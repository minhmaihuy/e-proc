# Tailwind Native Build Dependency Design

## Problem

The Linux deployment failed while Vite loaded `@tailwindcss/vite` because
`@tailwindcss/oxide` could not load its platform-native binding. Tailwind v4 is
required by `client/src/styles/global.css`, so removing the plugin would break
the UI rather than fix the deployment.

## Requirements

1. A clean Linux x64 GNU client install must include the matching Oxide binding.
2. Deployment and first-time setup must explicitly include optional packages,
   even when the host has an npm configuration that omits them by default.
3. Client builds must load-check Oxide before Vite and return a bounded,
   actionable error without exposing paths or environment values.
4. The package manifest, lockfile, deployment scripts, maintenance guidance,
   and regression test must remain coupled.

## Verification

- Run `node --test scripts/clientBuildDependencies.test.js`.
- Run `node client/scripts/verify-build-dependencies.mjs`.
- From `client`, run a clean `npm ci --include=dev --include=optional` followed
  by `npm run build` on Linux or in the deployment environment.
- Run `npm run docs:check`, backend/frontend type-checks, `git diff --check`,
  and the maintenance harness with this specification.
