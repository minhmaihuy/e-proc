#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${EAUDIT_ENV_FILE:-/opt/eaudit/.env}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_FILE="$(mktemp "/tmp/eproc-backup-${TIMESTAMP}-XXXXXX.sql.gz")"
LOG_DATABASE_URL=""
TENANT_SLUG=""
DATABASE_URL=""
CONTROL_DATABASE_URL=""

cleanup() {
  rm -f -- "$BACKUP_FILE"
}

record_failure() {
  local exit_code=$?
  if [[ -n "$LOG_DATABASE_URL" ]]; then
    psql "$LOG_DATABASE_URL" -v ON_ERROR_STOP=1 -v tenant_slug="$TENANT_SLUG" -v failure_code="BACKUP_FAILED" <<'SQL' >/dev/null 2>&1 || true
INSERT INTO tenant_issue_logs
  (tenant_slug, severity, source, code, message, actor_type)
VALUES
  (:'tenant_slug', 'critical', 'database_backup', :'failure_code',
   'Scheduled database backup failed. Review the protected host log.', 'system');
SQL
  fi
  cleanup
  exit "$exit_code"
}

trap record_failure ERR
trap cleanup EXIT
LOG_DATABASE_URL="$(grep '^LOG_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/g')"
TENANT_SLUG="$(grep '^TENANT_SLUG=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/g')"
CONTROL_DATABASE_URL="$(grep '^CONTROL_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/g')"
: "${S3_BACKUP_BUCKET:?S3_BACKUP_BUCKET is required}"
: "${AWS_REGION:?AWS_REGION is required}"

echo "[Backup] Starting protected tenant backup at ${TIMESTAMP}."
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$BACKUP_FILE"
BACKUP_SIZE_BYTES="$(wc -c < "$BACKUP_FILE" | tr -d ' ')"
aws s3 cp "$BACKUP_FILE" "s3://${S3_BACKUP_BUCKET}/backups/${TENANT_SLUG}/${TIMESTAMP}.sql.gz" \
  --region "$AWS_REGION" --only-show-errors

psql "$CONTROL_DATABASE_URL" -v ON_ERROR_STOP=1 -v tenant_slug="$TENANT_SLUG" -v backup_size="$BACKUP_SIZE_BYTES" <<'SQL' >/dev/null
UPDATE tenants
SET last_backup_at = CURRENT_TIMESTAMP,
    last_backup_size_bytes = :'backup_size'::bigint,
    updated_at = CURRENT_TIMESTAMP
WHERE slug = :'tenant_slug';
SQL

trap - ERR
echo "[Backup] Completed protected tenant backup (${BACKUP_SIZE_BYTES} bytes)."
