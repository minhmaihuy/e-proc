import test from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveBatchIdentityMode,
  effectiveBatchRecordMode,
  resolveTenantEvidencePolicy,
} from './tenantEvidencePolicy.js';

test("effective recording policy always includes 'none' and keeps local without retention", () => {
  const policy = resolveTenantEvidencePolicy({
    allowedRecordModes: 'local,s3',
    identityVerification: 'off',
    identityRetentionDays: null,
    recordingRetentionDays: null,
  });

  assert.deepEqual(policy.allowedRecordModes, ['none', 'local']);
  assert.equal(policy.identityVerification, 'off');
});

test('S3 is effective only with an integer recording retention from 1 to 365 days', () => {
  for (const invalid of [null, '', 0, 366, 12.5, 'not-a-number']) {
    const policy = resolveTenantEvidencePolicy({
      allowedRecordModes: 'none,s3',
      identityVerification: 'off',
      identityRetentionDays: null,
      recordingRetentionDays: invalid,
    });
    assert.deepEqual(policy.allowedRecordModes, ['none'], `retention ${String(invalid)} phải vô hiệu S3`);
  }

  for (const valid of [1, 365, '90']) {
    const policy = resolveTenantEvidencePolicy({
      allowedRecordModes: 'none,s3',
      identityVerification: 'off',
      identityRetentionDays: null,
      recordingRetentionDays: valid,
    });
    assert.deepEqual(policy.allowedRecordModes, ['none', 's3']);
  }
});

test('photo is effective only with valid ordered identity and recording retention', () => {
  for (const [identityRetentionDays, recordingRetentionDays] of [
    [null, 90], [30, null], [0, 90], [30, 366], [90, 90], [120, 90], [30.5, 90],
  ] as const) {
    const policy = resolveTenantEvidencePolicy({
      allowedRecordModes: 'none',
      identityVerification: 'photo',
      identityRetentionDays,
      recordingRetentionDays,
    });
    assert.equal(policy.identityVerification, 'off');
  }

  const effective = resolveTenantEvidencePolicy({
    allowedRecordModes: 'none',
    identityVerification: 'photo',
    identityRetentionDays: 30,
    recordingRetentionDays: 90,
  });
  assert.equal(effective.identityVerification, 'photo');
  assert.equal(effective.identityRetentionDays, 30);
  assert.equal(effective.recordingRetentionDays, 90);
});

test('unsupported face_match and invalid identity values fail safely to off', () => {
  for (const identityVerification of ['face_match', 'PHOTO', 'unknown', null]) {
    const policy = resolveTenantEvidencePolicy({
      allowedRecordModes: 'none',
      identityVerification,
      identityRetentionDays: 30,
      recordingRetentionDays: 90,
    });
    assert.equal(policy.identityVerification, 'off');
  }
});

test('stored and legacy batch recording modes are clamped to the current effective allowlist', () => {
  assert.equal(effectiveBatchRecordMode('local', false, ['none', 'local']), 'local');
  assert.equal(effectiveBatchRecordMode('local', false, ['none']), 'none');
  assert.equal(effectiveBatchRecordMode('s3', true, ['none', 'local']), 'none');
  assert.equal(effectiveBatchRecordMode(null, true, ['none', 's3']), 's3');
  assert.equal(effectiveBatchRecordMode('', 1, ['none']), 'none');
  assert.equal(effectiveBatchRecordMode('invalid', false, ['none', 'local', 's3']), 'none');
});

test('batch photo mode is clamped to the effective tenant identity capability', () => {
  assert.equal(effectiveBatchIdentityMode('photo', 'photo'), 'photo');
  assert.equal(effectiveBatchIdentityMode('photo', 'off'), 'off');
  assert.equal(effectiveBatchIdentityMode('face_match', 'photo'), 'off');
  assert.equal(effectiveBatchIdentityMode('off', 'photo'), 'off');
});
