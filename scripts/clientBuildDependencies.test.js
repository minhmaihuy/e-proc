import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('client declares and locks the Linux Tailwind native binding', async () => {
  const packageJson = JSON.parse(await read('client/package.json'));
  const packageLock = JSON.parse(await read('client/package-lock.json'));

  assert.equal(packageJson.optionalDependencies['@tailwindcss/oxide-linux-x64-gnu'], '4.3.3');
  assert.equal(
    packageLock.packages[''].optionalDependencies['@tailwindcss/oxide-linux-x64-gnu'],
    '4.3.3',
  );
  assert.ok(packageLock.packages['node_modules/@tailwindcss/oxide-linux-x64-gnu']);
  assert.match(packageJson.scripts.build, /deps:verify/);
});

test('deployment installs optional packages and verifies client native dependencies', async () => {
  for (const path of ['deploy/scripts/deploy.sh', 'deploy/scripts/setup.sh']) {
    const script = await read(path);
    assert.match(script, /npm ci[^\n]*--include=optional/);
    const clientInstall = script.lastIndexOf('npm ci');
    const clientVerify = script.lastIndexOf('npm run deps:verify');
    const clientBuild = script.lastIndexOf('npm run build');
    assert.ok(clientInstall < clientVerify && clientVerify < clientBuild);
  }
});
