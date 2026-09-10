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
