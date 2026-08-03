# ADR-001: Multi-tenant control plane and isolated tenant servers

## Status

Accepted

## Context

Each customer needs an independently configurable deployment. Customer administrators
may edit their own desired infrastructure configuration, but only a platform
superadmin may approve the tenant or create infrastructure. The existing Terraform
configuration provisions one fixed environment and uses names that cannot safely be
reused for multiple customers.

## Decision

- Keep the existing application as the control plane.
- Add a `tenant_admin` account role scoped by `admin_users.tenant_id`.
- Store desired tenant configuration and provisioning status in the database.
- Allow tenant admins to update only their own tenant. Any material change returns an
  approved tenant to `pending` review.
- Restrict approval and Terraform plan/apply operations to `superadmin`.
- Provision one EC2 data plane per tenant with the reusable
  `terraform/tenant-instance` module.
- Use one encrypted S3 state object and one lock per tenant. Provisioning is refused
  unless a remote state bucket is configured.
- Store application secrets in AWS Secrets Manager. The database stores only the
  secret ARN; Terraform never receives secret values.
- Run Terraform through `execFile` with an argument array, never through a shell.
  Slugs, regions, instance types, CIDRs and domains are validated before use.
- Record every approval and provisioning attempt in append-only audit/job tables.

## Alternatives considered

- **Shared application and tenant_id on every business table**: cheaper, but requires
  invasive row-level isolation across the existing exam schema and increases the
  impact of an authorization bug.
- **Copy the existing Terraform root per tenant**: quick initially, but duplicates RDS,
  IAM and backup resources and leaves hard-coded names/state collisions.
- **Allow tenants to run apply**: rejected because it grants customers an expensive,
  high-impact infrastructure capability.

## Consequences

- Tenant workloads are isolated at the server boundary and can be scaled or retired
  independently.
- The control plane needs AWS credentials limited to the tenant module resources and
  the configured Terraform state bucket/lock table.
- Provisioning is asynchronous and may fail after approval; the UI exposes job logs
  and supports retry.
- This version provisions infrastructure but does not destroy it from the UI. A
  destructive lifecycle requires a separate approval workflow.

## Failure modes and controls

- Concurrent apply: database status transition plus remote state locking.
- Process restart during apply: stale `running` jobs are visible; a superadmin can
  retry after confirming no Terraform process is active.
- Invalid/customer-controlled input: allowlists and strict format validation.
- Secret disclosure: secret values remain in Secrets Manager; logs are truncated and
  obvious secret patterns are redacted before persistence.
- Cost abuse: only superadmin can apply and instance types are allowlisted.
