# Runtime Dependency Preflight Design

## Purpose

Prevent an incomplete or stale production install from replacing the healthy PM2 process and causing an origin 502 such as `Cannot find module 'base64-js'`.

## Requirements

- `base64-js` shall be an explicit production dependency at an exact version in both `package.json` and `package-lock.json`.
- The root runtime dependency preflight shall resolve and load `base64-js` and `mammoth`, its direct application consumer.
- Both EC2 setup and deploy flows shall run the preflight immediately after the deterministic root install and before backend build, database work, frontend build, or PM2 replacement.
- A missing or unloadable dependency shall stop deployment with a non-zero status.
- Failure output shall identify only the affected module and shall not expose loader paths, registry details, environment values, stack traces, or secrets.
- The preflight shall not read, mutate, or migrate assessment, control-plane, or tenant log-plane data.

## Acceptance evidence

- Unit tests load the real configured modules, prove every configured module is resolved and loaded, verify manifest/lockfile consistency, and verify sanitized failure output.
- The preflight command succeeds against the installed root dependency tree.
- Backend TypeScript compilation and the tenant regression suite pass.
- Both deployment scripts pass shell syntax validation.
- The full maintenance harness runs against this specification with no error-level violations.
