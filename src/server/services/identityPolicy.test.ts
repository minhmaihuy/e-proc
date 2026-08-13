import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identitySatisfied,
  normalizeIdentityMode,
  resolveBatchIdentityMode,
  validateEvidenceRetention,
} from './identityPolicy.js';

test('off never blocks while photo requires manual verification', () => {
  assert.equal(identitySatisfied('off', 'pending'), true);
  assert.equal(identitySatisfied('photo', 'captured'), false);
  assert.equal(identitySatisfied('photo', 'verified'), true);
});

test('invalid modes fail safely to off', () => {
  assert.equal(normalizeIdentityMode('photo'), 'photo');
  assert.equal(normalizeIdentityMode('face_match'), 'face_match');
  assert.equal(normalizeIdentityMode('PHOTO'), 'off');
});

test('batch cannot silently elevate beyond the tenant mode', () => {
  const decision = resolveBatchIdentityMode({ requested: 'face_match', tenantMode: 'photo', canChange: true });
  assert.deepEqual(decision.mode, 'photo');
  assert.equal(decision.rejected, true);
  assert.match(decision.reason || '', /exceeds tenant mode/);
});

test('ordinary admin cannot change an existing batch identity mode', () => {
  const decision = resolveBatchIdentityMode({
    requested: 'off', tenantMode: 'photo', fallback: 'photo', canChange: false,
  });
  assert.deepEqual(decision, { mode: 'photo', rejected: false });
});

test('S3 recording and photo verification require explicit ordered retention', () => {
  assert.match(validateEvidenceRetention({
    identityMode: 'off', s3RecordingEnabled: true, identityRetentionDays: null, recordingRetentionDays: null,
  }) || '', /screen-recording retention/i);
  assert.match(validateEvidenceRetention({
    identityMode: 'photo', s3RecordingEnabled: false, identityRetentionDays: 30, recordingRetentionDays: null,
  }) || '', /screen-recording retention/i);
  assert.match(validateEvidenceRetention({
    identityMode: 'photo', s3RecordingEnabled: true, identityRetentionDays: 90, recordingRetentionDays: 90,
  }) || '', /shorter/);
  assert.match(validateEvidenceRetention({
    identityMode: 'photo', s3RecordingEnabled: true, identityRetentionDays: 120, recordingRetentionDays: 90,
  }) || '', /shorter/);
  assert.equal(validateEvidenceRetention({
    identityMode: 'photo', s3RecordingEnabled: true, identityRetentionDays: 30, recordingRetentionDays: 90,
  }), null);
});

test('inactive legacy evidence may remain nullable without silently choosing a retention', () => {
  assert.equal(validateEvidenceRetention({
    identityMode: 'off', s3RecordingEnabled: false, identityRetentionDays: null, recordingRetentionDays: null,
  }), null);
  assert.equal(validateEvidenceRetention({
    identityMode: 'off', s3RecordingEnabled: false, identityRetentionDays: 30, recordingRetentionDays: null,
  }), null);
});
