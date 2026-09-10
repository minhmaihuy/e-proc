# Live WebRTC Monitor Design

## Goal

Let a matching `tenant_admin` select the live-monitor signaling/TURN transport
per regular recorded batch without changing the existing self-hosted behavior.
The choices are `off`, `self_hosted`, and the previously implemented
`supabase` (Supabase Realtime signaling plus Metered TURN credentials). WebRTC
media remains peer-to-peer and no media or signaling payload is persisted by
E-PROC.

## Requirements

1. `batches.live_monitor_mode` is a server-authoritative enum. Existing recorded
   rows migrate to `self_hosted` to preserve their behavior; ineligible
   unrecorded rows and newly created batches default to `off`.
2. Only a matching `tenant_admin` may set or change the mode. A regular `admin`
   may continue editing a batch it owns but cannot change its stored transport.
3. A non-`off` mode is valid only for a regular batch with an effective `local`
   or `s3` recording mode. Practice and unrecorded batches reject it.
4. The create/edit UI presents the three choices, disables non-`off` choices
   when recording is unavailable, and hides the Live action for `off`/Practice
   batches. UI controls are not the authorization boundary.
5. Student and admin session routes read `live_monitor_mode` from the same
   active batch record and issue only that provider's configuration. They keep
   deriving student/batch/attempt identity from trusted JWT/database state.
6. Changing the provider while any candidate has an `in_progress` attempt is
   rejected. This prevents the publisher and viewer from joining different
   signaling providers for one attempt.
7. `self_hosted` keeps same-origin WSS, opaque tenant/batch/student/hashed-JTI
   topics, ten-minute HS256 tokens sent in `Sec-WebSocket-Protocol`, and optional
   tenant-owned coturn HMAC credentials. Origin, topic, actor, rate-limit, and
   heartbeat validation remain mandatory.
8. `supabase` uses the historic private Supabase Realtime channel contract:
   E-PROC issues a ten-minute ES256 token scoped to the opaque topic and supplies
   only Supabase URL/publishable key to the browser. Metered relay credentials are
   fetched server-side only over HTTPS from a validated `.metered.live` hostname.
   The Supabase private key and Metered API key are never returned or logged.
9. An unavailable provider returns a disabled session / a bounded admin error;
   it never prevents an exam from starting, continuing, or being submitted.
10. `live_monitor_audit` remains assessment-plane metadata only. Neither mode
    may write video, audio, SDP, ICE, token, provider credential, or signaling
    payload to E-PROC's assessment/control/log planes.

## Verification

- Unit-test mode validation/authorization fallback and self-hosted/Supabase
  session token configuration.
- Source-test tenant-admin guards, active attempt/effective recording checks,
  mode propagation, provider-change lock, and audit ownership.
- Verify both SQLite and PostgreSQL schema initialization/backfill paths.
- Run backend/frontend type checks, focused tests, `npm run test:tenant`,
  `npm run docs:check`, frontend build, diff check, and the project harness
  against `specs/per-batch-live-transport.spec.md`.
