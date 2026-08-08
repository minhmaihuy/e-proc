import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

interface RoleLoginFormProps {
  brandLabel: string;
  heroTitle: string;
  heroDescription: string;
  features: string[];
  accessLabel: string;
  title: string;
  subtitle: string;
  submitLabel: string;
  alternatePrompt: string;
  alternateLabel: string;
  alternatePath: string;
  onLogin: (username: string, password: string) => Promise<void>;
}

function RoleLoginForm({
  brandLabel,
  heroTitle,
  heroDescription,
  features,
  accessLabel,
  title,
  subtitle,
  submitLabel,
  alternatePrompt,
  alternateLabel,
  alternatePath,
  onLogin,
}: RoleLoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(username, password);
    } catch (requestError: unknown) {
      const response = requestError && typeof requestError === 'object'
        ? (requestError as { response?: { data?: { error?: unknown } } }).response
        : undefined;
      setError(typeof response?.data?.error === 'string'
        ? response.data.error
        : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <span className="eyebrow">{brandLabel}</span>
        <h1>{heroTitle}</h1>
        <p>{heroDescription}</p>
        <div className="login-feature-list">
          {features.map((feature) => <span key={feature}>{feature}</span>)}
        </div>
      </section>
      <section className="login-card">
        <div className="login-mark">EP</div>
        <span className="eyebrow">{accessLabel}</span>
        <h2>{title}</h2>
        <p className="login-subtitle">{subtitle}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="role-login-username">Username</label>
            <input
              id="role-login-username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={loading}
              required
              maxLength={100}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="role-login-password">Password</label>
            <input
              id="role-login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Logging in...' : submitLabel}
          </button>
        </form>
        <p className="login-footnote">
          {alternatePrompt} <Link to={alternatePath}>{alternateLabel}</Link>
        </p>
      </section>
    </main>
  );
}

export default RoleLoginForm;
