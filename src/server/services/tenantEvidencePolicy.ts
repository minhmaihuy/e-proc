import { isEvidenceRetentionDays } from './identityPolicy.js';
import { isRecordMode, parseAllowedRecordModes, RecordMode } from './recordingPolicy.js';

export type EffectiveIdentityMode = 'off' | 'photo';

export interface TenantEvidencePolicyInput {
  allowedRecordModes: unknown;
  identityVerification: unknown;
  identityRetentionDays: unknown;
  recordingRetentionDays: unknown;
}

export interface EffectiveTenantEvidencePolicy {
  allowedRecordModes: RecordMode[];
  identityVerification: EffectiveIdentityMode;
  identityRetentionDays: number | null;
  recordingRetentionDays: number | null;
}

function retentionDays(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const normalized = typeof value === 'number' ? value : Number(value);
  return isEvidenceRetentionDays(normalized) ? normalized : null;
}

/**
 * Converts a validation-free tenant draft into capabilities that runtime routes may
 * safely enforce. Draft persistence deliberately accepts incomplete infrastructure;
 * runtime use must nevertheless fail closed until its retention prerequisites exist.
 */
export function resolveTenantEvidencePolicy(input: TenantEvidencePolicyInput): EffectiveTenantEvidencePolicy {
  const configuredModes = parseAllowedRecordModes(input.allowedRecordModes);
  const recordingRetentionDays = retentionDays(input.recordingRetentionDays);
  const identityRetentionDays = retentionDays(input.identityRetentionDays);

  const allowedRecordModes: RecordMode[] = ['none'];
  if (configuredModes.includes('local')) allowedRecordModes.push('local');
  if (configuredModes.includes('s3') && recordingRetentionDays != null) allowedRecordModes.push('s3');

  const identityVerification: EffectiveIdentityMode = input.identityVerification === 'photo'
    && identityRetentionDays != null
    && recordingRetentionDays != null
    && identityRetentionDays < recordingRetentionDays
    ? 'photo'
    : 'off';

  return {
    allowedRecordModes,
    identityVerification,
    identityRetentionDays,
    recordingRetentionDays,
  };
}

function legacyRecordingEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Clamp persisted/legacy batch state to the tenant capability effective right now. */
export function effectiveBatchRecordMode(
  storedMode: unknown,
  storedLegacyEnabled: unknown,
  effectiveAllowedModes: readonly RecordMode[],
): RecordMode {
  const candidate: RecordMode = isRecordMode(storedMode)
    ? storedMode
    : legacyRecordingEnabled(storedLegacyEnabled) ? 's3' : 'none';
  return effectiveAllowedModes.includes(candidate) ? candidate : 'none';
}

/** `face_match`, invalid values, and revoked photo capability all fail safely to off. */
export function effectiveBatchIdentityMode(
  storedMode: unknown,
  effectiveTenantMode: EffectiveIdentityMode,
): EffectiveIdentityMode {
  return storedMode === 'photo' && effectiveTenantMode === 'photo' ? 'photo' : 'off';
}
