import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  UnsupportedNodeVersionError,
  verifyNodeVersion,
} from './verify-node-version.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('client declares and locks the Linux Tailwind native binding', async () => {
  const rootPackageJson = JSON.parse(await read('package.json'));
  const rootPackageLock = JSON.parse(await read('package-lock.json'));
  const packageJson = JSON.parse(await read('client/package.json'));
  const packageLock = JSON.parse(await read('client/package-lock.json'));

  assert.equal(rootPackageJson.engines.node, '>=22.0.0');
  assert.equal(rootPackageLock.packages[''].engines.node, '>=22.0.0');
  assert.equal(packageJson.engines.node, '>=22.0.0');
  assert.equal(packageLock.packages[''].engines.node, '>=22.0.0');
  assert.equal(packageJson.optionalDependencies['@tailwindcss/oxide-linux-x64-gnu'], '4.3.3');
  assert.equal(
    packageLock.packages[''].optionalDependencies['@tailwindcss/oxide-linux-x64-gnu'],
    '4.3.3',
  );
  assert.ok(packageLock.packages['node_modules/@tailwindcss/oxide-linux-x64-gnu']);
  assert.match(packageJson.scripts.build, /deps:verify/);
  assert.match(packageJson.scripts['deps:verify'], /verify-node-version/);
});

test('runtime gate rejects unsupported Node releases before optional dependencies are installed', () => {
  assert.throws(() => verifyNodeVersion('18.20.8'), UnsupportedNodeVersionError);
  assert.throws(() => verifyNodeVersion('20.20.0'), UnsupportedNodeVersionError);
  assert.equal(verifyNodeVersion('22.0.0'), '22.0.0');
  assert.equal(verifyNodeVersion('24.14.0'), '24.14.0');
});

test('deployment installs optional packages and verifies client native dependencies', async () => {
  for (const path of ['deploy/scripts/deploy.sh', 'deploy/scripts/setup.sh']) {
    const script = await read(path);
    assert.match(script, /npm ci[^\n]*--include=optional/);
    const runtimeVerify = script.indexOf('node scripts/verify-node-version.mjs');
    const firstInstall = script.indexOf('npm ci');
    assert.ok(runtimeVerify >= 0 && runtimeVerify < firstInstall);
    const clientInstall = script.lastIndexOf('npm ci');
    const clientVerify = script.lastIndexOf('npm run deps:verify');
    const clientBuild = script.lastIndexOf('npm run build');
    assert.ok(clientInstall < clientVerify && clientVerify < clientBuild);
  }
});

test('EC2 bootstrap installs a supported Node.js release', async () => {
  for (const path of ['terraform/userdata.sh', 'terraform/tenant-instance/user-data.sh.tftpl']) {
    const userdata = await read(path);
    assert.match(userdata, /setup_22\.x/);
    assert.doesNotMatch(userdata, /setup_(?:18|20)\.x/);
  }
});

/**
 * Giá trị bí mật trong .env do bootstrap sinh ra phải được bọc nháy kép.
 *
 * `dotenv` coi `#` là bắt đầu comment và cắt bỏ phần sau nó khi giá trị không được
 * trích dẫn. Mật khẩu `Abc12345#2nf` vì thế bị ứng dụng đọc thành `Abc12345` và băm
 * đúng phần cụt đó, trong khi người dùng gõ nguyên chuỗi nên không đăng nhập được.
 * Không có lỗi nào được in ra: seed chạy xong, tài khoản tồn tại, chỉ là mật khẩu
 * không phải cái ai cũng nghĩ. Đã xảy ra thật ngày 2026-08-14 trên production.
 */
test('bootstrap .env bọc nháy kép mọi giá trị bí mật', async () => {
  const source = await read('terraform-ipv6/userdata.sh');
  const secretKeys = [
    'GEMINI_API_KEY',
    'JWT_SECRET',
    'SESSION_SECRET',
    'SUPERADMIN_PASSWORD',
    'FSA_TENANT_ADMIN_PASSWORD',
  ];
  const unquoted = [];
  for (const key of secretKeys) {
    const line = source.split('\n').find((l) => l.startsWith(`${key}=`));
    assert.ok(line, `userdata.sh không còn ghi ${key}`);
    if (!/^[A-Z_]+="\$\{[a-z_]+\}"$/.test(line.trim())) unquoted.push(key);
  }
  assert.deepEqual(
    unquoted,
    [],
    'giá trị không bọc nháy kép sẽ bị dotenv cắt tại dấu # mà không báo lỗi',
  );
});

test('mật khẩu seed và jwt_secret bị chặn khi chứa ký tự phá cú pháp', async () => {
  // Bọc nháy kép giữ được `#`, nhưng `"` và `\` lại phá chính lớp bọc đó. Chặn ở
  // plan để hỏng ngay, thay vì sinh ra .env sai rồi mới phát hiện lúc đăng nhập.
  const variables = await read('terraform-ipv6/variables.tf');
  for (const name of ['superadmin_password', 'fsa_tenant_admin_password', 'jwt_secret']) {
    // Cắt đúng khối `variable "<name>" { ... }` rồi soi bên trong, thay vì dựng regex
    // khớp cả biểu thức Terraform — chuỗi đó chứa nháy kép và gạch chéo ngược nên phải
    // escape qua ba tầng và rất dễ viết sai thành test luôn xanh.
    const start = variables.indexOf(`variable "${name}" {`);
    assert.ok(start >= 0, `không tìm thấy biến ${name}`);
    const block = variables.slice(start, variables.indexOf('\n}\n', start));

    assert.ok(
      block.includes('!can(regex('),
      `thiếu validate chặn ký tự phá cú pháp cho ${name}`,
    );
  }
});
