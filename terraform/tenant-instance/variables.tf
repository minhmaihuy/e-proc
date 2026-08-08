variable "tenant_slug" {
  description = "Stable lowercase tenant identifier used in resource names."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.tenant_slug))
    error_message = "tenant_slug must be 3-31 lowercase letters, numbers or hyphens and start with a letter."
  }
}

variable "tenant_name" {
  description = "Customer-facing tenant name used to seed the deployed application."
  type        = string

  validation {
    condition     = length(trimspace(var.tenant_name)) >= 2 && length(var.tenant_name) <= 160
    error_message = "tenant_name must contain 2-160 characters."
  }
}

variable "tenant_contact_email" {
  description = "Tenant contact email used to seed the deployed application."
  type        = string

  validation {
    condition     = can(regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", var.tenant_contact_email))
    error_message = "tenant_contact_email must be a valid email address."
  }
}

variable "aws_region" {
  description = "AWS region for the tenant server."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.aws_region))
    error_message = "aws_region must be a valid AWS region name."
  }
}

variable "vpc_ipv4_cidr" {
  description = "Private IPv4 CIDR used by this tenant's isolated dual-stack VPC. Overlap is allowed while tenant VPCs are not peered."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_ipv4_cidr, 0)) && can(cidrsubnet(var.vpc_ipv4_cidr, 8, 1))
    error_message = "vpc_ipv4_cidr must be a valid CIDR with enough address space for tenant subnets."
  }
}

variable "instance_type" {
  description = "EC2 instance type selected from the control-plane allowlist."
  type        = string
  default     = "t3.micro"

  validation {
    condition     = contains(["t3.micro", "t3.small", "t3.medium", "t4g.micro", "t4g.small", "t4g.medium"], var.instance_type)
    error_message = "Unsupported instance_type."
  }
}

variable "app_port" {
  description = "Local application port behind nginx."
  type        = number
  default     = 3001

  validation {
    condition     = var.app_port >= 1024 && var.app_port <= 65535
    error_message = "app_port must be between 1024 and 65535."
  }
}

variable "domain_name" {
  description = "Dedicated tenant FQDN. FSA-CLS temporarily uses epoc.devfasttrack.com; other tenants use epoc.<tenant-label>.devfasttrack.com."
  type        = string

  validation {
    condition     = can(regex("^epoc(?:\\.[a-z](?:[a-z0-9-]{0,29}[a-z0-9])?)?\\.devfasttrack\\.com$", var.domain_name))
    error_message = "domain_name must use epoc.devfasttrack.com or epoc.<tenant-label>.devfasttrack.com."
  }
}

variable "route53_zone_id" {
  description = "Optional existing Route53 hosted zone ID."
  type        = string
  default     = ""
}

variable "secret_arn" {
  description = "Secrets Manager ARN containing DATABASE_URL, CONTROL_DATABASE_URL, LOG_DATABASE_URL, JWT_SECRET and optional app settings."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$", var.secret_arn))
    error_message = "secret_arn must be an AWS Secrets Manager ARN."
  }
}

variable "observed_tenant_secret_arns" {
  description = "Explicit Secrets Manager ARN allowlist readable by the superadmin control-plane host for remote tenant log observation. Keep empty on ordinary tenant hosts."
  type        = list(string)
  default     = []

  validation {
    condition = length(var.observed_tenant_secret_arns) <= 100 && alltrue([
      for arn in var.observed_tenant_secret_arns : can(regex("^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$", arn))
    ])
    error_message = "observed_tenant_secret_arns must contain at most 100 valid Secrets Manager ARNs."
  }
}

variable "repository_url" {
  description = "HTTPS Git repository containing the application."
  type        = string
  default     = "https://github.com/minhmaihuy/e-proc.git"

  validation {
    condition     = can(regex("^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\\.git$", var.repository_url))
    error_message = "repository_url must be an HTTPS GitHub repository URL."
  }
}

variable "repository_ref" {
  description = "Git branch or tag to deploy."
  type        = string
  default     = "main"

  validation {
    condition     = can(regex("^[A-Za-z0-9._/-]{1,100}$", var.repository_ref)) && !can(regex("\\.\\.", var.repository_ref))
    error_message = "repository_ref contains unsupported characters."
  }
}

variable "root_volume_size" {
  description = "Encrypted gp3 root volume size in GiB."
  type        = number
  default     = 12

  validation {
    condition     = var.root_volume_size >= 8 && var.root_volume_size <= 100
    error_message = "root_volume_size must be between 8 and 100 GiB."
  }
}

variable "compiler_enabled" {
  description = "Create an isolated Lambda code runner for Practice exams."
  type        = bool
  default     = false
}

variable "compiler_image_uri" {
  description = "Platform-owned, versioned ECR container image for the compiler Lambda."
  type        = string
  default     = ""

  validation {
    condition     = !var.compiler_enabled || can(regex("^[0-9]{12}\\.dkr\\.ecr\\.[a-z0-9-]+\\.amazonaws\\.com/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]{1,128}$", var.compiler_image_uri))
    error_message = "compiler_image_uri must be a versioned ECR image URI when compiler_enabled is true."
  }
}

variable "compiler_memory_mb" {
  description = "Memory allocated to each compiler Lambda invocation."
  type        = number
  default     = 512

  validation {
    condition     = var.compiler_memory_mb >= 256 && var.compiler_memory_mb <= 3008
    error_message = "compiler_memory_mb must be between 256 and 3008."
  }
}

variable "compiler_timeout_seconds" {
  description = "Maximum Lambda invocation duration."
  type        = number
  default     = 15

  validation {
    condition     = var.compiler_timeout_seconds >= 10 && var.compiler_timeout_seconds <= 30
    error_message = "compiler_timeout_seconds must be between 10 and 30."
  }
}

variable "compiler_concurrency" {
  description = "Reserved compiler concurrency, limiting cost and parallel student runs."
  type        = number
  default     = 2

  validation {
    condition     = var.compiler_concurrency >= 1 && var.compiler_concurrency <= 20
    error_message = "compiler_concurrency must be between 1 and 20."
  }
}

variable "tags" {
  description = "Additional tags for all tenant resources."
  type        = map(string)
  default     = {}
}
