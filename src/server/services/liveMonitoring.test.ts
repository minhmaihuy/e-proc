import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  issueLiveSession,
  liveMonitoringEnabled,
  liveTopic,
} from './liveMonitoring.js';

const LIVE_ENVIRONMENT_NAMES = [
  'LIVE_MONITORING_ENABLED',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_REALTIME_PRIVATE_KEY_BASE64',
  'SUPABASE_REALTIME_PRIVATE_KEY',
  'SUPABASE_REALTIME_JWT_KEY_ID',
  'OPEN_RELAY_CREDENTIALS_URL',
  'OPEN_RELAY_API_KEY',
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

test('live monitoring stays disabled when its signing configuration is absent', async () => {
  await withLiveEnvironment({}, async () => {
    assert.equal(liveMonitoringEnabled(), false);
    assert.deepEqual(await issueLiveSession({
      actor: 'student', subject: 'student:42', tenantSlug: 'fsa-cls', batchId: 7, studentId: 42,
      jti: '7a6bcac0-a243-4b9c-a801-a8d2e59a98cb',
    }), { enabled: false });
  });
});

test('a configured live session signs a short-lived ES256 token scoped to one opaque attempt topic', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  await withLiveEnvironment({
    LIVE_MONITORING_ENABLED: 'true',
    SUPABASE_URL: 'https://realtime.example.test',
    SUPABASE_PUBLISHABLE_KEY: '<set-locally>',
    SUPABASE_REALTIME_PRIVATE_KEY_BASE64: Buffer.from(JSON.stringify(privateJwk)).toString('base64'),
    SUPABASE_REALTIME_JWT_KEY_ID: 'live-key-1',
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
    assert.deepEqual(session.iceServers, [{ urls: ['stun:stun.relay.metered.ca:80', 'stun:stun.relay.metered.ca:443'] }]);

    const claims = jwt.verify(session.realtimeToken!, publicKey, {
      algorithms: ['ES256'], audience: 'authenticated', issuer: 'https://realtime.example.test/auth/v1',
    }) as jwt.JwtPayload;
    assert.equal(claims.live_topic, session.topic);
    assert.equal(claims.live_actor, 'student');
    assert.equal(claims.sub, 'student:42');
    assert.ok(typeof claims.exp === 'number' && typeof claims.iat === 'number' && claims.exp - claims.iat <= 600);
  });
});

test('an insecure Supabase URL fails closed instead of minting a browser token', async () => {
  await withLiveEnvironment({
    LIVE_MONITORING_ENABLED: 'true',
    SUPABASE_URL: 'http://realtime.example.test',
    SUPABASE_PUBLISHABLE_KEY: '<set-locally>',
    SUPABASE_REALTIME_PRIVATE_KEY: 'not-used-when-url-is-invalid',
  }, async () => {
    assert.equal(liveMonitoringEnabled(), false);
  });
});
