export type TenantIssueStatus = 'open' | 'resolved' | 'archived';
export type TenantIssueSeverity = 'warning' | 'error' | 'critical';

export interface TenantIssueFilters {
  status?: TenantIssueStatus;
  severity?: TenantIssueSeverity;
  limit: number;
}

export interface IssueQueryResult {
  rows: any[];
  rowCount?: number;
}

export type IssueQueryExecutor = (
  text: string,
  params?: Array<string | number>,
) => Promise<IssueQueryResult>;

export class TenantIssueFilterError extends Error {}

const ISSUE_STATUSES = new Set<TenantIssueStatus>(['open', 'resolved', 'archived']);
const ISSUE_SEVERITIES = new Set<TenantIssueSeverity>(['warning', 'error', 'critical']);
const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]{2,30}$/;

export function parseTenantIssueFilters(query: Record<string, unknown>): TenantIssueFilters {
  if (query.status !== undefined && typeof query.status !== 'string') {
    throw new TenantIssueFilterError('Invalid issue status.');
  }
  if (query.severity !== undefined && typeof query.severity !== 'string') {
    throw new TenantIssueFilterError('Invalid issue severity.');
  }
  if (query.limit !== undefined && typeof query.limit !== 'string' && typeof query.limit !== 'number') {
    throw new TenantIssueFilterError('Issue limit must be an integer between 1 and 200.');
  }
  const status = typeof query.status === 'string' ? query.status : '';
  const severity = typeof query.severity === 'string' ? query.severity : '';
  const requestedLimit = Number(query.limit ?? 100);
  if (status && !ISSUE_STATUSES.has(status as TenantIssueStatus)) {
    throw new TenantIssueFilterError('Invalid issue status.');
  }
  if (severity && !ISSUE_SEVERITIES.has(severity as TenantIssueSeverity)) {
    throw new TenantIssueFilterError('Invalid issue severity.');
  }
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
    throw new TenantIssueFilterError('Issue limit must be an integer between 1 and 200.');
  }
  return {
    status: status ? status as TenantIssueStatus : undefined,
    severity: severity ? severity as TenantIssueSeverity : undefined,
    limit: requestedLimit,
  };
}

export function parseTenantIssueStatus(value: unknown): TenantIssueStatus {
  if (typeof value !== 'string' || !ISSUE_STATUSES.has(value as TenantIssueStatus)) {
    throw new TenantIssueFilterError('Invalid issue status.');
  }
  return value as TenantIssueStatus;
}

export function buildTenantIssueStatusUpdate(
  status: TenantIssueStatus,
  actorId: number,
  issueId: number,
  tenantSlug: string,
): { text: string; params: Array<string | number> } {
  if (!Number.isInteger(actorId) || actorId <= 0 || !Number.isInteger(issueId) || issueId <= 0) {
    throw new TenantIssueFilterError('Invalid tenant issue lifecycle identity.');
  }
  if (!TENANT_SLUG_PATTERN.test(tenantSlug)) throw new TenantIssueFilterError('Invalid trusted tenant slug.');
  if (status === 'resolved') {
    return {
      text: `UPDATE tenant_issue_logs
             SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP,
                 archived_by = NULL, archived_at = NULL,
                 last_managed_by = ?, last_managed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND tenant_slug = ?`,
      params: [actorId, actorId, issueId, tenantSlug],
    };
  }
  if (status === 'archived') {
    return {
      text: `UPDATE tenant_issue_logs
             SET status = 'archived', archived_by = ?, archived_at = CURRENT_TIMESTAMP,
                 last_managed_by = ?, last_managed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND tenant_slug = ?`,
      params: [actorId, actorId, issueId, tenantSlug],
    };
  }
  return {
    text: `UPDATE tenant_issue_logs
           SET status = 'open', resolved_by = NULL, resolved_at = NULL,
               archived_by = NULL, archived_at = NULL,
               last_managed_by = ?, last_managed_at = CURRENT_TIMESTAMP
           WHERE id = ? AND tenant_slug = ?`,
    params: [actorId, issueId, tenantSlug],
  };
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'string' || value.length > 4_000) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const safe: Record<string, string | number | boolean | null> = {};
    for (const [key, item] of Object.entries(parsed).slice(0, 20)) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) continue;
      if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
        safe[key] = typeof item === 'string' ? item.slice(0, 500) : item as number | boolean | null;
      }
    }
    return safe;
  } catch {
    return null;
  }
}

function bounded(value: unknown, limit: number): string {
  return String(value ?? '').replace(/[\r\n\0]/g, ' ').trim().slice(0, limit);
}

export function publicTenantIssue(row: any) {
  return {
    id: Number(row.id),
    tenant_slug: String(row.tenant_slug),
    severity: ['warning', 'error', 'critical'].includes(String(row.severity)) ? String(row.severity) : 'error',
    source: bounded(row.source, 64),
    code: bounded(row.code, 64),
    message: bounded(row.message, 1_000),
    http_status: row.http_status === null ? null : Number(row.http_status),
    http_method: row.http_method ? bounded(row.http_method, 12) : null,
    request_path: row.request_path ? bounded(row.request_path, 500) : null,
    request_id: row.request_id ? bounded(row.request_id, 64) : null,
    actor_type: ['admin', 'student', 'anonymous', 'system'].includes(String(row.actor_type))
      ? String(row.actor_type)
      : 'system',
    actor_id: row.actor_id === null ? null : Number(row.actor_id),
    metadata: parseMetadata(row.metadata_json),
    status: ['open', 'resolved', 'archived'].includes(String(row.status)) ? String(row.status) : 'open',
    resolved_by: row.resolved_by === null ? null : Number(row.resolved_by),
    resolved_at: row.resolved_at || null,
    archived_by: row.archived_by === null ? null : Number(row.archived_by),
    archived_at: row.archived_at || null,
    last_managed_by: row.last_managed_by === null ? null : Number(row.last_managed_by),
    last_managed_at: row.last_managed_at || null,
    created_at: row.created_at,
  };
}

export async function listTenantIssues(
  execute: IssueQueryExecutor,
  tenantSlug: string,
  filters: TenantIssueFilters,
) {
  if (!TENANT_SLUG_PATTERN.test(tenantSlug)) throw new Error('Invalid trusted tenant slug.');
  const clauses = ['tenant_slug = ?'];
  const params: Array<string | number> = [tenantSlug];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.severity) {
    clauses.push('severity = ?');
    params.push(filters.severity);
  }
  params.push(filters.limit);
  const result = await execute(
    `SELECT id, tenant_slug, severity, source, code, message, http_status, http_method,
            request_path, request_id, actor_type, actor_id, metadata_json, status,
            resolved_by, resolved_at, archived_by, archived_at,
            last_managed_by, last_managed_at, created_at
     FROM tenant_issue_logs
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC, id DESC LIMIT ?`,
    params,
  );
  return result.rows.map(publicTenantIssue);
}
