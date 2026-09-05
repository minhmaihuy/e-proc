-- Run this only in the Supabase SQL editor. Do not run it against E-PROC's
-- assessment/control/log databases. Supabase already enables RLS on this schema.
-- Private channel clients carry a backend-signed JWT with `live_topic` and
-- `live_actor` claims. The application creates a unique, tenant-scoped topic per
-- active attempt; these policies prevent access to every other topic.

drop policy if exists "eproc_live_monitor_broadcast_read" on realtime.messages;
drop policy if exists "eproc_live_monitor_broadcast_write" on realtime.messages;

create policy "eproc_live_monitor_broadcast_read"
on realtime.messages
for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() = (current_setting('request.jwt.claims', true)::jsonb ->> 'live_topic')
  and (current_setting('request.jwt.claims', true)::jsonb ->> 'live_actor') in ('student', 'admin')
);

create policy "eproc_live_monitor_broadcast_write"
on realtime.messages
for insert to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() = (current_setting('request.jwt.claims', true)::jsonb ->> 'live_topic')
  and (current_setting('request.jwt.claims', true)::jsonb ->> 'live_actor') in ('student', 'admin')
);
