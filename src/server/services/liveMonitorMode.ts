/**
 * Live monitoring transport is a per-batch policy, not a browser preference.
 * Keep this separate from screen-recording policy: recording is a tenant-wide
 * capability granted by superadmin, while a matching tenant_admin picks the
 * signaling/TURN provider for an individual regular batch.
 */
export const LIVE_MONITOR_MODES = ['off', 'self_hosted', 'supabase'] as const;

export type LiveMonitorMode = (typeof LIVE_MONITOR_MODES)[number];

export interface LiveMonitorModeDecision {
  mode: LiveMonitorMode;
  rejected: boolean;
  reason?: string;
}

export function isLiveMonitorMode(value: unknown): value is LiveMonitorMode {
  return typeof value === 'string' && (LIVE_MONITOR_MODES as readonly string[]).includes(value);
}

/**
 * Client input is only a requested value. A normal tenant `admin` can create or
 * edit a batch it owns, but may not change the monitoring transport.
 */
export function resolveBatchLiveMonitorMode(input: {
  requested: unknown;
  fallback: LiveMonitorMode;
  canChange: boolean;
}): LiveMonitorModeDecision {
  if (input.requested === undefined || input.requested === null || input.requested === '') {
    return { mode: input.fallback, rejected: false };
  }
  if (!isLiveMonitorMode(input.requested)) {
    return { mode: input.fallback, rejected: true, reason: 'Unsupported live monitoring mode.' };
  }
  if (!input.canChange && input.requested !== input.fallback) {
    return { mode: input.fallback, rejected: true, reason: 'Only tenant admin can change live monitoring mode.' };
  }
  return { mode: input.requested, rejected: false };
}
