# Tailwind Native Build Dependency Design

## Problem

The Linux deployment failed while Vite loaded `@tailwindcss/vite` because
`@tailwindcss/oxide` could not load its platform-native binding. Tailwind v4 is
required by `client/src/styles/global.css`, so removing the plugin would break
the UI rather than fix the deployment. The first attempted repair declared the
Linux binding and included optional dependencies, but the EC2 bootstrap still
installed Node.js 18 while Oxide 4.3.3 requires Node.js 20 or newer. Because the
binding is optional, npm can omit the incompatible package and defer the failure
until Vite loads its configuration.

## Requirements

1. Root and client runtime contracts must require Node.js 22 or newer, and both
   EC2 bootstrap paths must install Node.js 22 LTS. Oxide itself requires 20+,
   but the application must not provision an older unsupported release.
2. Deployment and setup must reject an older Node.js runtime before `npm ci` so
   npm cannot silently omit an incompatible optional native package.
3. A clean Linux x64 GNU client install must include the matching Oxide binding.
4. Deployment and first-time setup must explicitly include optional packages,
   even when the host has an npm configuration that omits them by default.
5. Client builds must load-check Oxide before Vite and return a bounded,
   actionable error without exposing paths or environment values.
6. The package manifest, lockfile, deployment scripts, maintenance guidance,
   and regression test must remain coupled.

## Verification

- Run `node --test scripts/clientBuildDependencies.test.js`.
- Run `node scripts/verify-node-version.mjs` and confirm the test suite rejects
  a simulated Node.js 18 version.
- Run `node client/scripts/verify-build-dependencies.mjs`.
- From `client`, run a clean `npm ci --include=dev --include=optional` followed
  by `npm run build` on Linux or in the deployment environment.
- Run `npm run docs:check`, backend/frontend type-checks, `git diff --check`,
  and the maintenance harness with this specification.
