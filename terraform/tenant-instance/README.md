# Tenant instance module

This module creates one isolated EC2 application server for one E-PROC customer:

- dedicated dual-stack VPC with an AWS-assigned IPv6 /56 and public subnet;
- public IPv6 as the primary endpoint plus Elastic IPv4 as a bootstrap fallback;
- HTTP/HTTPS-only security group over IPv4 and IPv6 (administration uses SSM, not public SSH);
- least-privilege instance role for exactly one tenant Secrets Manager ARN;
- required dedicated tenant FQDN with optional Route53 A and AAAA management;
- optional isolated Lambda compiler for Practice exams, with bounded memory,
  timeout and reserved concurrency;
- bootstrap of the selected repository/ref through cloud-init.
- seeding of the deployed application's tenant identity through `TENANT_SLUG`
  and Base64-encoded tenant name/contact environment values (avoids shell
  injection and makes non-superadmin login tenant-aware from first startup).

It is normally invoked by the control-plane API, not manually. The API copies this
module into a tenant-specific working directory and initializes the S3 backend with:

```text
key = tenants/<tenant-slug>/terraform.tfstate
```

## Prerequisites

1. An encrypted/versioned private S3 bucket for Terraform state.
2. A DynamoDB lock table whose partition key is `LockID` (string).
3. AWS credentials on the control-plane host with least-privilege access to state
   storage and the resources in this module.
4. One Secrets Manager secret per tenant. Its JSON may contain:
   `DATABASE_URL` (tenant assessment data), `CONTROL_DATABASE_URL` (global tenant/admin control plane),
   `LOG_DATABASE_URL` (this tenant's operational issue logs),
   `JWT_SECRET`, `SESSION_SECRET`, `GEMINI_API_KEY`,
   `OPENAI_API_KEY`, and `GROQ_API_KEY`.
5. Terraform CLI 1.5 or newer on a persistent self-hosted control-plane machine.
6. For compiler-enabled tenants, a reviewed compiler image published to ECR and
   configured as `TENANT_COMPILER_IMAGE_URI` on the control plane. See
   `infra/compiler-lambda/README.md`.
7. A dedicated subdomain per tenant. FSA-CLS uses
   `epoc.devfasttrack.com`; this is the temporary FSA-CLS exception, while other tenants use `epoc.<tenant-label>.devfasttrack.com`. The application output URL is HTTPS.

## Security and operations

- Do not put secret values in the tenant database or UI; enter only the secret ARN.
- For superadmin remote log observation, configure `CONTROL_PLANE_LOG_SECRET_ARNS`
  only on the control-plane host. Terraform grants that host read access to the
  explicit ARN list; ordinary tenant hosts continue to read only their own secret.
  The control-plane network must also reach the selected PostgreSQL log databases.
- Do not enable provisioning in Vercel/serverless functions. Terraform apply needs a
  persistent process and filesystem. Use the EC2/pm2 control plane or a dedicated
  worker.
- The UI intentionally has no destroy button. Decommissioning requires a separate
  reviewed workflow to avoid accidental data loss.
- Run a successful plan after the latest tenant approval before apply is accepted.
- The IPv4 CIDR defaults to `10.0.0.0/16` inside each isolated VPC. Configure a
  non-overlapping CIDR before introducing VPC peering or Transit Gateway routing.

## Control-plane environment

```dotenv
TENANT_PROVISIONING_ENABLED=true
TERRAFORM_BIN=/usr/local/bin/terraform
TERRAFORM_STATE_BUCKET=eproc-terraform-state
TERRAFORM_STATE_REGION=ap-southeast-1
TERRAFORM_LOCK_TABLE=eproc-terraform-locks
TENANT_TERRAFORM_WORKDIR=/opt/eproc/tenant-terraform
TENANT_COMPILER_IMAGE_URI=123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/eproc/compiler:v1
CONTROL_PLANE_LOG_SECRET_ARNS=arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:eproc-fsa-cls,arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:eproc-acme
```
