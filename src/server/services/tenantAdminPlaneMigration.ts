import bcrypt from 'bcryptjs';
import controlDb from '../db/controlPlane.js';
import dataDb, { DbExecutor, ensureTenantOwnershipConstraints, syncAdminUserSequence } from '../db/postgres.js';
import {
  DEFAULT_FSA_TENANT_ADMIN_USERNAME,
  resolveTenantAdminSeed,
} from '../db/controlPlane.js';
import { getCurrentTenantConfig } from '../tenantContext.js';

const MIGRATION_KEY = 'tenant_admin_plane_migrated_v1';

interface TenantAdminRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'tenant_admin';
}

export interface TenantAdminMigrationResult {
  migrated: number;
  seeded: boolean;
  alreadyMigrated: boolean;
}

async function copyTenantAdmins(
  tx: DbExecutor,
  sourceUsers: TenantAdminRow[],
  tenantSlug: string,
  env: NodeJS.ProcessEnv,
): Promise<TenantAdminMigrationResult> {
  const marker = await tx.query(
    'SELECT metadata_value FROM data_plane_metadata WHERE metadata_key = ?',
    [MIGRATION_KEY],
  );
  if (marker.rows[0]?.metadata_value === '1') {
    const tenantAdminCount = Number((await tx.query(
      "SELECT COUNT(*) AS count FROM admin_users WHERE role = 'tenant_admin'",
    )).rows[0]?.count || 0);
    if (tenantAdminCount === 0) {
      throw new Error(`Tenant '${tenantSlug}' migration marker exists without a tenant_admin account.`);
    }
    return { migrated: 0, seeded: false, alreadyMigrated: true };
  }

  let migrated = 0;
  for (const source of sourceUsers) {
    const matches = await tx.query(
      'SELECT id, username FROM admin_users WHERE id = ? OR LOWER(username) = LOWER(?)',
      [source.id, source.username],
    );
    const conflictingId = matches.rows.find(
      (row: any) => Number(row.id) === Number(source.id)
        && String(row.username).toLowerCase() !== source.username.toLowerCase(),
    );
    const conflictingUsername = matches.rows.find(
      (row: any) => String(row.username).toLowerCase() === source.username.toLowerCase()
        && Number(row.id) !== Number(source.id),
    );
    if (conflictingId || conflictingUsername) {
      throw new Error(`Tenant admin migration conflict for account '${source.username}'.`);
    }
    if (matches.rows.length > 0) {
      await tx.query(
        'UPDATE admin_users SET password_hash = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [source.password_hash, source.role, source.id],
      );
    } else {
      await tx.query(
        'INSERT INTO admin_users (id, username, password_hash, role) VALUES (?, ?, ?, ?)',
        [source.id, source.username, source.password_hash, source.role],
      );
    }
    migrated++;
  }

  let seeded = false;
  const tenantAdminCount = Number((await tx.query(
    "SELECT COUNT(*) AS count FROM admin_users WHERE role = 'tenant_admin'",
  )).rows[0]?.count || 0);
  if (tenantAdminCount === 0 && tenantSlug === 'fsa-cls') {
    const username = env.FSA_TENANT_ADMIN_USERNAME?.trim() || DEFAULT_FSA_TENANT_ADMIN_USERNAME;
    const usernameTaken = Number((await tx.query(
      'SELECT COUNT(*) AS count FROM admin_users WHERE LOWER(username) = LOWER(?)',
      [username],
    )).rows[0]?.count || 0) > 0;
    const decision = resolveTenantAdminSeed(env, tenantAdminCount, usernameTaken);
    if (!decision.shouldSeed) {
      throw new Error(`Cannot seed FSA tenant admin because username '${username}' is already in use.`);
    }
    await tx.query(
      'INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)',
      [decision.username, await bcrypt.hash(decision.password, 12), 'tenant_admin'],
    );
    seeded = true;
  }

  const finalTenantAdminCount = Number((await tx.query(
    "SELECT COUNT(*) AS count FROM admin_users WHERE role = 'tenant_admin'",
  )).rows[0]?.count || 0);
  if (finalTenantAdminCount === 0) {
    throw new Error(`Tenant '${tenantSlug}' has no tenant_admin bootstrap account.`);
  }

  await tx.query(
    'INSERT INTO data_plane_metadata (metadata_key, metadata_value) VALUES (?, ?)',
    [MIGRATION_KEY, '1'],
  );
  return { migrated, seeded, alreadyMigrated: false };
}

export async function migrateCurrentTenantAdminsToDataPlane(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantAdminMigrationResult> {
  const tenantSlug = getCurrentTenantConfig().slug;
  const tenant = (await controlDb.query('SELECT id FROM tenants WHERE slug = ?', [tenantSlug])).rows[0];
  if (!tenant) throw new Error(`Current tenant '${tenantSlug}' is missing from the control-plane.`);
  const sourceUsers = (await controlDb.query(
    `SELECT id, username, password_hash, role FROM admin_users
      WHERE tenant_id = ? AND role IN ('admin', 'tenant_admin') ORDER BY id`,
    [tenant.id],
  )).rows as TenantAdminRow[];

  const result = await dataDb.withTransaction((tx) => copyTenantAdmins(tx, sourceUsers, tenantSlug, env));
  await syncAdminUserSequence();
  await ensureTenantOwnershipConstraints();
  console.log('[AuthMigration] Tenant identities ready in assessment data-plane:', {
    tenantSlug,
    migrated: result.migrated,
    seeded: result.seeded,
    alreadyMigrated: result.alreadyMigrated,
  });
  return result;
}

export const tenantAdminMigrationInternals = { copyTenantAdmins, MIGRATION_KEY };
