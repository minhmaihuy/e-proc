export type IdentityMode = 'off' | 'photo' | 'face_match';
export type IdentityStatus = 'not_required' | 'pending' | 'captured' | 'verified' | 'rejected';

export const IDENTITY_MODES: readonly IdentityMode[] = ['off', 'photo', 'face_match'];

export function isIdentityMode(value: unknown): value is IdentityMode {
  return typeof value === 'string' && (IDENTITY_MODES as readonly string[]).includes(value);
}

export function normalizeIdentityMode(value: unknown): IdentityMode {
  return isIdentityMode(value) ? value : 'off';
}

export function identitySatisfied(mode: IdentityMode, status: unknown): boolean {
  return mode === 'off' || status === 'verified';
}

export function resolveBatchIdentityMode(params: {
  requested: unknown;
  tenantMode: IdentityMode;
  fallback?: IdentityMode;
  canChange: boolean;
}): { mode: IdentityMode; rejected: boolean; reason?: string } {
  const fallback = params.fallback ?? 'off';
  if (!params.canChange || !isIdentityMode(params.requested)) return { mode: fallback, rejected: false };
  if (IDENTITY_MODES.indexOf(params.requested) > IDENTITY_MODES.indexOf(params.tenantMode)) {
    return {
      mode: params.tenantMode,
      rejected: true,
      reason: `Batch identity mode "${params.requested}" exceeds tenant mode "${params.tenantMode}".`,
    };
  }
  return { mode: params.requested, rejected: false };
}
