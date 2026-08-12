export const DEFAULT_BACKUP_RETENTION_DAYS = 14;
export const MIN_BACKUP_RETENTION_DAYS = 1;
export const MAX_BACKUP_RETENTION_DAYS = 35;

export function resolveBackupRetentionDays(value: unknown): number {
  const requested = Number(value);
  if (!Number.isInteger(requested)
    || requested < MIN_BACKUP_RETENTION_DAYS
    || requested > MAX_BACKUP_RETENTION_DAYS) {
    return DEFAULT_BACKUP_RETENTION_DAYS;
  }
  return requested;
}

export function isBackupRetentionDays(value: unknown): boolean {
  const requested = Number(value);
  return Number.isInteger(requested)
    && requested >= MIN_BACKUP_RETENTION_DAYS
    && requested <= MAX_BACKUP_RETENTION_DAYS;
}
