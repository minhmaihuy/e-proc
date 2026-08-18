import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src', 'server', 'routes', 'student.ts'),
  'utf8',
);

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Không tìm thấy mốc bắt đầu: ${start}`);
  assert.ok(endIndex > startIndex, `Không tìm thấy mốc kết thúc: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('atomic exam start redirects Practice before blueprint parsing or state mutation', () => {
  const atomicStart = section('async function startExamAtomically', 'async function enforceConcurrentSession');
  const redirectIndex = atomicStart.indexOf("return { success: false, redirect: 'practice' }");
  const blueprintIndex = atomicStart.indexOf('parseBlueprintCompat');
  const stateMutationIndex = atomicStart.indexOf("UPDATE students SET status = 'in_progress'");

  assert.match(atomicStart, /b\.practice_exam_id/);
  assert.ok(redirectIndex >= 0, 'start exam thiếu redirect cho batch Practice');
  assert.ok(redirectIndex < blueprintIndex, 'redirect Practice phải chạy trước khi parse blueprint rỗng');
  assert.ok(redirectIndex < stateMutationIndex, 'redirect Practice phải chạy trước khi đổi trạng thái student');
});

test('POST /exam/start returns Practice redirect before usage metering', () => {
  const startRoute = section("router.post('/exam/start'", "router.get('/exam/questions'");
  const redirectIndex = startRoute.indexOf('if (!startedExam.success) return res.json(startedExam)');
  const usageIndex = startRoute.indexOf('enqueueUsageEvent');

  assert.ok(redirectIndex >= 0, 'route start không trả kết quả redirect từ atomic guard');
  assert.ok(redirectIndex < usageIndex, 'Practice redirect không được ghi nhận như một exam start');
});

test('GET /exam/questions redirects Practice before returning pending empty questions', () => {
  const questionsRoute = section("router.get('/exam/questions'", "router.post('/exam/answer'");
  const redirectIndex = questionsRoute.indexOf("redirect: 'practice'");
  const pendingIndex = questionsRoute.indexOf("student.status === 'pending'");

  assert.match(questionsRoute, /b\.practice_exam_id/);
  assert.ok(redirectIndex >= 0, 'questions route thiếu redirect cho batch Practice');
  assert.ok(redirectIndex < pendingIndex, 'Practice phải redirect trước nhánh pending trả questions rỗng');
  assert.match(
    questionsRoute,
    /return res\.json\(\{ redirect: 'practice', questions: \[\], time_remaining: null \}\)/,
  );
});
