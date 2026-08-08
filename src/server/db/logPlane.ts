import pg from 'pg';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getCurrentTenantConfig } from '../tenantContext.js';

interface DbResult {
  rows: any[];
  rowCount: number;
  lastInsertRowid?: number | bigint;
}

export interface LogPlaneConnectionConfig {
  useSqlite: boolean;
  connectionString: string;
  sqlitePath: string;
}

export type IssueSeverity = 'warning' | 'error' | 'critical';
export type IssueActorType = 'admin' | 'student' | 'anonymous' | 'system';

export interface TenantIssueInput {
  tenantSlug: string;
  severity: IssueSeverity;
  source: string;
  code: string;
  message: string;
  httpStatus?: number | null;
  httpMethod?: string | null;
  requestPath?: string | null;
  requestId?: string | null;
  actorType?: IssueActorType;
  actorId?: number | null;
  metadata?: Record<string, unknown> | null;
}

const { Pool } = pg;
let pgPool: pg.Pool | null = null;
let sqliteDb: Database.Database | null = null;
let connectionConfig: LogPlaneConnectionConfig | null = null;

export function resolveLogPlaneConnection(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): LogPlaneConnectionConfig {
  const connectionString = env.LOG_DATABASE_URL?.trim() || '';
  return {
    useSqlite: !connectionString,
    connectionString,
    sqlitePath: path.resolve(env.LOG_SQLITE_PATH?.trim() || path.join(cwd, 'data', 'tenant-logs.db')),
  };
}

export function assertLogPlaneTenantBinding(existingSlug: unknown, requestedSlug: string): void {
  const existing = String(existingSlug || '').trim().toLowerCase();
  const requested = String(requestedSlug || '').trim().toLowerCase();
  if (existing && existing !== requested) {
    throw new Error(`Issue log database belongs to tenant "${existing}" and cannot be rebound to "${requested}".`);
  }
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
  throw new Error('Tenant issue log database is not initialized.');
}

