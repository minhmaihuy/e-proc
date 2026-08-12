import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { canManageTenantUser } from '../tenantContext.js';

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
 *   2. Bốn kiểm tra sở hữu viết `role !== 'admin'`, tức giới hạn đúng người NHIỀU
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

test('self-service registration không được sống lại', () => {
  const source = adminRoutes();
  assert.doesNotMatch(source, /'\/setup'/, 'POST /setup cho phép tạo admin không cần đăng nhập');
  assert.doesNotMatch(source, /is-initialized/, 'GET /is-initialized lộ trạng thái khởi tạo');
});

test('tài khoản quản trị chỉ được đọc/ghi qua control-plane', () => {
  const source = adminRoutes();
  assert.match(source, /import controlDb from '\.\.\/db\/controlPlane\.js'/);

  // Mọi câu lệnh chạm admin_users phải đi qua controlDb. Qua `db` (data-plane) thì
  // xoá tài khoản báo thành công nhưng người đó vẫn đăng nhập được như thường.
  for (const [statement] of source.matchAll(/(\w+)\.query\(\s*[`'"][^`'"]*admin_users/g)) {
    assert.match(
      statement,
      /^controlDb\./,
      `truy vấn admin_users qua data-plane: ${statement.slice(0, 60)}`,
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

test('tenant_id lấy từ JWT chứ không từ body', () => {
  const source = adminRoutes();
  const insert = source.match(/INSERT INTO admin_users[\s\S]{0,400}?\);/);
  assert.ok(insert, 'không tìm thấy câu INSERT admin_users');
  assert.match(
    insert[0],
    /req\.adminUser!\.tenantId/,
    'tin tenant_id từ body cho phép tạo tài khoản sang tenant khác',
  );
});

test('canManageTenantUser chặn đúng ba trường hợp', () => {
  const owner = { role: 'tenant_admin', tenantId: 1 };

  assert.equal(canManageTenantUser(owner, { role: 'admin', tenantId: 1 }), true);

  assert.equal(
    canManageTenantUser(owner, { role: 'admin', tenantId: 2 }),
    false,
    'không được quản lý người của tenant khác',
  );
  assert.equal(
    canManageTenantUser(owner, { role: 'superadmin', tenantId: null }),
    false,
    'tenant admin không được đụng tới superadmin',
  );
  assert.equal(
    canManageTenantUser({ role: 'admin', tenantId: 1 }, { role: 'admin', tenantId: 1 }),
    false,
    'giáo viên không phải người quản lý người dùng',
  );
});
