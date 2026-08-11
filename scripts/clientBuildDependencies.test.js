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
