# Feature: Superadmin tenant log observation and subdomain isolation

## Requirements (EARS)

- While a superadmin is authenticated, when it selects a tenant at `/tenants`, the system shall load that tenant's operational issue logs through a superadmin-only, read-only control-plane endpoint.
- While the selected tenant is the current server tenant, when logs are requested, the system shall query the initialized local log-plane database and filter by the selected tenant slug.
- While the selected tenant runs on another server/subdomain, when logs are requested, the system shall retrieve that tenant's `LOG_DATABASE_URL` from its configured AWS Secrets Manager secret, query the tenant log database through a short-lived connection, and close the connection after the request.
- When any superadmin log query executes, the system shall filter by the tenant slug loaded from the control database and shall never accept a tenant slug or database URL from the client.
- When log access fails, the system shall return a bounded, non-sensitive error and shall not expose credentials, secret values, database URLs, headers, tokens, stack traces, or tenant assessment data.
- While a superadmin reviews tenant logs, the system shall not allow it to resolve, delete, or mutate issue rows; tenant `admin` and `tenant_admin` retain ownership of `/api/admin/issues` within their tenant server.
- While a tenant `admin` reviews its tenant log plane, the system shall allow read-only access and shall reject every lifecycle mutation.
- While a `tenant_admin` manages its tenant log plane, the system shall allow resolve, reopen, archive, and restore only for rows whose `tenant_slug` matches the authenticated tenant and current server.
- When a tenant issue is archived, the system shall retain the immutable issue content and record the acting tenant administrator and timestamp instead of physically deleting operational evidence.
- When a tenant is created, approved, or provisioned, the system shall derive and enforce a dedicated domain in the form `epoc.<tenant-label>.devfasttrack.com`; as a temporary compatibility exception, `fsa-cls` uses `https://epoc.devfasttrack.com/`. A configuration update is a validation-free draft save and may preserve a legacy-invalid infrastructure value until approval.
- When an existing FSA-CLS control-plane row contains a known previous E-POC domain, startup shall migrate only that known legacy domain/app URL to `epoc.devfasttrack.com` without changing assessment or log data.
- When a future maintenance changeset is validated, the project harness command shall accept `--spec <file>`, validate that the specification exists, and include its path in static and pending judge output.

## Architecture

### Frontend

- Extend `TenantManagement.tsx` with a read-only "Operational logs" section tied to the selected tenant.
- Load `GET /api/tenants/:id/issues` whenever selection or filters change; expose status/severity filters, loading, empty, failure, and manual refresh states.
- Render only safe issue fields already exposed by the tenant issue API. Do not add resolve/delete controls.
- Show the selected tenant's dedicated HTTPS URL and keep the existing tenant selection as the source of the log request tenant id.

### Backend

- Add `GET /api/tenants/:id/issues` beneath the router-wide `authMiddleware` and `requireSuperAdmin` guards.
- Validate positive integer tenant id, status/severity enums, and a 1-200 limit before database access.
- Derive tenant domains from trusted slugs and reject control-plane configuration that does not exactly match `epoc.<tenant-label>.devfasttrack.com` or the FSA-CLS-only `epoc.devfasttrack.com` exception.
- Load only `id`, `slug`, `secret_arn`, `aws_region`, and domain/application URL fields from the global control database.
- Add a tenant log reader service. For the current tenant, delegate to `logPlane.ts`; for a remote tenant, use AWS Secrets Manager and a PostgreSQL pool limited to one connection, one request, and a short timeout.
- Parameterize every filter and map rows through one explicit public issue serializer shared with the tenant issue route.
- Keep `GET /api/admin/issues` available to matching `admin` and `tenant_admin`; protect every status mutation with a dedicated `tenant_admin` log-manager guard.
- Add `archived` lifecycle state plus `archived_by` and `archived_at` metadata through idempotent SQLite/PostgreSQL initialization. Preserve existing issue content and resolution metadata.

### Security

- Authentication and authorization are server-side and run before tenant lookup or secret access.
- The client supplies only control-plane tenant id and bounded filters. Tenant slug and secret ARN come from the control database.
- Remote secret JSON must contain a valid PostgreSQL `LOG_DATABASE_URL`; the value is never persisted in the control database, API response, audit detail, or application log.
- Remote queries are `SELECT` only and always include `tenant_slug = $1`. The pool is closed in `finally`.
- Tenant `/api/admin/issues` remains inaccessible to superadmin and remains the only issue mutation surface.
- Regular tenant `admin` is read-only. Only `tenant_admin` may mutate issue lifecycle, and every update includes both issue id and trusted tenant slug in parameterized SQL.
- Operational logging must not recursively log `/api/tenants` failures into a selected tenant's log database.
- Deployment must grant the control-plane runtime `secretsmanager:GetSecretValue` only for managed tenant secret ARNs and network reachability to tenant log databases.
- Terraform shall reject domain inputs outside `epoc.devfasttrack.com` and `epoc.<tenant-label>.devfasttrack.com`; backend create/approval/provisioning validation additionally binds the exact domain or FSA exception to the trusted slug, while draft update performs no business/infrastructure validation.

## Implementation plan

- [x] Add reusable issue filter/serialization helpers.
- [x] Add remote/local tenant log reader with dependency-injected tests.
- [x] Add guarded tenant issue observation endpoint.
- [x] Add selected-tenant log UI and API client method.
- [x] Add tenant-admin-only resolve/reopen/archive/restore lifecycle management and read-only regular-admin UI.
- [x] Require the standardized tenant domain before tenant approval, migrate the known FSA legacy values, and document the temporary `epoc.devfasttrack.com` exception.
- [x] Add durable harness `--spec` support and project maintenance command.
- [x] Update `AGENTS.md` and `D:\Codex-Skills\e-proc-platform` references.
- [x] Run tenant tests, backend/frontend type-checks, production build, diff checks, and the harness with this specification. Terraform CLI validation remains unavailable on this workstation.

## Acceptance criteria

- A superadmin can select FSA-CLS and view only `fsa-cls` rows from its log database.
- A superadmin can select a remote tenant and view only that tenant's rows when its secret and database are reachable.
- A missing/malformed secret or unavailable remote database returns a safe operational error without leaking the ARN value, connection string, or secret payload.
- Tenant admins continue to list and resolve their own issues through `/api/admin/issues`; superadmin receives 403 there.
- Non-superadmin users receive 403 from `/api/tenants/:id/issues` before secret or log database access.
- The superadmin endpoint has no mutation method and the UI has no resolve/delete action.
- A regular tenant `admin` can list logs but receives 403 from lifecycle mutations.
- A matching `tenant_admin` can resolve, reopen, archive, and restore its own tenant rows; cross-tenant ids cannot be changed.
- Archive preserves the row and records `archived_by`/`archived_at`; immutable issue content cannot be edited through any API.
- Tenant creation derives its domain from the slug, mismatched domain configuration is rejected, and FSA-CLS resolves to `https://epoc.devfasttrack.com/`.
- Running the code harness with `--spec specs/superadmin-tenant-log-observation-design.md` succeeds at argument parsing and records the exact resolved spec path for agent review.

## Rollback

- Remove the read-only endpoint, reader service, and UI section; existing tenant issue recording and tenant-admin issue management remain unchanged.
- Revoke the control-plane Secrets Manager read permission. No database migration or copied log data requires rollback.
- Revert the approval-domain validation only if the deployment process intentionally supports tenants without dedicated subdomains.
