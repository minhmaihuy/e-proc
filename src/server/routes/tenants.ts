import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/controlPlane.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';
import { ProvisionAction, ProvisionableTenant, runTenantProvisioning } from '../services/tenantProvisioner.js';
import {
  TenantIssueFilterError,
  parseTenantIssueFilters,
} from '../services/tenantIssueQuery.js';
import { TenantLogAccessError, readTenantIssues } from '../services/tenantLogReader.js';
import { isTenantDomainForSlug, tenantDomainForSlug } from '../tenantContext.js';
import { serializeAllowedRecordModes } from '../services/recordingPolicy.js';
import { isBackupRetentionDays } from '../services/backupPolicy.js';

const router = Router();
router.use(authMiddleware);
router.use(requireSuperAdmin);

const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGION_PATTERN = /^[a-z]{2}-[a-z]+-[0-9]$/;
const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const INSTANCE_TYPES = new Set(['t3.micro', 't3.small', 't3.medium', 't4g.micro', 't4g.small', 't4g.medium']);
const SECRET_ARN_PATTERN = /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;

interface TenantInput {
  name: string;
  slug: string;
  contactEmail: string;
  awsRegion: string;
  instanceType: string;
  rootVolumeSize: number;
  backupRetentionDays: number;
  emailEnabled: boolean;
  emailFromName: string | null;
  emailDailyLimit: number;
  quotaExamsPerMonth: number | null;
  quotaAiGradingsPerMonth: number | null;
  quotaRecordingGb: number | null;
  quotaEmailsPerMonth: number | null;
  compilerEnabled: boolean;
  compilerMemoryMb: number;
  compilerTimeoutSeconds: number;
  compilerConcurrency: number;
  domainName: string;
  route53ZoneId: string;
  secretArn: string;
  allowedRecordModes: string;
  repositoryUrl: string;
  repositoryRef: string;
}

interface TenantRow extends ProvisionableTenant {
  name: string;
  contact_email: string;
  created_at?: string;
  approved_at?: string;
  provision_status?: string;
  [key: string]: unknown;
}

function normalizeTenantInput(body: unknown, existing?: Partial<TenantRow>): TenantInput {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const slug = String(input.slug ?? existing?.slug ?? '').trim().toLowerCase();
  const configuredDomain = String(input.domain_name ?? input.domainName ?? existing?.domain_name ?? '').trim().toLowerCase();
  const nullableNumber = (snake: string, camel: string): number | null => {
    const value = Object.prototype.hasOwnProperty.call(input, snake) ? input[snake]
      : Object.prototype.hasOwnProperty.call(input, camel) ? input[camel]
        : existing?.[snake];
    return value === '' || value == null ? null : Number(value);
  };
  const booleanValue = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 'true';
  return {
    name: String(input.name ?? existing?.name ?? '').trim(),
    slug,
    contactEmail: String(input.contact_email ?? input.contactEmail ?? existing?.contact_email ?? '').trim().toLowerCase(),
    awsRegion: String(input.aws_region ?? input.awsRegion ?? existing?.aws_region ?? 'ap-southeast-1').trim(),
    instanceType: String(input.instance_type ?? input.instanceType ?? existing?.instance_type ?? 't3.micro').trim(),
    rootVolumeSize: Number(input.root_volume_size ?? input.rootVolumeSize ?? existing?.root_volume_size ?? 12),
    backupRetentionDays: Number(
      input.backup_retention_days ?? input.backupRetentionDays ?? existing?.backup_retention_days ?? 14,
    ),
    emailEnabled: booleanValue(input.email_enabled ?? input.emailEnabled ?? existing?.email_enabled ?? false),
    emailFromName: String(input.email_from_name ?? input.emailFromName ?? existing?.email_from_name ?? '').trim() || null,
    emailDailyLimit: Number(input.email_daily_limit ?? input.emailDailyLimit ?? existing?.email_daily_limit ?? 200),
    quotaExamsPerMonth: nullableNumber('quota_exams_per_month', 'quotaExamsPerMonth'),
    quotaAiGradingsPerMonth: nullableNumber('quota_ai_gradings_per_month', 'quotaAiGradingsPerMonth'),
    quotaRecordingGb: nullableNumber('quota_recording_gb', 'quotaRecordingGb'),
    quotaEmailsPerMonth: nullableNumber('quota_emails_per_month', 'quotaEmailsPerMonth'),
    compilerEnabled: booleanValue(input.compiler_enabled ?? input.compilerEnabled ?? existing?.compiler_enabled ?? false),
    compilerMemoryMb: Number(input.compiler_memory_mb ?? input.compilerMemoryMb ?? existing?.compiler_memory_mb ?? 512),
    compilerTimeoutSeconds: Number(input.compiler_timeout_seconds ?? input.compilerTimeoutSeconds ?? existing?.compiler_timeout_seconds ?? 15),
    compilerConcurrency: Number(input.compiler_concurrency ?? input.compilerConcurrency ?? existing?.compiler_concurrency ?? 2),
    domainName: configuredDomain || tenantDomainForSlug(slug),
    route53ZoneId: String(input.route53_zone_id ?? input.route53ZoneId ?? existing?.route53_zone_id ?? '').trim(),
    secretArn: String(input.secret_arn ?? input.secretArn ?? existing?.secret_arn ?? '').trim(),
    // Chuẩn hóa tại đây để dữ liệu bẩn từ client không lọt xuống DB.
    allowedRecordModes: serializeAllowedRecordModes(
      input.allowed_record_modes ?? input.allowedRecordModes ?? existing?.allowed_record_modes ?? 'none',
    ),
    repositoryUrl: String(input.repository_url ?? input.repositoryUrl ?? existing?.repository_url ?? 'https://github.com/minhmaihuy/e-proc.git').trim(),
    repositoryRef: String(input.repository_ref ?? input.repositoryRef ?? existing?.repository_ref ?? 'main').trim(),
  };
}

