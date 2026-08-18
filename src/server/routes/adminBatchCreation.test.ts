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
