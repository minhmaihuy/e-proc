import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeControlPlaneDatabase, initControlPlaneDatabase, query } from '../db/controlPlane.js';
import { recordUsageEvent, usagePeriod, validUsageAmount } from './usageMeter.js';

test('usage month is UTC-stable and amounts must be positive finite numbers', () => {
  assert.equal(usagePeriod(new Date('2026-08-31T23:59:59.000Z')), '2026-08');
  assert.equal(validUsageAmount(1), true);
  assert.equal(validUsageAmount(0), false);
  assert.equal(validUsageAmount(Number.NaN), false);
});

test('duplicate event counts once and a retry repairs a missing aggregate', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eproc-usage-'));
  const previousPath = process.env.CONTROL_SQLITE_PATH;
  const previousEnv = process.env.NODE_ENV;
  const previousSlug = process.env.TENANT_SLUG;
  process.env.CONTROL_SQLITE_PATH = path.join(directory, 'control.db');
  process.env.NODE_ENV = 'test';
  try {
    await initControlPlaneDatabase();
    assert.equal(await recordUsageEvent('exam-start:test-42', 'exams_started'), true);
    assert.equal(await recordUsageEvent('exam-start:test-42', 'exams_started'), false);
    let usage = await query("SELECT exams_started FROM tenant_usage WHERE period_month = ?", [usagePeriod()]);
    assert.equal(Number(usage.rows[0].exams_started), 1);

    const concurrent = await Promise.all([
      recordUsageEvent('exam-start:concurrent-1', 'exams_started'),
      recordUsageEvent('exam-start:concurrent-2', 'exams_started'),
    ]);
    assert.deepEqual(concurrent, [true, true], 'SQLite transactions must be serialized, not nested');
    usage = await query("SELECT exams_started FROM tenant_usage WHERE period_month = ?", [usagePeriod()]);
    assert.equal(Number(usage.rows[0].exams_started), 3);

    assert.equal(await recordUsageEvent(
      'exam-start:delayed-july',
      'exams_started',
      1,
      new Date('2026-07-31T23:59:59.000Z'),
    ), true);
    const julyUsage = await query("SELECT exams_started FROM tenant_usage WHERE period_month = ?", ['2026-07']);
    assert.equal(Number(julyUsage.rows[0].exams_started), 1,
      'an event delivered later must remain attributed to its UTC occurrence month');

    await query(`INSERT INTO tenants (slug, name, contact_email, created_by) VALUES (?, ?, ?, ?)`,
      ['acme', 'Acme', 'admin@acme.example', 1]);
    process.env.TENANT_SLUG = 'acme';
    assert.equal(await recordUsageEvent('exam-start:test-42', 'exams_started'), true,
      'the same local event id in a different tenant must not collide');
    assert.equal(Number((await query('SELECT COUNT(*) AS count FROM tenant_usage_events')).rows[0].count), 5);

    await query("DELETE FROM tenant_usage WHERE period_month = ?", [usagePeriod()]);
    assert.equal(await recordUsageEvent('exam-start:test-42', 'exams_started'), false);
    usage = await query("SELECT exams_started FROM tenant_usage WHERE period_month = ?", [usagePeriod()]);
    assert.equal(Number(usage.rows[0].exams_started), 1);
  } finally {
    await closeControlPlaneDatabase();
    if (previousPath === undefined) delete process.env.CONTROL_SQLITE_PATH;
    else process.env.CONTROL_SQLITE_PATH = previousPath;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (previousSlug === undefined) delete process.env.TENANT_SLUG;
    else process.env.TENANT_SLUG = previousSlug;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
