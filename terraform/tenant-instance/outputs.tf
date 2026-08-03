output "instance_id" {
  description = "Tenant EC2 instance ID."
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "Tenant Elastic IP."
  value       = aws_eip.app.public_ip
}

output "app_url" {
  description = "Public tenant application URL."
  value       = var.domain_name != "" ? "http://${var.domain_name}" : "http://${aws_eip.app.public_ip}"
}

output "compiler_lambda_arn" {
  description = "Practice compiler Lambda ARN, or an empty string when disabled."
  value       = var.compiler_enabled ? aws_lambda_function.compiler[0].arn : ""
}
