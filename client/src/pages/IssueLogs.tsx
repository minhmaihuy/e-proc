import { useCallback, useEffect, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { adminApi, TenantIssue } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

type IssueStatusFilter = '' | 'open' | 'resolved' | 'archived';
type IssueSeverityFilter = '' | 'warning' | 'error' | 'critical';

function errorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unable to load tenant issue logs.';
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === 'string' ? response.data.error : 'Unable to load tenant issue logs.';
}

// Mức độ phải phân biệt được bằng nhiều thứ hơn là màu: nền, chữ và viền cùng đổi, vì
// một bảng log dài mà chỉ khác sắc độ đỏ thì người phân biệt màu kém không đọc được thứ
// tự ưu tiên.
const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 ring-red-300',
  error: 'bg-orange-100 text-orange-800 ring-orange-300',
  warning: 'bg-amber-100 text-amber-800 ring-amber-300',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 ring-blue-300',
  resolved: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
  archived: 'bg-slate-100 text-slate-600 ring-slate-300',
};

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${tone}`}>
      {label}
    </span>
  );
}

function IssueLogs() {
  const { tenantName, tenantSlug, isTenantAdmin, logout } = useAuth();
  const [issues, setIssues] = useState<TenantIssue[]>([]);
  const [status, setStatus] = useState<IssueStatusFilter>('open');
  const [severity, setSeverity] = useState<IssueSeverityFilter>('');
  const [loading, setLoading] = useState(true);
  const [mutatingId, setMutatingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const loadIssues = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminApi.getIssues({
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        limit: 200,
      });
      setIssues(response.data);
      setError('');
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [severity, status]);

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  const updateIssueStatus = async (id: number, nextStatus: 'open' | 'resolved' | 'archived') => {
    if (nextStatus === 'archived' && !window.confirm('Archive this issue? The immutable event will be retained.')) return;
    setMutatingId(id);
    try {
      await adminApi.updateIssueStatus(id, nextStatus);
      await loadIssues();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setMutatingId(null);
    }
  };

  return (
    <div className="container">
      <div className="header">
        <div>
          <span className="eyebrow">TENANT LOG PLANE</span>
          <h1>Issue Logs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Operational failures for {tenantName || tenantSlug} ({tenantSlug}). Candidate violations remain in assessment results.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={logout}>Logout</button>
      </div>

      <AdminNav />

      <div className="card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="form-group mb-0 min-w-[10rem]">
            <label htmlFor="issue-status">Status</label>
            <select id="issue-status" value={status} onChange={(event) => setStatus(event.target.value as IssueStatusFilter)}>
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="form-group mb-0 min-w-[10rem]">
            <label htmlFor="issue-severity">Severity</label>
            <select id="issue-severity" value={severity} onChange={(event) => setSeverity(event.target.value as IssueSeverityFilter)}>
              <option value="">All</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <button className="btn btn-secondary" onClick={() => void loadIssues()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <span className="ml-auto text-sm text-slate-500" aria-live="polite">
            {loading ? 'Loading…' : `${issues.length} issue${issues.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <div
        className={`mb-6 rounded-xl border p-4 text-sm ${
          isTenantAdmin
            ? 'border-blue-200 bg-blue-50 text-blue-800'
            : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}
      >
        {isTenantAdmin
          ? 'Tenant administrator mode: you can resolve, reopen, archive, and restore issues for this tenant.'
          : 'Read-only mode: only this tenant administrator can manage issue lifecycle.'}
      </div>

      <div className="card overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Severity</th>
              <th>Issue</th>
              <th>Request</th>
              <th>Actor</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.id}>
                <td className="whitespace-nowrap align-top text-slate-600">{new Date(issue.created_at).toLocaleString()}</td>
                <td className="align-top">
                  <Pill label={issue.severity} tone={SEVERITY_STYLES[issue.severity] || STATUS_STYLES.archived} />
                </td>
                <td className="align-top">
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-blue-700">{issue.code}</code>
                  <div className="mt-1 max-w-md break-words text-slate-800">{issue.message}</div>
                  <small className="text-slate-500">Request ID: {issue.request_id || 'n/a'}</small>
                </td>
                <td className="align-top">
                  <code className="block break-all font-mono text-xs text-slate-700">
                    {issue.http_method || '-'} {issue.request_path || '-'}
                  </code>
                  <div className="mt-1 text-slate-500">{issue.http_status || '-'}</div>
                </td>
                <td className="align-top whitespace-nowrap text-slate-600">
                  {issue.actor_type}{issue.actor_id ? ` #${issue.actor_id}` : ''}
                </td>
                <td className="align-top">
                  <Pill label={issue.status} tone={STATUS_STYLES[issue.status] || STATUS_STYLES.archived} />
                </td>
                <td className="align-top">
                  {!isTenantAdmin ? <span className="text-sm text-slate-400">Read only</span> : (
                    <div className="button-row">
                      {issue.status === 'open' && (
                        <button className="btn btn-primary text-xs" disabled={mutatingId === issue.id} onClick={() => void updateIssueStatus(issue.id, 'resolved')}>Resolve</button>
                      )}
                      {issue.status === 'resolved' && (
                        <button className="btn btn-secondary text-xs" disabled={mutatingId === issue.id} onClick={() => void updateIssueStatus(issue.id, 'open')}>Reopen</button>
                      )}
                      {issue.status !== 'archived' && (
                        <button className="btn btn-danger-outline text-xs" disabled={mutatingId === issue.id} onClick={() => void updateIssueStatus(issue.id, 'archived')}>Archive</button>
                      )}
                      {issue.status === 'archived' && (
                        <button className="btn btn-secondary text-xs" disabled={mutatingId === issue.id} onClick={() => void updateIssueStatus(issue.id, 'open')}>Restore</button>
                      )}
                      {mutatingId === issue.id && <span className="text-xs text-slate-500">Updating…</span>}
                    </div>
                  )}
                  {issue.last_managed_at && (
                    <small className="mt-1.5 block text-slate-500">
                      Managed by #{issue.last_managed_by || '?'} · {new Date(issue.last_managed_at).toLocaleString()}
                    </small>
                  )}
                </td>
              </tr>
            ))}
            {!loading && issues.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-500">
                  No issues match these filters.
                </td>
              </tr>
            )}
            {loading && issues.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-slate-500">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default IssueLogs;