function validateTenantInput(input: TenantInput, requireSecret: boolean): string | null {
  if (input.name.length < 2 || input.name.length > 160) return 'Tenant name must be 2-160 characters.';
  if (!SLUG_PATTERN.test(input.slug)) return 'Slug must be 3-31 lowercase letters, numbers or hyphens.';
  if (!EMAIL_PATTERN.test(input.contactEmail) || input.contactEmail.length > 254) return 'A valid contact email is required.';
  if (!REGION_PATTERN.test(input.awsRegion)) return 'Invalid AWS region.';
  if (!INSTANCE_TYPES.has(input.instanceType)) return 'Unsupported EC2 instance type.';
  if (!Number.isInteger(input.rootVolumeSize) || input.rootVolumeSize < 8 || input.rootVolumeSize > 100) return 'Root volume must be 8-100 GiB.';
  if (!isBackupRetentionDays(input.backupRetentionDays)) return 'Backup retention must be 1-35 days.';
  if (input.emailFromName && input.emailFromName.length > 160) return 'Email sender name must be at most 160 characters.';
  if (!Number.isInteger(input.emailDailyLimit) || input.emailDailyLimit < 1 || input.emailDailyLimit > 50000) return 'Email daily limit must be 1-50000.';
  for (const [label, value] of [
    ['Exam quota', input.quotaExamsPerMonth],
    ['AI grading quota', input.quotaAiGradingsPerMonth],
    ['Email quota', input.quotaEmailsPerMonth],
  ] as const) {
    if (value != null && (!Number.isInteger(value) || value < 1)) return `${label} must be a positive integer or unlimited.`;
  }
  if (input.quotaRecordingGb != null && (!Number.isFinite(input.quotaRecordingGb) || input.quotaRecordingGb <= 0)) return 'Recording quota must be positive or unlimited.';
  if (!Number.isInteger(input.compilerMemoryMb) || input.compilerMemoryMb < 256 || input.compilerMemoryMb > 3008) return 'Compiler memory must be 256-3008 MB.';
  if (!Number.isInteger(input.compilerTimeoutSeconds) || input.compilerTimeoutSeconds < 10 || input.compilerTimeoutSeconds > 30) return 'Compiler timeout must be 10-30 seconds.';
  if (!Number.isInteger(input.compilerConcurrency) || input.compilerConcurrency < 1 || input.compilerConcurrency > 20) return 'Compiler concurrency must be 1-20.';
  if (input.domainName && !DOMAIN_PATTERN.test(input.domainName)) return 'Domain name must be a valid FQDN.';
  const requiredDomain = tenantDomainForSlug(input.slug);
  if (input.domainName && !isTenantDomainForSlug(input.domainName, input.slug)) return `Domain name must be ${requiredDomain}.`;
  if (input.route53ZoneId && !/^[A-Z0-9]{6,64}$/.test(input.route53ZoneId)) return 'Invalid Route53 hosted zone ID.';
  if (input.secretArn && !SECRET_ARN_PATTERN.test(input.secretArn)) return 'Invalid AWS Secrets Manager ARN.';
  if (requireSecret && !input.secretArn) return 'A Secrets Manager ARN is required.';
  if (requireSecret && !input.domainName) return 'A dedicated tenant domain is required before approval.';
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(input.repositoryUrl)) return 'Repository must be an HTTPS GitHub .git URL.';
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(input.repositoryRef) || input.repositoryRef.includes('..')) return 'Invalid repository ref.';
  return null;
}

