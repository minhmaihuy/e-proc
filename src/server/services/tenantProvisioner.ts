import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import db from '../db/controlPlane.js';

const execFileAsync = promisify(execFile);
const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;
const SECRET_ARN_PATTERN = /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;
const ECR_IMAGE_PATTERN = /^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]{1,128}$/;
const MAX_LOG_LENGTH = 60_000;

export type ProvisionAction = 'plan' | 'apply';

export interface ProvisionableTenant {
  id: number;
  slug: string;
  name: string;
  contact_email: string;
  status: string;
  aws_region: string;
  instance_type: string;
  root_volume_size: number;
  compiler_enabled: boolean | number;
  compiler_memory_mb: number;
  compiler_timeout_seconds: number;
  compiler_concurrency: number;
  domain_name: string;
  route53_zone_id: string;
  secret_arn: string;
  repository_url: string;
  repository_ref: string;
}

interface TerraformOutput {
  value?: string;
}

export function redactProvisionLog(raw: string): string {
  return raw
    .replace(/(password|secret|token|api[_-]?key)(\s*[=:]\s*)[^\s,]+/gi, '$1$2[REDACTED]')
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, 'postgresql://[REDACTED]@')
    .slice(-MAX_LOG_LENGTH);
}

export function validateTenantForProvisioning(tenant: ProvisionableTenant): string | null {
  if (!SLUG_PATTERN.test(tenant.slug)) return 'Invalid tenant slug.';
  if (tenant.status !== 'approved') return 'Tenant must be approved before provisioning.';
  if (!SECRET_ARN_PATTERN.test(tenant.secret_arn || '')) return 'A valid AWS Secrets Manager ARN is required before provisioning.';
  if (Boolean(tenant.compiler_enabled) && !ECR_IMAGE_PATTERN.test(process.env.TENANT_COMPILER_IMAGE_URI?.trim() || '')) {
    return 'TENANT_COMPILER_IMAGE_URI must be a versioned ECR image URI when Lambda compiler is enabled.';
  }
  return null;
}

function errorText(error: unknown, field: 'stdout' | 'stderr' | 'message'): string {
  if (!error || typeof error !== 'object') return '';
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

function getProvisioningConfig() {
  const stateBucket = process.env.TERRAFORM_STATE_BUCKET?.trim();
  const lockTable = process.env.TERRAFORM_LOCK_TABLE?.trim();
  const stateRegion = process.env.TERRAFORM_STATE_REGION?.trim() || 'ap-southeast-1';

  if (process.env.TENANT_PROVISIONING_ENABLED !== 'true') {
    throw new Error('Tenant provisioning is disabled. Set TENANT_PROVISIONING_ENABLED=true.');
  }
  if (!stateBucket || !lockTable) {
    throw new Error('TERRAFORM_STATE_BUCKET and TERRAFORM_LOCK_TABLE are required for isolated remote state.');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(stateBucket)) throw new Error('Invalid TERRAFORM_STATE_BUCKET.');
  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(lockTable)) throw new Error('Invalid TERRAFORM_LOCK_TABLE.');

  return {
    terraformBin: process.env.TERRAFORM_BIN?.trim() || 'terraform',
    stateBucket,
    lockTable,
    stateRegion,
  };
}

async function readTerraformOutputs(binary: string, workingDirectory: string): Promise<Record<string, TerraformOutput>> {
  try {
    const result = await execFileAsync(binary, [`-chdir=${workingDirectory}`, 'output', '-json'], {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, TF_IN_AUTOMATION: '1', TF_INPUT: '0' },
    });
    return JSON.parse(result.stdout || '{}') as Record<string, TerraformOutput>;
  } catch (error: unknown) {
    throw new Error(redactProvisionLog(`${errorText(error, 'stderr')}\n${errorText(error, 'message') || 'Unable to read Terraform outputs'}`));
  }
}

function copyModule(source: string, destination: string) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.terraform' || entry.name.endsWith('.tfstate') || entry.name.endsWith('.tfplan')) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyModule(sourcePath, destinationPath);
    else fs.copyFileSync(sourcePath, destinationPath);
  }
}

async function runTerraform(binary: string, workingDirectory: string, args: string[]) {
  try {
    const result = await execFileAsync(binary, [`-chdir=${workingDirectory}`, ...args], {
      windowsHide: true,
      timeout: 30 * 60 * 1000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, TF_IN_AUTOMATION: '1', TF_INPUT: '0' },
    });
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  } catch (error: unknown) {
    const detail = `${errorText(error, 'stdout')}\n${errorText(error, 'stderr')}\n${errorText(error, 'message') || 'Terraform command failed'}`;
    throw new Error(redactProvisionLog(detail));
  }
}

async function appendJobLog(jobId: number, output: string) {
  const current = await db.query('SELECT log_output FROM tenant_provision_jobs WHERE id = ?', [jobId]);
  const combined = `${current.rows[0]?.log_output || ''}\n${redactProvisionLog(output)}`.slice(-MAX_LOG_LENGTH);
  await db.query('UPDATE tenant_provision_jobs SET log_output = ? WHERE id = ?', [combined, jobId]);
}

