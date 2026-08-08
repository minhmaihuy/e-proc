import { FormEvent, useCallback, useEffect, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { AdminRole, AdminUser, adminApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

function apiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === 'string' ? response.data.error : fallback;
}

function roleLabel(role: AdminRole): string {
  if (role === 'tenant_admin') return 'Tenant administrator';
  return 'Application administrator';
}

function UserManagement() {
  const { userId, tenantId, tenantName, tenantSlug } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<AdminRole>('tenant_admin');
  const [creating, setCreating] = useState(false);
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const loadData = useCallback(async () => {
    try {
      const usersResponse = await adminApi.listUsers();
      setUsers(usersResponse.data);
      setError('');
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Unable to load tenant users.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const visibleRoles: AdminRole[] = ['tenant_admin', 'admin'];

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    clearMessages();
    const username = newUsername.trim();
    if (!/^[A-Za-z0-9_.@-]{3,100}$/.test(username)) {
      setError('Username must contain 3-100 letters, numbers, dots, dashes, @ or underscores.');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      setError('Password must contain 8-128 characters.');
      return;
    }
    setCreating(true);
    try {
      await adminApi.createUser({
        username,
        password: newPassword,
        role: newRole,
        tenant_id: tenantId,
      });
      setSuccess(`Account “${username}” created.`);
      setNewUsername('');
      setNewPassword('');
      setNewRole('tenant_admin');
      await loadData();
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Unable to create account.'));
    } finally {
      setCreating(false);
    }
  };

  const updateUser = async (user: AdminUser, changes: { role?: AdminRole; tenant_id?: number | null; password?: string }) => {
    clearMessages();
    try {
      await adminApi.updateUser(user.id, changes);
      setSuccess(`Updated “${user.username}”.`);
      await loadData();
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Unable to update account.'));
    }
  };

  const handleResetPassword = async (user: AdminUser) => {
    if (resetPasswordValue.length < 8 || resetPasswordValue.length > 128) {
      setError('Password must contain 8-128 characters.');
      return;
    }
    await updateUser(user, { password: resetPasswordValue });
    setResetPasswordId(null);
    setResetPasswordValue('');
  };

  const handleDelete = async (user: AdminUser) => {
    if (!window.confirm(`Delete account “${user.username}”? This cannot be undone.`)) return;
    clearMessages();
    try {
      await adminApi.deleteUser(user.id);
      setSuccess(`Deleted “${user.username}”.`);
      await loadData();
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Unable to delete account.'));
    }
  };

  if (loading) return <div className="loading">Loading tenant users...</div>;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <span className="eyebrow">IDENTITY & ACCESS</span>
          <h1>My tenant users</h1>
          <p>Managing {tenantName || tenantSlug || 'your tenant'} only.</p>
        </div>
      </header>

      <AdminNav />
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {success && <div className="notice notice-success" role="status">{success}</div>}

      <section className="tenant-config-card">
        <div className="section-heading">
          <div><span className="eyebrow">NEW ACCOUNT</span><h2>Create tenant user</h2></div>
          <small>Passwords are stored as bcrypt hashes</small>
        </div>
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <label className="field"><span>Username</span><input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} disabled={creating} required minLength={3} maxLength={100} /></label>
            <label className="field"><span>Temporary password</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={creating} required minLength={8} maxLength={128} /></label>
            <label className="field"><span>Role</span><select value={newRole} onChange={(event) => setNewRole(event.target.value as AdminRole)} disabled={creating}>{visibleRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
            <label className="field"><span>Tenant</span><input value={`${tenantName || 'Tenant'} (${tenantSlug || tenantId})`} disabled /></label>
          </div>
          <div className="form-footer">
            <p>Tenant administrators cannot assign accounts outside their JWT tenant.</p>
            <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating...' : 'Create account'}</button>
          </div>
        </form>
      </section>

      <section className="provision-card">
        <div className="section-heading"><div><span className="eyebrow">DIRECTORY</span><h2>Administrator accounts</h2></div><span className="count-pill">{users.length}</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Username</th><th>Tenant</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.username}</strong></td>
                  <td>
                    {user.tenant_name || tenantName || 'Tenant'}
                  </td>
                  <td>
                    <select value={user.role} disabled={user.id === userId} onChange={(event) => {
                      const role = event.target.value as AdminRole;
                      void updateUser(user, { role, tenant_id: tenantId });
                    }}>
                      {visibleRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                    </select>
                  </td>
                  <td>{new Date(user.created_at).toLocaleString()}</td>
                  <td>
                    {user.id === userId ? <span className="status-badge status-approved">Current session</span> : <div className="button-row">
                      {resetPasswordId === user.id ? (
                        <>
                          <input type="password" aria-label={`New password for ${user.username}`} placeholder="New password" value={resetPasswordValue} onChange={(event) => setResetPasswordValue(event.target.value)} minLength={8} maxLength={128} />
                          <button className="btn btn-primary" type="button" onClick={() => void handleResetPassword(user)}>Save</button>
                          <button className="btn btn-secondary" type="button" onClick={() => { setResetPasswordId(null); setResetPasswordValue(''); }}>Cancel</button>
                        </>
                      ) : <button className="btn btn-secondary" type="button" onClick={() => { setResetPasswordId(user.id); setResetPasswordValue(''); }}>Reset password</button>}
                      <button className="btn btn-danger" type="button" onClick={() => void handleDelete(user)}>Delete</button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ color: 'var(--text-light)', fontSize: 12 }}>
        Session scope: <strong>{tenantName || 'Tenant'} ({tenantSlug || tenantId})</strong>
      </p>
    </main>
  );
}

export default UserManagement;
