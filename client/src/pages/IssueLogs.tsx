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
          <p style={{ margin: 0, color: 'var(--text-light)' }}>
            Operational failures for {tenantName || tenantSlug} ({tenantSlug}). Candidate violations remain in assessment results.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={logout}>Logout</button>
      </div>

      <AdminNav />

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="issue-status">Status</label>
            <select id="issue-status" value={status} onChange={(event) => setStatus(event.target.value as IssueStatusFilter)}>
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="issue-severity">Severity</label>
            <select id="issue-severity" value={severity} onChange={(event) => setSeverity(event.target.value as IssueSeverityFilter)}>
              <option value="">All</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <button className="btn btn-secondary" onClick={() => void loadIssues()} disabled={loading}>Refresh</button>
        </div>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: 20 }}>{error}</div>}
      <div className="card" style={{ marginBottom: 20 }}>
        {isTenantAdmin
          ? 'Tenant administrator mode: you can resolve, reopen, archive, and restore issues for this tenant.'
          : 'Read-only mode: only this tenant administrator can manage issue lifecycle.'}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
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
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(issue.created_at).toLocaleString()}</td>
                <td><strong>{issue.severity.toUpperCase()}</strong></td>
                <td>
                  <div><code>{issue.code}</code></div>
                  <div style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{issue.message}</div>
                  <small style={{ color: 'var(--text-light)' }}>Request ID: {issue.request_id || 'n/a'}</small>
                </td>
                <td>
                  <code>{issue.http_method || '-'} {issue.request_path || '-'}</code>
                  <div>{issue.http_status || '-'}</div>
                </td>
                <td>{issue.actor_type}{issue.actor_id ? ` #${issue.actor_id}` : ''}</td>
                <td>{issue.status}</td>
                <td>
                  {!isTenantAdmin ? <span>Read only</span> : (
                    <div className="button-row">
                      {issue.status === 'open' && (
                        <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={mutatingId === issue.id} onClick={() => void updateIssueStatus(issue.id, 'resolved')}>Resolve</button>
                      )}
                      {issue.status === 'resolved' && (
                        <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={mutatingId === issue.id} onClick={() => void updateIssueStatus(issue.id, 'open')}>Reopen</button>
                      )}
                      {issue.status !== 'archived' && (
                        <button className="btn btn-danger-outline" style={{ fontSize: 12 }} disabled={mutatingId === issue.id} onClick={() => void updateIssueStatus(issue.id, 'archived')}>Archive</button>
                      )}
                      {issue.status === 'archived' && (
                        <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={mutatingId === issue.id} onClick={() => void updateIssueStatus(issue.id, 'open')}>Restore</button>
                      )}
                      {mutatingId === issue.id && <span>Updating...</span>}
                    </div>
                  )}
                  {issue.last_managed_at && (
                    <small style={{ display: 'block', color: 'var(--text-light)', marginTop: 6 }}>
                      Managed by #{issue.last_managed_by || '?'} · {new Date(issue.last_managed_at).toLocaleString()}
                    </small>
                  )}
                </td>
              </tr>
            ))}
            {!loading && issues.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-light)' }}>No issues match these filters.</td></tr>
            )}
            {loading && <tr><td colSpan={7} style={{ textAlign: 'center' }}>Loading...</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default IssueLogs;
