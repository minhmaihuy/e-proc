data "aws_ami" "ubuntu_x86" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_ami" "ubuntu_arm" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  name_prefix   = "eproc-${var.tenant_slug}"
  compiler_name = "${local.name_prefix}-compiler"
  is_arm        = startswith(var.instance_type, "t4g.")
}

resource "aws_vpc" "tenant" {
  cidr_block                       = var.vpc_ipv4_cidr
  assign_generated_ipv6_cidr_block = true
  enable_dns_support               = true
  enable_dns_hostnames             = true

  tags = { Name = "${local.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "tenant" {
  vpc_id = aws_vpc.tenant.id
  tags   = { Name = "${local.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                          = aws_vpc.tenant.id
  cidr_block                      = cidrsubnet(var.vpc_ipv4_cidr, 8, 1)
  ipv6_cidr_block                 = cidrsubnet(aws_vpc.tenant.ipv6_cidr_block, 8, 1)
  map_public_ip_on_launch         = true
  assign_ipv6_address_on_creation = true

  tags = { Name = "${local.name_prefix}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.tenant.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.tenant.id
  }

  route {
    ipv6_cidr_block = "::/0"
    gateway_id      = aws_internet_gateway.tenant.id
  }

  tags = { Name = "${local.name_prefix}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "app" {
  name_prefix = "${local.name_prefix}-"
  description = "HTTP and HTTPS access for tenant ${var.tenant_slug}"
  vpc_id      = aws_vpc.tenant.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description      = "HTTP over IPv6"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    ipv6_cidr_blocks = ["::/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description      = "HTTPS over IPv6"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    ipv6_cidr_blocks = ["::/0"]
  }

  egress {
    description = "Outbound package and API access"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description      = "Outbound package and API access over IPv6"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    ipv6_cidr_blocks = ["::/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_iam_role" "app" {
  name_prefix = "${local.name_prefix}-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "runtime" {
  name = "tenant-runtime"
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.secret_arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.backup.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.backup.arn}/backups/${var.tenant_slug}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:UpdateInstanceInformation",
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
          "ec2messages:AcknowledgeMessage",
          "ec2messages:DeleteMessage",
          "ec2messages:FailMessage",
          "ec2messages:GetEndpoint",
          "ec2messages:GetMessages",
          "ec2messages:SendReply"
        ]
        Resource = "*"
      }
      ], length(var.observed_tenant_secret_arns) > 0 ? [{
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.observed_tenant_secret_arns
        }] : [], var.compiler_enabled ? [{
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.compiler[0].arn
      }] : []
    )
  })
}

resource "aws_iam_role" "compiler" {
  count       = var.compiler_enabled ? 1 : 0
  name_prefix = "${local.compiler_name}-"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_cloudwatch_log_group" "compiler" {
  count             = var.compiler_enabled ? 1 : 0
  name              = "/aws/lambda/${local.compiler_name}"
  retention_in_days = 7
}

resource "aws_iam_role_policy" "compiler_logs" {
  count = var.compiler_enabled ? 1 : 0
  name  = "compiler-logs-only"
  role  = aws_iam_role.compiler[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "${aws_cloudwatch_log_group.compiler[0].arn}:*"
    }]
  })
}

resource "aws_lambda_function" "compiler" {
  count                          = var.compiler_enabled ? 1 : 0
  function_name                  = local.compiler_name
  role                           = aws_iam_role.compiler[0].arn
  package_type                   = "Image"
  image_uri                      = var.compiler_image_uri
  architectures                  = ["x86_64"]
  memory_size                    = var.compiler_memory_mb
  timeout                        = var.compiler_timeout_seconds
  reserved_concurrent_executions = var.compiler_concurrency

  ephemeral_storage {
    size = 512
  }

  tracing_config {
    mode = "PassThrough"
  }

  depends_on = [
    aws_cloudwatch_log_group.compiler,
    aws_iam_role_policy.compiler_logs
  ]
}

resource "aws_iam_instance_profile" "app" {
  name_prefix = "${local.name_prefix}-"
  role        = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                    = local.is_arm ? data.aws_ami.ubuntu_arm.id : data.aws_ami.ubuntu_x86.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name
  ipv6_address_count     = 1

  metadata_options {
    http_endpoint      = "enabled"
    http_protocol_ipv6 = "enabled"
    http_tokens        = "required"
  }

  root_block_device {
    volume_size           = var.root_volume_size
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    app_port                 = var.app_port
    domain_name              = var.domain_name
    repository_url           = var.repository_url
    repository_ref           = var.repository_ref
    secret_arn               = var.secret_arn
    tenant_slug              = var.tenant_slug
    tenant_name_b64          = base64encode(var.tenant_name)
    tenant_contact_email_b64 = base64encode(var.tenant_contact_email)
    aws_region               = var.aws_region
    compiler_mode            = var.compiler_enabled ? "lambda" : "local"
    compiler_lambda_arn      = var.compiler_enabled ? aws_lambda_function.compiler[0].arn : ""
    backup_bucket            = aws_s3_bucket.backup.id
  })

  tags = {
    Name = "${local.name_prefix}-server"
  }

  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_s3_bucket" "backup" {
  bucket_prefix = "eproc-${substr(var.tenant_slug, 0, 18)}-backup-"
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket                  = aws_s3_bucket.backup.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    id     = "tenant-backup-retention"
    status = "Enabled"
    filter { prefix = "backups/${var.tenant_slug}/" }
    expiration { days = var.backup_retention_days }
  }
}

resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "${local.name_prefix}-eip" }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

resource "aws_route53_record" "app" {
  count   = var.domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}

resource "aws_route53_record" "app_ipv6" {
  count   = var.domain_name != "" && var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "AAAA"
  ttl     = 300
  records = [aws_instance.app.ipv6_addresses[0]]
}
