import { pathToFileURL } from 'node:url';

export const MINIMUM_NODE_MAJOR = 22;

export class UnsupportedNodeVersionError extends Error {
  constructor(version) {
    super(
      `Node.js ${MINIMUM_NODE_MAJOR}+ is required; found ${version}. `
      + 'Upgrade Node.js before installing dependencies; the supported deployment runtime is Node.js 22 or newer.',
    );
    this.name = 'UnsupportedNodeVersionError';
    this.version = version;
  }
}

export function verifyNodeVersion(version = process.versions.node) {
  const match = /^v?(\d+)(?:\.|$)/.exec(version);
  const major = match ? Number.parseInt(match[1], 10) : Number.NaN;

  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) {
    throw new UnsupportedNodeVersionError(version);
  }

  return version;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    const version = verifyNodeVersion();
    console.log(`[runtime:verify] Node.js ${version} satisfies the ${MINIMUM_NODE_MAJOR}+ requirement.`);
  } catch (error) {
    if (error instanceof UnsupportedNodeVersionError) {
      console.error(`[runtime:verify] ${error.message}`);
    } else {
      console.error('[runtime:verify] Unable to verify the Node.js runtime version.');
    }
    process.exitCode = 1;
  }
}
