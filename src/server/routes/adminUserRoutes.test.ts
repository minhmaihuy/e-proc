import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

/**
 * Chốt lại mô hình phân quyền trong một tenant.
 *
 *   superadmin    — toàn cục, quản lý tenant và cấu hình, KHÔNG chạm dữ liệu khảo thí
 *   tenant_admin  — quản lý giáo viên/cộng tác viên, toàn quyền trong tenant của mình
 *   admin         — giáo viên/cộng tác viên, chỉ sửa được nội dung do mình tạo
 *
 * Cái tên `admin` mang nghĩa "người dùng thường" là nguồn gốc của hai lớp lỗi từng tồn
 * tại cùng lúc trong `admin.ts`, nên các test dưới đây đọc thẳng source:
 *
 *   1. `POST /setup` và `/is-initialized` vẫn sống dù tài liệu tuyên bố đã gỡ. Chúng
 *      nằm TRƯỚC `router.use(authMiddleware)` nên bất kỳ ai cũng gọi được, và ghi
 *      thẳng vào `admin_users` của database production. Xác nhận trên máy thật:
 *      `is-initialized` trả `{"initialized":false}`, `setup` với body rỗng trả 400 —
 *      nghĩa là handler được chạy, không có lớp xác thực nào chặn.
 *
 *   2. Tenant identities từng được chuyển sang control-plane trong khi ownership FK
 *      vẫn nằm trong tenant data-plane. Login/CRUD và `uploaded_by` vì vậy không cùng
 *      một nguồn sự thật, làm import PostgreSQL lỗi FK.
 *
 *   3. Bốn kiểm tra sở hữu viết `role !== 'admin'`, tức giới hạn đúng người NHIỀU
 *      quyền hơn (`tenant_admin`) và thả cửa cho giáo viên. Đảo ngược hoàn toàn ý định.
 */

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

const adminRoutes = () => readSource('src', 'server', 'routes', 'admin.ts');

