import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppSecretsError,
  MANAGED_SECRET_KEYS,
  classifySecretKeys,
  getAppSecretsStatus,
  inspectAppSecret,
  isAppSecretsEnabled,
  loadAppSecrets,
  parseSecretPayload,
  readAppSecretsConfig,
  resetAppSecretsStatusForTests,
} from './appSecrets.js';

const VALID_ARN = 'arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:eproc/app-AbCdEf';

test('secrets manager tắt theo mặc định và không gọi AWS', async () => {
  resetAppSecretsStatusForTests();
  let called = false;
  const env: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://from-dotenv/eaudit' };
  const result = await loadAppSecrets(env, async () => {
    called = true;
    return '{}';
  });
  assert.equal(result, null);
  assert.equal(called, false, 'không được gọi AWS khi tính năng đang tắt');
  assert.equal(env.DATABASE_URL, 'postgres://from-dotenv/eaudit', 'process.env phải giữ nguyên');
  assert.equal(getAppSecretsStatus().enabled, false);
});

test('chỉ bật khi APP_SECRETS_ENABLED đúng bằng true', () => {
  assert.equal(isAppSecretsEnabled({}), false);
  assert.equal(isAppSecretsEnabled({ APP_SECRETS_ENABLED: 'false' }), false);
  assert.equal(isAppSecretsEnabled({ APP_SECRETS_ENABLED: '1' }), false);
  assert.equal(isAppSecretsEnabled({ APP_SECRETS_ENABLED: 'TRUE' }), true);
  assert.equal(isAppSecretsEnabled({ APP_SECRETS_ENABLED: ' true ' }), true);
});

test('bật mà khai báo thiếu hoặc sai thì báo lỗi rõ ràng', () => {
  assert.throws(
    () => readAppSecretsConfig({ APP_SECRETS_ENABLED: 'true' }),
    (err: AppSecretsError) => err.code === 'MISSING_ARN',
  );
  assert.throws(
    () => readAppSecretsConfig({ APP_SECRETS_ENABLED: 'true', APP_SECRETS_ARN: 'khong-phai-arn', AWS_REGION: 'ap-southeast-1' }),
    (err: AppSecretsError) => err.code === 'INVALID_ARN',
  );
  assert.throws(
    () => readAppSecretsConfig({ APP_SECRETS_ENABLED: 'true', APP_SECRETS_ARN: VALID_ARN }),
    (err: AppSecretsError) => err.code === 'MISSING_REGION',
  );
});

test('APP_SECRETS_REGION được ưu tiên hơn AWS_REGION', () => {
  const config = readAppSecretsConfig({
    APP_SECRETS_ENABLED: 'true',
    APP_SECRETS_ARN: VALID_ARN,
    APP_SECRETS_REGION: 'ap-southeast-1',
    AWS_REGION: 'us-east-1',
  });
  assert.equal(config.region, 'ap-southeast-1');
});

test('giá trị trong secret ghi đè .env khi đã bật', async () => {
  resetAppSecretsStatusForTests();
  const env: NodeJS.ProcessEnv = {
    APP_SECRETS_ENABLED: 'true',
    APP_SECRETS_ARN: VALID_ARN,
    AWS_REGION: 'ap-southeast-1',
    DATABASE_URL: 'postgres://from-dotenv/eaudit',
    JWT_SECRET: 'cu',
  };
  const result = await loadAppSecrets(env, async () =>
    JSON.stringify({ DATABASE_URL: 'postgres://from-secret/eaudit', JWT_SECRET: 'moi' }),
  );
  assert.deepEqual(result?.appliedKeys, ['DATABASE_URL', 'JWT_SECRET']);
  assert.equal(env.DATABASE_URL, 'postgres://from-secret/eaudit');
  assert.equal(env.JWT_SECRET, 'moi');
});

