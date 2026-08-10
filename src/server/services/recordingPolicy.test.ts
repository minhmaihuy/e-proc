import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAllowedRecordModes,
  recordModeLabel,
  resolveBatchRecordMode,
  serializeAllowedRecordModes,
} from './recordingPolicy.js';

test("'none' luôn được phép dù cấu hình tenant để trống", () => {
  assert.deepEqual(parseAllowedRecordModes(''), ['none']);
  assert.deepEqual(parseAllowedRecordModes(null), ['none']);
  assert.deepEqual(parseAllowedRecordModes(undefined), ['none']);
});

test('chuẩn hóa được dữ liệu bẩn: hoa thường, khoảng trắng, trùng lặp, giá trị lạ', () => {
  assert.deepEqual(parseAllowedRecordModes(' S3 , local ,local, khong-ton-tai '), ['none', 'local', 's3']);
});

test('luôn trả về theo thứ tự cố định none → local → s3', () => {
  assert.deepEqual(parseAllowedRecordModes('s3,local'), ['none', 'local', 's3']);
  assert.equal(serializeAllowedRecordModes(['s3', 'local']), 'none,local,s3');
});

test('serialize nhận cả mảng lẫn chuỗi', () => {
  assert.equal(serializeAllowedRecordModes('local'), 'none,local');
  assert.equal(serializeAllowedRecordModes(['local']), 'none,local');
});

test('batch chọn được mode nằm trong allowlist của tenant', () => {
  const result = resolveBatchRecordMode({
    requested: 's3',
    allowedForTenant: ['none', 'local', 's3'],
    canChange: true,
  });
  assert.equal(result.mode, 's3');
  assert.equal(result.rejected, false);
});

test('mode ngoài allowlist bị từ chối, KHÔNG âm thầm nâng quyền', () => {
  const result = resolveBatchRecordMode({
    requested: 's3',
    allowedForTenant: ['none', 'local'],
    canChange: true,
  });
  assert.equal(result.mode, 'none', 'phải hạ về fallback chứ không được nhận s3');
  assert.equal(result.rejected, true);
  assert.match(result.reason ?? '', /không được phép/);
});

test('khi sửa batch, mode bị từ chối thì giữ nguyên giá trị đang lưu', () => {
  const result = resolveBatchRecordMode({
    requested: 's3',
    allowedForTenant: ['none', 'local'],
    fallback: 'local',
    canChange: true,
  });
  assert.equal(result.mode, 'local', 'không được hạ xuống none làm mất cấu hình đang chạy');
  assert.equal(result.rejected, true);
});

test('vai trò không đủ quyền thì giữ nguyên mode cũ, kể cả khi mode được phép', () => {
  const result = resolveBatchRecordMode({
    requested: 'none',
    allowedForTenant: ['none', 'local', 's3'],
    fallback: 's3',
    canChange: false,
  });
  assert.equal(result.mode, 's3');
  assert.equal(result.rejected, false);
});

test('giá trị rác từ client rơi về fallback mà không báo lỗi giả', () => {
  const result = resolveBatchRecordMode({
    requested: { hack: true },
    allowedForTenant: ['none', 'local', 's3'],
    fallback: 'local',
    canChange: true,
  });
  assert.equal(result.mode, 'local');
  assert.equal(result.rejected, false);
});

test('nhãn hiển thị phân biệt rõ ba chế độ', () => {
  assert.match(recordModeLabel('none'), /Không ghi/);
  assert.match(recordModeLabel('local'), /máy học viên/);
  assert.match(recordModeLabel('s3'), /S3/);
});
