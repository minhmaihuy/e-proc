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
  'JWT_SECRET',
  'LIVE_TURN_URLS',
  'LIVE_TURN_SHARED_SECRET',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_REALTIME_PRIVATE_KEY',
  'SUPABASE_REALTIME_PRIVATE_KEY_BASE64',
  'SUPABASE_REALTIME_JWT_KEY_ID',
  'OPEN_RELAY_CREDENTIALS_URL',
  'OPEN_RELAY_API_KEY',
] as const;

const JWT_TEST_SECRET = ['live', 'monitoring', 'test', 'secret'].join('-');
const SELF_HOSTED_JWT_TEST_SECRET = ['self', 'hosted', 'signaling', 'secret'].join('-');
const TURN_TEST_SHARED_SECRET = ['turn', 'shared', 'secret', 'for', 'test'].join('-');

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
    JWT_SECRET: JWT_TEST_SECRET,
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

    const claims = jwt.verify(session.signalingToken!, JWT_TEST_SECRET, {
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
    JWT_SECRET: SELF_HOSTED_JWT_TEST_SECRET,
  }, async () => {
    assert.equal(liveMonitoringEnabled(), true);
  });
});

test('the legacy Supabase transport is independently configured and has no self-hosted signaling token', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await withLiveEnvironment({
    LIVE_MONITORING_ENABLED: 'true',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'public-test-key',
    SUPABASE_REALTIME_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    SUPABASE_REALTIME_JWT_KEY_ID: 'test-key-id',
  }, async () => {
    assert.equal(liveMonitoringEnabled('self_hosted'), false);
    assert.equal(liveMonitoringEnabled('supabase'), true);
    const session = await issueLiveSession({
      mode: 'supabase', actor: 'student', subject: 'student:42', tenantSlug: 'fsa-cls', batchId: 7, studentId: 42,
      jti: '7a6bcac0-a243-4b9c-a801-a8d2e59a98cb',
    });
    assert.equal(session.enabled, true);
    assert.equal(session.transport, 'supabase');
    assert.equal(session.signalingToken, undefined);
    assert.equal(session.supabaseUrl, 'https://example.supabase.co');
    assert.equal(session.supabasePublishableKey, 'public-test-key');
    assert.equal(session.turnAvailable, false);
    assert.deepEqual(session.iceServers, [{ urls: ['stun:stun.relay.metered.ca:80', 'stun:stun.relay.metered.ca:443'] }]);
    const claims = jwt.decode(session.realtimeToken!) as jwt.JwtPayload;
    assert.equal(claims.live_topic, session.topic);
    assert.equal(claims.live_actor, 'student');
    assert.equal((jwt.decode(session.realtimeToken!, { complete: true }) as { header: jwt.JwtHeader }).header.kid, 'test-key-id');
  });
});

test('a self-hosted coturn relay receives an expiring HMAC credential without exposing its shared secret', async () => {
  await withLiveEnvironment({
    LIVE_MONITORING_ENABLED: 'true',
    JWT_SECRET: SELF_HOSTED_JWT_TEST_SECRET,
    LIVE_TURN_URLS: 'turn:turn.epoc.devfasttrack.cloud:3478?transport=udp,turns:turn.epoc.devfasttrack.cloud:5349?transport=tcp',
    LIVE_TURN_SHARED_SECRET: TURN_TEST_SHARED_SECRET,
  }, async () => {
    const session = await issueLiveSession({
      actor: 'student', subject: 'student:42', tenantSlug: 'fsa-cls', batchId: 7, studentId: 42,
      jti: '7a6bcac0-a243-4b9c-a801-a8d2e59a98cb',
    });
    assert.equal(session.turnAvailable, true);
    assert.deepEqual(session.iceServers?.[0]?.urls, [
      'turn:turn.epoc.devfasttrack.cloud:3478?transport=udp',
      'turns:turn.epoc.devfasttrack.cloud:5349?transport=tcp',
    ]);
    assert.match(session.iceServers?.[0]?.username || '', /^\d+:student:42$/);
    assert.notEqual(session.iceServers?.[0]?.credential, TURN_TEST_SHARED_SECRET);
  });
});
