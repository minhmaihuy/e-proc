import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const runtimeRequire = createRequire(import.meta.url);

export const REQUIRED_RUNTIME_MODULES = Object.freeze([
  'base64-js',
  'mammoth',
]);

export class RuntimeDependencyError extends Error {
  constructor(moduleName) {
    super(`Required runtime dependency '${moduleName}' is missing or cannot be loaded.`);
    this.name = 'RuntimeDependencyError';
    this.moduleName = moduleName;
  }
}

export function verifyRuntimeDependencies(
  moduleNames = REQUIRED_RUNTIME_MODULES,
  resolveModule = runtimeRequire.resolve,
  loadModule = runtimeRequire,
) {
  for (const moduleName of moduleNames) {
    try {
      resolveModule(moduleName);
      loadModule(moduleName);
    } catch {
      throw new RuntimeDependencyError(moduleName);
    }
  }
  return [...moduleNames];
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const verified = verifyRuntimeDependencies();
    console.log(`[deps:verify] Verified ${verified.length} critical runtime dependencies.`);
  } catch (error) {
    if (error instanceof RuntimeDependencyError) {
      console.error(`[deps:verify] ${error.message}`);
    } else {
      console.error('[deps:verify] Runtime dependency verification failed.');
    }
    process.exitCode = 1;
  }
}