function canAccessTenant(req: Request, tenantId: number): boolean {
  return req.adminUser?.role === 'superadmin' && Number.isInteger(tenantId) && tenantId > 0;
}

function publicTenant(row: TenantRow, isSuperAdmin: boolean) {
  return {
    ...row,
    secret_arn: isSuperAdmin ? row.secret_arn : row.secret_arn ? 'configured' : '',
  };
}

async function audit(tenantId: number, actorId: number, action: string, detail?: Record<string, unknown>) {
  await db.query(
    'INSERT INTO tenant_audit_events (tenant_id, actor_id, action, detail) VALUES (?, ?, ?, ?)',
    [tenantId, actorId, action, detail ? JSON.stringify(detail) : null],
  );
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await db.query(`
      SELECT t.*,
        (SELECT COUNT(*) FROM admin_users u WHERE u.tenant_id = t.id AND u.role = 'tenant_admin') AS admin_count,
        COALESCE((SELECT exams_started FROM tenant_usage x WHERE x.tenant_id = t.id AND x.period_month = ?), 0) AS usage_exams_started,
        COALESCE((SELECT ai_gradings FROM tenant_usage x WHERE x.tenant_id = t.id AND x.period_month = ?), 0) AS usage_ai_gradings,
        COALESCE((SELECT recording_minutes FROM tenant_usage x WHERE x.tenant_id = t.id AND x.period_month = ?), 0) AS usage_recording_minutes,
        COALESCE((SELECT emails_sent FROM tenant_usage x WHERE x.tenant_id = t.id AND x.period_month = ?), 0) AS usage_emails_sent,
        COALESCE((SELECT code_runs FROM tenant_usage x WHERE x.tenant_id = t.id AND x.period_month = ?), 0) AS usage_code_runs
      FROM tenants t ORDER BY t.created_at DESC
    `, Array(5).fill(new Date().toISOString().slice(0, 7)));
    return res.json(result.rows.map((row) => publicTenant(row as TenantRow, true)));
  } catch (error) {
    console.error('[Tenants] List failed:', error);
    return res.status(500).json({ error: 'Failed to load tenants.' });
  }
});

router.get('/:id/issues', async (req: Request, res: Response) => {
  const tenantId = Number(req.params.id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) return res.status(400).json({ error: 'Invalid tenant ID.' });
  try {
    const filters = parseTenantIssueFilters(req.query as Record<string, unknown>);
    const result = await db.query(
      'SELECT id, slug, aws_region, secret_arn FROM tenants WHERE id = ?',
      [tenantId],
    );
    const tenant = result.rows[0] as Pick<TenantRow, 'id' | 'slug' | 'aws_region' | 'secret_arn'> | undefined;
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
    const issues = await readTenantIssues({
      slug: tenant.slug,
      awsRegion: tenant.aws_region,
      secretArn: tenant.secret_arn,
    }, filters);
    await audit(tenantId, req.adminUser!.id, 'tenant.logs_viewed', {
      status: filters.status || 'all',
      severity: filters.severity || 'all',
      limit: filters.limit,
      result_count: issues.length,
    });
    return res.json(issues);
  } catch (error) {
    if (error instanceof TenantIssueFilterError) return res.status(400).json({ error: error.message });
    if (error instanceof TenantLogAccessError) {
      console.error('[Tenants] Log observation failed:', { tenantId, code: error.code });
      return res.status(error.code === 'NOT_CONFIGURED' ? 409 : 502).json({ error: error.message });
    }
    console.error('[Tenants] Log observation failed:', { tenantId, code: 'UNEXPECTED' });
    return res.status(500).json({ error: 'Failed to load tenant issues.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || !canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Forbidden.' });
    const result = await db.query('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Tenant not found.' });
    return res.json(publicTenant(result.rows[0] as TenantRow, req.adminUser?.role === 'superadmin'));
  } catch (error) {
    console.error('[Tenants] Get failed:', error);
    return res.status(500).json({ error: 'Failed to load tenant.' });
  }
});

