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

test('all student recording gates clamp stored modes through the current effective tenant policy', () => {
  const submit = section('async function submitExamAtomically', 'async function startExamAtomically');
  const verify = section("router.post('/verify'", "router.post('/select-email'");
  const recordingUrl = section("router.post('/exam/recording-url'", "router.post('/exam/recording-complete'");
  const recordingComplete = section("router.post('/exam/recording-complete'", "router.post('/exam/recording-finalize'");
  const recordingFinalize = section("router.post('/exam/recording-finalize'", '// PRACTICE EXAM');

  for (const [name, route] of [
    ['atomic submit', submit],
    ['verify', verify],
    ['recording URL', recordingUrl],
    ['recording complete', recordingComplete],
    ['recording finalize', recordingFinalize],
  ] as const) {
    assert.match(route, /effectiveBatchRecordMode\(/, `${name} dùng raw batch record_mode thay vì effective policy`);
  }

  assert.match(submit, /currentTenantEvidencePolicy\(\)/,
    'submit phải nạp policy hiện tại để việc thu hồi S3 bỏ chặn nộp ngay');
  assert.match(verify, /record_enabled: recordMode === 's3'/,
    'verify compatibility flag phải phản ánh mode hiệu lực, không phản ánh cột legacy');
});

test('student identity routes use retention-qualified effective photo capability', () => {
  const tenantPolicy = section('async function currentTenantEvidencePolicy', 'async function requireStudentIdentity');
  const upload = section("router.post('/identity/upload-url'", "router.post('/identity/complete'");
  const complete = section("router.post('/identity/complete'", "router.get('/identity/status'");
  const status = section("router.get('/identity/status'", "router.post('/exam/start'");

  assert.match(tenantPolicy, /allowed_record_modes/);
  assert.match(tenantPolicy, /recording_retention_days/);
  assert.match(tenantPolicy, /identity_retention_days/);
  assert.match(tenantPolicy, /resolveTenantEvidencePolicy\(/);
  for (const [name, route] of [['upload', upload], ['complete', complete], ['status', status]] as const) {
    assert.match(route, /effectiveBatchIdentityMode\(/, `${name} không clamp batch identity theo policy hiệu lực`);
  }
});
