import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const source = (...segments) => fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');

test('email PII stays in assessment plane while tenant configuration and aggregates stay in control plane', () => {
  const data = source('src', 'server', 'db', 'postgres.ts');
  const control = source('src', 'server', 'db', 'controlPlane.ts');
  assert.match(data, /CREATE TABLE IF NOT EXISTS email_queue/);
  assert.match(data, /CREATE TABLE IF NOT EXISTS email_suppressions/);
  assert.match(data, /CREATE TABLE IF NOT EXISTS usage_outbox/);
  assert.match(data, /occurred_at/);
  assert.doesNotMatch(data, /CREATE TABLE IF NOT EXISTS tenant_usage/);
  assert.match(control, /email_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(control, /email_daily_limit INTEGER NOT NULL DEFAULT 200/);
  assert.match(control, /CREATE TABLE IF NOT EXISTS tenant_usage/);
  assert.match(control, /CREATE TABLE IF NOT EXISTS tenant_usage_events/);
  assert.doesNotMatch(control, /CREATE TABLE IF NOT EXISTS email_queue/);
});

test('email API is authenticated, tenant-scoped, asynchronous and fails closed when disabled or unconfigured', () => {
  const admin = source('src', 'server', 'routes', 'admin.ts');
  assert.ok(admin.indexOf('router.use(authMiddleware)') < admin.indexOf("router.post('/batches/:id/emails'"));
  assert.match(admin, /router\.post\('\/batches\/:id\/emails', requireTenantDataAdmin/);
  assert.match(admin, /!req\.adminUser\?\.emailEnabled[\s\S]{0,100}status\(403\)/);
  assert.match(admin, /!isEmailProviderConfigured\(\)[\s\S]{0,100}status\(503\)/);
  assert.match(admin, /enqueueEmail\(/);
  assert.doesNotMatch(admin, /SendEmailCommand/);
});

test('queue shares the existing tick, claims jobs, limits retries and records successful sends idempotently', () => {
  const cache = source('src', 'server', 'cache.ts');
  const delivery = source('src', 'server', 'services', 'emailDelivery.ts');
  assert.match(cache, /QUEUE_PROCESS_INTERVAL/);
  assert.match(cache, /processEmailQueue\(5\)/);
  assert.match(delivery, /status = 'sending'/);
  assert.match(delivery, /attempts >= 3/);
  assert.match(delivery, /email:\$\{job\.dedupe_key\}/);
  assert.match(delivery, /ConfigurationSetName/);
  assert.match(delivery, /sqlTimestamp/);
  assert.doesNotMatch(delivery, /Attachment|RawMessage/);
});

test('SNS webhook verifies signature and configured topic before suppressing bounce or complaint recipients', () => {
  const events = source('src', 'server', 'routes', 'emailEvents.ts');
  const index = source('src', 'server', 'index.ts');
  assert.match(events, /verifySnsSignature/);
  assert.match(events, /timingSafeEqual/);
  assert.match(events, /SES_SNS_TOPIC_ARN/);
  assert.match(events, /eventType === 'bounce'/);
  assert.match(events, /eventType === 'complaint'/);
  assert.match(events, /suppressRecipient/);
  assert.ok(index.indexOf("app.use('/api/email/events/sns'") < index.indexOf("app.use(express.json"),
    'the SNS 256 KB parser must run before the global 10 MB JSON parser');
});

test('all usage events have stable keys and no quota policy is called from live request paths', () => {
  const student = source('src', 'server', 'routes', 'student.ts');
  const cache = source('src', 'server', 'cache.ts');
  const delivery = source('src', 'server', 'services', 'emailDelivery.ts');
  const meter = source('src', 'server', 'services', 'usageMeter.ts');
  const outbox = source('src', 'server', 'services', 'usageOutbox.ts');
  const practiceUi = source('client', 'src', 'pages', 'StudentPractice.tsx');
  assert.match(student, /exam-start:\$\{student_id\}/);
  assert.match(student, /recording:\$\{studentId\}/);
  assert.match(student, /code-run:\$\{studentId\}:\$\{eventId\}/);
  assert.match(student, /ENABLE_SERVER_CODE_RUN[\s\S]{0,120}status\(503\)/);
  assert.match(cache, /ai-grading:\$\{job\.kind\}:\$\{job\.examQuestionId\}/);
  assert.match(cache, /withTransaction\(async \(tx\)/,
    'AI result, completed state and usage outbox event must commit atomically');
  assert.match(delivery, /email:\$\{job\.dedupe_key\}/);
  assert.match(meter, /ON CONFLICT \(event_key\) DO NOTHING/);
  assert.match(meter, /scopedEventKey = `\$\{tenantSlug\}:\$\{eventKey\}`/);
  assert.match(meter, /withTransaction/);
  assert.match(outbox, /reconcileUsageOutbox/);
  assert.match(outbox, /exam_started_at IS NOT NULL/);
  assert.match(outbox, /recording_finalized_at IS NOT NULL/);
  assert.match(outbox, /email_queue WHERE status = 'sent'/);
  assert.match(outbox, /recordUsageEvent\([\s\S]{0,180}usageEventDate\(row\.occurred_at\)/);
  assert.match(practiceUi, /recordLocalCodeRun\(crypto\.randomUUID\(\)\)/);
  assert.match(meter, /SELECT COALESCE\(SUM\(amount\), 0\)/);
  assert.doesNotMatch(student, /evaluateQuota|quotaPolicy/);
  assert.doesNotMatch(source('src', 'server', 'routes', 'admin.ts'), /evaluateQuota|quotaPolicy/);
});

test('tenant bootstrap preserves complete SES provider configuration from its protected secret', () => {
  const bootstrap = source('terraform', 'tenant-instance', 'user-data.sh.tftpl');
  assert.match(bootstrap, /SES_FROM_EMAIL/);
  assert.match(bootstrap, /SES_SNS_TOPIC_ARN/);
  assert.match(bootstrap, /SES_CONFIGURATION_SET/);
});

test('superadmin UI exposes email controls, quota values and current-month usage', () => {
  const ui = source('client', 'src', 'pages', 'TenantManagement.tsx');
  assert.match(ui, /email_enabled/);
  assert.match(ui, /quota_exams_per_month/);
  assert.match(ui, /Measured usage/);
  assert.match(ui, /UsageMeter/);
  assert.match(ui, /does not block|blocking is not enabled/i);
  const tenants = source('src', 'server', 'routes', 'tenants.ts');
  assert.match(tenants, /hasOwnProperty\.call\(input, snake\)/,
    'an explicit null must clear a quota instead of falling back to the existing value');
});
