#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${EAUDIT_ENV_FILE:-/opt/eaudit/.env}"
: "${S3_BACKUP_BUCKET:?S3_BACKUP_BUCKET is required}"
: "${AWS_REGION:?AWS_REGION is required}"

TENANT_SLUG="$(grep '^TENANT_SLUG=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
SOURCE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/g')"
CONTROL_URL="$(grep '^CONTROL_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/g')"
LOG_URL="$(grep '^LOG_DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/g')"
MAINTENANCE_DB="$({ grep '^DATABASE_MAINTENANCE_DB=' "$ENV_FILE" || true; } | head -1 | cut -d= -f2-)"
MAINTENANCE_DB="${MAINTENANCE_DB:-postgres}"
SOURCE_URL_WITHOUT_QUERY="${SOURCE_URL%%\?*}"
SOURCE_QUERY_SUFFIX=""
[[ "$SOURCE_URL" == *\?* ]] && SOURCE_QUERY_SUFFIX="?${SOURCE_URL#*\?}"
MAINTENANCE_URL="${SOURCE_URL_WITHOUT_QUERY%/*}/${MAINTENANCE_DB}${SOURCE_QUERY_SUFFIX}"
TARGET_DB="restore_check_$(date -u +%Y%m%d_%H%M%S)_${RANDOM}"
RESTORE_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/restore-db.sh"

record_status() {
  local status="$1"
  psql "$CONTROL_URL" -v ON_ERROR_STOP=1 -v tenant_slug="$TENANT_SLUG" -v restore_status="$status" <<'SQL' >/dev/null 2>&1 || true
UPDATE tenants
SET last_restore_test_at = CURRENT_TIMESTAMP,
    last_restore_test_status = :'restore_status',
    updated_at = CURRENT_TIMESTAMP
WHERE slug = :'tenant_slug';
SQL
}

cleanup() {
  dropdb --maintenance-db="$MAINTENANCE_URL" --if-exists --force "$TARGET_DB" >/dev/null 2>&1 || true
}

record_failure() {
  local exit_code=$?
  record_status failed
  psql "$LOG_URL" -v ON_ERROR_STOP=1 -v tenant_slug="$TENANT_SLUG" <<'SQL' >/dev/null 2>&1 || true
INSERT INTO tenant_issue_logs
  (tenant_slug, severity, source, code, message, actor_type)
VALUES
  (:'tenant_slug', 'critical', 'database_restore_check', 'RESTORE_CHECK_FAILED',
   'Scheduled backup restore verification failed. Review the protected host log.', 'system');
SQL
  cleanup
  exit "$exit_code"
}

trap record_failure ERR
trap cleanup EXIT

LATEST_KEY="$(aws s3api list-objects-v2 --bucket "$S3_BACKUP_BUCKET" --prefix "backups/${TENANT_SLUG}/" \
  --query 'reverse(sort_by(Contents,&LastModified))[0].Key' --output text --region "$AWS_REGION")"
[[ -n "$LATEST_KEY" && "$LATEST_KEY" != "None" ]] || { echo "No backup is available for restore verification." >&2; false; }

"$RESTORE_SCRIPT" --source "s3://${S3_BACKUP_BUCKET}/${LATEST_KEY}" --target-db "$TARGET_DB"
TARGET_URL="${SOURCE_URL_WITHOUT_QUERY%/*}/${TARGET_DB}${SOURCE_QUERY_SUFFIX}"

for table in question_bank students exam_questions violation_events; do
  SOURCE_COUNT="$(psql "$SOURCE_URL" -Atqc "SELECT COUNT(*) FROM ${table}")"
  RESTORED_COUNT="$(psql "$TARGET_URL" -Atqc "SELECT COUNT(*) FROM ${table}")"
  [[ "$SOURCE_COUNT" == "$RESTORED_COUNT" ]] || { echo "Restore verification row-count mismatch for ${table}." >&2; false; }
done

record_status passed
trap - ERR
echo "[Restore check] Latest backup restored and row counts match."
