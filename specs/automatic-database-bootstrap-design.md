# Automatic PostgreSQL Database Bootstrap Design

## Scope

This change prepares EC2 deployments for the existing three-plane database architecture. It does not move assessment rows, merge database planes, rotate credentials, or deploy to production.

## Requirements

- When production configuration is prepared, the system shall require `DATABASE_URL`, `CONTROL_DATABASE_URL`, and `LOG_DATABASE_URL` to point to three distinct PostgreSQL databases.
- When all three URLs use one RDS instance, the system shall permit that topology as long as the target database names are distinct.
- When a configured application database is absent, the deployment bootstrap shall create only that database before PM2 is restarted.
- When a configured application database already exists, bootstrap shall leave it unchanged.
- After all configured databases exist, deployment shall run the idempotent assessment, global-control, and tenant-log schema migrations in that ownership order before replacing PM2.
- If any plane migration fails, deployment shall not run later plane migrations or replace PM2, and the migration process shall close every database connection without printing connection details.
- When bootstrap runs concurrently and PostgreSQL reports that another process created the database, bootstrap shall treat the target as available.
- If a URL is missing, malformed, non-PostgreSQL, targets a system database, duplicates another plane, or cannot be created, deployment shall stop before interrupting the running PM2 application.
- Database names shall be validated before use as quoted PostgreSQL identifiers. Database existence checks shall use parameterized values.
- Connection URLs, passwords, API keys, JWT secrets, session secrets, secret payloads, and stack traces shall never be committed or printed by bootstrap/deploy logs.
- `.env.example` shall document variable names and visibly non-secret placeholders only. A private Git repository shall not be treated as a secret store.
- The PostgreSQL deployment role shall have `CONNECT` access to the maintenance database and `CREATEDB` privilege. Application startup remains responsible for idempotently creating tables inside each database.
- The canonical EC2 environment file shall be `/opt/eaudit/.env`; a root-run deployment may copy it to `/opt/eaudit/app/.env` with owner-only permissions before dropping to the application user.
- Deployment shall perform source update, dependency install, backend build, database bootstrap, all-plane schema migration, and frontend build before replacing the PM2 process.
- A failed health check shall return a non-zero deployment status and print only bounded PM2 diagnostics.

## Database topology

| Plane | Variable | Example database name | Owner |
| --- | --- | --- | --- |
| Assessment | `DATABASE_URL` | `eaudit` | FSA-CLS questions, batches, students, grading, violations |
| Global control | `CONTROL_DATABASE_URL` | `eaudit_control` | identities, tenants, provisioning jobs, audit events |
| Tenant operations | `LOG_DATABASE_URL` | `eaudit_fsa_cls_logs` | bounded operational issue logs for FSA-CLS |

## Safety and rollback

- Bootstrap issues `CREATE DATABASE` only after a catalog lookup. It never drops, renames, truncates, or alters an existing database.
- Schema migration reuses each plane's idempotent application initializer. Fresh assessment schemas create `students` before the foreign-key-dependent `practice_submissions` table.
- Keep the previous PM2 process running until all pre-restart gates pass.
- If the new process fails health verification, inspect the bounded PM2 log output, correct `/opt/eaudit/.env` or PostgreSQL privileges, and rerun deployment. Existing databases and data remain untouched.
- Revert the deployment commit to restore the previous script; this does not remove databases created by bootstrap.

## Acceptance evidence

- Unit tests cover same-server isolation, missing/duplicate/unsafe targets, existing and missing databases, duplicate-create races, ordered all-plane migration, fresh-schema dependency order, sanitized failures, and connection closure.
- Backend TypeScript compilation and tenant test suite pass.
- Both deployment scripts pass shell syntax validation.
- The full maintenance harness runs against this specification with no error-level violations.
