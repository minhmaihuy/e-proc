# Live realtime monitor design

## Goal

Add opt-in live screen monitoring from the referenced upstream feature without
merging its older fork lineage. A tenant administrator may view all active regular
exam candidates in a batch concurrently through WebRTC; the application hosts its
own authenticated WebSocket signaling endpoint.

## Requirements

1. A current-tenant `tenant_admin` can list active candidates and initiate/end a
   viewing session for every active candidate in the batch concurrently. A regular
   `admin` and `superadmin` are rejected server-side.
2. The candidate session endpoint derives student id, batch id, and attempt id from
   the student JWT and requires an in-progress attempt plus effective recording.
3. The feature is disabled unless `LIVE_MONITORING_ENABLED=true`; it uses the
   existing application `JWT_SECRET` and same-origin WSS in HTTPS deployments. A
   configuration or signaling failure never blocks the exam.
4. Topics are unique by trusted tenant slug, batch, candidate, and a hashed attempt
   identifier. Short-lived HS256 signaling tokens have a dedicated issuer/audience,
   are sent only in `Sec-WebSocket-Protocol`, and expire in ten minutes. The server
   validates Origin, scopes forwarding to the exact topic, rate-limits messages,
   and replaces duplicate actor connections.
5. WebRTC media/SDP/ICE data must not enter any E-PROC database or operational log.
   Only viewer audit metadata belongs in the assessment data-plane.
6. Practice batches are excluded on the API and UI. Both effective `local` and
   `s3` recording reuse the already-approved Entire Screen capture; `none` is
   rejected. Unknown capture surfaces fail closed, and this feature does not change
   evidence retention policy.
7. Configuration names are allowlisted in managed secrets and tenant bootstrap. No
   hosted broker, hosted STUN/TURN service, or external migration is required. A
   tenant-owned coturn relay may be configured with an expiring HMAC credential
   issued by E-PROC; its shared secret never reaches a browser. Deployment
   configures the root-owned relay only from the protected host environment,
   checks TLS before enabling `turns:`, and leaves PM2 unchanged on relay failure.
   The generated configuration contains the relay shared secret, so it is owned
   by `root:turnserver` with mode `640`: the coturn systemd account can read it
   without exposing it to other host users.
   The IPv6 Terraform deployment persists the relay FQDN as
   `turn.<app_subdomain>.<domain_name>`, writes only opt-in relay configuration,
   and limits relay ingress to the required port ranges.

## Verification

- Unit test disabled configuration, token algorithm/claims/expiry, opaque tenant
  topic, and self-hosted token verification.
- Source regression test pins tenant-admin route guards, active-attempt query,
  recording policy check, scoped audit update, JWT-bound student endpoint, Origin
  validation, WebSocket heartbeat, rate limit, and native-client signaling.
- Run backend and frontend type checks, tenant test suite, frontend tests/build,
  docs parity check, diff check, and the project harness against this design.
