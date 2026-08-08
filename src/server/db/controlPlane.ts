import pg from 'pg';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import dataDb from './postgres.js';
import { getCurrentTenantConfig } from '../tenantContext.js';

interface DbResult {
  rows: any[];
  rowCount: number;
  lastInsertRowid?: number | bigint;
}

export interface ControlPlaneConnectionConfig {
  useSqlite: boolean;
  connectionString: string;
  sqlitePath: string;
  sharedWithDataPlane: boolean;
}

const { Pool } = pg;
let pgPool: pg.Pool | null = null;
let sqliteDb: Database.Database | null = null;
let connectionConfig: ControlPlaneConnectionConfig | null = null;

export function resolveControlPlaneConnection(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): ControlPlaneConnectionConfig {
  const explicitControlUrl = env.CONTROL_DATABASE_URL?.trim() || '';
  const connectionString = explicitControlUrl;
  return {
    useSqlite: !connectionString,
    connectionString,
    sqlitePath: path.resolve(env.CONTROL_SQLITE_PATH?.trim() || path.join(cwd, 'data', 'control-plane.db')),
    sharedWithDataPlane: false,
  };
}

export function mapLegacyTenantSlug(slug: string): string {
  return slug.trim().toLowerCase() === 'fsa' ? 'fsa-cls' : slug.trim().toLowerCase();
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export async function query(text: string, params: any[] = []): Promise<DbResult> {
  if (sqliteDb) {
    const stmt = sqliteDb.prepare(text);
    const normalized = text.trim().toUpperCase();
    if (normalized.startsWith('SELECT') || normalized.includes('RETURNING')) {
      const rows = stmt.all(...params);
      return { rows, rowCount: rows.length };
    }
    const result = stmt.run(...params);
    return { rows: [], rowCount: result.changes, lastInsertRowid: result.lastInsertRowid };
  }
  if (pgPool) {
    let index = 1;
    const pgText = params.length ? text.replace(/\?/g, () => `$${index++}`) : text;
    const result = await pgPool.query(pgText, params);
    return { rows: result.rows, rowCount: result.rowCount || 0 };
  }
  throw new Error('Control-plane database is not initialized.');
}

async function initPostgres(config: ControlPlaneConnectionConfig) {
  pgPool = new Pool({
    connectionString: config.connectionString,
    max: Math.max(1, parseInt(process.env.CONTROL_DB_POOL_MAX || '5', 10)),
    min: 0,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        tenant_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(31) UNIQUE NOT NULL,
        name VARCHAR(160) NOT NULL,
        contact_email VARCHAR(254) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        aws_region VARCHAR(32) NOT NULL DEFAULT 'ap-southeast-1',
        instance_type VARCHAR(32) NOT NULL DEFAULT 't3.micro',
        root_volume_size INTEGER NOT NULL DEFAULT 12,
        compiler_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        compiler_memory_mb INTEGER NOT NULL DEFAULT 512,
        compiler_timeout_seconds INTEGER NOT NULL DEFAULT 15,
        compiler_concurrency INTEGER NOT NULL DEFAULT 2,
        compiler_lambda_arn TEXT,
        domain_name VARCHAR(253) NOT NULL DEFAULT '',
        route53_zone_id VARCHAR(64) NOT NULL DEFAULT '',
        secret_arn TEXT NOT NULL DEFAULT '',
        repository_url TEXT NOT NULL DEFAULT 'https://github.com/minhmaihuy/e-proc.git',
        repository_ref VARCHAR(100) NOT NULL DEFAULT 'main',
        provision_status VARCHAR(20) NOT NULL DEFAULT 'not_started',
        terraform_state_key TEXT,
        instance_id VARCHAR(64),
        public_ip VARCHAR(64),
        ipv6_address VARCHAR(64),
        app_url TEXT,
        last_error TEXT,
        approved_by INTEGER,
        approved_at TIMESTAMP,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
      CREATE INDEX IF NOT EXISTS idx_admin_users_tenant ON admin_users(tenant_id);
      CREATE TABLE IF NOT EXISTS tenant_provision_jobs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        action VARCHAR(16) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
        requested_by INTEGER NOT NULL,
        log_output TEXT,
        started_at TIMESTAMP,
        finished_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_jobs_tenant ON tenant_provision_jobs(tenant_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS tenant_audit_events (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        actor_id INTEGER NOT NULL,
        action VARCHAR(64) NOT NULL,
        detail TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_audit_tenant ON tenant_audit_events(tenant_id, created_at DESC);
    `);
    await client.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS compiler_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS compiler_memory_mb INTEGER NOT NULL DEFAULT 512`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS compiler_timeout_seconds INTEGER NOT NULL DEFAULT 15`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS compiler_concurrency INTEGER NOT NULL DEFAULT 2`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS compiler_lambda_arn TEXT`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ipv6_address VARCHAR(64)`);
  } finally {
    client.release();
  }
}

function initSqlite(config: ControlPlaneConnectionConfig) {
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  sqliteDb = new Database(config.sqlitePath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      tenant_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      aws_region TEXT NOT NULL DEFAULT 'ap-southeast-1',
      instance_type TEXT NOT NULL DEFAULT 't3.micro',
      root_volume_size INTEGER NOT NULL DEFAULT 12,
      compiler_enabled INTEGER NOT NULL DEFAULT 0,
      compiler_memory_mb INTEGER NOT NULL DEFAULT 512,
      compiler_timeout_seconds INTEGER NOT NULL DEFAULT 15,
      compiler_concurrency INTEGER NOT NULL DEFAULT 2,
      compiler_lambda_arn TEXT,
      domain_name TEXT NOT NULL DEFAULT '',
      route53_zone_id TEXT NOT NULL DEFAULT '',
      secret_arn TEXT NOT NULL DEFAULT '',
      repository_url TEXT NOT NULL DEFAULT 'https://github.com/minhmaihuy/e-proc.git',
      repository_ref TEXT NOT NULL DEFAULT 'main',
      provision_status TEXT NOT NULL DEFAULT 'not_started',
      terraform_state_key TEXT,
      instance_id TEXT,
      public_ip TEXT,
      ipv6_address TEXT,
      app_url TEXT,
      last_error TEXT,
      approved_by INTEGER,
      approved_at DATETIME,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
    CREATE INDEX IF NOT EXISTS idx_admin_users_tenant ON admin_users(tenant_id);
    CREATE TABLE IF NOT EXISTS tenant_provision_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      requested_by INTEGER NOT NULL,
      log_output TEXT,
      started_at DATETIME,
      finished_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_jobs_tenant ON tenant_provision_jobs(tenant_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS tenant_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_audit_tenant ON tenant_audit_events(tenant_id, created_at DESC);
  `);
}

const ADMIN_COLUMNS = ['id', 'username', 'password_hash', 'role', 'tenant_id', 'created_at', 'updated_at'];
const TENANT_COLUMNS = [
  'id', 'slug', 'name', 'contact_email', 'status', 'aws_region', 'instance_type', 'root_volume_size',
  'compiler_enabled', 'compiler_memory_mb', 'compiler_timeout_seconds', 'compiler_concurrency',
  'compiler_lambda_arn', 'domain_name', 'route53_zone_id', 'secret_arn', 'repository_url',
  'repository_ref', 'provision_status', 'terraform_state_key', 'instance_id', 'public_ip',
  'ipv6_address', 'app_url', 'last_error', 'approved_by', 'approved_at', 'created_by', 'created_at', 'updated_at',
];
const JOB_COLUMNS = ['id', 'tenant_id', 'action', 'status', 'requested_by', 'log_output', 'started_at', 'finished_at', 'created_at'];
const AUDIT_COLUMNS = ['id', 'tenant_id', 'actor_id', 'action', 'detail', 'created_at'];

async function legacyRows(table: string): Promise<any[]> {
  try {
    return (await dataDb.query(`SELECT * FROM ${table}`)).rows;
  } catch (error) {
    console.warn(`[ControlDB] Legacy ${table} data is unavailable; continuing with control-plane bootstrap.`);
    return [];
  }
}

async function copyRowsWhenEmpty(table: string, columns: string[], rows: any[], transform?: (row: any) => any) {
  const existing = Number((await query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0]?.count || 0);
  if (existing > 0 || rows.length === 0) return;
  const seenSlugs = new Set<string>();
  const hasExplicitFsaCls = table === 'tenants' && rows.some((row) => mapLegacyTenantSlug(String(row.slug)) === 'fsa-cls' && String(row.slug).toLowerCase() !== 'fsa');
  for (const original of rows) {
    const row = transform ? transform(original) : original;
    if (table === 'tenants') {
      if (hasExplicitFsaCls && String(original.slug).toLowerCase() === 'fsa') continue;
      const slug = String(row.slug);
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
    }
    const values = columns.map((column) => row[column] ?? null);
    await query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders(columns.length)})`,
      values,
    );
  }
}

async function resetPostgresSequences() {
  if (!pgPool) return;
  for (const table of ['admin_users', 'tenants', 'tenant_provision_jobs', 'tenant_audit_events']) {
    await pgPool.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1), COALESCE((SELECT MAX(id) FROM ${table}), 0) > 0)`,
    );
  }
}

async function seedSuperAdmin() {
  const count = Number((await query('SELECT COUNT(*) AS count FROM admin_users')).rows[0]?.count || 0);
  if (count > 0) return;
  const username = process.env.SUPERADMIN_USERNAME || 'supperadmin';
  const password = process.env.SUPERADMIN_PASSWORD || 'superadmin123#2nf';
  const passwordHash = await bcrypt.hash(password, 12);
  await query('INSERT INTO admin_users (username, password_hash, role, tenant_id) VALUES (?, ?, ?, NULL)', [username, passwordHash, 'superadmin']);
  console.log('[ControlDB] Seeded initial superadmin:', username);
}

async function ensureFsaClsTenant(legacyTenantIds: number[]): Promise<number> {
  const config = getCurrentTenantConfig();
  const targetSlug = 'fsa-cls';
  let tenant = await query('SELECT id FROM tenants WHERE slug = ?', [targetSlug]);
  if (!tenant.rows[0]) {
    const owner = await query("SELECT id FROM admin_users WHERE role = 'superadmin' ORDER BY id ASC LIMIT 1");
    const ownerId = Number(owner.rows[0]?.id);
    if (!ownerId) throw new Error('A superadmin is required before FSA-CLS can be initialized.');
    await query(
      `INSERT INTO tenants
       (slug, name, contact_email, status, aws_region, domain_name, provision_status, app_url,
        approved_by, approved_at, created_by)
       VALUES (?, ?, ?, 'approved', ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP, ?)`,
      [targetSlug, config.name, config.contactEmail, config.awsRegion, config.domainName, config.appUrl || null, ownerId, ownerId],
    );
    tenant = await query('SELECT id FROM tenants WHERE slug = ?', [targetSlug]);
  }
  const tenantId = Number(tenant.rows[0]?.id);
  await query(
    `UPDATE tenants
     SET domain_name = CASE
           WHEN domain_name = '' OR LOWER(domain_name) IN ('epoc-fsa-cls.devfasttrack.cloud', 'epoc.devfasttrack.cloud', 'epoc.fsa.devfasttrack.com') THEN ?
           ELSE domain_name
         END,
         app_url = CASE
           WHEN app_url IS NULL OR app_url = '' OR app_url LIKE 'http://localhost%'
             OR LOWER(app_url) IN (
               'https://epoc-fsa-cls.devfasttrack.cloud', 'https://epoc-fsa-cls.devfasttrack.cloud/',
               'https://epoc.devfasttrack.cloud', 'https://epoc.devfasttrack.cloud/',
               'https://epoc.fsa.devfasttrack.com', 'https://epoc.fsa.devfasttrack.com/'
             ) THEN ?
           ELSE app_url
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [config.domainName, config.appUrl, tenantId],
  );
  await query("UPDATE admin_users SET tenant_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE role = 'superadmin' AND tenant_id IS NOT NULL");
  if (legacyTenantIds.length > 0) {
    await query(
      `UPDATE admin_users SET tenant_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE role <> 'superadmin' AND (tenant_id IS NULL OR tenant_id IN (${placeholders(legacyTenantIds.length)}))`,
      [tenantId, ...legacyTenantIds],
    );
  } else {
    await query(
      "UPDATE admin_users SET tenant_id = ?, updated_at = CURRENT_TIMESTAMP WHERE role <> 'superadmin' AND tenant_id IS NULL",
      [tenantId],
    );
  }
  return tenantId;
}

async function migrateLegacyControlPlane() {
  const [legacyAdmins, legacyTenants, legacyJobs, legacyAudits] = await Promise.all([
    legacyRows('admin_users'), legacyRows('tenants'), legacyRows('tenant_provision_jobs'), legacyRows('tenant_audit_events'),
  ]);
  const legacyFsaIds = legacyTenants
    .filter((row) => ['fsa', 'fsa-cls'].includes(String(row.slug).trim().toLowerCase()))
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id));

  await copyRowsWhenEmpty('admin_users', ADMIN_COLUMNS, legacyAdmins);
  await seedSuperAdmin();
  await copyRowsWhenEmpty('tenants', TENANT_COLUMNS, legacyTenants, (row) => ({
    ...row,
    slug: mapLegacyTenantSlug(String(row.slug)),
    name: String(row.slug).trim().toLowerCase() === 'fsa' ? 'FSA CLS' : row.name,
  }));
  await copyRowsWhenEmpty('tenant_provision_jobs', JOB_COLUMNS, legacyJobs);
  await copyRowsWhenEmpty('tenant_audit_events', AUDIT_COLUMNS, legacyAudits);
  await resetPostgresSequences();
  const tenantId = await ensureFsaClsTenant(legacyFsaIds);
  if (legacyFsaIds.length > 0) {
    await query(
      `UPDATE tenant_provision_jobs SET tenant_id = ? WHERE tenant_id IN (${placeholders(legacyFsaIds.length)})`,
      [tenantId, ...legacyFsaIds],
    );
    await query(
      `UPDATE tenant_audit_events SET tenant_id = ? WHERE tenant_id IN (${placeholders(legacyFsaIds.length)})`,
      [tenantId, ...legacyFsaIds],
    );
  }
  console.log('[ControlDB] FSA-CLS tenant ready:', tenantId);
}

export async function initControlPlaneDatabase() {
  connectionConfig = resolveControlPlaneConnection();
  if (connectionConfig.useSqlite) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CONTROL_DATABASE_URL is required in production; the control plane cannot share the tenant database.');
    }
    initSqlite(connectionConfig);
    console.log('[ControlDB] SQLite:', connectionConfig.sqlitePath);
  } else {
    await initPostgres(connectionConfig);
    console.log('[ControlDB] PostgreSQL: separate control plane');
  }
  await migrateLegacyControlPlane();
}

export function getControlPlaneConfig(): ControlPlaneConnectionConfig | null {
  return connectionConfig;
}

export default { initControlPlaneDatabase, query, getControlPlaneConfig };
