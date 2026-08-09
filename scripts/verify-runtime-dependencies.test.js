import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REQUIRED_RUNTIME_MODULES,
  RuntimeDependencyError,
  verifyRuntimeDependencies,
} from './verify-runtime-dependencies.mjs';

test('base64-js remains an explicit locked production dependency', () => {
  const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

  assert.equal(packageManifest.dependencies['base64-js'], '1.5.1');
  assert.equal(packageLock.packages[''].dependencies['base64-js'], '1.5.1');
  assert.equal(packageLock.packages['node_modules/base64-js'].version, '1.5.1');
});

test('critical transitive runtime dependencies resolve and load from a clean root install', () => {
  assert.deepEqual(verifyRuntimeDependencies(), [...REQUIRED_RUNTIME_MODULES]);
});

test('runtime dependency verifier checks resolve and load for every named module', () => {
  const events = [];
  const verified = verifyRuntimeDependencies(
    ['first-module', 'second-module'],
    (moduleName) => { events.push(`resolve:${moduleName}`); return moduleName; },
    (moduleName) => { events.push(`load:${moduleName}`); return {}; },
  );
  assert.deepEqual(verified, ['first-module', 'second-module']);
  assert.deepEqual(events, [
    'resolve:first-module',
    'load:first-module',
    'resolve:second-module',
    'load:second-module',
  ]);
});

test('runtime dependency failures identify only the module and hide loader details', () => {
  assert.throws(
    () => verifyRuntimeDependencies(
      ['base64-js'],
      () => { throw new Error('/opt/eaudit/app/private/install/detail'); },
      () => ({}),
    ),
    (error) => error instanceof RuntimeDependencyError
      && error.moduleName === 'base64-js'
      && !error.message.includes('/opt/eaudit'),
  );
});