router.post('/', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const input = normalizeTenantInput(req.body);
    const validationError = validateTenantInput(input, false);
    if (validationError) return res.status(400).json({ error: validationError });

    const username = String(req.body.admin_username || '').trim();
    const password = String(req.body.admin_password || '');
    if (!/^[A-Za-z0-9_.@-]{3,100}$/.test(username)) return res.status(400).json({ error: 'Tenant admin username is invalid.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Tenant admin password must be 8-128 characters.' });

    const duplicate = await db.query('SELECT id FROM tenants WHERE slug = ?', [input.slug]);
    if (duplicate.rows.length) return res.status(409).json({ error: 'Tenant slug already exists.' });
    const duplicateUser = await db.query('SELECT id FROM admin_users WHERE username = ?', [username]);
    if (duplicateUser.rows.length) return res.status(409).json({ error: 'Username already exists.' });

    const created = await db.query(
      `INSERT INTO tenants
       (slug, name, contact_email, aws_region, instance_type, root_volume_size, compiler_enabled,
        backup_retention_days, email_enabled, email_from_name, email_daily_limit,
        quota_exams_per_month, quota_ai_gradings_per_month, quota_recording_gb, quota_emails_per_month,
        compiler_memory_mb, compiler_timeout_seconds, compiler_concurrency, domain_name,
        route53_zone_id, secret_arn, allowed_record_modes, repository_url, repository_ref, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.slug, input.name, input.contactEmail, input.awsRegion, input.instanceType,
        input.rootVolumeSize, input.compilerEnabled, input.backupRetentionDays, input.emailEnabled, input.emailFromName,
        input.emailDailyLimit, input.quotaExamsPerMonth, input.quotaAiGradingsPerMonth, input.quotaRecordingGb,
        input.quotaEmailsPerMonth, input.compilerMemoryMb, input.compilerTimeoutSeconds,
        input.compilerConcurrency, input.domainName, input.route53ZoneId, input.secretArn,
        input.allowedRecordModes, input.repositoryUrl, input.repositoryRef, req.adminUser!.id],
    );
    const tenantId = Number(created.lastInsertRowid || (await db.query('SELECT id FROM tenants WHERE slug = ?', [input.slug])).rows[0]?.id);
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      await db.query(
        'INSERT INTO admin_users (username, password_hash, role, tenant_id) VALUES (?, ?, ?, ?)',
        [username, passwordHash, 'tenant_admin', tenantId],
      );
    } catch (userError) {
      // Compensating write for databases where this lightweight abstraction cannot
      // keep INSERTs on one explicit transaction/connection.
      await db.query('DELETE FROM tenants WHERE id = ?', [tenantId]).catch(() => undefined);
      throw userError;
    }
    await audit(tenantId, req.adminUser!.id, 'tenant.created', { username });
    return res.status(201).json({ success: true, id: tenantId });
  } catch (error) {
    console.error('[Tenants] Create failed:', error);
    return res.status(500).json({ error: 'Failed to create tenant.' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || !canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Forbidden.' });
    const result = await db.query('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    const existing = result.rows[0] as TenantRow | undefined;
    if (!existing) return res.status(404).json({ error: 'Tenant not found.' });
    if (existing.provision_status === 'applying' || existing.provision_status === 'planning') {
      return res.status(409).json({ error: 'Configuration cannot change while Terraform is running.' });
    }

    const input = normalizeTenantInput(req.body, existing);
    input.slug = existing.slug;
    const validationError = validateTenantInput(input, false);
    if (validationError) return res.status(400).json({ error: validationError });

    await db.query(
      `UPDATE tenants SET name = ?, contact_email = ?, aws_region = ?, instance_type = ?,
       root_volume_size = ?, backup_retention_days = ?, compiler_enabled = ?, compiler_memory_mb = ?, compiler_timeout_seconds = ?,
       email_enabled = ?, email_from_name = ?, email_daily_limit = ?, quota_exams_per_month = ?,
       quota_ai_gradings_per_month = ?, quota_recording_gb = ?, quota_emails_per_month = ?,
       compiler_concurrency = ?, domain_name = ?, route53_zone_id = ?, secret_arn = ?,
       allowed_record_modes = ?, repository_url = ?, repository_ref = ?,
       status = 'pending', provision_status = 'not_started',
       approved_by = NULL, approved_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [input.name, input.contactEmail, input.awsRegion, input.instanceType, input.rootVolumeSize, input.backupRetentionDays,
        input.compilerEnabled, input.compilerMemoryMb, input.compilerTimeoutSeconds, input.emailEnabled, input.emailFromName,
        input.emailDailyLimit, input.quotaExamsPerMonth, input.quotaAiGradingsPerMonth, input.quotaRecordingGb,
        input.quotaEmailsPerMonth, input.compilerConcurrency,
        input.domainName, input.route53ZoneId, input.secretArn, input.allowedRecordModes,
        input.repositoryUrl, input.repositoryRef, tenantId],
    );
    await audit(tenantId, req.adminUser!.id, 'tenant.configuration_updated');
    return res.json({ success: true, status: 'pending' });
  } catch (error) {
    console.error('[Tenants] Update failed:', error);
    return res.status(500).json({ error: 'Failed to update tenant.' });
  }
});

