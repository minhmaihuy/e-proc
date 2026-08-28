# Tenant Draft Configuration Update Design

## Problem

The superadmin tenant form sends the complete tenant configuration on every save.
Changing an unrelated capability, such as enabling `local` screen recording, therefore
resends legacy infrastructure values. `PUT /api/tenants/:id` currently validates that
whole normalized object and rejects the save when an existing Route53 zone ID does not
match the current format, even though Route53 was not the field being changed.

Observed failure: selecting `Record Local` and saving returns
`Invalid Route53 hosted zone ID.`.

## Product decision

Tenant configuration updates are draft saves. A superadmin may save the normalized form
without business or infrastructure validation. Invalid or incomplete draft values must
not block `PUT /api/tenants/:id`.

This decision does not weaken security or provisioning gates:

- admin JWT and `superadmin` authorization remain mandatory;
- the tenant ID must identify an existing tenant;
- the tenant slug remains immutable;
- configuration remains locked while Terraform is planning or applying;
- a save still resets approval and provisioning state to pending/not-started;
- tenant creation remains validated;
- approval remains fully validated, including Route53, domain, repository, secret,
  recording/identity retention, and compiler constraints;
- provisioning remains restricted to an approved tenant and retains its own validation.

Because the draft row is also the control-plane source read by the running tenant, runtime
capability resolution must fail closed independently of draft validation. Local recording
remains safe and effective without infrastructure validation. S3 recording is effective
only with a valid recording-retention period; photo identity is effective only with valid,
ordered identity and recording retention. A stored batch mode removed from the effective
tenant allowlist is treated as `none` at student runtime until a tenant admin reconciles it.

## Recording and route ownership boundary

The recording fields in the superadmin tenant draft and the recording selector in a batch
are two different levels of policy, not duplicate configuration:

- only superadmin grants the tenant-wide `tenants.allowed_record_modes` capability at
  `/tenants`;
- only a matching `tenant_admin` chooses the actual `batches.record_mode` for an exam,
  and that value must be inside the superadmin-granted allowlist;
- regular `admin` cannot change the tenant allowlist or a batch's recording mode;
- `GET /api/admin/recording-config` only reports the effective allowlist and whether the
  current tenant role may choose a batch mode. It is read-only and has no mutation peer.

Tenant roles do not receive a tenant-infrastructure configuration workspace. Legacy
`/admin/tenant` remains absent and redirects to the tenant dashboard. `/admin/settings`
is retained because it configures tenant-local AI grading; it is separate from the
superadmin-owned tenant capability and infrastructure form.

Authentication alone is not a sufficient assessment boundary. After the four
`requireTenantUserManager`-protected user CRUD routes, `admin.ts` must install
`router.use(requireTenantDataAdmin)` before every remaining assessment route. This rejects
a valid superadmin token from recording capability, AI settings, questions, batches, and
all other tenant assessment data.

## Backend requirements

1. Validation policy must explicitly distinguish `create`, `update`, and `approval`.
2. The `update` phase returns no validation error for any normalized tenant form value.
3. `create` keeps the existing validation behavior without requiring a secret ARN.
4. `approval` keeps the existing validation behavior and requires the secret ARN and
   dedicated tenant domain.
5. `PUT /api/tenants/:id` continues to normalize and persist the complete form, preserve
   the trusted existing slug, reset approval/provisioning state, and write the audit event.
6. The superadmin update remains the only API that can write `allowed_record_modes`; the
   tenant assessment router exposes no tenant-wide recording-policy mutation.
7. `GET /api/admin/recording-config` remains read-only and returns effective capability
   from trusted request context rather than accepting a tenant id or allowlist from the client.
8. Batch create/update continues to enforce both role and allowlist: `tenant_admin` may
   choose an allowed mode, while regular `admin` preserves the stored/default mode.
9. All assessment routes after current-tenant user CRUD are globally guarded by
   `requireTenantDataAdmin`, so superadmin cannot reach tenant assessment data.
