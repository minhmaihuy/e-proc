#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: restore-db.sh --source <local.sql.gz|s3://...> --target-db <new_database_name>" >&2
  exit 64
}

SOURCE=""
TARGET_DB=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --target-db) TARGET_DB="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

[[ -n "$SOURCE" && "$TARGET_DB" =~ ^[a-z][a-z0-9_]{2,62}$ ]] || usage

ENV_FILE="${EAUDIT_ENV_FILE:-/opt/eaudit/.env}"
SOURCE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/g')"
MAINTENANCE_DB="$({ grep '^DATABASE_MAINTENANCE_DB=' "$ENV_FILE" || true; } | head -1 | cut -d= -f2-)"
MAINTENANCE_DB="${MAINTENANCE_DB:-postgres}"
SOURCE_URL_WITHOUT_QUERY="${SOURCE_URL%%\?*}"
SOURCE_QUERY_SUFFIX=""
[[ "$SOURCE_URL" == *\?* ]] && SOURCE_QUERY_SUFFIX="?${SOURCE_URL#*\?}"
MAINTENANCE_URL="${SOURCE_URL_WITHOUT_QUERY%/*}/${MAINTENANCE_DB}${SOURCE_QUERY_SUFFIX}"
SOURCE_DB="$(psql "$SOURCE_URL" -Atqc 'SELECT current_database()')"
[[ "$TARGET_DB" != "$SOURCE_DB" ]] || { echo "Target must be a new database." >&2; exit 65; }

EXISTS="$(psql "$MAINTENANCE_URL" -v target_db="$TARGET_DB" -Atqc "SELECT 1 FROM pg_database WHERE datname = :'target_db'")"
[[ -z "$EXISTS" ]] || { echo "Target database already exists; refusing to overwrite it." >&2; exit 66; }

TARGET_URL="${SOURCE_URL_WITHOUT_QUERY%/*}/${TARGET_DB}${SOURCE_QUERY_SUFFIX}"
RESTORE_FILE="$(mktemp /tmp/eproc-restore-XXXXXX.sql.gz)"
trap 'rm -f -- "$RESTORE_FILE"' EXIT

if [[ "$SOURCE" == s3://* ]]; then
  aws s3 cp "$SOURCE" "$RESTORE_FILE" --only-show-errors
else
  cp -- "$SOURCE" "$RESTORE_FILE"
fi

createdb --maintenance-db="$MAINTENANCE_URL" "$TARGET_DB"
gzip -dc "$RESTORE_FILE" | psql "$TARGET_URL" -v ON_ERROR_STOP=1 >/dev/null
echo "[Restore] Restore completed into newly created database ${TARGET_DB}."
