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
  signalingToken?: string;
  signalingPath?: string;
  iceServers?: LiveIceServer[];
  turnAvailable?: boolean;
  expiresAt?: string;
}

const LIVE_TOKEN_TTL_SECONDS = 10 * 60;
const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function liveMonitoringEnabled(): boolean {
  // JWT_SECRET is already a mandatory startup invariant. The feature has no
  // hosted signaling dependency: explicit opt-in is the only extra setting.
  return process.env.LIVE_MONITORING_ENABLED === 'true' && Boolean(process.env.JWT_SECRET?.trim());
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

function staticStunServers(): LiveIceServer[] {
  // Do not make a third-party STUN/TURN request. Host candidates allow LAN and
  // directly reachable peers; deploy a tenant-owned TURN server when relay is needed.
  return [];
}

export async function issueLiveSession(input: {
  actor: LiveActor;
  subject: string;
  tenantSlug: string;
  batchId: number;
  studentId: number;
  jti: string;
  viewerSessionId?: string;
}): Promise<LiveSessionConfig> {
  if (!liveMonitoringEnabled()) return { enabled: false };

  const topic = liveTopic(input.tenantSlug, input.batchId, input.studentId, input.jti);
  const now = Math.floor(Date.now() / 1000);
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
    topic,
    signalingToken,
    signalingPath: '/api/live/signaling',
    iceServers: staticStunServers(),
    turnAvailable: false,
    expiresAt: new Date((now + LIVE_TOKEN_TTL_SECONDS) * 1000).toISOString(),
  };
}

export function attemptHash(jti: string): string {
  return crypto.createHash('sha256').update(jti).digest('hex');
}
