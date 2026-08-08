import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { assertLogPlaneTenantBinding, resolveLogPlaneConnection } from './logPlane.js';

test('local issue logs use a dedicated SQLite database', () => {
  const config = resolveLogPlaneConnection({}, 'D:/workspace/e-proc');
  assert.equal(config.useSqlite, true);
  assert.equal(config.connectionString, '');
  assert.equal(config.sqlitePath, path.resolve('D:/workspace/e-proc/data/tenant-logs.db'));
});

test('log plane never falls back to assessment or control database URLs', () => {
  const config = resolveLogPlaneConnection({
    DATABASE_URL: 'postgresql://assessment.example/eproc',
    CONTROL_DATABASE_URL: 'postgresql://control.example/eproc',
  });
  assert.equal(config.useSqlite, true);
  assert.equal(config.connectionString, '');
});

test('explicit tenant log database is used independently', () => {
  const config = resolveLogPlaneConnection({ LOG_DATABASE_URL: 'postgresql://logs.example/acme_logs' });
  assert.equal(config.useSqlite, false);
  assert.equal(config.connectionString, 'postgresql://logs.example/acme_logs');
});

test('issue log database cannot be rebound to another tenant', () => {
  assert.doesNotThrow(() => assertLogPlaneTenantBinding('fsa-cls', 'fsa-cls'));
  assert.throws(() => assertLogPlaneTenantBinding('fsa-cls', 'acme'), /cannot be rebound/);
  assert.throws(
    () => assertLogPlaneTenantBinding('legacy-row-tenant', 'fsa-cls'),
    /cannot be rebound/,
  );
});
