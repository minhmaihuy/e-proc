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

export interface ControlPlaneExecutor {
  query(text: string, params?: any[]): Promise<DbResult>;
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
let sqliteTransactionTail: Promise<void> = Promise.resolve();

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
    // better-sqlite3 chỉ bind number/string/bigint/buffer/null. Cột boolean của
    // control-plane (compiler_enabled...) được code truyền xuống dạng boolean JS, chạy
    // tốt trên Postgres nhưng ném "SQLite3 can only bind..." ở dev local — nghĩa là
    // tạo/sửa tenant không dùng được khi phát triển. Quy đổi tại đây để mọi câu lệnh
    // đều an toàn, thay vì bắt từng call site nhớ ép kiểu.
    params = params.map((value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value));
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

/** Keep a usage event and its aggregate on one physical control-plane connection. */
export async function withTransaction<T>(work: (tx: ControlPlaneExecutor) => Promise<T>): Promise<T> {
  if (sqliteDb) {
    const previous = sqliteTransactionTail;
    let release!: () => void;
    sqliteTransactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    let began = false;
    try {
      sqliteDb.exec('BEGIN IMMEDIATE');
      began = true;
      const result = await work({ query });
      sqliteDb.exec('COMMIT');
      return result;
    } catch (error) {
      if (began) sqliteDb.exec('ROLLBACK');
      throw error;
    } finally {
      release();
    }
  }
  if (!pgPool) throw new Error('Control-plane database is not initialized.');
  const client = await pgPool.connect();
  const tx: ControlPlaneExecutor = {
    query: async (text: string, params: any[] = []) => {
      let index = 1;
      const pgText = params.length ? text.replace(/\?/g, () => `$${index++}`) : text;
      const result = await client.query(pgText, params);
      return { rows: result.rows, rowCount: result.rowCount || 0 };
    },
  };
  try {
    await client.query('BEGIN');
    const result = await work(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
        backup_retention_days INTEGER NOT NULL DEFAULT 14,
        last_backup_at TIMESTAMP,
        last_backup_size_bytes BIGINT,
        last_restore_test_at TIMESTAMP,
        last_restore_test_status VARCHAR(16),
        email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        email_from_name VARCHAR(160),
        email_daily_limit INTEGER NOT NULL DEFAULT 200,
        quota_exams_per_month INTEGER,
        quota_ai_gradings_per_month INTEGER,
        quota_recording_gb NUMERIC,
        quota_emails_per_month INTEGER,
        identity_verification VARCHAR(16) NOT NULL DEFAULT 'off',
        identity_retention_days INTEGER,
        compiler_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        -- Danh sách chế độ ghi màn hình tenant được PHÉP dùng (batch chọn trong đó).
        -- Tenant mới mặc định chỉ 'none': bật ghi màn hình là quyết định có chủ đích
        -- của superadmin, không phải mặc định im lặng.
        allowed_record_modes TEXT NOT NULL DEFAULT 'none',
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
      CREATE TABLE IF NOT EXISTS tenant_usage (
        tenant_id INTEGER NOT NULL,
        period_month VARCHAR(7) NOT NULL,
        exams_started INTEGER NOT NULL DEFAULT 0,
        ai_gradings INTEGER NOT NULL DEFAULT 0,
        recording_minutes NUMERIC NOT NULL DEFAULT 0,
        emails_sent INTEGER NOT NULL DEFAULT 0,
        code_runs INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tenant_id, period_month)
      );
      CREATE TABLE IF NOT EXISTS tenant_usage_events (
        event_key VARCHAR(180) PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        period_month VARCHAR(7) NOT NULL,
        metric VARCHAR(32) NOT NULL,
        amount NUMERIC NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS tenant_id INTEGER`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS compiler_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    // Tenant ĐANG CHẠY trước khi có allowlist vẫn được dùng đủ ba chế độ: siết lại
    // ngay lúc migrate sẽ vô hiệu hóa cấu hình ghi màn hình của các batch đang có.
    // Tenant tạo MỚI thì theo DEFAULT 'none' của cột.
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allowed_record_modes TEXT NOT NULL DEFAULT 'none,local,s3'`);
    await client.query(`ALTER TABLE tenants ALTER COLUMN allowed_record_modes SET DEFAULT 'none'`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS backup_retention_days INTEGER NOT NULL DEFAULT 14`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_backup_at TIMESTAMP`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_backup_size_bytes BIGINT`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_restore_test_at TIMESTAMP`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_restore_test_status VARCHAR(16)`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_from_name VARCHAR(160)`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_daily_limit INTEGER NOT NULL DEFAULT 200`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quota_exams_per_month INTEGER`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quota_ai_gradings_per_month INTEGER`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quota_recording_gb NUMERIC`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quota_emails_per_month INTEGER`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS identity_verification VARCHAR(16) NOT NULL DEFAULT 'off'`);
    await client.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS identity_retention_days INTEGER`);
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
      backup_retention_days INTEGER NOT NULL DEFAULT 14,
      last_backup_at DATETIME,
      last_backup_size_bytes INTEGER,
      last_restore_test_at DATETIME,
      last_restore_test_status TEXT,
      email_enabled INTEGER NOT NULL DEFAULT 0,
      email_from_name TEXT,
      email_daily_limit INTEGER NOT NULL DEFAULT 200,
      quota_exams_per_month INTEGER,
      quota_ai_gradings_per_month INTEGER,
      quota_recording_gb REAL,
      quota_emails_per_month INTEGER,
      identity_verification TEXT NOT NULL DEFAULT 'off',
      identity_retention_days INTEGER,
      compiler_enabled INTEGER NOT NULL DEFAULT 0,
      allowed_record_modes TEXT NOT NULL DEFAULT 'none',
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
    CREATE TABLE IF NOT EXISTS tenant_usage (
      tenant_id INTEGER NOT NULL,
      period_month TEXT NOT NULL,
      exams_started INTEGER NOT NULL DEFAULT 0,
      ai_gradings INTEGER NOT NULL DEFAULT 0,
      recording_minutes REAL NOT NULL DEFAULT 0,
      emails_sent INTEGER NOT NULL DEFAULT 0,
      code_runs INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, period_month)
    );
    CREATE TABLE IF NOT EXISTS tenant_usage_events (
      event_key TEXT PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      period_month TEXT NOT NULL,
      metric TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // SQLite không có ADD COLUMN IF NOT EXISTS → phải tự kiểm tra. Backfill 'none,local,s3'
  // cho tenant có sẵn để không tắt mất cấu hình ghi màn hình đang chạy; tenant tạo mới
  // theo DEFAULT 'none' của cột.
  const tenantColumns = (sqliteDb.prepare('PRAGMA table_info(tenants)').all() as { name: string }[])
    .map((column) => column.name);
  if (!tenantColumns.includes('allowed_record_modes')) {
    sqliteDb.exec("ALTER TABLE tenants ADD COLUMN allowed_record_modes TEXT NOT NULL DEFAULT 'none'");
    sqliteDb.exec("UPDATE tenants SET allowed_record_modes = 'none,local,s3'");
  }
  for (const [name, definition] of [
    ['backup_retention_days', 'INTEGER NOT NULL DEFAULT 14'],
    ['last_backup_at', 'DATETIME'],
    ['last_backup_size_bytes', 'INTEGER'],
    ['last_restore_test_at', 'DATETIME'],
    ['last_restore_test_status', 'TEXT'],
    ['email_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['email_from_name', 'TEXT'],
    ['email_daily_limit', 'INTEGER NOT NULL DEFAULT 200'],
    ['quota_exams_per_month', 'INTEGER'],
    ['quota_ai_gradings_per_month', 'INTEGER'],
    ['quota_recording_gb', 'REAL'],
    ['quota_emails_per_month', 'INTEGER'],
    ['identity_verification', "TEXT NOT NULL DEFAULT 'off'"],
    ['identity_retention_days', 'INTEGER'],
  ] as const) {
    if (!tenantColumns.includes(name)) sqliteDb.exec(`ALTER TABLE tenants ADD COLUMN ${name} ${definition}`);
  }
}

const ADMIN_COLUMNS = ['id', 'username', 'password_hash', 'role', 'tenant_id', 'created_at', 'updated_at'];
const TENANT_COLUMNS = [
  'id', 'slug', 'name', 'contact_email', 'status', 'aws_region', 'instance_type', 'root_volume_size',
  'backup_retention_days', 'last_backup_at', 'last_backup_size_bytes', 'last_restore_test_at', 'last_restore_test_status',
  'email_enabled', 'email_from_name', 'email_daily_limit', 'quota_exams_per_month',
  'quota_ai_gradings_per_month', 'quota_recording_gb', 'quota_emails_per_month',
  'identity_verification', 'identity_retention_days', 'allowed_record_modes', 'compiler_enabled', 'compiler_memory_mb', 'compiler_timeout_seconds', 'compiler_concurrency',
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

export interface TenantAdminSeedEnvironment {
  FSA_TENANT_ADMIN_USERNAME?: string;
  FSA_TENANT_ADMIN_PASSWORD?: string;
}

export type TenantAdminSeedReason =
  | 'seed'
  | 'tenant_admin_exists'
  | 'username_taken';

export interface TenantAdminSeedDecision {
  shouldSeed: boolean;
  username: string;
  password: string;
  reason: TenantAdminSeedReason;
}

export const DEFAULT_FSA_TENANT_ADMIN_USERNAME = 'adminfsa';
export const DEFAULT_FSA_TENANT_ADMIN_PASSWORD = 'adminfsa123#2nf';

/**
 * Quyết định có seed tài khoản tenant_admin cho FSA-CLS hay không.
 *
 * Vì sao cần: seedSuperAdmin() chỉ tạo superadmin, mà superadmin CỐ TÌNH không đọc/ghi
 * được dữ liệu khảo thí của tenant (xem requireSuperAdmin / requireTenantDataAdmin).
 * Cài mới xong là không có đường nào vào /admin/* — không có ngân hàng câu hỏi, không
 * có batch, không có kết quả. Superadmin cũng không phải người quản lý user của tenant
 * nên tự nó không tạo được tài khoản này.
 *
 * Hai điều kiện dừng, cả hai đều nhằm KHÔNG giẫm lên dữ liệu thật:
 *   - đã có bất kỳ tenant_admin nào của tenant này → hệ thống đang được dùng, đứng yên;
 *   - tên đăng nhập đã bị chiếm (kể cả bởi tenant khác hay bởi superadmin) → dừng,
 *     vì username là duy nhất toàn cục, chèn vào sẽ vi phạm ràng buộc.
 */
export function resolveTenantAdminSeed(
  env: TenantAdminSeedEnvironment,
  existingTenantAdminCount: number,
  usernameTaken: boolean,
): TenantAdminSeedDecision {
  const username = env.FSA_TENANT_ADMIN_USERNAME?.trim() || DEFAULT_FSA_TENANT_ADMIN_USERNAME;
  const password = env.FSA_TENANT_ADMIN_PASSWORD?.trim() || DEFAULT_FSA_TENANT_ADMIN_PASSWORD;

  if (existingTenantAdminCount > 0) {
    return { shouldSeed: false, username, password, reason: 'tenant_admin_exists' };
  }
  if (usernameTaken) {
    return { shouldSeed: false, username, password, reason: 'username_taken' };
  }
  return { shouldSeed: true, username, password, reason: 'seed' };
}

async function seedFsaTenantAdmin(tenantId: number) {
  const existing = Number(
    (await query(
      "SELECT COUNT(*) AS count FROM admin_users WHERE role = 'tenant_admin' AND tenant_id = ?",
      [tenantId],
    )).rows[0]?.count || 0,
  );
  const username = process.env.FSA_TENANT_ADMIN_USERNAME?.trim() || DEFAULT_FSA_TENANT_ADMIN_USERNAME;
  const taken = Number(
    (await query('SELECT COUNT(*) AS count FROM admin_users WHERE LOWER(username) = LOWER(?)', [username]))
      .rows[0]?.count || 0,
  ) > 0;

  const decision = resolveTenantAdminSeed(process.env, existing, taken);
  if (!decision.shouldSeed) {
    if (decision.reason === 'username_taken') {
      console.warn(
        `[ControlDB] Bỏ qua seed tenant admin: tên đăng nhập '${decision.username}' đã tồn tại.`,
      );
    }
    return;
  }

  const passwordHash = await bcrypt.hash(decision.password, 12);
  await query(
    'INSERT INTO admin_users (username, password_hash, role, tenant_id) VALUES (?, ?, ?, ?)',
    [decision.username, passwordHash, 'tenant_admin', tenantId],
  );
  console.log('[ControlDB] Seeded FSA-CLS tenant admin:', decision.username);
}

export interface FsaClsLifecycleRow {
  status: string;
  provisionStatus: string;
  approvedBy: number | null;
  approvedAt: string | null;
}

export interface FsaClsLifecycleResult {
  status: string;
  provisionStatus: string;
  approvedBy: number | null;
  stampApprovedAt: boolean;
}

/**
 * FSA-CLS là tenant đang chạy thật của chính máy chủ này, không phải một đơn đăng ký
 * chờ duyệt — nên nó phải ở trạng thái `approved`.
 *
 * Hàng tạo mới đã được INSERT là 'approved', nhưng hàng có sẵn (chép sang từ
 * control-plane cũ) mang 'pending' mặc định của schema và trước đây KHÔNG có đường nào
 * sửa: khối UPDATE phía sau chỉ đụng tới domain_name/app_url. Vì vậy fsa-cls kẹt
 * 'pending' vĩnh viễn dù đang phục vụ người dùng, và bị chặn ở bước Terraform
 * plan/apply vốn yêu cầu approved.
 *
 * Chỉ nâng từ 'pending'. 'suspended' là quyết định có chủ đích của superadmin và phải
 * được giữ nguyên — tự động bỏ đình chỉ sẽ là hành vi nguy hiểm.
 */
export function resolveFsaClsLifecycle(
  row: FsaClsLifecycleRow,
  superadminId: number | null,
): FsaClsLifecycleResult {
  const promoting = row.status === 'pending';
  return {
    status: promoting ? 'approved' : row.status,
    provisionStatus: row.provisionStatus === 'not_started' ? 'active' : row.provisionStatus,
    approvedBy: promoting ? row.approvedBy ?? superadminId : row.approvedBy,
    stampApprovedAt: promoting && !row.approvedAt,
  };
}

async function ensureFsaClsTenant(legacyTenantIds: number[]): Promise<number> {
  const config = getCurrentTenantConfig();
  const targetSlug = 'fsa-cls';
  let tenant = await query('SELECT id FROM tenants WHERE slug = ?', [targetSlug]);
  const owner = await query("SELECT id FROM admin_users WHERE role = 'superadmin' ORDER BY id ASC LIMIT 1");
  const ownerId = Number(owner.rows[0]?.id);
  if (!tenant.rows[0]) {
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

  const current = await query(
    'SELECT status, provision_status, approved_by, approved_at FROM tenants WHERE id = ?',
    [tenantId],
  );
  const lifecycle = resolveFsaClsLifecycle(
    {
      status: String(current.rows[0]?.status ?? ''),
      provisionStatus: String(current.rows[0]?.provision_status ?? ''),
      approvedBy: current.rows[0]?.approved_by ?? null,
      approvedAt: current.rows[0]?.approved_at ?? null,
    },
    ownerId || null,
  );

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
         status = ?,
         approved_by = ?,
         approved_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE approved_at END,
         provision_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      config.domainName,
      config.appUrl,
      lifecycle.status,
      lifecycle.approvedBy,
      lifecycle.stampApprovedAt ? 1 : 0,
      lifecycle.provisionStatus,
      tenantId,
    ],
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

export function normalizeLegacyTenantForControlPlane(row: any) {
  return {
    ...row,
    slug: mapLegacyTenantSlug(String(row.slug)),
    name: String(row.slug).trim().toLowerCase() === 'fsa' ? 'FSA CLS' : row.name,
    backup_retention_days: Number(row.backup_retention_days) > 0 ? Number(row.backup_retention_days) : 14,
    identity_verification: row.identity_verification === 'photo' || row.identity_verification === 'face_match'
      ? row.identity_verification
      : 'off',
    identity_retention_days: Number(row.identity_retention_days) > 0 ? Number(row.identity_retention_days) : null,
  };
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
  await copyRowsWhenEmpty('tenants', TENANT_COLUMNS, legacyTenants, normalizeLegacyTenantForControlPlane);
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
  // Sau ensureFsaClsTenant, vì tài khoản cần tenant_id thật để gắn vào.
  await seedFsaTenantAdmin(tenantId);
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

export async function closeControlPlaneDatabase(): Promise<void> {
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

export function getControlPlaneConfig(): ControlPlaneConnectionConfig | null {
  return connectionConfig;
}

export default { initControlPlaneDatabase, closeControlPlaneDatabase, query, withTransaction, getControlPlaneConfig };
