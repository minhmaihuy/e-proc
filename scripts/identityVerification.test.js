import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const source = (...segments) => fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');

test('legacy tenants and batches remain off and no retention period is silently selected', () => {
  const control = source('src', 'server', 'db', 'controlPlane.ts');
  const data = source('src', 'server', 'db', 'postgres.ts');
  assert.match(control, /identity_verification VARCHAR\(16\) NOT NULL DEFAULT 'off'/);
  assert.match(control, /identity_retention_days INTEGER/);
  assert.doesNotMatch(control, /identity_retention_days INTEGER[^\n]*DEFAULT/);
  assert.match(control, /recording_retention_days INTEGER/);
  assert.doesNotMatch(control, /recording_retention_days INTEGER[^\n]*DEFAULT/);
  assert.match(data, /identity_verification VARCHAR\(16\) NOT NULL DEFAULT 'off'/);
  assert.match(data, /identity_status VARCHAR\(16\) NOT NULL DEFAULT 'not_required'/);
});

test('student identity mode and object keys are server-derived from control-plane, batch and JWT', () => {
  const student = source('src', 'server', 'routes', 'student.ts');
  const s3 = source('src', 'server', 'services', 's3.ts');
  assert.match(student, /const \{ access_code \} = req\.body/);
  assert.doesNotMatch(student, /const \{ access_code, identity/);
  assert.match(student, /SELECT identity_verification, identity_retention_days FROM tenants WHERE slug = \?/);
  assert.match(student, /const \{ studentId, batchId \} = req\.studentPayload!/);
  assert.match(student, /finalizeIdentityObjects\(\{ batchId, studentId, captureId: student\.identity_capture_id \}\)/);
  assert.doesNotMatch(student, /req\.body\?\.(?:studentId|batchId|key)/);
  assert.match(s3, /`identity\/\$\{batchId\}\/\$\{studentId\}\/\$\{captureId\}\/\$\{kind\}\.jpg`/);
  assert.match(s3, /CopyObjectCommand/);
  assert.match(student, /!\['pending', 'rejected'\]\.includes\(student\.identity_status\)/,
    'captured/verified evidence must not receive a new upload URL');
});

test('assessment content is blocked by backend until manual photo review is verified', () => {
  const student = source('src', 'server', 'routes', 'student.ts');
  assert.match(student, /async function requireStudentIdentity/);
  assert.match(student, /reason: 'identity_required'/);
  for (const route of ["router.post('/exam/start'", "router.get('/exam/questions'", "router.get('/practice'"]) {
    const start = student.indexOf(route);
    assert.notEqual(start, -1, `${route} must exist`);
    assert.match(student.slice(start, start + 900), /requireStudentIdentity/);
  }
});

test('identity evidence is private, short-lived, audited and raw keys are stripped from list APIs', () => {
  const admin = source('src', 'server', 'routes', 'admin.ts');
  const s3 = source('src', 'server', 'services', 's3.ts');
  assert.match(admin, /router\.get\('\/batches\/:id\/students\/:studentId\/identity', requireTenantDataAdmin/);
  assert.match(admin, /tenant\.identity_viewed/);
  assert.match(s3, /RECORDING_VIEW_EXPIRES_SECONDS = 5 \* 60/);
  assert.match(admin, /identity_id_key: _identityIdKey/);
  assert.match(admin, /identity_face_key: _identityFaceKey/);
  assert.match(admin, /identity_capture_id: _identityCaptureId/);
  assert.doesNotMatch(admin, /res\.json\(\{[^}]*identity_(?:id|face)_key/s);
  assert.match(admin, /review_token: identityReviewToken/);
  assert.match(admin, /identity_capture_id = \? AND identity_status = 'captured'/);
  assert.match(admin, /reviewed\.rowCount !== 1/);
});

test('Terraform creates isolated private evidence storage with ordered lifecycles and prefix-only object IAM', () => {
  const terraform = source('terraform', 'tenant-instance', 'main.tf');
  const variables = source('terraform', 'tenant-instance', 'variables.tf');
  const bootstrap = source('terraform', 'tenant-instance', 'user-data.sh.tftpl');
  assert.match(terraform, /resource "aws_s3_bucket" "identity"/);
  assert.match(terraform, /resource "aws_s3_bucket_public_access_block" "identity"/);
  assert.match(terraform, /filter \{ prefix = "identity\/" \}/);
  assert.match(terraform, /expiration \{ days = var\.identity_retention_days \}/);
  assert.match(terraform, /Action\s*= \["s3:GetObject", "s3:PutObject"\]/);
  assert.match(terraform, /Resource = "\$\{aws_s3_bucket\.identity\[0\]\.arn\}\/identity\/\*"/);
  assert.match(terraform, /resource "aws_s3_bucket" "recording"/);
  assert.match(terraform, /resource "aws_s3_bucket_public_access_block" "recording"/);
  assert.match(terraform, /filter \{ prefix = "recordings\/" \}/);
  assert.match(terraform, /expiration \{ days = var\.recording_retention_days \}/);
  assert.match(terraform, /Resource = "\$\{aws_s3_bucket\.recording\[0\]\.arn\}\/recordings\/\*"/);
  assert.match(terraform, /identity_retention_days < var\.recording_retention_days/);
  assert.match(terraform, /user_data_replace_on_change\s*=\s*true/);
  assert.match(variables, /identity_retention_days/);
  assert.match(variables, /recording_retention_days/);
  assert.match(variables, /default\s*= null/);
  assert.match(bootstrap, /S3_IDENTITY_BUCKET/);
  assert.match(bootstrap, /S3_RECORDINGS_BUCKET/);
});

test('photo UI explains collection, audience and retention while face_match remains unavailable', () => {
  const confirm = source('client', 'src', 'pages', 'StudentConfirm.tsx');
  const tenants = source('client', 'src', 'pages', 'TenantManagement.tsx');
  const results = source('client', 'src', 'pages', 'Results.tsx');
  assert.match(confirm, /government ID photo and a current face photo/i);
  assert.match(confirm, /Only authorized tenant reviewers can view them/i);
  assert.match(confirm, /automatically deleted after/);
  assert.match(results, /Government ID/);
  assert.match(results, /Current face photo/);
  assert.match(results, /reviewStudentIdentity/);
  assert.match(results, /identityEvidence\.status === 'captured'/,
    'review actions must appear only for an unreviewed captured evidence set');
  assert.match(tenants, /Automated face matching is intentionally not available/);
  assert.match(tenants, /Screen recording retention \(days\)/);
  assert.match(tenants, /Identity-photo retention must be shorter than screen-recording retention/);
  assert.doesNotMatch(confirm, /Rekognition|identity_mismatch/);
});

test('tenant API persists both retention values and validates their ordering on the backend', () => {
  const routes = source('src', 'server', 'routes', 'tenants.ts');
  assert.match(routes, /validateEvidenceRetention\(\{/);
  assert.match(routes, /s3RecordingEnabled: parseAllowedRecordModes\(input\.allowedRecordModes\)\.includes\('s3'\)/);
  assert.match(routes, /identity_verification, identity_retention_days, recording_retention_days/);
  assert.match(routes, /identity_verification = \?, identity_retention_days = \?, recording_retention_days = \?/);
});
