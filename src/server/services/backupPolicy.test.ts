import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  isBackupRetentionDays,
  resolveBackupRetentionDays,
} from './backupPolicy.js';

test('mặc định an toàn là 14 ngày', () => {
  assert.equal(resolveBackupRetentionDays(undefined), DEFAULT_BACKUP_RETENTION_DAYS);
  assert.equal(resolveBackupRetentionDays(null), DEFAULT_BACKUP_RETENTION_DAYS);
  assert.equal(resolveBackupRetentionDays('invalid'), DEFAULT_BACKUP_RETENTION_DAYS);
});

test('chấp nhận số ngày RDS hỗ trợ và từ chối tắt backup', () => {
  assert.equal(resolveBackupRetentionDays(1), 1);
  assert.equal(resolveBackupRetentionDays('14'), 14);
  assert.equal(resolveBackupRetentionDays(35), 35);
  assert.equal(isBackupRetentionDays(0), false);
  assert.equal(isBackupRetentionDays(36), false);
});
