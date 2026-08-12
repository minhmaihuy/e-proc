import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

function source(...segments) {
  return fs.readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');
}

test('RDS luôn giữ backup, chống xóa và tạo final snapshot ở cả hai module legacy', () => {
  for (const file of ['terraform/rds.tf', 'terraform-ipv6/rds.tf']) {
    const terraform = source(...file.split('/'));
    assert.match(terraform, /backup_retention_period\s*=\s*var\.backup_retention_days/);
    assert.match(terraform, /deletion_protection\s*=\s*true/);
    assert.match(terraform, /skip_final_snapshot\s*=\s*false/);
    assert.match(terraform, /final_snapshot_identifier\s*=/);
  }
});

test('backup chỉ đọc đúng DATABASE_URL, đổi sslmode cho libpq và không tách mật khẩu', () => {
  const backup = source('scripts', 'backup-db.sh');
  assert.match(backup, /grep '\^DATABASE_URL='/, 'grep không neo sẽ ăn cả CONTROL/LOG_DATABASE_URL');
  assert.match(backup, /sslmode=no-verify\/sslmode=require/);
  assert.match(backup, /pg_dump "\$DATABASE_URL"/);
  assert.doesNotMatch(backup, /PGPASSWORD/);
  for (const scriptName of ['backup-db.sh', 'restore-db.sh', 'verify-latest-backup.sh']) {
    const script = source('scripts', scriptName);
    assert.doesNotMatch(script, /echo[^\n]*(DATABASE_URL|CONTROL_DATABASE_URL|LOG_DATABASE_URL|SOURCE_URL|CONTROL_URL|LOG_URL)/);
  }
  assert.ok(
    backup.indexOf('LOG_DATABASE_URL="$(grep') < backup.indexOf(': "${S3_BACKUP_BUCKET:'),
    'log-plane connection must be loaded before configuration failures can occur',
  );
  assert.ok(
    backup.indexOf('trap record_failure ERR') < backup.indexOf(': "${S3_BACKUP_BUCKET:'),
    'failure trap must be active before validating scheduled-backup configuration',
  );
});

test('restore từ chối database nguồn và database đã tồn tại', () => {
  const restore = source('scripts', 'restore-db.sh');
  assert.match(restore, /sslmode=no-verify\/sslmode=require/);
  assert.match(restore, /\[\[ "\$TARGET_DB" != "\$SOURCE_DB" \]\]/);
  assert.match(restore, /Target database already exists; refusing to overwrite/);
  assert.match(restore, /createdb --maintenance-db=/);
  assert.doesNotMatch(restore, /dropdb/);
});

test('restore drill đối chiếu bốn bảng, dọn database tạm và ghi log-plane khi lỗi', () => {
  const verify = source('scripts', 'verify-latest-backup.sh');
  for (const table of ['question_bank', 'students', 'exam_questions', 'violation_events']) {
    assert.match(verify, new RegExp(`for table in[^\\n]*${table}|${table}[^\\n]*COUNT`));
  }
  assert.match(verify, /SOURCE_COUNT=.*SELECT COUNT\(\*\) FROM \$\{table\}/);
  assert.match(verify, /RESTORED_COUNT=.*SELECT COUNT\(\*\) FROM \$\{table\}/);
  assert.match(verify, /\[\[ "\$SOURCE_COUNT" == "\$RESTORED_COUNT" \]\]/);
  assert.match(verify, /dropdb --maintenance-db=.*--if-exists --force/);
  assert.match(verify, /INSERT INTO tenant_issue_logs/);
  assert.match(verify, /last_restore_test_status/);
});

test('tenant cron points backup and restore drill at the tenant env file', () => {
  const userData = source('terraform', 'tenant-instance', 'user-data.sh.tftpl');
  assert.match(
    userData,
    /EAUDIT_ENV_FILE='\/opt\/eproc\/\.env'[^\n]*\/opt\/eproc\/backup-db\.sh/,
  );
  assert.match(
    userData,
    /EAUDIT_ENV_FILE='\/opt\/eproc\/\.env'[^\n]*\/opt\/eproc\/verify-latest-backup\.sh/,
  );
});

test('control-plane backfill giữ backup bật ở 14 ngày và UI hiển thị trạng thái', () => {
  const control = source('src', 'server', 'db', 'controlPlane.ts');
  const ui = source('client', 'src', 'pages', 'TenantManagement.tsx');
  assert.match(control, /backup_retention_days INTEGER NOT NULL DEFAULT 14/);
  assert.match(control, /ALTER TABLE tenants ADD COLUMN IF NOT EXISTS backup_retention_days INTEGER NOT NULL DEFAULT 14/);
  assert.match(ui, /Latest backup/);
  assert.match(ui, /Latest restore check/);
});
