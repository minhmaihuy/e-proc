/**
 * Nạp cấu hình nhạy cảm của ứng dụng từ AWS Secrets Manager.
 *
 * MẶC ĐỊNH TẮT. Khi APP_SECRETS_ENABLED khác 'true', toàn bộ module này không gọi
 * AWS, không đụng process.env, và server chạy y hệt như trước — chỉ đọc .env.
 * Bật lên thì giá trị trong secret GHI ĐÈ .env (đó là mục đích của việc bật).
 *
 * Nguyên tắc bảo mật của module:
 *  - Không bao giờ log hay trả về GIÁ TRỊ secret; chỉ trả TÊN khóa.
 *  - Chỉ áp dụng các khóa nằm trong MANAGED_SECRET_KEYS; khóa lạ bị bỏ qua và
 *    được báo lại để phát hiện gõ sai tên, thay vì im lặng không có tác dụng.
 *  - Khi đã bật mà nạp lỗi thì THROW để server dừng hẳn. Chạy tiếp với cấu hình
 *    cũ trong .env nguy hiểm hơn nhiều: dễ ghi nhầm vào database của môi trường khác.
 */
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/** Khóa được phép nạp từ secret. Thêm khóa mới ở đây thì mới có tác dụng. */
export const MANAGED_SECRET_KEYS = Object.freeze([
  'DATABASE_URL',
  'CONTROL_DATABASE_URL',
  'LOG_DATABASE_URL',
  'JWT_SECRET',
  'SESSION_SECRET',
  'GEMINI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_RECORDINGS_BUCKET',
  'SES_FROM_EMAIL',
  'SES_SNS_TOPIC_ARN',
  'SES_CONFIGURATION_SET',
  'SUPERADMIN_PASSWORD',
]);

export const SECRET_ARN_PATTERN = /^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;

export type AppSecretsErrorCode =
  | 'NOT_ENABLED'
  | 'MISSING_ARN'
  | 'INVALID_ARN'
  | 'MISSING_REGION'
  | 'FETCH_FAILED'
  | 'INVALID_PAYLOAD';

export class AppSecretsError extends Error {
  readonly code: AppSecretsErrorCode;
  constructor(code: AppSecretsErrorCode, message: string) {
    super(message);
    this.name = 'AppSecretsError';
    this.code = code;
  }
}

export interface AppSecretsEnvironment {
  APP_SECRETS_ENABLED?: string;
  APP_SECRETS_ARN?: string;
  APP_SECRETS_REGION?: string;
  AWS_REGION?: string;
  [key: string]: string | undefined;
}

export interface AppSecretsConfig {
  enabled: boolean;
  secretArn: string;
  region: string;
}

export interface AppSecretsLoadResult {
  /** Tên các khóa đã ghi vào process.env — KHÔNG kèm giá trị. */
  appliedKeys: string[];
  /** Khóa có trong secret nhưng không nằm trong danh sách quản lý (thường do gõ sai). */
  ignoredKeys: string[];
  secretArn: string;
  region: string;
}

export interface AppSecretsStatus {
  enabled: boolean;
  configured: boolean;
  secretArn: string;
  region: string;
  loadedAt: string | null;
  appliedKeys: string[];
  ignoredKeys: string[];
  error: string | null;
  managedKeys: string[];
}

export type SecretFetcher = (secretArn: string, region: string) => Promise<string>;

let lastStatus: AppSecretsStatus = {
  enabled: false,
  configured: false,
  secretArn: '',
  region: '',
  loadedAt: null,
  appliedKeys: [],
  ignoredKeys: [],
  error: null,
  managedKeys: [...MANAGED_SECRET_KEYS],
};

export function isAppSecretsEnabled(env: AppSecretsEnvironment): boolean {
  return env.APP_SECRETS_ENABLED?.trim().toLowerCase() === 'true';
}

/** Đọc và kiểm tra cấu hình. Ném lỗi khi đã bật nhưng khai báo thiếu/sai. */
export function readAppSecretsConfig(env: AppSecretsEnvironment): AppSecretsConfig {
  const enabled = isAppSecretsEnabled(env);
  const secretArn = env.APP_SECRETS_ARN?.trim() || '';
  const region = env.APP_SECRETS_REGION?.trim() || env.AWS_REGION?.trim() || '';

  if (!enabled) {
    return { enabled: false, secretArn, region };
  }
  if (!secretArn) {
    throw new AppSecretsError('MISSING_ARN', 'APP_SECRETS_ENABLED=true nhưng thiếu APP_SECRETS_ARN.');
  }
  if (!SECRET_ARN_PATTERN.test(secretArn)) {
    throw new AppSecretsError('INVALID_ARN', 'APP_SECRETS_ARN không đúng định dạng ARN của Secrets Manager.');
  }
  if (!region) {
    throw new AppSecretsError('MISSING_REGION', 'Thiếu APP_SECRETS_REGION (hoặc AWS_REGION) cho Secrets Manager.');
  }
  return { enabled: true, secretArn, region };
}

