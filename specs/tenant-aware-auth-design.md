# Feature: Tenant-aware admin authentication and user management

## Requirements

- While an administrator account is not a superadmin, when it signs in, the
  system shall resolve and embed exactly one tenant in its session.
- While legacy accounts have no tenant, when the database starts, the system
  shall attach them to the current/default tenant (`FSA` when no tenant is
  configured).
- While a superadmin is signed in, when user management is opened, the system
  shall show users across all tenants and allow an explicit tenant assignment.
- While a tenant administrator is signed in, when user management is opened,
  the system shall show and mutate only accounts in that administrator's tenant.
- While a tenant is suspended, when one of its accounts signs in, the system
  shall deny access without issuing a JWT.

## Architecture

### Frontend

- `AuthContext` stores `tenantId`, `tenantSlug`, and `tenantName` returned by
  login and clears all tenant session fields on logout/expiry.
- `UserManagement` is available to `superadmin` and `tenant_admin` roles.
- Superadmins choose a tenant for non-superadmin accounts; tenant admins use
  their JWT tenant implicitly and cannot submit a different tenant.
- Tenant context is shown after login and in user-management copy so the active
  scope is visible.

### Backend

- Database startup ensures a current tenant. `TENANT_SLUG` selects the current
  tenant on tenant servers; otherwise the fallback is `fsa` / `FSA`.
- Existing non-superadmin rows with `tenant_id IS NULL` are migrated to that
  tenant. Superadmins remain global (`tenant_id IS NULL`).
- Login joins `admin_users` to `tenants`, rejects malformed tenant membership
  and suspended tenants, and signs immutable tenant identity into the JWT.
- Auth middleware rechecks the account, role, tenant, and suspension status on
  every protected request so role changes and suspensions revoke stale sessions.
- `/api/admin/users` is mounted before the legacy platform-admin gate. Every
  query is scoped from `req.adminUser`, never from a client-provided tenant for
  tenant administrators.
- User create/update/delete operations use parameterized queries and record
  tenant audit events.

### Security

- Authentication remains JWT HS256 with the existing login rate limiter.
- Authorization is enforced server-side for every user-management operation.
- Tenant admins cannot read, move, edit, or delete users in another tenant.
- Non-superadmin accounts cannot be created without a valid tenant.
- Self-delete/self-demotion and deletion/demotion of the last superadmin or last
  tenant administrator remain blocked.
- API responses explicitly exclude `password_hash` and secrets.
- Usernames, roles, tenant IDs, and passwords are validated at the trust boundary.

## Acceptance criteria

- [x] A fresh/default installation contains tenant `fsa` and the seeded
      superadmin remains global.
- [x] Existing global `admin` accounts become FSA accounts without password loss.
- [x] Login returns tenant identity for every non-superadmin and no tenant for
      superadmin.
- [x] Superadmin can manage users across tenants.
- [x] Tenant admin can manage only users in its own tenant.
- [x] Cross-tenant IDOR attempts return 403/404 without mutation.
- [x] Backend tests, frontend type-check, production build, and static harness pass.

## Deployment and rollback

- Deployment is forward-compatible: startup creates/locates the default tenant
  before backfilling only `tenant_id IS NULL AND role <> 'superadmin'`.
- Rollback does not delete the FSA tenant or clear assignments. Older code ignores
  `tenant_id`, so retaining the migrated values is safe.
