# AWS SES feedback setup

E-PROC deliberately returns `503` for email APIs until all four provider values are present:
`AWS_REGION`, `SES_FROM_EMAIL`, `SES_SNS_TOPIC_ARN`, and `SES_CONFIGURATION_SET`.
Keep their real values in the protected tenant secret or `/opt/eaudit/.env`, never in Git.

For each tenant, the platform operations account must create a dedicated SES configuration set and
a dedicated SNS topic. Its event destination publishes both `BOUNCE` and `COMPLAINT` events only to
that tenant's `SES_SNS_TOPIC_ARN`; subscribe only `https://<tenant-domain>/api/email/events/sns` to
that topic. Never share a feedback topic across tenants because recipient addresses belong to the
assessment data-plane. Restrict each topic policy to `ses.amazonaws.com`, the owning AWS account,
and that tenant's configuration-set source ARN. E-PROC automatically confirms only correctly signed
subscription messages from the exact configured topic. The verified sender identity may remain shared.

Every outgoing message includes `SES_CONFIGURATION_SET`, so feedback follows that destination.
Before enabling a tenant, send a staging message to the AWS SES mailbox simulator bounce/complaint
addresses and confirm the recipient enters `email_suppressions`; then confirm a later campaign skips it.
Do not enable tenant email based only on successful Terraform validation or an ARN existing in the secret.
