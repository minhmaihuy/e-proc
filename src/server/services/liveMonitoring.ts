import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { type LiveMonitorMode } from './liveMonitorMode.js';

export type LiveActor = 'student' | 'admin';
export type LiveTransport = Exclude<LiveMonitorMode, 'off'>;

export interface LiveIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface LiveSessionConfig {
  enabled: boolean;
  transport?: LiveTransport;
  topic?: string;
  signalingToken?: string;
  signalingPath?: string;
  realtimeToken?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  iceServers?: LiveIceServer[];
  turnAvailable?: boolean;
  expiresAt?: string;
}

const LIVE_TOKEN_TTL_SECONDS = 10 * 60;
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TURN_URL_PATTERN = /^turns?:[a-z0-9.-]+(?::\d{1,5})?(?:\?transport=(?:udp|tcp))?$/i;

interface SupabaseRuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  signingKey: crypto.KeyObject | string;
  keyId: string | null;
}

function optionalEnvironment(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function liveMonitoringOptedIn(): boolean {
  return process.env.LIVE_MONITORING_ENABLED === 'true';
}

function selfHostedRuntimeEnabled(): boolean {
  return liveMonitoringOptedIn() && Boolean(process.env.JWT_SECRET?.trim());
}

function loadSupabaseSigningKey(): crypto.KeyObject | string | null {
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

function supabaseRuntimeConfig(): SupabaseRuntimeConfig | null {
  if (!liveMonitoringOptedIn()) return null;

  const supabaseUrl = optionalEnvironment('SUPABASE_URL');
  const supabasePublishableKey = optionalEnvironment('SUPABASE_PUBLISHABLE_KEY');
  const signingKey = loadSupabaseSigningKey();
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

/** Backward-compatible default means the existing self-hosted transport. */
export function liveMonitoringEnabled(mode: LiveMonitorMode = 'self_hosted'): boolean {
  if (mode === 'self_hosted') return selfHostedRuntimeEnabled();
  if (mode === 'supabase') return supabaseRuntimeConfig() !== null;
  return false;
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

  // An internal signaling server must not let equal numeric IDs from two tenants meet.
  // Hashing also avoids exposing the session identifier in a browser-visible topic.
  const attempt = crypto.createHash('sha256').update(jti).digest('hex').slice(0, 24);
  return `live:tenant:${tenant}:batch:${batchId}:student:${studentId}:attempt:${attempt}`;
}

function selfHostedStunServers(): LiveIceServer[] {
  // Do not make a third-party STUN/TURN request. Host candidates allow LAN and
  // directly reachable peers; deploy a tenant-owned TURN server when relay is needed.
  return [];
}

function selfHostedTurnServers(subject: string, expiresAt: number): LiveIceServer[] {
  const secret = process.env.LIVE_TURN_SHARED_SECRET?.trim();
  const urls = (process.env.LIVE_TURN_URLS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!secret || urls.length === 0 || urls.length > 4 || !urls.every((url) => TURN_URL_PATTERN.test(url))) return [];

  // coturn's long-term credential mechanism accepts an expiry-prefixed username
  // and an HMAC-SHA1 password. The shared secret never leaves the backend.
  const username = `${expiresAt}:${subject.slice(0, 96)}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return [{ urls, username, credential }];
}

export async function issueLiveSession(input: {
  actor: LiveActor;
  mode?: LiveMonitorMode;
  subject: string;
  tenantSlug: string;
  batchId: number;
  studentId: number;
  jti: string;
  viewerSessionId?: string;
}): Promise<LiveSessionConfig> {
  const mode = input.mode ?? 'self_hosted';
  if (mode === 'off' || !liveMonitoringEnabled(mode)) return { enabled: false };

  const topic = liveTopic(input.tenantSlug, input.batchId, input.studentId, input.jti);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + LIVE_TOKEN_TTL_SECONDS;

  if (mode === 'supabase') {
    const current = supabaseRuntimeConfig();
    if (!current) return { enabled: false };
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
    const relay = await meteredIceServers();
    return {
      enabled: true,
      transport: 'supabase',
      topic,
      realtimeToken,
      supabaseUrl: current.supabaseUrl,
      supabasePublishableKey: current.supabasePublishableKey,
      iceServers: relay.iceServers,
      turnAvailable: relay.turnAvailable,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  const turnServers = selfHostedTurnServers(input.subject, expiresAt);
  const signalingToken = jwt.sign({
    iss: 'eproc-live-signaling',
    aud: 'eproc-live-signaling',
    sub: input.subject,
    topic,
    actor: input.actor,
    ...(input.viewerSessionId ? { viewer_session_id: input.viewerSessionId } : {}),
    iat: now,
  }, process.env.JWT_SECRET!, {
    algorithm: 'HS256',
    expiresIn: LIVE_TOKEN_TTL_SECONDS,
  });
  return {
    enabled: true,
    transport: 'self_hosted',
    topic,
    signalingToken,
    signalingPath: '/api/live/signaling',
    iceServers: [...selfHostedStunServers(), ...turnServers],
    turnAvailable: turnServers.length > 0,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

function meteredStunServers(): LiveIceServer[] {
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

/** The legacy third-party mode uses Metered's short-lived relay credentials. */
async function meteredIceServers(): Promise<{ iceServers: LiveIceServer[]; turnAvailable: boolean }> {
  const endpoint = optionalEnvironment('OPEN_RELAY_CREDENTIALS_URL');
  const apiKey = optionalEnvironment('OPEN_RELAY_API_KEY');
  if (!endpoint || !apiKey) return { iceServers: meteredStunServers(), turnAvailable: false };
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.metered.live')) throw new Error('Invalid relay endpoint.');
    url.searchParams.set('apiKey', apiKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error('Relay credentials request failed.');
    const payload = await response.json() as unknown;
    const servers = Array.isArray(payload) ? payload.filter(isSafeIceServer) : [];
    return {
      iceServers: [...meteredStunServers(), ...servers],
      turnAvailable: servers.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls])
        .some((url) => url.startsWith('turn:') || url.startsWith('turns:'))),
    };
  } catch {
    // A relay outage must never block the assessment or expose an endpoint/key in logs.
    return { iceServers: meteredStunServers(), turnAvailable: false };
  }
}

export function attemptHash(jti: string): string {
  return crypto.createHash('sha256').update(jti).digest('hex');
}
