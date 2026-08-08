# Feature: FSA-CLS control-plane/data-plane separation

## Requirements

- While upgrading an existing installation, when the application initializes, the system shall preserve all assessment data in `DATABASE_URL` and bind that database to tenant `fsa-cls`.
- While a separate `CONTROL_DATABASE_URL` is configured, the system shall store administrative identities, tenant configuration, provisioning jobs, and tenant audit events only through the control-plane connection.
- When legacy control-plane tables contain current FSA accounts/configuration, the migration shall copy them idempotently, map legacy tenant slug `fsa` to `fsa-cls`, and preserve password hashes.
- When no separate control database is configured in production, the system shall keep a backward-compatible shared-PostgreSQL mode and emit an explicit warning.
- When running locally without PostgreSQL, the system shall use `data/eaudit.db` for FSA-CLS assessment data and `data/control-plane.db` for control data.
- When a superadmin opens tenant management, the UI shall show the global control plane separately from the assessment dashboard.
- When a tenant administrator opens tenant settings, the UI shall show only its own tenant workspace.
- When an admin or superadmin opens the assessment dashboard, the UI shall display the current data-plane tenant `fsa-cls`.

## Architecture

### Frontend

- Keep `/admin/tenants` as the superadmin-only global control plane.
- Add `/admin/tenant` as the tenant-admin-only workspace, reusing the tenant configuration component in workspace mode.
- Update login redirects, navigation, and `PrivateRoute` role guards.
- Persist server/data-plane tenant context from login and display it on `AdminDashboard`.

### Backend

- Add `src/server/db/controlPlane.ts` with an independent PostgreSQL/SQLite connection and portable `?` query adapter.
- Keep `src/server/db/postgres.ts` as the assessment data-plane connection.
- Route admin authentication/user CRUD, tenant routes, and tenant provisioner state to the control-plane adapter.
- Initialize data plane first, then control-plane schema/migration, then cache/queue.
- Add an idempotent data-plane identity marker for `fsa-cls`.
- Refuse startup if an existing data-plane marker belongs to a different tenant; only legacy `fsa` may normalize to `fsa-cls`.
- Default tenant resolution to slug `fsa-cls`, name `FSA CLS`.

### Migration

1. Initialize assessment schema in the existing database.
2. Initialize control-plane tables in `CONTROL_DATABASE_URL` or local `control-plane.db`.
3. If control-plane identities are empty, copy legacy `admin_users` with ids/password hashes.
4. If control-plane tenants are empty, copy legacy tenants/jobs/audit; map legacy `fsa` to `fsa-cls`.
5. Ensure an approved/active `fsa-cls` tenant exists.
6. Assign legacy current-tenant non-superadmins to `fsa-cls`; leave users of other explicit tenants unchanged.
7. Reset PostgreSQL sequences after explicit-id copies.
8. Keep legacy control tables in the data database for rollback; all runtime control writes use the new adapter.

## Security

- Authenticate admin JWTs against the control database on every request.
- Keep tenant/admin ownership enforcement server-side; UI separation is not authorization.
- Use parameterized queries for both connections.
- Do not copy or log plaintext passwords, connection strings, secret values, or private keys.
- Preserve bcrypt hashes exactly during migration.
- Restrict migration to the four control table groups and make it idempotent.
- Fail startup if control-plane initialization fails; do not silently authenticate against stale data after a configured control DB becomes unavailable.
- Keep assessment data inaccessible from tenant-management endpoints.

## Acceptance criteria

- Existing local assessment rows remain in `data/eaudit.db`; new control rows are in `data/control-plane.db`.
- Provisioned tenant secrets provide both the tenant-specific `DATABASE_URL` and global `CONTROL_DATABASE_URL`.
- Existing non-superadmin users attached to legacy FSA authenticate with tenant slug `fsa-cls` and unchanged passwords.
- Superadmin remains global and can access `/admin/tenants`.
- Tenant admin is redirected to `/admin/tenant` and cannot access `/admin/tenants` or assessment-management routes.
- Dashboard visibly identifies FSA CLS for current assessment data.
- Tenant routes and provisioner no longer query the data-plane DB.
- Existing tenant/compiler/provisioner tests and both TypeScript builds pass; new control-plane tests cover default configuration and slug migration.

## Rollback

- Remove `CONTROL_DATABASE_URL` to use backward-compatible shared PostgreSQL mode, or restore the previous release.
- Legacy control tables are retained in the data database during this migration.
- No assessment table or row is deleted or moved by application startup.
