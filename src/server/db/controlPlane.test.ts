import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mapLegacyTenantSlug, resolveControlPlaneConnection } from './controlPlane.js';
import { assertDataPlaneTenantBinding } from './postgres.js';

test('local control plane uses a separate SQLite database', () => {
  const config = resolveControlPlaneConnection({}, 'D:/workspace/e-proc');
  assert.equal(config.useSqlite, true);
  assert.equal(config.sharedWithDataPlane, false);
  assert.equal(config.sqlitePath, path.resolve('D:/workspace/e-proc/data/control-plane.db'));
});

test('explicit control database remains separate from the assessment database', () => {
  const config = resolveControlPlaneConnection({
    DATABASE_URL: 'postgresql://assessment.example/eproc',
    CONTROL_DATABASE_URL: 'postgresql://control.example/eproc_control',
  });
  assert.equal(config.useSqlite, false);
  assert.equal(config.connectionString, 'postgresql://control.example/eproc_control');
  assert.equal(config.sharedWithDataPlane, false);
});

test('missing production control URL uses explicit compatibility mode', () => {
  const config = resolveControlPlaneConnection({ DATABASE_URL: 'postgresql://assessment.example/eproc' });
  assert.equal(config.connectionString, 'postgresql://assessment.example/eproc');
  assert.equal(config.sharedWithDataPlane, true);
});

test('legacy FSA slug migrates to FSA-CLS without changing other tenants', () => {
  assert.equal(mapLegacyTenantSlug(' FSA '), 'fsa-cls');
  assert.equal(mapLegacyTenantSlug('fsa-cls'), 'fsa-cls');
  assert.equal(mapLegacyTenantSlug('Acme-Vietnam'), 'acme-vietnam');
});

test('assessment database cannot be rebound to another tenant', () => {
  assert.doesNotThrow(() => assertDataPlaneTenantBinding('fsa', 'fsa-cls'));
  assert.doesNotThrow(() => assertDataPlaneTenantBinding('fsa-cls', 'fsa-cls'));
  assert.throws(
    () => assertDataPlaneTenantBinding('fsa-cls', 'other-tenant'),
    /cannot be rebound/,
  );
});
