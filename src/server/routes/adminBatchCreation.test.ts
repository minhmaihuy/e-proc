import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src', 'server', 'routes', 'admin.ts'),
  'utf8',
);

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Không tìm thấy mốc bắt đầu: ${start}`);
  assert.ok(endIndex > startIndex, `Không tìm thấy mốc kết thúc: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('batch creation returns the inserted id in both database modes', () => {
  const route = section("router.post('/batches'", "router.post('/batches/:id/emails'");
  const inserts = [...route.matchAll(/INSERT INTO batches[\s\S]*?RETURNING id/g)];

  assert.equal(inserts.length, 2, 'cả SQLite và PostgreSQL INSERT đều phải RETURNING id');
  assert.match(route, /const batchId = Number\(result\.rows\?\.\[0\]\?\.id \?\? result\.lastInsertRowid\)/);
  assert.match(route, /res\.json\(\{ success: true, id: batchId \}\)/);
});

test('batch create and update enforce tenant recording allowlist and tenant_admin authority', () => {
  const createRoute = section("router.post('/batches'", "router.post('/batches/:id/emails'");
  const updateRoute = section("router.put('/batches/:id'", "router.delete('/batches/:id'");

  for (const [name, route] of [['create', createRoute], ['update', updateRoute]] as const) {
    assert.match(route, /resolveBatchRecordMode\(\{/,
      `${name} phải quyết định record mode ở backend`);
    assert.match(route, /requested: record_mode/,
      `${name} phải coi record_mode từ client là yêu cầu, không phải giá trị tin cậy`);
    assert.match(route, /allowedForTenant: req\.adminUser\?\.allowedRecordModes \?\? \['none'\]/,
      `${name} phải giới hạn theo allowlist đã nạp từ control-plane`);
    assert.match(route, /canChange: req\.adminUser\?\.role === 'tenant_admin'/,
      `${name} chỉ cho tenant_admin quyết định mode theo batch`);
    assert.match(route, /if \(recordDecision\.rejected\) \{[\s\S]*?res\.status\(403\)/,
      `${name} phải trả 403 khi mode vượt allowlist`);
  }

  assert.match(createRoute, /fallback: 'none'/,
    'batch mới phải rơi về none khi client không có quyền hoặc không gửi mode hợp lệ');
  assert.match(updateRoute, /SELECT record_mode, identity_verification FROM batches WHERE id = \?/,
    'update phải đọc mode hiện tại trước khi quyết định');
  assert.match(updateRoute, /fallback: existingMode/,
    'update không được âm thầm tắt recording đã lưu');
});

test('recording capability endpoint is read-only and trusts authenticated tenant context', () => {
  const registrations = [...source.matchAll(
    /router\.(get|post|put|patch|delete)\('\/recording-config'/g,
  )].map((match) => match[1]);

  assert.deepEqual(
    registrations,
    ['get'],
    'tenant assessment router không được có API sửa tenant-wide recording allowlist',
  );

  const route = section(
    "router.get('/recording-config'",
    'async function identityReviewTarget',
  );
  assert.match(route, /allowed_record_modes: req\.adminUser\?\.allowedRecordModes \?\? \['none'\]/);
  assert.match(route, /can_change: req\.adminUser\?\.role === 'tenant_admin'/);
  assert.doesNotMatch(route, /req\.(body|params|query)/,
    'effective capability không được nhận tenant id hay allowlist từ client');
});
