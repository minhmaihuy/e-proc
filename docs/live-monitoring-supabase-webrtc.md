# Live realtime monitor (Supabase + WebRTC)

This optional feature lets a matching-tenant `tenant_admin` view the screen stream
of one active **regular** exam candidate at a time. It works with both `local`
encrypted-folder recording and `s3` recording because it reuses the same
already-approved Entire Screen stream. It is deliberately unavailable for Practice
batches. The app server never receives, relays, or stores video, audio,
SDP, ICE candidates, or signaling payloads.

## Security and scope

- The backend issues a short-lived ES256 Supabase Realtime token only after it
  verifies the tenant admin, active `students.active_jti`, current batch, and an
  effective recording mode.
- Every private topic contains the trusted tenant slug, batch id, student id, and
  a hash of the active attempt id. Numeric IDs alone are never a cross-tenant scope.
- Only `tenant_admin` can list candidates or create/end a viewer session; UI guards
  are convenience only. Audit metadata is written to the tenant assessment plane.
- The token lasts ten minutes. Reopen the viewer when it expires. Signaling failure
  must not block a candidate from taking or submitting an exam.
- Use the supplied publishable Supabase key in the browser; never expose the
  ES256 private JWK/PEM or an Open Relay API key.

## Supabase setup

1. Create a Supabase project and enable Realtime Broadcast.
2. In Realtime settings, disable **Allow public access** so channels remain private.
3. Add an ES256 signing key in Supabase Auth, retain its key id, and put the private
   JWK (base64 encoded) only in the managed application secret.
4. Run [the Realtime RLS policy](../migrations/20260905_live_monitoring_supabase.sql)
   in the Supabase SQL editor. It is for Supabase's `realtime.messages` schema, not
   the application's RDS/SQLite databases.
5. Configure the app environment (real values only in a managed secret):

```dotenv
LIVE_MONITORING_ENABLED=true
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<set-locally>
SUPABASE_REALTIME_PRIVATE_KEY_BASE64=<set-locally>
SUPABASE_REALTIME_JWT_KEY_ID=<set-locally>
```

Optional TURN credentials may use `OPEN_RELAY_CREDENTIALS_URL` and
`OPEN_RELAY_API_KEY`. If they are absent or fail, the app keeps STUN-only P2P
attempts; it does not silently substitute a public relay.

The tenant bootstrap allowlist in `terraform/tenant-instance/user-data.sh.tftpl`
must include these exact environment names or new tenant instances will start with
the feature safely disabled.

## Operator check

Create a regular batch with an effective `local` or `s3` recording mode, start a
candidate attempt, then open **Live** from its batch as `tenant_admin`. Confirm the
audit row has only ids, timestamps, hashed attempt id, and outcome. Verify an
ordinary `admin`, a superadmin, a Practice batch, an inactive attempt, and a revoked
recording mode are all rejected by the API.

See Supabase's [Realtime Authorization guide](https://supabase.com/docs/guides/realtime/authorization)
and [JavaScript `setAuth` reference](https://supabase.com/docs/reference/javascript/realtime-setauth)
for the private-channel requirements used here.
