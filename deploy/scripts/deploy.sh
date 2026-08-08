#!/bin/bash
# =============================================================================
# Redeploy Script — Pull latest code, rebuild, and restart
# Usage: bash deploy.sh  OR  sudo /opt/eaudit/deploy.sh
#
# PM2 keeps a separate daemon per OS user. The app's pm2 process is normally
# started under a non-root deploy user, not root. If this script runs as root
# (e.g. via sudo) without dropping privileges, `pm2 stop/delete eaudit` below
# silently no-ops against root's own (empty) pm2 daemon instead of the real
# running process, and `pm2 start` then creates a second, root-owned "eaudit"
# — so the live app never actually gets the new code. To make `sudo
# /opt/eaudit/deploy.sh` behave the same as running it directly, we re-exec
# ourselves as the real app-owning user before doing anything else whenever
# we detect we're running as root.
# =============================================================================
set -euo pipefail

APP_DIR="/opt/eaudit/app"
CANONICAL_ENV="/opt/eaudit/.env"

if [ "$(id -u)" -eq 0 ]; then
  APP_USER="${SUDO_USER:-$(stat -c '%U' "$APP_DIR")}"
  if [ "$APP_USER" = "root" ]; then
    echo "!!! Refusing to deploy as root: $APP_DIR is root-owned and no non-root" >&2
    echo "!!! SUDO_USER is set. Fix ownership first: chown -R <user>:<user> $APP_DIR" >&2
    exit 1
  fi
  APP_GROUP="$(id -gn "$APP_USER")"
  if [ -f "$CANONICAL_ENV" ]; then
    install -m 600 -o "$APP_USER" -g "$APP_GROUP" "$CANONICAL_ENV" "$APP_DIR/.env"
    echo ">>> Synchronized protected environment configuration for '$APP_USER'."
  fi
  echo ">>> Running as root; re-executing as '$APP_USER' so PM2/git/npm stay consistent..."
  exec sudo -u "$APP_USER" -H bash "$0" "$@"
fi

echo "============================================"
echo "  E-Audit Platform — Redeploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "!!! Missing $APP_DIR/.env. Create $CANONICAL_ENV and run this script with sudo." >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "!!! Refusing to overwrite tracked local changes in $APP_DIR." >&2
  echo "!!! Commit, stash, or restore them before deploying." >&2
  exit 1
fi

# --- Pull Latest ---
echo ""
echo ">>> Pulling latest code..."
git pull --ff-only origin main

# --- Rebuild Server ---
echo ""
echo ">>> Rebuilding server..."
npm ci --include=dev
npm run build:server

# --- Ensure Database Planes ---
echo ""
echo ">>> Ensuring isolated PostgreSQL databases..."
npm run db:ensure

# --- Rebuild Client ---
echo ""
echo ">>> Rebuilding client..."
cd client
npm ci --include=dev
npm run build
cd ..

# --- Restart App After Every Preflight Gate Passed ---
echo ""
echo ">>> Restarting application..."
pm2 delete eaudit || true
pm2 start dist/server/server.js \
  --name eaudit \
  --env production \
  --max-memory-restart 512M \
  --log-date-format "YYYY-MM-DD HH:mm:ss" \
  --merge-logs
pm2 save

# --- Health Check ---
echo ""
echo ">>> Waiting for app to start..."
sleep 5

if ! HEALTH=$(curl --fail --silent --show-error --max-time 10 http://localhost:3001/api/health); then
  echo "!!! Health check failed. Recent bounded PM2 logs follow:" >&2
  pm2 logs eaudit --lines 50 --nostream || true
  exit 1
fi
echo "    Health: $HEALTH"

echo ""
echo "============================================"
echo "  ✅ Redeploy Complete!"
echo "============================================"
echo "  PM2 Logs: pm2 logs eaudit --lines 20"
echo ""
