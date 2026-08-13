output "instance_id" {
  description = "Tenant EC2 instance ID."
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "Tenant Elastic IPv4 fallback address."
  value       = aws_eip.app.public_ip
}

output "ipv6_address" {
  description = "Tenant public IPv6 address."
  value       = aws_instance.app.ipv6_addresses[0]
}

output "app_url" {
  description = "Public tenant application URL."
  value       = "https://${var.domain_name}/"
}

output "backup_bucket" {
  description = "Private S3 bucket used for tenant database backups and restore drills."
  value       = aws_s3_bucket.backup.id
}

output "identity_bucket" {
  description = "Private S3 bucket for tenant identity evidence, or empty when disabled."
  value       = var.identity_retention_days != null ? aws_s3_bucket.identity[0].id : ""
}

output "compiler_lambda_arn" {
  description = "Practice compiler Lambda ARN, or an empty string when disabled."
  value       = var.compiler_enabled ? aws_lambda_function.compiler[0].arn : ""
}
