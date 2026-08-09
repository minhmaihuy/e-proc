import { Client } from 'pg';

const DATABASE_ENV_NAMES = [
  'DATABASE_URL',
  'CONTROL_DATABASE_URL',
  'LOG_DATABASE_URL',
] as const;
const SYSTEM_DATABASES = new Set(['postgres', 'template0', 'template1']);
const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/;

export type DatabaseEnvironmentName = typeof DATABASE_ENV_NAMES[number];

export interface DatabaseBootstrapEnvironment {
  DATABASE_URL?: string;
  CONTROL_DATABASE_URL?: string;
  LOG_DATABASE_URL?: string;
  DATABASE_MAINTENANCE_DB?: string;
}

export interface DatabaseBootstrapTarget {
  envName: DatabaseEnvironmentName;
  databaseName: string;
  serverLabel: string;
  maintenanceConnectionString: string;
}

export interface DatabaseBootstrapResult {
  envName: DatabaseEnvironmentName;
  databaseName: string;
  created: boolean;
}

interface QueryResultLike {
  rows: unknown[];
}

export interface DatabaseMaintenanceClient {
  connect(): Promise<unknown>;
  query(text: string, values?: unknown[]): Promise<QueryResultLike>;
  end(): Promise<void>;
}

export type DatabaseMaintenanceClientFactory = (
  connectionString: string,
) => DatabaseMaintenanceClient;

export class DatabaseBootstrapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly envName?: DatabaseEnvironmentName,
    public readonly databaseCode?: string,
  ) {
    super(message);
    this.name = 'DatabaseBootstrapError';
  }
}

function validateDatabaseName(name: string, source: string): string {
  if (!DATABASE_NAME_PATTERN.test(name)) {
    throw new DatabaseBootstrapError(
      'INVALID_DATABASE_NAME',
      `${source} must name a PostgreSQL database using 1-63 letters, numbers, underscores, or hyphens.`,
    );
  }
  if (SYSTEM_DATABASES.has(name.toLowerCase())) {
    throw new DatabaseBootstrapError(
      'SYSTEM_DATABASE_TARGET',
      `${source} cannot use a PostgreSQL maintenance or template database as an application plane.`,
    );
  }
  return name;
}

function parseTarget(
  envName: DatabaseEnvironmentName,
  rawConnectionString: string,
  maintenanceDatabase: string,
): DatabaseBootstrapTarget & { identity: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawConnectionString);
  } catch {
    throw new DatabaseBootstrapError(
      'INVALID_DATABASE_URL',
      `${envName} must be a valid PostgreSQL URL.`,
      envName,
    );
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new DatabaseBootstrapError(
      'UNSUPPORTED_DATABASE_PROTOCOL',
      `${envName} must use the postgres or postgresql protocol.`,
      envName,
    );
  }
  if (!parsed.hostname) {
    throw new DatabaseBootstrapError(
      'INVALID_DATABASE_URL',
      `${envName} must include a PostgreSQL host.`,
      envName,
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new DatabaseBootstrapError(
      'INVALID_DATABASE_NAME',
      `${envName} contains an invalid encoded database name.`,
      envName,
    );
  }
  validateDatabaseName(databaseName, envName);

  const port = parsed.port || '5432';
  const serverLabel = `${parsed.hostname.toLowerCase()}:${port}`;
  const maintenanceUrl = new URL(parsed.toString());
  maintenanceUrl.pathname = `/${maintenanceDatabase}`;

  return {
    envName,
    databaseName,
    serverLabel,
    maintenanceConnectionString: maintenanceUrl.toString(),
    identity: `${serverLabel}/${databaseName.toLowerCase()}`,
  };
}

export function buildDatabaseBootstrapPlan(
  env: DatabaseBootstrapEnvironment,
): DatabaseBootstrapTarget[] {
  const maintenanceDatabase = env.DATABASE_MAINTENANCE_DB?.trim() || 'postgres';
  if (!DATABASE_NAME_PATTERN.test(maintenanceDatabase)) {
    throw new DatabaseBootstrapError(
      'INVALID_MAINTENANCE_DATABASE',
      'DATABASE_MAINTENANCE_DB must use a valid PostgreSQL database name.',
    );
  }

  const parsedTargets = DATABASE_ENV_NAMES.map((envName) => {
    const connectionString = env[envName]?.trim();
    if (!connectionString) {
      throw new DatabaseBootstrapError(
        'MISSING_DATABASE_URL',
        `${envName} is required before database bootstrap.`,
        envName,
      );
    }
    return parseTarget(envName, connectionString, maintenanceDatabase);
  });

  const identities = new Map<string, DatabaseEnvironmentName>();
  for (const target of parsedTargets) {
    const existing = identities.get(target.identity);
    if (existing) {
      throw new DatabaseBootstrapError(
        'DATABASE_PLANES_NOT_ISOLATED',
        `${target.envName} and ${existing} must reference different PostgreSQL databases.`,
        target.envName,
      );
    }
    identities.set(target.identity, target.envName);
  }

  return parsedTargets.map(({ identity: _identity, ...target }) => target);
}

export function quotePostgresIdentifier(identifier: string): string {
  if (!DATABASE_NAME_PATTERN.test(identifier)) {
    throw new DatabaseBootstrapError(
      'INVALID_DATABASE_NAME',
      'Unsafe PostgreSQL identifier rejected.',
    );
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : undefined;
}

function defaultClientFactory(connectionString: string): DatabaseMaintenanceClient {
  // Phải bật SSL giống hệt các pool của ứng dụng (db/postgres.ts, db/controlPlane.ts,
  // db/logPlane.ts, services/tenantLogReader.ts). RDS bật rds.force_ssl sẽ từ chối kết
  // nối không mã hóa với SQLSTATE 28000 — app chạy bình thường nhưng riêng script này
  // chết, vì nó là chỗ duy nhất tạo kết nối mà không khai báo ssl.
  return new Client({ connectionString, ssl: { rejectUnauthorized: false } });
}

export async function ensurePostgresDatabases(
  env: DatabaseBootstrapEnvironment,
  createClient: DatabaseMaintenanceClientFactory = defaultClientFactory,
): Promise<DatabaseBootstrapResult[]> {
  const targets = buildDatabaseBootstrapPlan(env);
  const results: DatabaseBootstrapResult[] = [];

  for (const target of targets) {
    const client = createClient(target.maintenanceConnectionString);
    let operationError: unknown;
    try {
      await client.connect();
      const existing = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [target.databaseName],
      );
      let created = false;
      if (existing.rows.length === 0) {
        try {
          await client.query(`CREATE DATABASE ${quotePostgresIdentifier(target.databaseName)}`);
          created = true;
        } catch (error) {
          if (databaseErrorCode(error) !== '42P04') {
            throw error;
          }
        }
      }
      results.push({
        envName: target.envName,
        databaseName: target.databaseName,
        created,
      });
    } catch (error) {
      operationError = error;
      throw new DatabaseBootstrapError(
        'DATABASE_BOOTSTRAP_FAILED',
        `Unable to ensure ${target.envName} database '${target.databaseName}'. Check connectivity and CREATEDB privilege.`,
        target.envName,
        databaseErrorCode(error),
      );
    } finally {
      try {
        await client.end();
      } catch (error) {
        if (!operationError) {
          throw new DatabaseBootstrapError(
            'DATABASE_CLOSE_FAILED',
            `Unable to close the maintenance connection for ${target.envName}.`,
            target.envName,
            databaseErrorCode(error),
          );
        }
      }
    }
  }

  return results;
}
