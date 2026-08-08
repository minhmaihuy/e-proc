import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';
import logDb from '../db/logPlane.js';
import { getCurrentTenantConfig } from '../tenantContext.js';
import {
  IssueQueryExecutor,
  TenantIssueFilters,
  listTenantIssues,
} from './tenantIssueQuery.js';

const { Pool } = pg;
const SECRET_ARN_PATTERN = /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;

export interface TenantLogTarget {
  slug: string;
  awsRegion: string;
  secretArn: string;
}

interface RemoteLogDatabase {
  query: IssueQueryExecutor;
  close: () => Promise<void>;
}

export interface TenantLogReaderDependencies {
  currentTenantSlug?: () => string;
  localQuery?: IssueQueryExecutor;
  getSecretPayload?: (secretArn: string, awsRegion: string) => Promise<string>;
  openRemoteDatabase?: (connectionString: string) => Promise<RemoteLogDatabase>;
}

export type TenantLogAccessCode = 'NOT_CONFIGURED' | 'UPSTREAM_UNAVAILABLE';

export class TenantLogAccessError extends Error {
  constructor(public readonly code: TenantLogAccessCode) {
    super(code === 'NOT_CONFIGURED'
      ? 'Tenant log database is not configured.'
      : 'Tenant log database is temporarily unavailable.');
    this.name = 'TenantLogAccessError';
  }
}

export function extractLogDatabaseUrl(secretPayload: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretPayload);
  } catch {
    throw new TenantLogAccessError('NOT_CONFIGURED');
  }
  const value = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>).LOG_DATABASE_URL
    : null;
  if (typeof value !== 'string' || value.length > 4_096) {
    throw new TenantLogAccessError('NOT_CONFIGURED');
  }
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length <= 1) {
      throw new Error('invalid');
    }
  } catch {
    throw new TenantLogAccessError('NOT_CONFIGURED');
  }
  return value;
}

async function getSecretPayload(secretArn: string, awsRegion: string): Promise<string> {
  const client = new SecretsManagerClient({ region: awsRegion });
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (response.SecretString) return response.SecretString;
  if (response.SecretBinary) return new TextDecoder().decode(response.SecretBinary);
  throw new TenantLogAccessError('NOT_CONFIGURED');
}

function postgresPlaceholders(text: string): string {
  let index = 1;
  return text.replace(/\?/g, () => `$${index++}`);
}

async function openRemoteDatabase(connectionString: string): Promise<RemoteLogDatabase> {
  const pool = new Pool({
    connectionString,
    max: 1,
    min: 0,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    ssl: { rejectUnauthorized: false },
  });
  return {
    query: async (text, params = []) => {
      const result = await pool.query(postgresPlaceholders(text), params);
      return { rows: result.rows, rowCount: result.rowCount || 0 };
    },
    close: () => pool.end(),
  };
}

export async function readTenantIssues(
  target: TenantLogTarget,
  filters: TenantIssueFilters,
  dependencies: TenantLogReaderDependencies = {},
) {
  const currentTenantSlug = dependencies.currentTenantSlug?.() || getCurrentTenantConfig().slug;
  if (target.slug === currentTenantSlug) {
    const localQuery = dependencies.localQuery || ((text, params = []) => logDb.query(text, params));
    return listTenantIssues(localQuery, target.slug, filters);
  }
  if (!SECRET_ARN_PATTERN.test(target.secretArn) || !/^[a-z]{2}-[a-z]+-[0-9]$/.test(target.awsRegion)) {
    throw new TenantLogAccessError('NOT_CONFIGURED');
  }

  let payload: string;
  try {
    payload = await (dependencies.getSecretPayload || getSecretPayload)(target.secretArn, target.awsRegion);
  } catch (error) {
    if (error instanceof TenantLogAccessError) throw error;
    throw new TenantLogAccessError('UPSTREAM_UNAVAILABLE');
  }
  const connectionString = extractLogDatabaseUrl(payload);

  let remote: RemoteLogDatabase;
  try {
    remote = await (dependencies.openRemoteDatabase || openRemoteDatabase)(connectionString);
  } catch {
    throw new TenantLogAccessError('UPSTREAM_UNAVAILABLE');
  }
  try {
    return await listTenantIssues(remote.query, target.slug, filters);
  } catch {
    throw new TenantLogAccessError('UPSTREAM_UNAVAILABLE');
  } finally {
    await remote.close().catch(() => undefined);
  }
}
