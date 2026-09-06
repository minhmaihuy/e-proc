import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { verifyLiveSignalingToken } from './selfHostedLiveSignaling.js';

const topic = 'live:tenant:fsa-cls:batch:7:student:42:attempt:0123456789abcdef01234567';

test('self-hosted signaling accepts only an audience-scoped, short-lived live token', () => {
  const prior = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'self-hosted-test-secret';
  try {
    const token = jwt.sign({ topic, actor: 'admin', viewer_session_id: '7a6bcac0-a243-4b9c-a801-a8d2e59a98cb' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', issuer: 'eproc-live-signaling', audience: 'eproc-live-signaling', expiresIn: '10m',
    });
    assert.deepEqual(verifyLiveSignalingToken(token)?.topic, topic);
    const wrongAudience = jwt.sign({ topic, actor: 'student' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', issuer: 'eproc-live-signaling', audience: 'other-service', expiresIn: '10m',
    });
    assert.equal(verifyLiveSignalingToken(wrongAudience), null);
  } finally {
    if (prior === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prior;
  }
});