10. Authentication and student runtime consume a pure effective-capability policy rather
    than raw draft values: invalid S3/photo draft combinations are reduced to safe modes,
    while Local remains available when granted.
11. Student verification, submit behavior, and every new S3 upload/finalization gate intersect
    the stored batch mode with the current effective tenant allowlist. Revocation therefore
    fails closed at the next verify/server-policy check even if an older batch row still stores
    Local or S3. It does not rewrite that row, cancel an already-running Local client snapshot,
    or invalidate a presigned S3 PUT before its 15-minute expiry.

## Frontend requirements

1. The existing tenant update form submits without native browser constraint validation.
2. The update handler does not run recording/identity retention validation before calling
   `tenantControlApi.updateTenant`.
3. The create form and the approval action retain their existing validation boundaries.
4. Selecting Local recording updates the allowlist to `none,local` and can be saved even
   when another persisted field contains a legacy or incomplete value.
5. The tenant batch form consumes the read-only effective capability to offer allowed
   per-batch choices; it does not edit the tenant-wide allowlist.
6. When a legacy batch stores `photo` after that capability becomes ineffective, the edit
   form shows the revoked value explicitly and lets `tenant_admin` reconcile it to `off`;
   warnings do not tell a regular `admin` to operate a disabled selector.
6. Legacy `/admin/tenant` remains a redirect rather than a second tenant configuration
   workspace. The separate `/admin/settings` AI page remains available to tenant roles.

## Regression coverage

- Pure backend policy tests prove an intentionally invalid tenant is accepted at the
  `update` phase while the same input is rejected at `create` and `approval`.
- A valid create configuration without a secret remains accepted; approval without a
  secret remains rejected.
- A TenantManagement interaction test loads a tenant with a legacy invalid Route53 value
  and an otherwise incomplete draft, selects Local, submits, and proves the API receives
  `allowed_record_modes: 'none,local'` plus the unchanged legacy Route53 value.
- Source tests pin `requireTenantDataAdmin` after user CRUD and before every remaining
  assessment route; direct middleware tests prove that guard rejects superadmin and
  cross-tenant users while accepting matching tenant roles.
- Recording tests prove the effective-capability endpoint is GET-only, tenant_admin can
  choose only an allowed per-batch mode, and regular admin cannot change the stored mode.
- Pure runtime-policy tests prove Local survives unrelated invalid infrastructure fields,
  S3/photo fail closed without valid retention, and revoked stored batch modes resolve to
  `none`; student-route source tests pin that resolution at verification, submit, upload,
  part completion, and finalization.
- Frontend routing/navigation tests keep `/admin/tenant` absent while retaining the
  tenant-local AI Settings route; removing duplicate infrastructure configuration must not
  remove the per-batch recording selector or AI settings.
- Existing tenant/provisioning tests must remain green.

## Verification

- `npm run test:tenant`
- backend and frontend `npx tsc --noEmit`
- full frontend test suite
- `npm run build`
- `npm run docs:check`
- `git diff --check`
- maintenance harness with this specification

### Verification evidence (2026-08-28)

- `npm run test:tenant`: 192/192 passed. The run includes the real control-plane
  backfill twice without losing tenant rows, the repeatable identity data-plane migration
  with preserved legacy assessment rows, and the repeatable email/usage data-plane
  migration with preserved assessment rows.
- Client Vitest: 56/56 passed, including the tenant draft save, per-batch recording
  capability interactions, and the tenant-admin reconciliation of revoked photo mode to Off.
- Backend build/type-check, frontend `npx tsc --noEmit`, dependency preflight,
  `npm run docs:check`, and `git diff --check`: passed.
- The normal frontend output folder is locked by a local Windows ACL (`EPERM` while
  emptying `client/dist/assets`). Running the same Vite production build into an isolated
  output directory transformed 1,966 modules and passed, separating the workspace ACL
  problem from source/build correctness.
