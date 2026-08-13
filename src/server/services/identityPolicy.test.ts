import test from 'node:test';
import assert from 'node:assert/strict';
import { identitySatisfied, normalizeIdentityMode, resolveBatchIdentityMode } from './identityPolicy.js';

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
