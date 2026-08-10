import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

/**
 * Chốt lại danh tính câu hỏi = CẶP (id, question_group).
 *
 * Bối cảnh: bản sửa này ĐÃ TỪNG bị một merge ghi đè mất, và bug quay lại nguyên vẹn —
 * import bộ đề thứ hai xóa trắng 100 câu của bộ thứ nhất vì hai file dùng chung mã ID.
 * Không ai phát hiện cho tới khi mất dữ liệu thật. Các test dưới đây đọc thẳng source
 * để lần sau nếu bị gỡ thì suite đỏ ngay, thay vì phải chờ hỏng ngoài production.
 *
 * Cùng quy ước với databaseMigration.test.ts (đọc source) vì đây là bất biến về lược đồ
 * và câu SQL, không phải logic runtime tách rời được.
 */

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('question_bank dùng khóa chính kép (id, question_group) ở cả hai DB mode', () => {
  const source = readSource('src', 'server', 'db', 'postgres.ts');
  assert.match(source, /ADD PRIMARY KEY \(id, question_group\)/, 'thiếu migration khóa kép cho PostgreSQL');
  assert.match(source, /PRIMARY KEY \(id, question_group\)/, 'thiếu bảng dựng lại với khóa kép cho SQLite');
});

test('exam_questions lưu kèm question_group để join không mơ hồ', () => {
  const source = readSource('src', 'server', 'db', 'postgres.ts');
  assert.match(source, /ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS question_group/);
  assert.match(source, /ALTER TABLE exam_questions ADD COLUMN question_group/);
});

test('cả hai route import đều upsert theo cặp, không theo id đơn lẻ', () => {
  const source = readSource('src', 'server', 'routes', 'admin.ts');
  const pairConflicts = [...source.matchAll(/ON CONFLICT \(id, question_group\)/g)];
  assert.equal(pairConflicts.length, 2, 'phải có đúng 2 upsert (tự luận + quiz) khóa trên cặp');

  // Chỉ soi các upsert vào question_bank. `ON CONFLICT (id)` của ai_settings là hợp lệ:
  // bảng đó thật sự chỉ có một hàng, khóa trên id là đúng.
  for (const [block] of source.matchAll(/INSERT INTO question_bank[\s\S]{0,900}?(?=`)/g)) {
    if (!block.includes('ON CONFLICT')) continue;
    assert.match(
      block,
      /ON CONFLICT \(id, question_group\)/,
      'upsert question_bank khóa trên id đơn lẻ → bộ đề sau sẽ ghi đè bộ trước',
    );
  }
});

test('mọi join exam_questions → question_bank đều so khớp question_group', () => {
  const files = [
    ['src', 'ai', 'queue.ts'],
    ['src', 'server', 'cache.ts'],
    ['src', 'server', 'routes', 'admin.ts'],
    ['src', 'server', 'routes', 'student.ts'],
  ];
  for (const segments of files) {
    const source = readSource(...segments);
    const joins = [...source.matchAll(/JOIN question_bank q ON eq\.question_id = q\.id([\s\S]{0,120})/g)];
    for (const [, tail] of joins) {
      assert.match(
        tail,
        /COALESCE\(eq\.question_group, ''\) = COALESCE\(q\.question_group, ''\)/,
        `${segments.join('/')}: join thiếu điều kiện question_group → số dòng nhân đôi khi hai bộ trùng ID`,
      );
    }
  }
});

test('import đọc cột bộ đề từ Excel, nếu không thì mọi câu đều rơi vào group rỗng', () => {
  const source = readSource('src', 'server', 'routes', 'admin.ts');
  assert.match(source, /QuestionGroup/, 'không đọc cột QuestionGroup thì khóa kép trở nên vô nghĩa');
});

test('SQLite chạy .all() cho INSERT ... RETURNING', () => {
  // Nếu đi qua .run(), rows luôn rỗng → students/import đọc được undefined rồi bỏ qua
  // học viên, tạo tài khoản mà không gán câu hỏi nào.
  const source = readSource('src', 'server', 'db', 'postgres.ts');
  assert.match(source, /upper\.includes\('RETURNING'\)/);
});
