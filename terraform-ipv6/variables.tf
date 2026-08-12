# =============================================================================
# Variables — IPv6 Optimized Environment
# =============================================================================

# --- AWS ---
variable "aws_region" {
  description = "AWS region to deploy"
  type        = string
  default     = "ap-southeast-1"
}

# --- Domain ---
variable "domain_name" {
  description = "Root domain name"
  type        = string
  default     = "devfasttrack.com"
}

variable "app_subdomain" {
  description = "Subdomain for the app (e.g. 'epoc' → epoc.devfasttrack.com for FSA-CLS)"
  type        = string
  default     = "epoc"
}

# --- EC2 ---
variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "allowed_ssh_ipv6_cidr" {
  description = "IPv6 CIDR block allowed for SSH access. Default allows all IPv6. For security, restrict to your IPv6 address, e.g. '2001:db8::/32'."
  type        = string
  default     = "::/0"
}

# --- RDS Database ---
variable "db_instance_class" {
  description = "RDS instance class (Free Tier: db.t3.micro)"
  type        = string
  default     = "db.t3.micro"
}

variable "backup_retention_days" {
  description = "Always-on RDS and S3 backup retention in days."
  type        = number
  default     = 14
  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35."
  }
}

variable "db_name" {
  description = "PostgreSQL assessment data-plane database name"
  type        = string
  default     = "eaudit"
}

variable "control_db_name" {
  description = "PostgreSQL global control-plane database name (tenant management)"
  type        = string
  default     = "eaudit_control"
}

variable "log_db_name" {
  description = "PostgreSQL per-tenant operational log-plane database name"
  type        = string
  default     = "eaudit_fsa_cls_logs"
}

variable "tenant_slug" {
  description = "Tenant slug identifier for the log-plane (e.g. fsa-cls)"
  type        = string
  default     = "fsa-cls"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "eaudit_admin"
}

variable "db_password" {
  description = "PostgreSQL master password (min 8 chars)"
  type        = string
  sensitive   = true
}

variable "ssh_password" {
  description = "Password for the ubuntu user (used for EC2 Serial Console login)"
  type        = string
  sensitive   = true
  default     = "" # Change in terraform.tfvars
}

# --- App Secrets ---
variable "gemini_api_key" {
  description = "Google Gemini API key for AI grading"
  type        = string
  sensitive   = true
  default     = ""
}

variable "session_secret" {
  description = "Express session secret"
  type        = string
  sensitive   = true
  default     = "eaudit-session-secret-change-me-ipv6"
}

# Ký JWT của admin và học viên. KHÔNG có default: thiếu biến này thì server
# process.exit(1) ngay lúc khởi động, nên thà Terraform hỏi ngay còn hơn để phát
# hiện sau khi instance đã dựng xong mà app không chạy.
# Đặt giá trị thật trong terraform.tfvars (đã gitignore), không commit vào repo.
variable "jwt_secret" {
  description = "Secret used to sign admin and student JWTs (>= 32 characters)"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.jwt_secret) >= 32
    error_message = "jwt_secret phải dài ít nhất 32 ký tự."
  }
}

# --- Tài khoản seed ---
#
# Hai tài khoản này được seed ở lần khởi tạo control-plane ĐẦU TIÊN (bảng admin_users
# rỗng / tenant chưa có tenant_admin nào). Không khai ở đây thì ứng dụng rơi về giá trị
# mặc định nằm sẵn trong source và trong lịch sử git — ai clone repo cũng đọc được.
#
# Mật khẩu KHÔNG có default, giống jwt_secret: thà Terraform hỏi ngay còn hơn dựng xong
# một máy chạy production bằng mật khẩu công khai. Đặt giá trị thật trong
# terraform.tfvars (đã gitignore).
#
# ⚠ Chỉ có tác dụng với database MỚI. Trên database đã có sẵn tài khoản, hàm seed cố ý
# không ghi đè, nên đổi biến ở đây rồi apply lại KHÔNG đổi được mật khẩu đang dùng —
# phải đổi qua API/giao diện đổi mật khẩu.

variable "superadmin_username" {
  description = "Username of the seeded global superadmin (first admin_users row)"
  type        = string
  default     = "supperadmin"
}

variable "superadmin_password" {
  description = "Password for the seeded global superadmin (>= 12 characters)"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.superadmin_password) >= 12
    error_message = "superadmin_password phải dài ít nhất 12 ký tự."
  }
}

variable "fsa_tenant_admin_username" {
  description = "Username of the seeded FSA-CLS tenant administrator"
  type        = string
  default     = "adminfsa"
}

variable "fsa_tenant_admin_password" {
  description = "Password for the seeded FSA-CLS tenant administrator (>= 12 characters)"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.fsa_tenant_admin_password) >= 12
    error_message = "fsa_tenant_admin_password phải dài ít nhất 12 ký tự."
  }
}

# Database dùng để kết nối khi tạo các database còn thiếu (npm run db:ensure).
# Vai trò deploy cần quyền CONNECT và CREATEDB trên database này.
variable "database_maintenance_db" {
  description = "Maintenance database used by npm run db:ensure"
  type        = string
  default     = "postgres"
}

# --- App Config ---
variable "node_env" {
  description = "Node.js environment"
  type        = string
  default     = "production"
}

variable "app_port" {
  description = "Application port"
  type        = number
  default     = 3001
}
