import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { mapLegacyTenantSlug, resolveControlPlaneConnection, resolveFsaClsLifecycle } from './controlPlane.js';
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

test('control plane never falls back to the assessment database URL', () => {
  const config = resolveControlPlaneConnection({ DATABASE_URL: 'postgresql://assessment.example/eproc' });
  assert.equal(config.useSqlite, true);
  assert.equal(config.connectionString, '');
  assert.equal(config.sharedWithDataPlane, false);
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

test('fsa-cls dang pending duoc nang len approved vi no la tenant dang chay that', () => {
  const result = resolveFsaClsLifecycle(
    { status: 'pending', provisionStatus: 'not_started', approvedBy: null, approvedAt: null },
    7,
  );
  assert.equal(result.status, 'approved');
  assert.equal(result.provisionStatus, 'active');
  assert.equal(result.approvedBy, 7);
  assert.equal(result.stampApprovedAt, true);
});

test('suspended la quyet dinh co chu dich cua superadmin, khong duoc tu dong go', () => {
  const result = resolveFsaClsLifecycle(
    { status: 'suspended', provisionStatus: 'active', approvedBy: 3, approvedAt: '2026-01-01' },
    7,
  );
  assert.equal(result.status, 'suspended');
  assert.equal(result.approvedBy, 3);
  assert.equal(result.stampApprovedAt, false);
});

test('tenant da approved khong bi dong dau approved_at lan hai', () => {
  const result = resolveFsaClsLifecycle(
    { status: 'approved', provisionStatus: 'active', approvedBy: 3, approvedAt: '2026-01-01' },
    7,
  );
  assert.equal(result.status, 'approved');
  assert.equal(result.stampApprovedAt, false);
});

test('giu nguyen nguoi duyet cu khi da co, khong ghi de bang superadmin hien tai', () => {
  const result = resolveFsaClsLifecycle(
    { status: 'pending', provisionStatus: 'active', approvedBy: 2, approvedAt: null },
    7,
  );
  assert.equal(result.approvedBy, 2);
  assert.equal(result.provisionStatus, 'active');
});