router.post('/:id/approve', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.params.id);
    const result = await db.query('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    const tenant = result.rows[0] as TenantRow | undefined;
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
    const validationError = validateTenantInput(normalizeTenantInput(tenant, tenant), true);
    if (validationError) return res.status(400).json({ error: validationError });

    await db.query(
      "UPDATE tenants SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [req.adminUser!.id, tenantId],
    );
    await audit(tenantId, req.adminUser!.id, 'tenant.approved');
    return res.json({ success: true });
  } catch (error) {
    console.error('[Tenants] Approve failed:', error);
    return res.status(500).json({ error: 'Failed to approve tenant.' });
  }
});

router.post('/:id/suspend', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.params.id);
    const existing = await db.query('SELECT id FROM tenants WHERE id = ?', [tenantId]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Tenant not found.' });
    await db.query("UPDATE tenants SET status = 'suspended', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [tenantId]);
    await audit(tenantId, req.adminUser!.id, 'tenant.suspended');
    return res.json({ success: true });
  } catch (error) {
    console.error('[Tenants] Suspend failed:', error);
    return res.status(500).json({ error: 'Failed to suspend tenant.' });
  }
});

router.get('/:id/jobs', async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || !canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Forbidden.' });
    const jobs = await db.query(
      'SELECT id, action, status, log_output, started_at, finished_at, created_at FROM tenant_provision_jobs WHERE tenant_id = ? ORDER BY created_at DESC',
      [tenantId],
    );
    return res.json(jobs.rows);
  } catch (error) {
    console.error('[Tenants] Jobs failed:', error);
    return res.status(500).json({ error: 'Failed to load provisioning jobs.' });
  }
});

async function queueProvision(req: Request, res: Response, action: ProvisionAction) {
  try {
    const tenantId = Number(req.params.id);
    const result = await db.query('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    const tenant = result.rows[0] as ProvisionableTenant | undefined;
    if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
    if (tenant.status !== 'approved') return res.status(409).json({ error: 'Tenant must be approved first.' });

    if (action === 'apply') {
      const reviewedPlan = await db.query(
        `SELECT id FROM tenant_provision_jobs
         WHERE tenant_id = ? AND action = 'plan' AND status = 'succeeded'
           AND created_at >= (SELECT approved_at FROM tenants WHERE id = ?)
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, tenantId],
      );
      if (!reviewedPlan.rows.length) {
        return res.status(409).json({ error: 'Run and review a successful Terraform plan after the latest approval.' });
      }
    }

    const running = await db.query(
      "SELECT id FROM tenant_provision_jobs WHERE tenant_id = ? AND status IN ('queued', 'running')",
      [tenantId],
    );
    if (running.rows.length) return res.status(409).json({ error: 'A Terraform job is already running for this tenant.' });

    const created = await db.query(
      'INSERT INTO tenant_provision_jobs (tenant_id, action, requested_by) VALUES (?, ?, ?)',
      [tenantId, action, req.adminUser!.id],
    );
    const fallback = await db.query('SELECT id FROM tenant_provision_jobs WHERE tenant_id = ? ORDER BY id DESC LIMIT 1', [tenantId]);
    const jobId = Number(created.lastInsertRowid || fallback.rows[0]?.id);
    await audit(tenantId, req.adminUser!.id, `terraform.${action}_queued`, { jobId });
    void runTenantProvisioning(tenant, action, jobId);
    return res.status(202).json({ success: true, jobId });
  } catch (error) {
    console.error(`[Tenants] Terraform ${action} queue failed:`, error);
    return res.status(500).json({ error: `Failed to queue Terraform ${action}.` });
  }
}

router.post('/:id/plan', requireSuperAdmin, (req, res) => queueProvision(req, res, 'plan'));
router.post('/:id/provision', requireSuperAdmin, (req, res) => queueProvision(req, res, 'apply'));

export default router;
