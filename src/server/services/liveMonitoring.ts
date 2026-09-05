import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export type LiveActor = 'student' | 'admin';

export interface LiveIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface LiveSessionConfig {
  enabled: boolean;
  topic?: string;
  realtimeToken?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  iceServers?: LiveIceServer[];
  turnAvailable?: boolean;
  expiresAt?: string;
}

interface LiveRuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  signingKey: crypto.KeyObject | string;
  keyId: string | null;
}

const LIVE_TOKEN_TTL_SECONDS = 10 * 60;
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

function optionalEnvironment(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function loadSigningKey(): crypto.KeyObject | string | null {
  const encoded = optionalEnvironment('SUPABASE_REALTIME_PRIVATE_KEY_BASE64');
  if (encoded) {
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8').trim();
      return decoded.startsWith('{')
        ? crypto.createPrivateKey({ key: JSON.parse(decoded), format: 'jwk' })
        : decoded;
    } catch {
      return null;
    }
  }
  return optionalEnvironment('SUPABASE_REALTIME_PRIVATE_KEY')?.replace(/\\n/g, '\n') || null;
}

function runtimeConfig(): LiveRuntimeConfig | null {
  if (process.env.LIVE_MONITORING_ENABLED !== 'true') return null;

  const supabaseUrl = optionalEnvironment('SUPABASE_URL');
  const supabasePublishableKey = optionalEnvironment('SUPABASE_PUBLISHABLE_KEY');
  const signingKey = loadSigningKey();
  if (!supabaseUrl || !supabasePublishableKey || !signingKey) return null;

  try {
    if (new URL(supabaseUrl).protocol !== 'https:') return null;
  } catch {
    return null;
  }

  return {
    supabaseUrl,
    supabasePublishableKey,
    signingKey,
    keyId: optionalEnvironment('SUPABASE_REALTIME_JWT_KEY_ID'),
  };
}

export function liveMonitoringEnabled(): boolean {
  return runtimeConfig() !== null;
}

function requirePositiveId(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${label}.`);
}

export function liveTopic(tenantSlug: string, batchId: number, studentId: number, jti: string): string {
  const tenant = tenantSlug.trim().toLowerCase();
  if (!TENANT_SLUG_PATTERN.test(tenant)) throw new Error('Invalid tenant slug.');
  requirePositiveId(batchId, 'batch id');
  requirePositiveId(studentId, 'student id');
  if (!/^[0-9a-f-]{36}$/i.test(jti)) throw new Error('Invalid attempt identifier.');

  // A shared Supabase project must not let equal numeric IDs from two tenants meet.
  // Hashing also avoids exposing the session identifier in a browser-visible topic.
  const attempt = crypto.createHash('sha256').update(jti).digest('hex').slice(0, 24);
  return `live:tenant:${tenant}:batch:${batchId}:student:${studentId}:attempt:${attempt}`;
}

function staticStunServers(): LiveIceServer[] {
  return [{ urls: ['stun:stun.relay.metered.ca:80', 'stun:stun.relay.metered.ca:443'] }];
}

function isSafeIceServer(value: unknown): value is LiveIceServer {
  if (!value || typeof value !== 'object') return false;
  const server = value as LiveIceServer;
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.length > 0 && urls.length <= 8
    && urls.every((url) => typeof url === 'string' && /^(stun:|turn:|turns:)/.test(url) && url.length <= 300)
    && (!server.username || server.username.length <= 512)
    && (!server.credential || server.credential.length <= 1024);
}

async function relayIceServers(): Promise<{ iceServers: LiveIceServer[]; turnAvailable: boolean }> {
  const endpoint = optionalEnvironment('OPEN_RELAY_CREDENTIALS_URL');
  const apiKey = optionalEnvironment('OPEN_RELAY_API_KEY');
  if (!endpoint || !apiKey) return { iceServers: staticStunServers(), turnAvailable: false };

  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.metered.live')) throw new Error('invalid relay endpoint');
    url.searchParams.set('apiKey', apiKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`relay status ${response.status}`);
    const servers = (await response.json() as unknown[]).filter(isSafeIceServer);
    return {
      iceServers: [...staticStunServers(), ...servers],
      turnAvailable: servers.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls])
        .some((url) => url.startsWith('turn:') || url.startsWith('turns:'))),
    };
  } catch (error) {
    console.warn('[live-monitor] TURN credentials unavailable; continuing P2P-only', error instanceof Error ? error.message : 'unknown error');
    return { iceServers: staticStunServers(), turnAvailable: false };
  }
}

export async function issueLiveSession(input: {
  actor: LiveActor;
  subject: string;
  tenantSlug: string;
  batchId: number;
  studentId: number;
  jti: string;
}): Promise<LiveSessionConfig> {
  const current = runtimeConfig();
  if (!current) return { enabled: false };

  const topic = liveTopic(input.tenantSlug, input.batchId, input.studentId, input.jti);
  const now = Math.floor(Date.now() / 1000);
  const realtimeToken = jwt.sign({
    iss: `${current.supabaseUrl}/auth/v1`,
    aud: 'authenticated',
    role: 'authenticated',
    sub: input.subject,
    live_topic: topic,
    live_actor: input.actor,
    iat: now,
  }, current.signingKey, {
    algorithm: 'ES256',
    expiresIn: LIVE_TOKEN_TTL_SECONDS,
    ...(current.keyId ? { keyid: current.keyId } : {}),
  });
  const relay = await relayIceServers();
  return {
    enabled: true,
    topic,
    realtimeToken,
    supabaseUrl: current.supabaseUrl,
    supabasePublishableKey: current.supabasePublishableKey,
    iceServers: relay.iceServers,
    turnAvailable: relay.turnAvailable,
    expiresAt: new Date((now + LIVE_TOKEN_TTL_SECONDS) * 1000).toISOString(),
  };
}

export function attemptHash(jti: string): string {
  return crypto.createHash('sha256').update(jti).digest('hex');
}
