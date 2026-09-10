# Per-batch live transport specification

## Overview and user value

Tenant administrators need to choose a reliable live-screen-monitor transport
for each regular exam batch. The current self-hosted WebSocket/coturn flow stays
available for environments with working private TURN connectivity, while the
previous Supabase Realtime + Metered TURN flow can be deliberately selected for
batches whose users need third-party IPv4-compatible relay infrastructure.

## Functional requirements (EARS)

1. Where a batch is created, the system shall persist `live_monitor_mode` as
   `off`, `self_hosted`, or `supabase`; new batches shall default to `off`.
2. Where an existing recorded batch lacks `live_monitor_mode`, database
   initialization shall backfill it as `self_hosted`; an unrecorded batch shall
   backfill to `off`, without changing assessment data.
3. When a matching `tenant_admin` selects a valid mode for a regular batch with
   effective recording, the system shall save the requested mode.
4. When a regular `admin` or untrusted client tries to change the mode, the
   system shall reject the request and retain the stored value.
5. When the batch is Practice or has effective recording `none`, the system
   shall reject a non-`off` mode.
6. When any student in a batch is `in_progress`, the system shall reject a mode
   change.
7. When the student or tenant-admin live-session endpoint is called, the system
   shall derive the mode from the active batch and issue only that provider's
   short-lived configuration.
8. Where `self_hosted` is selected, the system shall use the existing scoped
   same-origin WSS and optional coturn HMAC credentials.
9. Where `supabase` is selected, the system shall issue a scoped ES256 private
   Realtime token and shall fetch optional Metered credentials server-side only
   from a validated HTTPS `.metered.live` endpoint.
10. If provider configuration or relay credentials are unavailable, the system
    shall fail the live session safely without interrupting the assessment.
11. The system shall never persist or log WebRTC media, SDP, ICE, provider
    tokens, private keys, or relay API keys.

## Non-functional requirements

- Tenant/attempt scope uses trusted tenant slug and a hashed active JWT `jti`.
- Session tokens expire within ten minutes.
- Self-hosted WebSocket controls retain Origin, topic, actor, message-size,
  rate-limit, and heartbeat protections.
- Provider changes use bounded queries and never disclose secret values in errors.

## Acceptance criteria

1. Given a tenant admin creates a recorded regular batch, when they choose
   `self_hosted` or `supabase`, then the chosen value is stored and returned to
   both live-session endpoints.
2. Given a regular admin edits its own batch, when it submits a different live
   mode, then the API returns 403 and the stored provider is unchanged.
3. Given an active candidate in a batch, when a tenant admin tries changing the
   provider, then the API returns 409 and both existing/new live sessions use
   the original provider.
4. Given a mode is `off`, Practice, or recording is ineffective, when a live
   session is requested, then no usable signaling configuration is issued.
5. Given `self_hosted` is configured, when a session is issued, then it has a
   scoped HS256 signaling token and no Supabase configuration.
6. Given `supabase` is configured, when a session is issued, then it has a
   scoped ES256 realtime token and no self-hosted signaling token.
7. Given a Metered outage, when a Supabase session is issued, then it returns
   STUN-only configuration without secrets and the assessment remains usable.

## Error handling

| Situation | API behavior | Assessment effect |
| --- | --- | --- |
| Unknown live mode | 403, preserve fallback | None |
| Regular admin mode change | 403, preserve stored mode | None |
| Practice/unrecorded non-off mode | 400 | None |
| Mode change during active attempt | 409 | Existing attempt continues |
| Provider missing configuration | Disabled student session / 503 admin viewer | Exam continues |
| Metered credential failure | STUN-only Supabase session, no secret/error detail | Exam continues |

## Implementation checklist

- [x] Add storage/migration and mode validation.
- [x] Enforce tenant-admin-only per-batch mode selection and active-attempt lock.
- [x] Dispatch session configuration and browser signaling by stored provider.
- [x] Restore Supabase client dependency and managed-secret allowlist.
- [x] Update batch UI, docs, rules, E-PROC skill references, and regression tests.
- [ ] Run the final verification and deploy the required provider configuration.
