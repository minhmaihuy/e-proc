import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  DEFAULT_FSA_TENANT_ADMIN_PASSWORD,
  DEFAULT_FSA_TENANT_ADMIN_USERNAME,
  mapLegacyTenantSlug,
  resolveControlPlaneConnection,
  resolveFsaClsLifecycle,
  resolveTenantAdminSeed,
} from './controlPlane.js';
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

/**
 * Seed tenant_admin cho FSA-CLS.
 *
 * Bối cảnh: superadmin CỐ TÌNH không chạm được dữ liệu khảo thí của tenant, nên nếu
 * chỉ seed superadmin thì cài mới xong không có đường nào vào /admin/*. Superadmin
 * cũng không phải người quản lý user của tenant nên không tự tạo được tài khoản này.
 */

test('seed tenant admin khi tenant chưa có quản trị viên nào', () => {
  const decision = resolveTenantAdminSeed({}, 0, false);
  assert.equal(decision.shouldSeed, true);
  assert.equal(decision.reason, 'seed');
  assert.equal(decision.username, DEFAULT_FSA_TENANT_ADMIN_USERNAME);
  assert.equal(decision.password, DEFAULT_FSA_TENANT_ADMIN_PASSWORD);
});

test('không seed đè khi tenant đã có tenant_admin', () => {
  // Hệ thống đang được dùng thật; tạo thêm tài khoản mặc định là mở một lối vào
  // không ai yêu cầu, với mật khẩu nằm sẵn trong lịch sử git.
  const decision = resolveTenantAdminSeed({}, 1, false);
  assert.equal(decision.shouldSeed, false);
  assert.equal(decision.reason, 'tenant_admin_exists');
});

test('không seed khi tên đăng nhập đã bị chiếm', () => {
  // username là duy nhất toàn cục (kể cả superadmin và tenant khác) nên chèn vào sẽ
  // vi phạm ràng buộc và làm hỏng cả bước khởi tạo.
  const decision = resolveTenantAdminSeed({}, 0, true);
  assert.equal(decision.shouldSeed, false);
  assert.equal(decision.reason, 'username_taken');
});

test('tên đăng nhập đã chiếm được ưu tiên xét sau khi tenant đã có admin', () => {
  const decision = resolveTenantAdminSeed({}, 2, true);
  assert.equal(decision.reason, 'tenant_admin_exists');
});

test('biến môi trường ghi đè tên đăng nhập và mật khẩu, có cắt khoảng trắng', () => {
  const decision = resolveTenantAdminSeed(
    { FSA_TENANT_ADMIN_USERNAME: '  fsa.owner  ', FSA_TENANT_ADMIN_PASSWORD: '  s3cret-value-32  ' },
    0,
    false,
  );
  assert.equal(decision.username, 'fsa.owner');
  assert.equal(decision.password, 's3cret-value-32');
});

test('biến môi trường rỗng rơi về giá trị mặc định', () => {
  // Chuỗi rỗng trong .env là lỗi cấu hình thường gặp; rơi về mặc định vẫn tốt hơn tạo
  // tài khoản có username rỗng.
  const decision = resolveTenantAdminSeed(
    { FSA_TENANT_ADMIN_USERNAME: '   ', FSA_TENANT_ADMIN_PASSWORD: '' },
    0,
    false,
  );
  assert.equal(decision.username, DEFAULT_FSA_TENANT_ADMIN_USERNAME);
  assert.equal(decision.password, DEFAULT_FSA_TENANT_ADMIN_PASSWORD);
});
