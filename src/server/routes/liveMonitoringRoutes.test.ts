import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const adminSource = fs.readFileSync(path.resolve(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
const studentSource = fs.readFileSync(path.resolve(process.cwd(), 'src/server/routes/student.ts'), 'utf8');

test('live monitor administration is restricted to the current tenant administrator', () => {
  assert.match(adminSource, /router\.get\('\/batches\/:batchId\/live\/students',\s*requireTenantUserManager/);
  assert.match(adminSource, /router\.post\('\/batches\/:batchId\/live\/students\/:studentId\/session',\s*requireTenantUserManager/);
  assert.match(adminSource, /router\.post\('\/live\/audit\/:viewerSessionId\/end',\s*requireTenantUserManager/);
  assert.doesNotMatch(adminSource, /live\/students',\s*requireAdmin/);
});

test('live monitor routes bind a viewer to an active recorded attempt and to its creator audit row', () => {
  assert.match(adminSource, /effectiveBatchRecordMode\(/);
  assert.match(adminSource, /status = 'in_progress' AND active_jti IS NOT NULL/);
  assert.match(adminSource, /attemptHash\(jti\)/);
  assert.match(adminSource, /WHERE viewer_session_id = \? AND admin_user_id = \?/);
});

test('student signaling is scoped to the JWT attempt and refuses an inactive or unrecorded exam', () => {
  assert.match(studentSource, /router\.post\('\/live\/session', studentAuthMiddleware/);
  assert.match(studentSource, /const \{ studentId, batchId, jti \} = req\.studentPayload!/);
  assert.match(studentSource, /active_jti = \?/);
  assert.match(studentSource, /effectiveBatchRecordMode\(/);
});