test('admin.ts không còn route nào chạy trước authMiddleware', () => {
  const source = adminRoutes();
  const guardIndex = source.indexOf('router.use(authMiddleware)');
  assert.ok(guardIndex > 0, 'không tìm thấy authMiddleware');

  const beforeGuard = source.slice(0, guardIndex);
  const unguarded = [...beforeGuard.matchAll(/^router\.(get|post|put|delete|patch)\(/gm)];
  assert.deepEqual(
    unguarded.map((match) => match[0]),
    [],
    'route đặt trước authMiddleware là route công khai — kiểm tra kỹ trước khi thêm',
  );
});

test('assessment routes require current-tenant access after the four user-management routes', () => {
  const source = adminRoutes();
  const authGuardIndex = source.indexOf('router.use(authMiddleware)');
  const tenantDataGuardIndex = source.indexOf('router.use(requireTenantDataAdmin)', authGuardIndex + 1);

  assert.ok(authGuardIndex >= 0, 'không tìm thấy authMiddleware');
  assert.ok(tenantDataGuardIndex > authGuardIndex, 'thiếu requireTenantDataAdmin cho assessment routes');

  const userRoutes = [
    "router.get('/users', requireTenantUserManager",
    "router.post('/users', requireTenantUserManager",
    "router.put('/users/:id', requireTenantUserManager",
    "router.delete('/users/:id', requireTenantUserManager",
  ];
  for (const signature of userRoutes) {
    const routeIndex = source.indexOf(signature);
    assert.ok(routeIndex > authGuardIndex, `${signature} phải nằm sau authMiddleware`);
    assert.ok(
      routeIndex < tenantDataGuardIndex,
      `${signature} phải giữ guard requireTenantUserManager riêng trước assessment guard`,
    );
  }

  const betweenAuthAndTenantGuard = source.slice(authGuardIndex, tenantDataGuardIndex);
  const routesBeforeTenantGuard = [...betweenAuthAndTenantGuard.matchAll(/^router\.(get|post|put|delete|patch)\(([^\n]+)/gm)]
    .map((match) => match[0]);
  assert.equal(routesBeforeTenantGuard.length, 4, 'chỉ bốn route /users được đứng trước tenant data guard');
  assert.ok(
    routesBeforeTenantGuard.every((route) => route.includes("'/users")),
    'route không thuộc user management đứng trước tenant data guard',
  );

  const guardedAssessmentRoutes = [...source.slice(tenantDataGuardIndex).matchAll(/^router\.(get|post|put|delete|patch)\(/gm)];
  assert.ok(guardedAssessmentRoutes.length > 0, 'không còn assessment route nào sau tenant data guard');
});

test('self-service registration không được sống lại', () => {
  const source = adminRoutes();
  assert.doesNotMatch(source, /'\/setup'/, 'POST /setup cho phép tạo admin không cần đăng nhập');
  assert.doesNotMatch(source, /is-initialized/, 'GET /is-initialized lộ trạng thái khởi tạo');
});

test('tài khoản tenant chỉ được đọc/ghi qua assessment data-plane', () => {
  const source = adminRoutes();
  assert.match(source, /import db from '\.\.\/db\/postgres\.js'/);

  // Mỗi DATABASE_URL là một tenant boundary; control-plane không xác thực tenant user.
  for (const [statement] of source.matchAll(/(\w+)\.query\(\s*[`'"][^`'"]*admin_users/g)) {
    assert.match(
      statement,
      /^db\./,
      `truy vấn tenant admin_users ngoài data-plane: ${statement.slice(0, 60)}`,
    );
  }
});

test('CRUD người dùng đủ bốn động từ', () => {
  const source = adminRoutes();
  // PUT từng KHÔNG tồn tại dù client vẫn gọi, nên đổi vai trò và đặt lại mật khẩu
  // trên giao diện đều nhận 404 trong im lặng.
  for (const verb of ['get', 'post', 'put', 'delete']) {
    assert.match(
      source,
      new RegExp(`router\\.${verb}\\('/users`),
      `thiếu ${verb.toUpperCase()} /users`,
    );
  }
});

test('vai trò hợp lệ trong tenant là tenant_admin và admin, không phải mod', () => {
  const source = adminRoutes();
  assert.match(source, /TENANT_ROLES = \['tenant_admin', 'admin'\]/);
  // Validate cũ nhận 'mod' (vai trò không tồn tại) và từ chối 'tenant_admin'.
  assert.doesNotMatch(source, /role !== 'admin' && role !== 'mod'/);
});

test('ràng buộc sở hữu áp lên giáo viên, không áp lên tenant_admin', () => {
  const source = adminRoutes();
  assert.equal(
    [...source.matchAll(/if \(req\.adminUser\?\.role !== 'admin'\) \{/g)].length,
    0,
    "`role !== 'admin'` giới hạn đúng người nhiều quyền hơn — đảo ngược ý định",
  );
  assert.equal(
    [...source.matchAll(/if \(req\.adminUser\?\.role === 'admin'\) \{/g)].length,
    4,
    'phải còn đúng 4 chỗ ràng buộc sở hữu cho vai trò admin',
  );
});

test('tenant_admin cuối cùng không bị xóa hoặc hạ cấp', () => {
  const source = adminRoutes();
  // superadmin cố tình không quản lý được người dùng của tenant, nên mất tenant_admin
  // cuối cùng là khóa tenant ra ngoài vĩnh viễn — không ai dựng lại được.
  assert.match(source, /otherTenantAdminCount/);
  assert.match(source, /Cannot delete the last tenant administrator/);
  assert.match(source, /Cannot demote the last tenant administrator/);
});

test('tenant user insert không nhận tenant_id vì DATABASE_URL là tenant boundary', () => {
  const source = adminRoutes();
  const insert = source.match(/INSERT INTO admin_users[\s\S]{0,400}?\);/);
  assert.ok(insert, 'không tìm thấy câu INSERT admin_users');
  assert.match(
    insert[0],
    /INSERT INTO admin_users \(username, password_hash, role\)/,
    'tenant data-plane không được phụ thuộc control-plane tenant_id',
  );
  assert.doesNotMatch(insert[0], /tenant_id/);
});