async function initPostgres(config: LogPlaneConnectionConfig) {
  pgPool = new Pool({
    connectionString: config.connectionString,
    max: Math.max(1, parseInt(process.env.LOG_DB_POOL_MAX || '5', 10)),
    min: 0,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS log_plane_metadata (
        metadata_key VARCHAR(64) PRIMARY KEY,
        metadata_value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tenant_issue_logs (
        id BIGSERIAL PRIMARY KEY,
        tenant_slug VARCHAR(31) NOT NULL,
        severity VARCHAR(16) NOT NULL,
        source VARCHAR(64) NOT NULL,
        code VARCHAR(64) NOT NULL,
        message TEXT NOT NULL,
        http_status INTEGER,
        http_method VARCHAR(12),
        request_path VARCHAR(500),
        request_id VARCHAR(64),
        actor_type VARCHAR(16) NOT NULL DEFAULT 'system',
        actor_id BIGINT,
        metadata_json TEXT,
        status VARCHAR(16) NOT NULL DEFAULT 'open',
        resolved_by BIGINT,
        resolved_at TIMESTAMP,
        archived_by BIGINT,
        archived_at TIMESTAMP,
        last_managed_by BIGINT,
        last_managed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE tenant_issue_logs ADD COLUMN IF NOT EXISTS archived_by BIGINT;
      ALTER TABLE tenant_issue_logs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
      ALTER TABLE tenant_issue_logs ADD COLUMN IF NOT EXISTS last_managed_by BIGINT;
      ALTER TABLE tenant_issue_logs ADD COLUMN IF NOT EXISTS last_managed_at TIMESTAMP;
      CREATE INDEX IF NOT EXISTS idx_tenant_issue_scope
        ON tenant_issue_logs(tenant_slug, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tenant_issue_severity
        ON tenant_issue_logs(tenant_slug, severity, created_at DESC);
    `);
  } finally {
    client.release();
  }
}

function initSqlite(config: LogPlaneConnectionConfig) {
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  sqliteDb = new Database(config.sqlitePath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS log_plane_metadata (
      metadata_key TEXT PRIMARY KEY,
      metadata_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tenant_issue_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_slug TEXT NOT NULL,
      severity TEXT NOT NULL,
      source TEXT NOT NULL,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      http_status INTEGER,
      http_method TEXT,
      request_path TEXT,
      request_id TEXT,
      actor_type TEXT NOT NULL DEFAULT 'system',
      actor_id INTEGER,
      metadata_json TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_by INTEGER,
      resolved_at DATETIME,
      archived_by INTEGER,
      archived_at DATETIME,
      last_managed_by INTEGER,
      last_managed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_issue_scope
      ON tenant_issue_logs(tenant_slug, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tenant_issue_severity
      ON tenant_issue_logs(tenant_slug, severity, created_at DESC);
  `);
  const issueColumns = sqliteDb.prepare('PRAGMA table_info(tenant_issue_logs)').all() as { name: string }[];
  const issueColumnNames = new Set(issueColumns.map((column) => column.name));
  for (const [name, type] of [
    ['archived_by', 'INTEGER'],
    ['archived_at', 'DATETIME'],
    ['last_managed_by', 'INTEGER'],
    ['last_managed_at', 'DATETIME'],
  ]) {
    if (!issueColumnNames.has(name)) sqliteDb.exec(`ALTER TABLE tenant_issue_logs ADD COLUMN ${name} ${type}`);
  }
}

async function bindLogPlaneTenant() {
  const tenant = getCurrentTenantConfig();
  const existing = await query(
    "SELECT metadata_value FROM log_plane_metadata WHERE metadata_key = 'tenant_slug'",
  );
  assertLogPlaneTenantBinding(existing.rows[0]?.metadata_value, tenant.slug);
  if (!existing.rows[0]) {
    const issueTenants = await query('SELECT DISTINCT tenant_slug FROM tenant_issue_logs LIMIT 2');
    for (const row of issueTenants.rows) {
      assertLogPlaneTenantBinding(row.tenant_slug, tenant.slug);
    }
    await query(
      "INSERT INTO log_plane_metadata (metadata_key, metadata_value) VALUES ('tenant_slug', ?)",
      [tenant.slug],
    );
  }
}

function bounded(value: unknown, maxLength: number, fallback = ''): string {
  const normalized = String(value ?? fallback).replace(/[\r\n\0]/g, ' ').trim();
  return normalized.slice(0, maxLength);
}

function safeMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null;
  const allowed: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      allowed[key] = typeof value === 'string' ? bounded(value, 500) : value as number | boolean | null;
    }
  }
  return JSON.stringify(allowed).slice(0, 4_000);
}

export async function recordTenantIssue(input: TenantIssueInput): Promise<void> {
  const tenant = getCurrentTenantConfig();
  if (input.tenantSlug !== tenant.slug) {
    throw new Error('Issue tenant does not match the current log-plane tenant.');
  }
  const severity: IssueSeverity = ['warning', 'error', 'critical'].includes(input.severity)
    ? input.severity
    : 'error';
  await query(
    `INSERT INTO tenant_issue_logs
     (tenant_slug, severity, source, code, message, http_status, http_method,
      request_path, request_id, actor_type, actor_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tenant.slug,
      severity,
      bounded(input.source, 64, 'application'),
      bounded(input.code, 64, 'UNCLASSIFIED'),
      bounded(input.message, 1_000, 'Tenant request failed'),
      Number.isInteger(input.httpStatus) ? input.httpStatus : null,
      input.httpMethod ? bounded(input.httpMethod, 12).toUpperCase() : null,
      input.requestPath ? bounded(input.requestPath, 500) : null,
      input.requestId ? bounded(input.requestId, 64) : null,
      input.actorType || 'system',
      Number.isInteger(input.actorId) ? input.actorId : null,
      safeMetadata(input.metadata),
    ],
  );
}

export async function initLogPlaneDatabase() {
  connectionConfig = resolveLogPlaneConnection();
  if (connectionConfig.useSqlite) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('LOG_DATABASE_URL is required in production; tenant issues require an isolated log database.');
    }
    initSqlite(connectionConfig);
    console.log('[LogDB] SQLite tenant issue plane:', connectionConfig.sqlitePath);
  } else {
    await initPostgres(connectionConfig);
    console.log('[LogDB] PostgreSQL tenant issue plane configured');
  }
  await bindLogPlaneTenant();
}

export async function closeLogPlaneDatabase(): Promise<void> {
  if (pgPool) {
    const pool = pgPool;
    pgPool = null;
    await pool.end();
  }
  if (sqliteDb) {
    const database = sqliteDb;
    sqliteDb = null;
    if (database.open) database.close();
  }
  connectionConfig = null;
}

export function getLogPlaneConfig(): LogPlaneConnectionConfig | null {
  return connectionConfig;
}

export default { initLogPlaneDatabase, closeLogPlaneDatabase, query, recordTenantIssue, getLogPlaneConfig };
