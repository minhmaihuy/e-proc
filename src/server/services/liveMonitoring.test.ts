import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  issueLiveSession,
  liveMonitoringEnabled,
  liveTopic,
} from './liveMonitoring.js';

const LIVE_ENVIRONMENT_NAMES = [
  'LIVE_MONITORING_ENABLED',
  'JWT_SECRET',
] as const;

async function withLiveEnvironment(
  values: Partial<Record<(typeof LIVE_ENVIRONMENT_NAMES)[number], string>>,
  action: () => Promise<void> | void,
): Promise<void> {
  const original = new Map(LIVE_ENVIRONMENT_NAMES.map((name) => [name, process.env[name]]));
  for (const name of LIVE_ENVIRONMENT_NAMES) delete process.env[name];
  Object.assign(process.env, values);
  try {
    await action();
  } finally {
    for (const name of LIVE_ENVIRONMENT_NAMES) {
      const value = original.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('live monitoring stays disabled until the self-hosted channel is explicitly enabled', async () => {
  await withLiveEnvironment({}, async () => {
    assert.equal(liveMonitoringEnabled(), false);
    assert.deepEqual(await issueLiveSession({
      actor: 'student', subject: 'student:42', tenantSlug: 'fsa-cls', batchId: 7, studentId: 42,
      jti: '7a6bcac0-a243-4b9c-a801-a8d2e59a98cb',
    }), { enabled: false });
  });
});

test('a configured live session signs a short-lived self-hosted token scoped to one opaque attempt topic', async () => {
  await withLiveEnvironment({
    LIVE_MONITORING_ENABLED: 'true',
    JWT_SECRET: 'live-monitoring-test-secret',
  }, async () => {
    const jti = '7a6bcac0-a243-4b9c-a801-a8d2e59a98cb';
    const session = await issueLiveSession({
      actor: 'student', subject: 'student:42', tenantSlug: 'fsa-cls', batchId: 7, studentId: 42, jti,
    });

    assert.equal(session.enabled, true);
    assert.equal(session.topic, liveTopic('fsa-cls', 7, 42, jti));
    assert.ok(session.topic?.startsWith('live:tenant:fsa-cls:batch:7:student:42:attempt:'));
    assert.equal(session.topic?.includes(jti), false);
    assert.equal(session.turnAvailable, false);
    assert.deepEqual(session.iceServers, []);
    assert.equal(session.signalingPath, '/api/live/signaling');

    const claims = jwt.verify(session.signalingToken!, 'live-monitoring-test-secret', {
      algorithms: ['HS256'], audience: 'eproc-live-signaling', issuer: 'eproc-live-signaling',
    }) as jwt.JwtPayload;
    assert.equal(claims.topic, session.topic);
    assert.equal(claims.actor, 'student');
    assert.equal(claims.sub, 'student:42');
    assert.ok(typeof claims.exp === 'number' && typeof claims.iat === 'number' && claims.exp - claims.iat <= 600);
  });
});

test('an enabled self-hosted session uses the existing server JWT secret only', async () => {
  await withLiveEnvironment({
    LIVE_MONITORING_ENABLED: 'true',
    JWT_SECRET: 'self-hosted-signaling-secret',
  }, async () => {
    assert.equal(liveMonitoringEnabled(), true);
  });
});
