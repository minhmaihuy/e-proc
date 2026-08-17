import test from 'node:test';
import assert from 'node:assert/strict';
import { DbExecutor } from '../db/postgres.js';
import { tenantAdminMigrationInternals } from './tenantAdminPlaneMigration.js';

interface UserRow { id: number; username: string; password_hash: string; role: string }

function fixture(initialUsers: UserRow[] = []) {
  const users = initialUsers.map((row) => ({ ...row }));
  const metadata = new Map<string, string>();
  const executor: DbExecutor = {
    query: async (text, params = []) => {
      const sql = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (sql.startsWith('select metadata_value')) {
        const value = metadata.get(String(params[0]));
        return { rows: value === undefined ? [] : [{ metadata_value: value }], rowCount: value === undefined ? 0 : 1 };
      }
      if (sql.startsWith('select id, username from admin_users')) {
        const id = Number(params[0]);
        const username = String(params[1]).toLowerCase();
        const rows = users.filter((row) => row.id === id || row.username.toLowerCase() === username);
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith('update admin_users set password_hash')) {
        const user = users.find((row) => row.id === Number(params[2]));
        if (user) Object.assign(user, { password_hash: String(params[0]), role: String(params[1]) });
        return { rows: [], rowCount: user ? 1 : 0 };
      }
      if (sql.startsWith('insert into admin_users (id,')) {
        users.push({ id: Number(params[0]), username: String(params[1]), password_hash: String(params[2]), role: String(params[3]) });
        return { rows: [], rowCount: 1, lastInsertRowid: Number(params[0]) };
      }
      if (sql.startsWith('select count(*) as count from admin_users where role')) {
        return { rows: [{ count: users.filter((row) => row.role === 'tenant_admin').length }], rowCount: 1 };
      }
      if (sql.startsWith('select count(*) as count from admin_users where lower')) {
        const count = users.filter((row) => row.username.toLowerCase() === String(params[0]).toLowerCase()).length;
        return { rows: [{ count }], rowCount: 1 };
      }
      if (sql.startsWith('insert into admin_users (username,')) {
        const id = Math.max(0, ...users.map((row) => row.id)) + 1;
        users.push({ id, username: String(params[0]), password_hash: String(params[1]), role: String(params[2]) });
        return { rows: [], rowCount: 1, lastInsertRowid: id };
      }
      if (sql.startsWith('insert into data_plane_metadata')) {
        metadata.set(String(params[0]), String(params[1]));
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected test SQL: ${text}`);
    },
  };
  return { users, metadata, executor };
}

test('tenant identities move to the data-plane once and preserve their IDs', async () => {
  const state = fixture();
  const source = [{ id: 17, username: 'teacher', password_hash: 'current-hash', role: 'admin' as const },
    { id: 21, username: 'owner', password_hash: 'owner-hash', role: 'tenant_admin' as const }];

  const first = await tenantAdminMigrationInternals.copyTenantAdmins(state.executor, source, 'fsa-cls', {});
  assert.deepEqual(first, { migrated: 2, seeded: false, alreadyMigrated: false });
  assert.deepEqual(state.users, source);

  const second = await tenantAdminMigrationInternals.copyTenantAdmins(
    state.executor,
    [{ ...source[0], password_hash: 'stale-control-hash' }, source[1]],
    'fsa-cls',
    {},
  );
  assert.deepEqual(second, { migrated: 0, seeded: false, alreadyMigrated: true });
  assert.equal(state.users.find((row) => row.id === 17)?.password_hash, 'current-hash');
});

test('tenant identity migration fails safely on ID or username conflicts', async () => {
  const state = fixture([{ id: 7, username: 'different-user', password_hash: 'hash', role: 'admin' }]);
  await assert.rejects(
    tenantAdminMigrationInternals.copyTenantAdmins(
      state.executor,
      [{ id: 7, username: 'owner', password_hash: 'owner-hash', role: 'tenant_admin' }],
      'fsa-cls',
      {},
    ),
    /migration conflict/,
  );
  assert.equal(state.metadata.size, 0);
});

test('fresh FSA data-plane seeds its first tenant_admin locally', async () => {
  const state = fixture();
  const result = await tenantAdminMigrationInternals.copyTenantAdmins(
    state.executor,
    [],
    'fsa-cls',
    { FSA_TENANT_ADMIN_USERNAME: 'fsa-owner', FSA_TENANT_ADMIN_PASSWORD: '<test-only-placeholder>' },
  );
  assert.equal(result.seeded, true);
  assert.deepEqual(
    state.users.map(({ username, role }) => ({ username, role })),
    [{ username: 'fsa-owner', role: 'tenant_admin' }],
  );
});

test('non-FSA tenant without a bootstrap owner fails before marking migration complete', async () => {
  const state = fixture();
  await assert.rejects(
    tenantAdminMigrationInternals.copyTenantAdmins(state.executor, [], 'acme-vietnam', {}),
    /has no tenant_admin bootstrap account/,
  );
  assert.equal(state.metadata.size, 0);
});
