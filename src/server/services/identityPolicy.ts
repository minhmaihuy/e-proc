export type IdentityMode = 'off' | 'photo' | 'face_match';
export type IdentityStatus = 'not_required' | 'pending' | 'captured' | 'verified' | 'rejected';

export const IDENTITY_MODES: readonly IdentityMode[] = ['off', 'photo', 'face_match'];
export const MIN_EVIDENCE_RETENTION_DAYS = 1;
export const MAX_EVIDENCE_RETENTION_DAYS = 365;

export function isIdentityMode(value: unknown): value is IdentityMode {
  return typeof value === 'string' && (IDENTITY_MODES as readonly string[]).includes(value);
}

export function normalizeIdentityMode(value: unknown): IdentityMode {
  return isIdentityMode(value) ? value : 'off';
}

export function identitySatisfied(mode: IdentityMode, status: unknown): boolean {
  return mode === 'off' || status === 'verified';
}

export function isEvidenceRetentionDays(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_EVIDENCE_RETENTION_DAYS
    && value <= MAX_EVIDENCE_RETENTION_DAYS;
}

export function validateEvidenceRetention(params: {
  identityMode: IdentityMode;
  s3RecordingEnabled: boolean;
  identityRetentionDays: number | null;
  recordingRetentionDays: number | null;
}): string | null {
  const { identityMode, s3RecordingEnabled, identityRetentionDays, recordingRetentionDays } = params;

  if (recordingRetentionDays != null && !isEvidenceRetentionDays(recordingRetentionDays)) {
    return 'Screen-recording retention must be an integer from 1 to 365 days.';
  }
  if (identityRetentionDays != null && !isEvidenceRetentionDays(identityRetentionDays)) {
    return 'Identity-image retention must be an integer from 1 to 365 days.';
  }
  if (s3RecordingEnabled && recordingRetentionDays == null) {
    return 'Choose a screen-recording retention period before enabling S3 recording.';
  }
  if (identityMode === 'photo') {
    if (identityRetentionDays == null) {
      return 'Choose an identity-image retention period before enabling photo verification.';
    }
    if (recordingRetentionDays == null) {
      return 'Choose a screen-recording retention period before enabling photo verification.';
    }
  }
  if (identityRetentionDays != null
      && recordingRetentionDays != null
      && identityRetentionDays >= recordingRetentionDays) {
    return 'Identity-image retention must be shorter than screen-recording retention.';
  }
  return null;
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
