import { FormEvent, useCallback, useEffect, useState } from 'react';
import AdminNav from '../components/AdminNav';
import { AppSecretsStatus, AppSecretsTestResult, adminApi } from '../services/api';

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
  if (keys.length === 0) return <span style={{ color: 'var(--text-light)', fontSize: 13 }}>—</span>;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {keys.map((key) => (
        <code
          key={key}
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 5,
            background: palette.bg,
            color: palette.fg,
            border: `1px solid ${palette.border}`,
          }}
        >
          {key}
        </code>
      ))}
    </span>
  );
}

function SecretsManagement() {
  const [status, setStatus] = useState<AppSecretsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      setError(apiErrorMessage(requestError, 'Không tải được trạng thái Secrets Manager.'));
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
      setTestError(apiErrorMessage(requestError, 'Không đọc được secret.'));
    } finally {
      setTesting(false);
    }
  };

  const enabled = status?.enabled ?? false;

  return (
    <div className="container">
      <div className="header">
        <h2>Secrets Manager</h2>
      </div>
      <AdminNav />

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
      {loading && <p style={{ color: 'var(--text-light)' }}>Đang tải…</p>}

      {status && (
        <>
          <div className="card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              Trạng thái
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: enabled ? 'rgba(34,197,94,0.14)' : 'rgba(100,116,139,0.14)',
                  color: enabled ? '#15803d' : '#475569',
                }}
              >
                {enabled ? 'ĐANG BẬT' : 'ĐANG TẮT'}
              </span>
            </h3>

            {!enabled && (
              <p style={{ color: 'var(--text-light)', fontSize: 14, lineHeight: 1.6 }}>
                Ứng dụng đang đọc toàn bộ cấu hình từ file <code>.env</code> trên máy chủ. Đây là
                trạng thái mặc định và hoàn toàn bình thường. Dùng khung bên dưới để kiểm tra một
                secret trước, rồi mới bật.
              </p>
            )}

            <table style={{ marginTop: 12 }}>
              <tbody>
                <tr>
                  <td style={{ width: 200, color: 'var(--text-light)' }}>Secret ARN</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                    {status.secretArn || <span style={{ color: 'var(--text-light)' }}>chưa cấu hình</span>}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-light)' }}>Region</td>
                  <td>{status.region || <span style={{ color: 'var(--text-light)' }}>chưa cấu hình</span>}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-light)' }}>Nạp lúc</td>
                  <td>{status.loadedAt ? new Date(status.loadedAt).toLocaleString() : '—'}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-light)' }}>Khóa lấy từ secret</td>
                  <td><KeyBadges keys={status.appliedKeys} tone="secret" /></td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-light)' }}>Khóa còn lấy từ .env</td>
                  <td><KeyBadges keys={status.envFallbackKeys} tone="env" /></td>
                </tr>
                {status.ignoredKeys.length > 0 && (
                  <tr>
                    <td style={{ color: 'var(--text-light)' }}>Khóa bị bỏ qua</td>
                    <td>
                      <KeyBadges keys={status.ignoredKeys} tone="warn" />
                      <p style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 6 }}>
                        Không nằm trong danh sách quản lý — thường là gõ sai tên khóa.
                      </p>
                    </td>
                  </tr>
                )}
                {status.error && (
                  <tr>
                    <td style={{ color: 'var(--text-light)' }}>Lỗi</td>
                    <td className="error">{status.error}</td>
                  </tr>
                )}
              </tbody>
            </table>

            <p style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 14, lineHeight: 1.6 }}>
              Trang này chỉ hiển thị <strong>tên khóa</strong>, không bao giờ hiển thị giá trị.
              Các khóa được phép nạp: {status.managedKeys.join(', ')}.
            </p>
          </div>

          <div className="card">
            <h3>Kiểm tra một secret</h3>
            <p style={{ color: 'var(--text-light)', fontSize: 14 }}>
              Thử đọc secret để xác nhận ARN, region và quyền IAM đã đúng.
              Thao tác này <strong>không</strong> làm thay đổi cấu hình đang chạy.
            </p>
            <form onSubmit={handleTest}>
              <div className="form-group">
                <label htmlFor="secret-arn">Secret ARN</label>
                <input
                  id="secret-arn"
                  value={testArn}
                  onChange={(event) => setTestArn(event.target.value)}
                  placeholder="arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:eproc/app-AbCdEf"
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="secret-region">Region</label>
                <input
                  id="secret-region"
                  value={testRegion}
                  onChange={(event) => setTestRegion(event.target.value)}
                  placeholder="ap-southeast-1"
                  style={{ width: 220 }}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={testing || !testArn.trim()}>
                {testing ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
              </button>
            </form>

            {testError && <div className="error" style={{ marginTop: 14 }}>{testError}</div>}
            {testResult && (
              <div style={{ marginTop: 14 }}>
                <p style={{ color: '#15803d', fontWeight: 600 }}>✅ {testResult.message}</p>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 4 }}>Sẽ được áp dụng:</div>
                  <KeyBadges keys={testResult.appliedKeys} tone="secret" />
                </div>
                {testResult.ignoredKeys.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-light)', marginBottom: 4 }}>Sẽ bị bỏ qua:</div>
                    <KeyBadges keys={testResult.ignoredKeys} tone="warn" />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Cách bật</h3>
            <p style={{ color: 'var(--text-light)', fontSize: 14, lineHeight: 1.7 }}>
              Việc bật/tắt cố ý <strong>không làm qua giao diện</strong>. Nếu bật được bằng một cú
              nhấp chuột thì một tài khoản superadmin bị chiếm quyền có thể trỏ ứng dụng sang secret
              của kẻ tấn công và chiếm luôn database. Vì vậy nó nằm trong <code>.env</code> của máy
              chủ, chỉ người có quyền SSH mới đổi được.
            </p>
            <pre
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 14,
                fontSize: 12,
                overflowX: 'auto',
              }}
            >{`# /opt/eaudit/.env
APP_SECRETS_ENABLED=true
APP_SECRETS_ARN=arn:aws:secretsmanager:...:secret:eproc/app-AbCdEf
APP_SECRETS_REGION=ap-southeast-1

# rồi khởi động lại: pm2 restart eaudit`}</pre>
            <p style={{ fontSize: 13, color: 'var(--text-light)', lineHeight: 1.7 }}>
              Nội dung secret phải là object JSON, ví dụ{' '}
              <code>{'{"DATABASE_URL":"postgres://…","JWT_SECRET":"…"}'}</code>. Khi bật, giá trị
              trong secret <strong>ghi đè</strong> giá trị cùng tên trong <code>.env</code>. Nếu nạp
              thất bại, server sẽ <strong>dừng hẳn</strong> thay vì chạy tiếp bằng cấu hình cũ —
              tránh việc vô tình ghi vào database của môi trường khác.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default SecretsManagement;
