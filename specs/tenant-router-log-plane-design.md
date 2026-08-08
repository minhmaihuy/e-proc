# Feature: Tenant router isolation and tenant issue log plane

> Historical design note: login routing in this document was superseded by
> `split-login-boundaries-design.md`. Tenant roles now use `/admin/login`, while
> superadmin uses `/tenant/login`; backend endpoints enforce the same split.

## Requirements

- While a superadmin is authenticated, when it opens the control application, the system shall serve tenant management at `/tenants` and deny every tenant assessment route.
- While an `admin` or `tenant_admin` is authenticated, when it uses `/admin/questions` or another audit administration route, the system shall allow access only if the account tenant slug matches the current server `TENANT_SLUG`.
- While a tenant administrator manages users, the system shall limit every identity read/write to that administrator's tenant and shall not allow superadmin through the tenant user API.
- When a control-plane request is handled, the system shall access only the control database for tenant configuration, provisioning jobs, audit events, and identities.
- When a tenant audit request is handled, the system shall access only that tenant server's assessment data database after server-side tenant authorization.
- When a tenant HTTP request finishes with status 400 or greater, the system shall append a redacted operational issue to the tenant's separate log database.
- While a tenant `admin` reviews issues, the system shall return only rows whose `tenant_slug` matches its JWT and the current server and shall reject lifecycle mutations.
- While a `tenant_admin` manages issues, the system shall resolve, reopen, archive, or restore only rows whose `tenant_slug` matches its JWT and the current server; archive shall retain immutable event content.
- When the log database is initialized, the system shall bind it immutably to the current tenant; legacy or conflicting tenant databases shall fail startup rather than mix logs.

## Architecture

### Frontend

- `/tenants`: superadmin-only global control-plane page.
- `/admin`: shared login. Superadmin redirects to `/tenants`; `admin` and `tenant_admin` redirect to `/admin/dashboard`.
- `/admin/questions`, batches, Practice, results, settings, dashboard, and `/admin/issues`: current-tenant audit administration.
- `/admin/users`: `tenant_admin` only, scoped to the current tenant.
- `/admin/tenants` remains only as a client redirect to `/tenants`; `/admin/tenant` is removed.
- Superadmin navigation contains only tenant control and sign-out; it never renders assessment links.

### Backend

- Mount tenant control API at `/api/tenants`; every route uses `authMiddleware` then `requireSuperAdmin` before control queries.
- `requireTenantDataAdmin` accepts only roles `admin` and `tenant_admin`, requires tenant id/slug, and requires slug equality with `getCurrentTenantConfig().slug`. It explicitly rejects superadmin.
- Apply `requireTenantDataAdmin` before every assessment, queue, cache, diagnostic, and tenant issue-list endpoint. Apply `requireTenantLogManager` before every tenant issue lifecycle mutation.
- Tenant user CRUD uses `requireTenantUserManager`, accepting only `tenant_admin`; SQL remains tenant-scoped.
- Keep authentication and password change in the control database because identities are global control metadata.

### Log database

- Add `src/server/db/logPlane.ts` with independent PostgreSQL `LOG_DATABASE_URL` or local SQLite `data/tenant-logs.db`; it never falls back to either other database connection.
- `tenant_issue_logs` stores one row per issue: tenant slug, severity, source, code, safe message, HTTP status/method/path, request id, actor type/id, lifecycle status, resolution/archive metadata, last-management actor/time, and timestamps.
- `log_plane_metadata` binds a log database to one tenant slug.
- Request middleware assigns `X-Request-Id` and asynchronously records every tenant request ending in HTTP 4xx/5xx. It skips `/api/tenants` control requests and never stores request bodies, headers, tokens, query strings, stack traces, credentials, or provisioning secrets.
- `GET /api/admin/issues` validates status/severity/limit filters and scopes by trusted JWT tenant slug.
- `PUT /api/admin/issues/:id/status` lets only a matching `tenant_admin` resolve, reopen, archive, or restore an issue in the trusted tenant and records the managing account and time. `PUT /:id/resolve` remains a protected compatibility alias.
- No endpoint edits issue content or physically deletes issue evidence.

## Security checkpoint

- Authentication: signed admin JWT followed by a control-database account reload.
- Authorization: separate superadmin and tenant-data middleware; frontend routes are UX only.
- Tenant isolation: trusted JWT tenant must match immutable server data/log-plane tenant; every issue query also filters tenant slug.
- Input validation: bounded enum filters, integer ids/limits, no client-provided tenant slug.
- Output: issue API returns only predefined columns and parsed safe metadata.
- Logging: no body/header/query/stack/secret capture; message and metadata lengths are bounded.
- SQL: portable parameterized `?` placeholders only.
- Failure behavior: all three databases initialize before the server listens; a configured unavailable log DB fails startup.

## Implementation plan

- [x] Add route/RBAC guards and move tenant control API/UI to `/tenants`.
- [x] Add log-plane adapter, immutable binding, issue service, and request middleware.
- [x] Add tenant issue APIs and Issue Log UI.
- [x] Restrict tenant users and assessment diagnostics to tenant roles.
- [x] Update environment/Terraform propagation and maintenance rules.
- [x] Add authorization, connection-selection, binding, and safe-log-payload tests.
- [x] Run tenant tests, backend/frontend type-checks, frontend production build, and static checks. Localhost role smoke and Terraform CLI validation remain deployment-environment checks because no seeded role fixtures/Terraform executable are available in this workspace session.

## Acceptance criteria

- Superadmin receives 403 from `/api/admin/questions` and can access `/api/tenants`.
- Tenant `admin` and `tenant_admin` for FSA-CLS can access `/api/admin/questions`; an account for another tenant receives 403 before assessment DB access.
- `/tenants` is the only tenant control UI; tenant admins cannot open it.
- Superadmin cannot access `/api/admin/issues` or tenant user endpoints. It may observe safe selected-tenant issues read-only through `/api/tenants/:id/issues` without gaining mutation or assessment access.
- A tenant 4xx/5xx response creates a row only in that tenant's log database.
- Issue reads and lifecycle mutations are tenant-scoped and cannot accept a tenant slug from the client. Regular `admin` is read-only; only `tenant_admin` may mutate lifecycle state.
- Local assessment, control, and issue data reside in three separate files.

## Rollback

- Revert the release; assessment and control schemas are not deleted or moved.
- The new log database can remain unused after rollback because it has no foreign-key dependency on either existing database.
- `/admin/tenants` client redirect can be restored to the previous page without data migration.