export async function runTenantProvisioning(
  tenant: ProvisionableTenant,
  action: ProvisionAction,
  jobId: number,
): Promise<void> {
  try {
    const validationError = validateTenantForProvisioning(tenant);
    if (validationError) throw new Error(validationError);

    const config = getProvisioningConfig();
    const moduleSource = path.resolve(process.cwd(), 'terraform', 'tenant-instance');
    const workRoot = path.resolve(process.env.TENANT_TERRAFORM_WORKDIR || path.join(process.cwd(), 'data', 'tenant-terraform'));
    const workingDirectory = path.resolve(workRoot, tenant.slug);
    if (!workingDirectory.startsWith(`${workRoot}${path.sep}`)) throw new Error('Invalid Terraform working directory.');

    copyModule(moduleSource, workingDirectory);
    const tfvars = {
      tenant_slug: tenant.slug,
      tenant_name: tenant.name,
      tenant_contact_email: tenant.contact_email,
      aws_region: tenant.aws_region,
      instance_type: tenant.instance_type,
      root_volume_size: Number(tenant.root_volume_size),
      compiler_enabled: Boolean(tenant.compiler_enabled),
      compiler_image_uri: Boolean(tenant.compiler_enabled) ? process.env.TENANT_COMPILER_IMAGE_URI!.trim() : '',
      compiler_memory_mb: Number(tenant.compiler_memory_mb),
      compiler_timeout_seconds: Number(tenant.compiler_timeout_seconds),
      compiler_concurrency: Number(tenant.compiler_concurrency),
      domain_name: tenant.domain_name || '',
      route53_zone_id: tenant.route53_zone_id || '',
      secret_arn: tenant.secret_arn,
      repository_url: tenant.repository_url,
      repository_ref: tenant.repository_ref,
      tags: { TenantId: String(tenant.id), Environment: 'production' },
    };
    fs.writeFileSync(path.join(workingDirectory, 'tenant.auto.tfvars.json'), JSON.stringify(tfvars, null, 2), { mode: 0o600 });

    const stateKey = `tenants/${tenant.slug}/terraform.tfstate`;
    await db.query(
      "UPDATE tenant_provision_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?",
      [jobId],
    );
    await db.query(
      "UPDATE tenants SET provision_status = ?, terraform_state_key = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [action === 'plan' ? 'planning' : 'applying', stateKey, tenant.id],
    );

    const initLog = await runTerraform(config.terraformBin, workingDirectory, [
      'init', '-reconfigure',
      `-backend-config=bucket=${config.stateBucket}`,
      `-backend-config=key=${stateKey}`,
      `-backend-config=region=${config.stateRegion}`,
      `-backend-config=dynamodb_table=${config.lockTable}`,
      '-backend-config=encrypt=true',
    ]);
    await appendJobLog(jobId, initLog);
    await appendJobLog(jobId, await runTerraform(config.terraformBin, workingDirectory, ['fmt', '-check', '-recursive']));
    await appendJobLog(jobId, await runTerraform(config.terraformBin, workingDirectory, ['validate', '-no-color']));
    await appendJobLog(jobId, await runTerraform(config.terraformBin, workingDirectory, ['plan', '-no-color', '-out=tenant.tfplan']));

    if (action === 'apply') {
      await appendJobLog(jobId, await runTerraform(config.terraformBin, workingDirectory, ['apply', '-no-color', '-auto-approve', 'tenant.tfplan']));
      const outputs = await readTerraformOutputs(config.terraformBin, workingDirectory);
      await db.query(
        `UPDATE tenants SET provision_status = 'active', instance_id = ?, public_ip = ?, ipv6_address = ?, app_url = ?, compiler_lambda_arn = ?,
         last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [outputs.instance_id?.value || null, outputs.public_ip?.value || null, outputs.ipv6_address?.value || null,
          outputs.app_url?.value || null, outputs.compiler_lambda_arn?.value || null, tenant.id],
      );
    } else {
      await db.query(
        "UPDATE tenants SET provision_status = 'planned', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [tenant.id],
      );
    }

    await db.query(
      "UPDATE tenant_provision_jobs SET status = 'succeeded', finished_at = CURRENT_TIMESTAMP WHERE id = ?",
      [jobId],
    );
  } catch (error: unknown) {
    const message = redactProvisionLog(errorText(error, 'message') || 'Provisioning failed');
    await appendJobLog(jobId, message).catch(() => undefined);
    await db.query(
      "UPDATE tenant_provision_jobs SET status = 'failed', finished_at = CURRENT_TIMESTAMP WHERE id = ?",
      [jobId],
    ).catch(() => undefined);
    await db.query(
      "UPDATE tenants SET provision_status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [message.slice(-4000), tenant.id],
    ).catch(() => undefined);
  }
}
