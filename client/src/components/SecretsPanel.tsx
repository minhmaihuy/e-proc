import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AppSecretsStatus, AppSecretsTestResult, adminApi } from '../services/api';

/**
 * Panel AWS Secrets Manager — nhúng trong trang quản lý tenant của superadmin
 * (`/tenants`), không phải một trang rời. Secrets là hạ tầng của control plane nên
 * thuộc về đúng nơi superadmin đã quản lý tenant, domain và Terraform.
 *
 * Panel chỉ HIỂN THỊ trạng thái và THỬ đọc secret; nó không bao giờ nhận về giá trị
 * secret, chỉ tên khóa. Việc bật/tắt nằm ở `.env` máy chủ, cố ý không đưa lên API.
 */

function apiErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === 'string' ? response.data.error : fallback;
}

function KeyBadges({ keys, tone }: { keys: string[]; tone: 'secret' | 'env' | 'warn' }) {
  const palette = {
    secret: { bg: 'rgba(34,197,94,0.12)', fg: '#15803d', border: 'rgba(34,197,94,0.35)' },
    env: { bg: 'rgba(100,116,139,0.12)', fg: '#475569', border: 'rgba(100,116,139,0.3)' },
    warn: { bg: 'rgba(234,179,8,0.14)', fg: '#a16207', border: 'rgba(234,179,8,0.4)' },
  }[tone];
  if (keys.length === 0) return <span className="text-[13px] text-slate-500">—</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {keys.map((key) => (
        <code
          key={key}
          className="rounded-[5px] border px-2 py-0.5 text-xs"
      // Mau lay tu palette tinh trong JS theo trang thai khoa, khong the bieu dien
      // bang class tinh cua Tailwind, nen ba thuoc tinh nay van phai la inline.
      style={{ background: palette.bg, color: palette.fg, borderColor: palette.border }}
        >
          {key}
        </code>
      ))}
    </span>
  );
}

