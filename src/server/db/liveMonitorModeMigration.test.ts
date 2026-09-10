import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(process.cwd(), 'src/server/db/postgres.ts'), 'utf8');

test('batch live-monitor migration keeps recorded legacy batches self-hosted and ineligible rows off', () => {
  assert.match(source, /live_monitor_mode VARCHAR\(24\) NOT NULL DEFAULT 'off'/);
  assert.match(source, /live_monitor_mode = 'self_hosted' WHERE live_monitor_mode IS NULL AND \(record_mode IN \('local', 's3'\) OR record_enabled = true\)/);
  assert.match(source, /live_monitor_mode = 'off' WHERE live_monitor_mode IS NULL/);
  assert.match(source, /live_monitor_mode TEXT NOT NULL DEFAULT 'off'/);
  assert.match(source, /ALTER TABLE batches ADD COLUMN live_monitor_mode TEXT NOT NULL DEFAULT 'self_hosted'/);
  assert.match(source, /UPDATE batches SET live_monitor_mode = 'off' WHERE record_mode IS NULL OR \(record_mode = 'none' AND COALESCE\(record_enabled, 0\) = 0\)/);
});