test('khóa lạ bị bỏ qua và được báo lại thay vì im lặng', async () => {
  resetAppSecretsStatusForTests();
  const env: NodeJS.ProcessEnv = {
    APP_SECRETS_ENABLED: 'true',
    APP_SECRETS_ARN: VALID_ARN,
    AWS_REGION: 'ap-southeast-1',
  };
  const result = await loadAppSecrets(env, async () =>
    JSON.stringify({ DATABASE_URL: 'postgres://x/y', DATABSE_URL: 'go-sai', PATH: '/khong-duoc-ghi-de' }),
  );
  assert.deepEqual(result?.appliedKeys, ['DATABASE_URL']);
  assert.deepEqual(result?.ignoredKeys, ['DATABSE_URL', 'PATH']);
  assert.equal(env.PATH, undefined, 'khóa ngoài danh sách không được ghi vào env');
});

test('payload không phải object JSON thì bị từ chối', () => {
  assert.throws(() => parseSecretPayload('khong-phai-json'), (err: AppSecretsError) => err.code === 'INVALID_PAYLOAD');
  assert.throws(() => parseSecretPayload('["a","b"]'), (err: AppSecretsError) => err.code === 'INVALID_PAYLOAD');
  assert.throws(() => parseSecretPayload('"chuoi"'), (err: AppSecretsError) => err.code === 'INVALID_PAYLOAD');
});

test('nạp lỗi thì ném ra để server dừng, không chạy tiếp với cấu hình cũ', async () => {
  resetAppSecretsStatusForTests();
  const env: NodeJS.ProcessEnv = {
    APP_SECRETS_ENABLED: 'true',
    APP_SECRETS_ARN: VALID_ARN,
    AWS_REGION: 'ap-southeast-1',
    DATABASE_URL: 'postgres://from-dotenv/eaudit',
  };
  await assert.rejects(
    loadAppSecrets(env, async () => {
      throw new Error('AccessDeniedException: user is not authorized');
    }),
    (err: AppSecretsError) => err.code === 'FETCH_FAILED',
  );
  assert.equal(env.DATABASE_URL, 'postgres://from-dotenv/eaudit', 'không được áp dụng nửa vời');
});

test('lỗi trả ra không lộ nguyên văn thông báo của AWS', async () => {
  resetAppSecretsStatusForTests();
  await assert.rejects(
    inspectAppSecret(VALID_ARN, 'ap-southeast-1', async () => {
      throw new Error('User: arn:aws:sts::532245541954:assumed-role/secret-role is not authorized');
    }),
    (err: AppSecretsError) => !/532245541954|assumed-role/.test(err.message),
  );
});

test('trạng thái chỉ phơi ra tên khóa, không có giá trị', async () => {
  resetAppSecretsStatusForTests();
  const env: NodeJS.ProcessEnv = {
    APP_SECRETS_ENABLED: 'true',
    APP_SECRETS_ARN: VALID_ARN,
    AWS_REGION: 'ap-southeast-1',
  };
  await loadAppSecrets(env, async () => JSON.stringify({ JWT_SECRET: 'v-ngam' }));
  const status = getAppSecretsStatus();
  assert.deepEqual(status.appliedKeys, ['JWT_SECRET']);
  assert.ok(!JSON.stringify(status).includes('v-ngam'), 'trạng thái không được chứa giá trị secret');
  assert.ok(status.loadedAt);
});

test('kiểm tra kết nối không làm thay đổi process.env đang chạy', async () => {
  resetAppSecretsStatusForTests();
  const before = process.env.JWT_SECRET;
  const result = await inspectAppSecret(VALID_ARN, 'ap-southeast-1', async () =>
    JSON.stringify({ JWT_SECRET: 'v-bo-qua', LA: 'x' }),
  );
  assert.deepEqual(result.appliedKeys, ['JWT_SECRET']);
  assert.deepEqual(result.ignoredKeys, ['LA']);
  assert.equal(process.env.JWT_SECRET, before);
});

test('danh sách khóa quản lý bao gồm các bí mật trọng yếu', () => {
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'SESSION_SECRET', 'SUPABASE_REALTIME_PRIVATE_KEY_BASE64']) {
    assert.ok(MANAGED_SECRET_KEYS.includes(key), `${key} phải nằm trong danh sách quản lý`);
  }
  const { ignoredKeys } = classifySecretKeys({ NODE_ENV: 'production' });
  assert.deepEqual(ignoredKeys, ['NODE_ENV'], 'không cho secret ghi đè biến vận hành ngoài danh sách');
});
