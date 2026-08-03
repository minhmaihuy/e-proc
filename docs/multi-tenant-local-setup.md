# Multi-tenant local setup

## Roles and lifecycle

1. A `superadmin` opens `/admin/tenants` and creates a customer plus its
   `tenant_admin` account.
2. The tenant admin signs in through `/admin` and can edit only that tenant's desired
   server configuration.
3. Every saved change sets the tenant back to `pending`.
4. A superadmin reviews and approves the configuration.
5. A superadmin runs Terraform plan and reviews its log.
6. Only after a successful post-approval plan can the superadmin choose
   **Create / update server**.

Tenant admins cannot access the platform question bank, batches, platform users,
approval endpoints, or Terraform execution endpoints. The API enforces these rules;
the UI routing is only an additional usability guard.

## Local UI/API development

Copy `.env.example` to `.env`, set a strong `JWT_SECRET`, and keep:

```dotenv
TENANT_PROVISIONING_ENABLED=false
```

Then run the normal backend and frontend development commands. You can test tenant
creation, tenant login, configuration and approval locally with SQLite. Plan/apply
jobs intentionally end as `failed` with a clear disabled message until provisioning
is explicitly enabled on a properly configured host.

## Production provisioning

Provisioning must run on a persistent trusted host with Terraform, AWS credentials,
an S3 state bucket and DynamoDB lock table. See
`terraform/tenant-instance/README.md` for required environment variables and the
per-tenant Secrets Manager JSON contract.

The control-plane AWS principal should be narrowed to:

- the configured state bucket prefix `tenants/*`;
- the configured lock table;
- EC2, EIP, security-group, IAM instance-profile and optional Route53 resources
  carrying the `Project=e-proc` and tenant tags;
- `iam:PassRole` only for tenant runtime roles.

Do not grant tenant users AWS credentials. They submit desired configuration only;
the platform superadmin remains the approval and cost-control boundary.
