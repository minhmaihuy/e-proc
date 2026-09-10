import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('tenant bootstrap preserves both explicitly selectable live-monitor provider configurations', () => {
  const bootstrap = fs.readFileSync(
    path.resolve(process.cwd(), 'terraform/tenant-instance/user-data.sh.tftpl'),
    'utf8',
  );
  for (const name of [
    'LIVE_MONITORING_ENABLED', 'LIVE_TURN_URLS', 'LIVE_TURN_SHARED_SECRET',
    'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_REALTIME_PRIVATE_KEY_BASE64',
    'SUPABASE_REALTIME_PRIVATE_KEY', 'SUPABASE_REALTIME_JWT_KEY_ID',
    'OPEN_RELAY_CREDENTIALS_URL', 'OPEN_RELAY_API_KEY',
  ]) {
    assert.match(bootstrap, new RegExp(`"${name}"`), `${name} must reach the application env`);
  }
});

test('Supabase private-channel policy scopes broadcast access to the signed attempt claims', () => {
  const policy = fs.readFileSync(
    path.resolve(process.cwd(), 'migrations/20260905_live_monitoring_supabase.sql'),
    'utf8',
  );
  assert.match(policy, /on realtime\.messages/);
  assert.match(policy, /realtime\.messages\.extension = 'broadcast'/);
  assert.match(policy, /realtime\.topic\(\) = \(current_setting\('request\.jwt\.claims', true\)::jsonb ->> 'live_topic'\)/);
  assert.match(policy, /live_actor'\) in \('student', 'admin'\)/);
  assert.match(policy, /for select to authenticated/);
  assert.match(policy, /for insert to authenticated/);
});