function SecretsPanel() {
  const [status, setStatus] = useState<AppSecretsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const [testArn, setTestArn] = useState('');
  const [testRegion, setTestRegion] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AppSecretsTestResult | null>(null);
  const [testError, setTestError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const response = await adminApi.getSecretsStatus();
      setStatus(response.data);
      setTestArn((current) => current || response.data.secretArn);
      setTestRegion((current) => current || response.data.region);
      setError('');
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError, 'Unable to load Secrets Manager status.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleTest = async (event: FormEvent) => {
    event.preventDefault();
    setTesting(true);
    setTestError('');
    setTestResult(null);
    try {
      const response = await adminApi.testSecret(testArn.trim(), testRegion.trim());
      setTestResult(response.data);
    } catch (requestError: unknown) {
      setTestError(apiErrorMessage(requestError, 'Unable to read that secret.'));
    } finally {
      setTesting(false);
    }
  };

  const enabled = status?.enabled ?? false;

  return (
    <section className="panel-section" aria-label="Application secrets">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PLATFORM CONFIGURATION</span>
          <h2>
            Secrets Manager{' '}
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 align-middle text-xs font-semibold ${
        enabled ? 'bg-green-500/15 text-green-700' : 'bg-slate-500/15 text-slate-600'
      }`}
            >
              {enabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </h2>
        </div>
        <div className="button-row">
          <button className="btn btn-secondary" type="button" disabled={loading} onClick={() => void loadStatus()}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error" role="alert">{error}</div>}

      {status && (
        <>
          <p className="text-slate-500">
            {enabled
              ? 'This server loads sensitive configuration from AWS Secrets Manager. Values are never displayed here — only key names.'
              : 'This server reads all configuration from its .env file. That is the default and is working as intended. Test a secret below before enabling.'}
          </p>

          {expanded && (
            <>
              <div className="overflow-x-auto">
                <table>
                  <tbody>
                    <tr>
                      <td className="w-[210px] text-slate-500">Secret ARN</td>
                      <td className="break-words font-mono text-xs">
                        {status.secretArn || <span className="text-slate-500">not configured</span>}
                      </td>
                    </tr>
                    <tr>
                      <td className="text-slate-500">Region</td>
                      <td>{status.region || <span className="text-slate-500">not configured</span>}</td>
                    </tr>
                    <tr>
                      <td className="text-slate-500">Loaded at</td>
                      <td>{status.loadedAt ? new Date(status.loadedAt).toLocaleString() : '—'}</td>
                    </tr>
                    <tr>
                      <td className="text-slate-500">Keys from secret</td>
                      <td><KeyBadges keys={status.appliedKeys} tone="secret" /></td>
                    </tr>
                    <tr>
                      <td className="text-slate-500">Keys still from .env</td>
                      <td><KeyBadges keys={status.envFallbackKeys} tone="env" /></td>
                    </tr>
                    {status.ignoredKeys.length > 0 && (
                      <tr>
                        <td className="text-slate-500">Ignored keys</td>
                        <td>
                          <KeyBadges keys={status.ignoredKeys} tone="warn" />
                          <small className="mt-1.5 block text-slate-500">
                            Not in the managed list — usually a mistyped key name.
                          </small>
                        </td>
                      </tr>
                    )}
                    {status.error && (
                      <tr>
                        <td className="text-slate-500">Error</td>
                        <td className="error">{status.error}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <form onSubmit={handleTest} className="mt-[18px]">
                <div className="form-grid">
                  <label className="field field-wide">
                    <span>Secret ARN to test</span>
                    <input
                      value={testArn}
                      onChange={(event) => setTestArn(event.target.value)}
                      placeholder="arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:eproc/app-AbCdEf"
                      className="font-mono text-xs"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Region</span>
                    <input
                      value={testRegion}
                      onChange={(event) => setTestRegion(event.target.value)}
                      placeholder="ap-southeast-1"
                    />
                  </label>
                </div>
                <div className="form-footer">
                  <p>Reading a secret here validates the ARN, region, and IAM permission. It never applies it to the running process.</p>
                  <div className="button-row">
                    <button className="btn btn-primary" type="submit" disabled={testing || !testArn.trim()}>
                      {testing ? 'Testing...' : 'Test connection'}
                    </button>
                  </div>
                </div>
              </form>

              {testError && <div className="notice notice-error" role="alert">{testError}</div>}
              {testResult && (
                <div className="notice notice-success" role="status">
                  <div>{testResult.message}</div>
                  <div className="mt-2">
                    <small className="text-slate-500">Would be applied:</small>
                    <KeyBadges keys={testResult.appliedKeys} tone="secret" />
                  </div>
                  {testResult.ignoredKeys.length > 0 && (
                    <div className="mt-2">
                      <small className="text-slate-500">Would be ignored:</small>
                      <KeyBadges keys={testResult.ignoredKeys} tone="warn" />
                    </div>
                  )}
                </div>
              )}

              <details className="mt-4">
                <summary className="cursor-pointer">How to enable</summary>
                <p className="leading-relaxed text-slate-500">
                  Enabling is deliberately not an API action. If one click could repoint the
                  application at another secret, a hijacked superadmin session could take over the
                  database. It lives in the server <code>.env</code>, so only someone with SSH can
                  change it.
                </p>
                <pre className="overflow-x-auto text-xs">{`# /opt/eaudit/.env
APP_SECRETS_ENABLED=true
APP_SECRETS_ARN=arn:aws:secretsmanager:...:secret:eproc/app-AbCdEf
APP_SECRETS_REGION=ap-southeast-1

# then: pm2 restart eaudit`}</pre>
                <p className="leading-relaxed text-slate-500">
                  The secret must be a JSON object, e.g.{' '}
                  <code>{'{"DATABASE_URL":"postgres://…","JWT_SECRET":"…"}'}</code>. Once enabled,
                  secret values override same-named <code>.env</code> entries, and a failed load
                  stops the server instead of silently running on stale configuration. Managed
                  keys: {status.managedKeys.join(', ')}.
                </p>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}

export default SecretsPanel;
