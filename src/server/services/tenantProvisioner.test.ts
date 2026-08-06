import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ProvisionableTenant,
  redactProvisionLog,
  validateTenantForProvisioning,
} from './tenantProvisioner.js';

const validTenant: ProvisionableTenant = {
  id: 1,
  slug: 'acme-vietnam',
  status: 'approved',
  aws_region: 'ap-southeast-1',
  instance_type: 't3.micro',
  root_volume_size: 12,
  compiler_enabled: false,
  compiler_memory_mb: 512,
  compiler_timeout_seconds: 15,
  compiler_concurrency: 2,
  domain_name: 'acme.example.com',
  route53_zone_id: 'Z123456789',
  secret_arn: 'arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:eproc-acme',
  repository_url: 'https://github.com/minhmaihuy/e-proc.git',
  repository_ref: 'main',
};

test('provisioning validation accepts an approved, scoped tenant', () => {
  assert.equal(validateTenantForProvisioning(validTenant), null);
});

test('provisioning validation rejects unapproved tenants', () => {
  assert.match(
    validateTenantForProvisioning({ ...validTenant, status: 'pending' }) || '',
    /approved/,
  );
});

test('provisioning validation rejects unsafe slugs and malformed secret ARNs', () => {
  assert.match(
    validateTenantForProvisioning({ ...validTenant, slug: '../../other-tenant' }) || '',
    /slug/,
  );
  assert.match(
    validateTenantForProvisioning({ ...validTenant, secret_arn: "arn:aws:secretsmanager:x'; touch hacked" }) || '',
    /Secrets Manager ARN/,
  );
});

test('Terraform logs redact common credentials and database userinfo', () => {
  const output = redactProvisionLog(
    'password=SuperSecret123 token: abcdefghijklmnop postgresql://admin:dbpass@example.com/eproc',
  );
  assert.doesNotMatch(output, /SuperSecret123|abcdefghijklmnop|admin:dbpass/);
  assert.match(output, /\[REDACTED\]/);
});

test('tenant Terraform module exposes the application over IPv6 end to end', () => {
  const moduleRoot = path.resolve(process.cwd(), 'terraform', 'tenant-instance');
  const main = fs.readFileSync(path.join(moduleRoot, 'main.tf'), 'utf8');
  const outputs = fs.readFileSync(path.join(moduleRoot, 'outputs.tf'), 'utf8');
  const userData = fs.readFileSync(path.join(moduleRoot, 'user-data.sh.tftpl'), 'utf8');

  assert.match(main, /assign_generated_ipv6_cidr_block\s*=\s*true/);
  assert.match(main, /ipv6_cidr_block\s*=\s*"::\/0"/);
  assert.match(main, /resource\s+"aws_route53_record"\s+"app_ipv6"/);
  assert.match(outputs, /output\s+"ipv6_address"/);
  assert.match(userData, /listen \[::\]:80 default_server;/);
});