/** Tách các cặp khóa/giá trị hợp lệ khỏi payload JSON của secret. */
export function parseSecretPayload(payload: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new AppSecretsError('INVALID_PAYLOAD', 'Secret phải là một object JSON dạng {"KHOA":"giá trị"}.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppSecretsError('INVALID_PAYLOAD', 'Secret phải là một object JSON dạng {"KHOA":"giá trị"}.');
  }
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') entries[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') entries[key] = String(value);
  }
  return entries;
}

/** Phân loại khóa thành áp dụng được / bị bỏ qua, không chạm tới giá trị. */
export function classifySecretKeys(entries: Record<string, string>): {
  appliedKeys: string[];
  ignoredKeys: string[];
} {
  const managed = new Set(MANAGED_SECRET_KEYS);
  const appliedKeys: string[] = [];
  const ignoredKeys: string[] = [];
  for (const key of Object.keys(entries)) {
    if (managed.has(key)) appliedKeys.push(key);
    else ignoredKeys.push(key);
  }
  return { appliedKeys: appliedKeys.sort(), ignoredKeys: ignoredKeys.sort() };
}

const defaultFetcher: SecretFetcher = async (secretArn, region) => {
  const client = new SecretsManagerClient({ region });
  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
    if (response.SecretString) return response.SecretString;
    if (response.SecretBinary) return new TextDecoder().decode(response.SecretBinary);
    throw new AppSecretsError('FETCH_FAILED', 'Secret rỗng — không có SecretString lẫn SecretBinary.');
  } finally {
    client.destroy();
  }
};

/**
 * Lấy secret rồi kiểm tra, KHÔNG ghi vào process.env. Dùng cho nút "Kiểm tra kết nối"
 * của superadmin: xác nhận ARN/quyền IAM đúng mà không làm thay đổi cấu hình đang chạy.
 */
export async function inspectAppSecret(
  secretArn: string,
  region: string,
  fetchSecret: SecretFetcher = defaultFetcher,
): Promise<{ appliedKeys: string[]; ignoredKeys: string[] }> {
  if (!SECRET_ARN_PATTERN.test(secretArn)) {
    throw new AppSecretsError('INVALID_ARN', 'ARN không đúng định dạng của Secrets Manager.');
  }
  if (!region) {
    throw new AppSecretsError('MISSING_REGION', 'Thiếu region cho Secrets Manager.');
  }
  let payload: string;
  try {
    payload = await fetchSecret(secretArn, region);
  } catch (error) {
    if (error instanceof AppSecretsError) throw error;
    // Không đưa nguyên văn lỗi AWS ra ngoài: có thể lộ ARN/account của tài nguyên khác.
    throw new AppSecretsError('FETCH_FAILED', 'Không đọc được secret. Kiểm tra ARN, region và quyền secretsmanager:GetSecretValue.');
  }
  return classifySecretKeys(parseSecretPayload(payload));
}

/**
 * Nạp secret vào process.env. Khi tắt thì trả về ngay, không gọi AWS.
 * Gọi TRƯỚC khi import module đọc cấu hình (index.ts kiểm JWT_SECRET lúc load).
 */
export async function loadAppSecrets(
  env: NodeJS.ProcessEnv = process.env,
  fetchSecret: SecretFetcher = defaultFetcher,
): Promise<AppSecretsLoadResult | null> {
  const config = readAppSecretsConfig(env as AppSecretsEnvironment);
  lastStatus = {
    ...lastStatus,
    enabled: config.enabled,
    configured: Boolean(config.secretArn),
    secretArn: config.secretArn,
    region: config.region,
  };

  if (!config.enabled) {
    lastStatus.error = null;
    return null;
  }

  try {
    const payload = await fetchSecret(config.secretArn, config.region);
    const entries = parseSecretPayload(payload);
    const { appliedKeys, ignoredKeys } = classifySecretKeys(entries);
    for (const key of appliedKeys) {
      env[key] = entries[key];
    }
    lastStatus = {
      ...lastStatus,
      loadedAt: new Date().toISOString(),
      appliedKeys,
      ignoredKeys,
      error: null,
    };
    return { appliedKeys, ignoredKeys, secretArn: config.secretArn, region: config.region };
  } catch (error) {
    const message = error instanceof AppSecretsError
      ? error.message
      : 'Không đọc được secret. Kiểm tra ARN, region và quyền secretsmanager:GetSecretValue.';
    lastStatus = { ...lastStatus, loadedAt: null, appliedKeys: [], ignoredKeys: [], error: message };
    throw error instanceof AppSecretsError ? error : new AppSecretsError('FETCH_FAILED', message);
  }
}

/** Trạng thái lần nạp gần nhất — chỉ chứa tên khóa, không có giá trị. */
export function getAppSecretsStatus(): AppSecretsStatus {
  return { ...lastStatus, appliedKeys: [...lastStatus.appliedKeys], ignoredKeys: [...lastStatus.ignoredKeys] };
}

/** Chỉ dùng trong test. */
export function resetAppSecretsStatusForTests(): void {
  lastStatus = {
    enabled: false,
    configured: false,
    secretArn: '',
    region: '',
    loadedAt: null,
    appliedKeys: [],
    ignoredKeys: [],
    error: null,
    managedKeys: [...MANAGED_SECRET_KEYS],
  };
}
