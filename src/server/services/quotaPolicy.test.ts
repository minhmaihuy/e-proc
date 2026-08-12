import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuota } from './quotaPolicy.js';

test('NULL quota means unlimited while 80% and 100% remain observable states', () => {
  assert.deepEqual(evaluateQuota(999, null), { state: 'unlimited', ratio: null });
  assert.equal(evaluateQuota(79, 100).state, 'ok');
  assert.equal(evaluateQuota(80, 100).state, 'warning');
  assert.equal(evaluateQuota(100, 100).state, 'exceeded');
});
