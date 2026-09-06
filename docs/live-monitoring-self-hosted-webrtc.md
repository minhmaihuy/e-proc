# Live realtime monitor (self-hosted WebRTC signaling)

This optional feature lets a matching-tenant `tenant_admin` view all active
**regular** exam candidates in one batch at the same time. It reuses the already-approved Entire
Screen capture for either `local` or `s3` recording. It is unavailable for
Practice batches.

## Self-hosted architecture

- The E-PROC backend exposes an authenticated WebSocket endpoint at
  `/api/live/signaling`. It keeps only short-lived signaling connections in
  memory and relays offer/answer/ICE messages between the authorized student
  and tenant admin.
- Browser-to-browser WebRTC carries the screen media directly. E-PROC does not
  persist or relay video, audio, SDP, ICE candidates, or signaling payloads.
- No Supabase, hosted signaling broker, Open Relay, external STUN, or external
  TURN provider is used. Without a relay, host candidates work only on LAN or
  directly reachable peers. For candidates/admins on separate NATs, deploy the
  tenant-owned coturn relay below.

## Security and scope

- The backend issues an HS256 token valid for ten minutes using the existing
  server `JWT_SECRET`. The browser passes it only in `Sec-WebSocket-Protocol`,
  not a URL query string.
- The token is bound to a trusted tenant slug, batch, student, hashed active
  attempt id, actor, and (for a viewer) viewer-session id. The socket verifies
  origin, issuer, audience, expiry, message size, rate limit, actor, and topic.
- One socket per actor is retained per attempt topic. A newer socket replaces
  its same-actor predecessor. One viewer is permitted per student topic, while
  the same tenant admin may concurrently open viewers for many student topics.
- Only `tenant_admin` can create/end viewer sessions. Audit rows store only
  ids, timestamps, hashed attempt id, and outcome.
- The implementation is intentionally single-instance. If a tenant is later
  scaled to multiple backend instances, add sticky routing or an owned shared
  signaling plane before enabling this feature there.

## Configuration

```dotenv
LIVE_MONITORING_ENABLED=true
# Issued dynamically by E-PROC as coturn REST credentials; never put this value in the browser.
LIVE_TURN_URLS=turn:turn.epoc.devfasttrack.cloud:3478?transport=udp,turns:turn.epoc.devfasttrack.cloud:5349?transport=tcp
LIVE_TURN_SHARED_SECRET=<set-locally>
```

`JWT_SECRET` is already required by every E-PROC backend instance; no new
third-party key is required. Restart the backend after changing the flag.

## Self-hosted coturn relay

Install coturn on the E-PROC EC2 instance or a tenant-owned relay host. Configure
`use-auth-secret` with the same `LIVE_TURN_SHARED_SECRET`, a TLS certificate valid
for the relay hostname, a bounded relay port range, and no anonymous/static users:

```ini
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<set-locally>
realm=epoc.devfasttrack.cloud
no-loopback-peers
no-multicast-peers
min-port=49152
max-port=49200
```

Open TCP/UDP 3478, TCP/UDP 5349, and UDP 49152–49200 on the relay security group
and host firewall. On EC2 with a private instance address, configure coturn's
`external-ip=<public-ip>/<private-ip>` as well. E-PROC derives expiring HMAC
credentials server-side, so the shared secret is never delivered to a browser.

## Operator check

Create a regular batch with effective `local` or `s3` recording, start a
candidate attempt, then open **Live** as `tenant_admin`. Verify that an
ordinary `admin`, a superadmin, a Practice batch, an inactive attempt, and a
revoked recording mode are rejected. Confirm that the live audit row contains
no media or signaling payload.
