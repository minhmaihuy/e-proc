import { TenantIssue } from '../../services/api';

/**
 * Nhật ký vận hành của một tenant, ở chế độ CHỈ ĐỌC cho superadmin.
 *
 * Superadmin quan sát được nhưng không giải quyết hay xóa được — quyền sở hữu vòng đời
 * của issue thuộc về tenant admin. Vì vậy component này cố tình không có nút hành động
 * nào ngoài lọc và tải lại.
 */
interface TenantIssuesPanelProps {
  tenantUrl: string;
  issues: TenantIssue[];
  status: '' | 'open' | 'resolved' | 'archived';
  severity: '' | 'warning' | 'error' | 'critical';
  loading: boolean;
  error: string;
  onStatusChange: (status: '' | 'open' | 'resolved' | 'archived') => void;
  onSeverityChange: (severity: '' | 'warning' | 'error' | 'critical') => void;
  onRefresh: () => void;
}

function TenantIssuesPanel({
  tenantUrl,
  issues,
  status,
  severity,
  loading,
  error,
  onStatusChange,
  onSeverityChange,
  onRefresh,
}: TenantIssuesPanelProps) {
  return (
    <section className="provision-card" aria-labelledby="tenant-log-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">READ-ONLY OBSERVABILITY</span>
          <h3 id="tenant-log-heading">Operational logs</h3>
          <small>{tenantUrl || 'Configure a dedicated tenant domain before approval.'}</small>
        </div>
        <button className="btn btn-secondary" type="button" disabled={loading} onClick={onRefresh}>
          {loading ? 'Loading…' : 'Refresh logs'}
        </button>
      </div>

      <p className="text-slate-500">
        Superadmin can observe safe operational failures for this tenant but cannot resolve or
        delete them. Tenant administrators retain issue ownership.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="field min-w-[11rem]">
          <span>Status</span>
          <select value={status} onChange={(event) => onStatusChange(event.target.value as TenantIssuesPanelProps['status'])}>
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="field min-w-[11rem]">
          <span>Severity</span>
          <select value={severity} onChange={(event) => onSeverityChange(event.target.value as TenantIssuesPanelProps['severity'])}>
            <option value="">All</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
        </label>
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Severity</th>
              <th>Issue</th>
              <th>Request</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.id}>
                <td className="whitespace-nowrap align-top text-slate-600">
                  {new Date(issue.created_at).toLocaleString()}
                </td>
                <td><strong>{issue.severity.toUpperCase()}</strong></td>
                <td>
                  <div><code>{issue.code}</code> · {issue.source}</div>
                  <div className="max-w-md break-words text-slate-800">{issue.message}</div>
                  <small className="text-slate-500">Request ID: {issue.request_id || 'n/a'}</small>
                  {issue.metadata && (
                    <details>
                      <summary>Safe metadata</summary>
                      <pre>{JSON.stringify(issue.metadata, null, 2)}</pre>
                    </details>
                  )}
                </td>
                <td>
                  <code className="block break-all font-mono text-xs text-slate-700">
                    {issue.http_method || '-'} {issue.request_path || '-'}
                  </code>
                  <div className="mt-1 text-slate-500">{issue.http_status || '-'}</div>
                </td>
                <td>{issue.status}</td>
              </tr>
            ))}
            {!loading && issues.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-500">
                  No issues match these filters.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-slate-500">
                  Loading tenant log database…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default TenantIssuesPanel;
