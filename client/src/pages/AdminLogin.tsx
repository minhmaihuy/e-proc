import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const session = await login(username, password);
      navigate(session.role === 'tenant_admin' ? '/admin/tenant' : '/admin/dashboard');
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Login failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <span className="eyebrow">E-PROC PLATFORM</span>
        <h1>One control plane.<br />Every customer environment.</h1>
        <p>Secure tenant onboarding, approval and infrastructure provisioning from a single workspace.</p>
        <div className="login-feature-list">
          <span>Isolated tenant servers</span>
          <span>Approval-gated Terraform</span>
          <span>Auditable operations</span>
        </div>
      </section>
      <section className="login-card">
        <div className="login-mark">EP</div>
        <span className="eyebrow">SECURE ACCESS</span>
        <h2>Welcome back</h2>
        <p className="login-subtitle">Your account selects its tenant automatically. Existing platform data belongs to FSA CLS.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="admin-username">Username</label>
            <input
              id="admin-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <p className="login-footnote">Access is logged and protected by role-based authorization.</p>
      </section>
    </main>
  );
}

export default AdminLogin;
