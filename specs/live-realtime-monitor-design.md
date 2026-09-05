# Live realtime monitor design

## Goal

Add opt-in live screen monitoring from the referenced upstream feature without
merging its older fork lineage. A tenant administrator may view one active regular
exam candidate through WebRTC; Supabase Realtime is signaling only.

## Requirements

1. A current-tenant `tenant_admin` can list active candidates and initiate/end a
   viewing session. A regular `admin` and `superadmin` are rejected server-side.
2. The candidate session endpoint derives student id, batch id, and attempt id from
   the student JWT and requires an in-progress attempt plus effective recording.
3. The feature is disabled unless all Supabase signing configuration is present and
   uses HTTPS. A configuration or signaling failure never blocks the exam.
4. Topics are unique by trusted tenant slug, batch, candidate, and a hashed attempt
   identifier. Tokens are ES256, audience `authenticated`, private-channel scoped,
   and expire in ten minutes.
5. WebRTC media/SDP/ICE data must not enter any E-PROC database or operational log.
   Only viewer audit metadata belongs in the assessment data-plane.
6. Practice batches are excluded on the API and UI. Both effective `local` and
   `s3` recording reuse the already-approved Entire Screen capture; `none` is
   rejected. Unknown capture surfaces fail closed, and this feature does not change
   evidence retention policy.
7. Configuration names are allowlisted in managed secrets and tenant bootstrap.
   Supabase Realtime RLS setup is documented as a separate external migration.

## Verification

- Unit test disabled configuration, token algorithm/claims/expiry, opaque tenant
  topic, and HTTPS fail-closed behavior.
- Source regression test pins tenant-admin route guards, active-attempt query,
  recording policy check, scoped audit update, and JWT-bound student endpoint.
- Run backend and frontend type checks, tenant test suite, frontend tests/build,
  docs parity check, diff check, and the project harness against this design.
