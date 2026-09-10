import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLiveMonitorMode,
  resolveBatchLiveMonitorMode,
} from './liveMonitorMode.js';

test('only the explicit per-batch live monitor modes are accepted', () => {
  assert.equal(isLiveMonitorMode('off'), true);
  assert.equal(isLiveMonitorMode('self_hosted'), true);
  assert.equal(isLiveMonitorMode('supabase'), true);
  assert.equal(isLiveMonitorMode('metered'), false);
  assert.equal(isLiveMonitorMode(''), false);
});

test('a tenant admin may choose a provider, while a regular admin cannot change it', () => {
  assert.deepEqual(resolveBatchLiveMonitorMode({
    requested: 'supabase', fallback: 'off', canChange: true,
  }), { mode: 'supabase', rejected: false });
  assert.deepEqual(resolveBatchLiveMonitorMode({
    requested: 'supabase', fallback: 'self_hosted', canChange: false,
  }), {
    mode: 'self_hosted', rejected: true, reason: 'Only tenant admin can change live monitoring mode.',
  });
});

test('missing mode keeps the stored fallback but an invalid client value is rejected', () => {
  assert.deepEqual(resolveBatchLiveMonitorMode({
    requested: undefined, fallback: 'self_hosted', canChange: false,
  }), { mode: 'self_hosted', rejected: false });
  assert.deepEqual(resolveBatchLiveMonitorMode({
    requested: 'untrusted-provider', fallback: 'off', canChange: true,
  }), { mode: 'off', rejected: true, reason: 'Unsupported live monitoring mode.' });
});
