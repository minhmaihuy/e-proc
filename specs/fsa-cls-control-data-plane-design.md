# Feature: FSA-CLS control-plane/data-plane separation

## Requirements

- While upgrading an existing installation, when the application initializes, the system shall preserve all assessment data in `DATABASE_URL` and bind that database to tenant `fsa-cls`.
- While a separate `CONTROL_DATABASE_URL` is configured, the system shall store global superadmin identity, tenant configuration, provisioning jobs, and tenant audit events through the control-plane connection; tenant `admin`/`tenant_admin` identities belong to each tenant assessment database.
- When legacy control-plane tables contain current FSA tenant accounts, the migration shall copy them once into the FSA assessment database with IDs/password hashes preserved and fail safely on ID or username conflicts.
- When no separate control database is configured in production, the system shall keep a backward-compatible shared-PostgreSQL mode and emit an explicit warning.
- When running locally without PostgreSQL, the system shall use `data/eaudit.db` for FSA-CLS assessment data and `data/control-plane.db` for control data.
- When a superadmin opens tenant management, the UI shall show the global control plane separately from the assessment dashboard.
- When a tenant administrator opens tenant settings, the UI shall show only its own tenant workspace.
- When an admin or superadmin opens the assessment dashboard, the UI shall display the current data-plane tenant `fsa-cls`.
- When assessment rows record an admin owner, the system shall enforce a foreign key to the tenant-local `admin_users` table.

## Architecture

### Frontend

- Keep `/admin/tenants` as the superadmin-only global control plane.
- Add `/admin/tenant` as the tenant-admin-only workspace, reusing the tenant configuration component in workspace mode.
- Update login redirects, navigation, and `PrivateRoute` role guards.
- Persist server/data-plane tenant context from login and display it on `AdminDashboard`.

### Backend

- Add `src/server/db/controlPlane.ts` with an independent PostgreSQL/SQLite connection and portable `?` query adapter.
- Keep `src/server/db/postgres.ts` as the assessment data-plane connection.
- Route superadmin authentication, tenant settings, and provisioner state to the control-plane adapter; route tenant login/password/user CRUD to the assessment adapter.
- Initialize data plane, then control-plane settings, then one-time tenant-identity migration and ownership FKs, then log-plane/cache/queue.
- Add an idempotent data-plane identity marker for `fsa-cls`.
- Refuse startup if an existing data-plane marker belongs to a different tenant; only legacy `fsa` may normalize to `fsa-cls`.
- Default tenant resolution to slug `fsa-cls`, name `FSA CLS`.
- Keep assessment ownership columns (`question_bank.uploaded_by`, `batches.created_by`) as foreign keys to tenant-local `admin_users`; never point them at control-plane identities.

### Migration

1. Initialize assessment schema in the existing database.
2. Initialize control-plane tables in `CONTROL_DATABASE_URL` or local `control-plane.db`.
3. If control-plane superadmin identities are empty, copy/seed only the global superadmin there.
4. If control-plane tenants are empty, copy legacy tenants/jobs/audit; map legacy `fsa` to `fsa-cls`.
5. Ensure an approved/active `fsa-cls` tenant exists.
6. Copy current-tenant `admin`/`tenant_admin` rows from the legacy control source into the tenant data-plane once, preserving IDs and hashes; mark completion in `data_plane_metadata`.
7. Reset the tenant `admin_users` PostgreSQL sequence after explicit-ID copies.
8. Install `uploaded_by`/`created_by` FKs only after tenant identities exist; reject orphan ownership IDs without deleting them.
9. Keep legacy control rows for rollback/bootstrap compatibility, but never use them for tenant login/session/CRUD after migration.

## Security

- Reload superadmin JWTs from control; reload tenant admin JWTs from the current assessment database and combine them with tenant status/capabilities read separately from control.
- Keep tenant/admin ownership enforcement server-side; UI separation is not authorization.
- Use parameterized queries for both connections.
- Do not copy or log plaintext passwords, connection strings, secret values, or private keys.
- Preserve bcrypt hashes exactly during migration.
- Make tenant identity migration one-time, transactional in the data-plane, ID-preserving, and conflict-failing.
- Fail startup if control-plane initialization fails; do not silently authenticate against stale data after a configured control DB becomes unavailable.
- Keep assessment data inaccessible from tenant-management endpoints.

## Acceptance criteria

- Existing local assessment rows remain in `data/eaudit.db`; new control rows are in `data/control-plane.db`.
- Provisioned tenant secrets provide both the tenant-specific `DATABASE_URL` and global `CONTROL_DATABASE_URL`.
- Existing non-superadmin users attached to legacy FSA authenticate from `eaudit` with unchanged IDs/passwords.
- Superadmin remains global and can access `/admin/tenants`.
- Tenant admin is redirected to `/admin/tenant` and cannot access `/admin/tenants` or assessment-management routes.
- Dashboard visibly identifies FSA CLS for current assessment data.
- Tenant routes and provisioner no longer query the data-plane DB.
- Existing tenant/compiler/provisioner tests and both TypeScript builds pass; new control-plane tests cover default configuration and slug migration.
- Question import and batch creation satisfy tenant-local ownership FKs for the authenticated tenant account.

## Rollback

- Remove `CONTROL_DATABASE_URL` to use backward-compatible shared PostgreSQL mode, or restore the previous release.
- Legacy control tables are retained in the data database during this migration.
- No assessment table or row is deleted or moved by application startup.
