#!/usr/bin/env bash
# Configure the tenant-owned coturn relay from the protected deployment env.
# This script is deliberately root-only: it writes /etc/turnserver.conf and
# changes the host firewall. It never prints LIVE_TURN_SHARED_SECRET.
set -euo pipefail

ENV_FILE="${1:-/opt/eaudit/.env}"
TURN_CONFIG="/etc/turnserver.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: configure-coturn.sh must run as root." >&2
  exit 1
fi

if [ ! -r "$ENV_FILE" ]; then
  echo "ERROR: protected environment file is not readable: $ENV_FILE" >&2
  exit 1
fi

read_env() {
  local key="$1" line value
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)"
  value="${line#*=}"
  if [[ "$value" =~ ^\"(.*)\"$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$value"
}

TURN_URLS="$(read_env LIVE_TURN_URLS)"
TURN_SECRET="$(read_env LIVE_TURN_SHARED_SECRET)"

# TURN is optional. Leaving both values absent keeps ordinary deployments
# unchanged and avoids starting a relay with anonymous credentials.
if [ -z "$TURN_URLS" ] && [ -z "$TURN_SECRET" ]; then
  echo ">>> coturn is not configured (LIVE_TURN_URLS/SECRET absent); skipping."
  exit 0
fi

if [ -z "$TURN_URLS" ] || [ -z "$TURN_SECRET" ]; then
  echo "ERROR: LIVE_TURN_URLS and LIVE_TURN_SHARED_SECRET must be set together." >&2
  exit 1
fi

TURN_HOST="$(read_env LIVE_TURN_HOST)"
if [ -z "$TURN_HOST" ]; then
  echo "ERROR: LIVE_TURN_HOST is required when TURN is enabled." >&2
  exit 1
fi
if [[ ! "$TURN_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "ERROR: LIVE_TURN_HOST must be a DNS hostname." >&2
  exit 1
fi
if [[ ",$TURN_URLS," != *"turn:$TURN_HOST:"* && ",$TURN_URLS," != *"turns:$TURN_HOST:"* ]]; then
  echo "ERROR: LIVE_TURN_URLS must reference LIVE_TURN_HOST." >&2
  exit 1
fi

CERT_FILE="$(read_env LIVE_TURN_TLS_CERT_PATH)"
KEY_FILE="$(read_env LIVE_TURN_TLS_KEY_PATH)"
CERT_FILE="${CERT_FILE:-/etc/letsencrypt/live/$TURN_HOST/fullchain.pem}"
KEY_FILE="${KEY_FILE:-/etc/letsencrypt/live/$TURN_HOST/privkey.pem}"

if [[ ",$TURN_URLS," == *"turns:$TURN_HOST:"* ]] && { [ ! -r "$CERT_FILE" ] || [ ! -r "$KEY_FILE" ]; }; then
  echo "ERROR: turns: is configured but its TLS certificate/key are not readable." >&2
  echo "       Expected certificate: $CERT_FILE" >&2
  exit 1
fi

TURN_LISTENING_IP="$(read_env LIVE_TURN_LISTENING_IP)"
TURN_RELAY_IP="$(read_env LIVE_TURN_RELAY_IP)"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y coturn

if [ -f /etc/default/coturn ]; then
  if grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn; then
    sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  else
    printf '\nTURNSERVER_ENABLED=1\n' >> /etc/default/coturn
  fi
fi

umask 077
{
  printf '%s\n' '# Managed by /opt/eaudit/app/deploy/scripts/configure-coturn.sh'
  printf '%s\n' 'listening-port=3478' 'tls-listening-port=5349' 'fingerprint'
  printf '%s\n' 'use-auth-secret' "static-auth-secret=$TURN_SECRET"
  printf '%s\n' "realm=$TURN_HOST" 'no-loopback-peers' 'no-multicast-peers'
  printf '%s\n' 'no-cli' 'no-tlsv1' 'no-tlsv1_1' 'min-port=49152' 'max-port=49200'
  [ -n "$TURN_LISTENING_IP" ] && printf '%s\n' "listening-ip=$TURN_LISTENING_IP"
  [ -n "$TURN_RELAY_IP" ] && printf '%s\n' "relay-ip=$TURN_RELAY_IP"
  if [[ ",$TURN_URLS," == *"turns:$TURN_HOST:"* ]]; then
    printf '%s\n' "cert=$CERT_FILE" "pkey=$KEY_FILE"
  fi
} > "$TURN_CONFIG"
chmod 600 "$TURN_CONFIG"

# Security groups remain authoritative at AWS. Mirror the necessary rules in
# UFW only when the host administrator has explicitly enabled it.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 3478/tcp
  ufw allow 3478/udp
  ufw allow 5349/tcp
  ufw allow 49152:49200/udp
fi

systemctl enable coturn
systemctl restart coturn
systemctl is-active --quiet coturn
echo ">>> coturn is active for $TURN_HOST (credential and private values withheld)."
