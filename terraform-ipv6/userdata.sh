#!/bin/bash
# =============================================================================
# EC2 User Data — Bootstrap E-Audit Platform (IPv6 + NAT64)
# Uses public NAT64/DNS64 service (nat64.net) for IPv4 connectivity
# =============================================================================
set -euo pipefail

exec > /var/log/userdata.log 2>&1

# Với `set -e`, một lệnh lỗi làm script dừng ngay và KHÔNG in gì thêm — log trông như
# bị cắt cụt giữa chừng, không rõ chết ở đâu. Trap dưới đây ghi lại dòng và lệnh gây
# lỗi, đồng thời để lại /var/log/userdata.failed để kiểm tra nhanh bằng một lệnh test.
trap 'code=$?; echo "!!! USERDATA FAILED: dòng $LINENO, lệnh: $BASH_COMMAND (exit $code)"; echo "dòng $LINENO: $BASH_COMMAND (exit $code)" > /var/log/userdata.failed; echo "=== Kết thúc trong lỗi: $(date) ==="' ERR

echo "=== E-Audit IPv6 UserData Start: $(date) ==="

# --- Set Password for ubuntu User (for Serial Console Access) ---
if [ -n "${ssh_password}" ]; then
    echo ">>> Setting password for ubuntu user..."
    echo "ubuntu:${ssh_password}" | chpasswd || true
fi

# --- Hostname phải có trong /etc/hosts ---
# Thiếu dòng này thì MỌI lệnh sudo in "unable to resolve host <hostname>" trước khi
# chạy. Vô hại về chức năng nhưng lẫn vào log deploy và rất dễ bị đọc nhầm là lỗi DNS —
# nhất là trên máy này, nơi DNS thật sự có can thiệp (NAT64/DNS64 ở STEP 1).
HOSTNAME_SELF=$(hostname)
grep -q "$HOSTNAME_SELF" /etc/hosts || echo "127.0.1.1 $HOSTNAME_SELF" >> /etc/hosts

# =============================================================================
# STEP 1: Configure NAT64/DNS64 (CRITICAL — Must be FIRST!)
# =============================================================================
echo ">>> Configuring NAT64/DNS64 via nat64.net..."

# Stop systemd-resolved to prevent it from overwriting resolv.conf
systemctl stop systemd-resolved || true
systemctl disable systemd-resolved || true

# Remove symlink if exists
rm -f /etc/resolv.conf

# Write public NAT64/DNS64 resolvers
# These servers handle BOTH DNS resolution AND IPv6→IPv4 data translation
cat > /etc/resolv.conf << 'DNSEOF'
nameserver 2a01:4f8:c2c:123f::1
nameserver 2a00:1098:2c::1
DNSEOF

# Lock the file so nothing can overwrite it.
# `|| true`: một số filesystem không hỗ trợ thuộc tính immutable, và dưới `set -e`
# thất bại ở đây sẽ giết cả script dù DNS đã ghi xong và hoàn toàn dùng được.
chattr +i /etc/resolv.conf || true

echo ">>> DNS64 configured and locked"
sleep 3

# --- Verify NAT64 Connectivity ---
echo ">>> Verifying NAT64 connectivity..."
MAX_RETRIES=5
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    if curl -s -o /dev/null -w "%%{http_code}" --max-time 15 https://github.com | grep -q "200\|301\|302"; then
        echo ">>> NAT64 connectivity VERIFIED! GitHub is reachable."
        break
    fi
    RETRY=$((RETRY + 1))
    echo ">>> Retry $RETRY/$MAX_RETRIES — waiting 5 seconds..."
    sleep 5
done

if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "WARNING: NAT64 connectivity check failed after $MAX_RETRIES retries."
    echo "WARNING: Continuing anyway — some installations may fail."
fi

# =============================================================================
# STEP 2: System Update & Core Packages
# =============================================================================
echo ">>> Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# --- Install Node.js 22 LTS (required by Tailwind Oxide + project manifests) ---
echo ">>> Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
echo "Node.js version: $(node --version)"
echo "NPM version: $(npm --version)"

# --- Install Nginx ---
echo ">>> Installing Nginx..."
apt-get install -y nginx
systemctl enable nginx

# --- Install Certbot (Let's Encrypt SSL) ---
echo ">>> Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# --- Install PM2 (Node.js Process Manager) ---
echo ">>> Installing PM2..."
npm install -g pm2

# --- Install Git & Build Tools ---
echo ">>> Installing build tools..."
apt-get install -y git build-essential

# --- Install PostgreSQL Client (for pg_dump backups) ---
echo ">>> Installing PostgreSQL client..."
apt-get install -y postgresql-client-16 || apt-get install -y postgresql-client

# --- Install AWS CLI with Fallbacks ---
echo ">>> Installing AWS CLI..."
if apt-get install -y awscli 2>/dev/null; then
    echo "AWS CLI installed via apt"
else
    echo ">>> apt failed, trying snap install for AWS CLI..."
    if snap install aws-cli --classic 2>/dev/null; then
        echo "AWS CLI installed via snap"
        ln -sf /snap/bin/aws /usr/bin/aws || true
    else
        echo ">>> snap failed, downloading official AWS CLI zip..."
        apt-get install -y unzip
        ARCH=$(uname -m)
        if [ "$ARCH" = "x86_64" ]; then
            curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
        else
            curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
        fi
        unzip -q awscliv2.zip
        ./aws/install
        rm -rf awscliv2.zip aws
        ln -sf /usr/local/bin/aws /usr/bin/aws || true
    fi
fi

# =============================================================================
# STEP 3: System Configuration
# =============================================================================

# --- Add Swap (1GB) ---
echo ">>> Setting up 1GB swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "    Swap enabled: 1GB"
fi

# --- Create app directories ---
echo ">>> Setting up app directories..."
mkdir -p /opt/eaudit
mkdir -p /opt/eaudit/app
chown -R ubuntu:ubuntu /opt/eaudit

# --- Create environment file ---
echo ">>> Creating .env file..."
# Heredoc ĐƯỢC TRÍCH DẪN ('ENVEOF'): chặn bash diễn giải $ và backtick bên trong giá
# trị bí mật (mật khẩu DB hay secret chứa '$' sẽ bị cắt cụt nếu không trích dẫn).
# Terraform vẫn thay biến template của nó bình thường, vì nó xử lý template TRƯỚC
# khi script chay tren may.
cat > /opt/eaudit/.env << 'ENVEOF'
NODE_ENV=${node_env}
PORT=${app_port}

# Assessment data-plane (FSA-CLS exam data)
DATABASE_URL=${database_url}

# Global control-plane (tenant management, admin accounts)
CONTROL_DATABASE_URL=${control_database_url}

# Per-tenant operational log-plane
LOG_DATABASE_URL=${log_database_url}

# Tenant identification
TENANT_SLUG=${tenant_slug}

GEMINI_API_KEY=${gemini_api_key}

# Ký JWT admin/học viên. Thiếu khóa này server thoát ngay lúc khởi động.
JWT_SECRET=${jwt_secret}
SESSION_SECRET=${session_secret}

# Database dùng khi tạo các database còn thiếu (npm run db:ensure)
DATABASE_MAINTENANCE_DB=${maintenance_db}

# Tài khoản seed cho lần khởi tạo control-plane ĐẦU TIÊN.
# Thiếu bốn khóa này thì ứng dụng rơi về mặc định nằm sẵn trong source (và trong lịch
# sử git), nghĩa là máy production chạy một quãng bằng mật khẩu ai cũng đọc được.
# Trên database đã có tài khoản, hàm seed cố ý không ghi đè — xem controlPlane.ts.
SUPERADMIN_USERNAME=${superadmin_username}
SUPERADMIN_PASSWORD=${superadmin_password}
FSA_TENANT_ADMIN_USERNAME=${fsa_tenant_admin_username}
FSA_TENANT_ADMIN_PASSWORD=${fsa_tenant_admin_password}

USE_SQLITE=false
ALLOWED_ORIGINS=https://${domain_name}
ENVEOF
chown ubuntu:ubuntu /opt/eaudit/.env
chmod 600 /opt/eaudit/.env
echo ">>> .env created successfully"

# =============================================================================
# STEP 4: Configure Nginx
# =============================================================================
echo ">>> Configuring Nginx..."
cat > /etc/nginx/sites-available/eaudit << 'NGINXEOF'
server {
    listen 80;
    listen [::]:80;
    server_name ${domain_name}${www_domain_name != "" ? " " : ""}${www_domain_name};

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:${app_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 10M;
    }

    # Static files (React build)
    location / {
        root /opt/eaudit/app/client/dist;
        index index.html;
        try_files $uri $uri/ /index.html;

        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # Health check (no logging)
    location = /api/health {
        proxy_pass http://127.0.0.1:${app_port};
        access_log off;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/eaudit /etc/nginx/sites-enabled/eaudit
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# =============================================================================
# STEP 5: Create Helper Scripts
# =============================================================================

# --- DB Backup Script ---
echo ">>> Creating backup script..."
cat > /opt/eaudit/backup-db.sh << 'BACKUPEOF'
#!/bin/bash
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/tmp/eaudit_backup_$TIMESTAMP.sql.gz"
S3_BUCKET="${s3_bucket}"

echo "[Backup] Starting: $TIMESTAMP"

# Dùng thẳng URL thay vì tách host/user/db rồi dựng PGPASSWORD. Cách cũ hỏng theo hai
# đường độc lập:
#   1. `grep DATABASE_URL` khớp cả CONTROL_DATABASE_URL, LOG_DATABASE_URL và
#      DATABASE_MAINTENANCE_DB — sed nhận nhiều dòng và sinh mật khẩu rác. Neo `^` để
#      chỉ lấy đúng một dòng.
#   2. Mật khẩu trong URL đã được urlencode (ký tự '#' thành '%23'), nên gán thẳng vào
#      PGPASSWORD là sai nguyên bản. Truyền cả URL cho pg_dump thì libpq tự giải mã.
#
# sslmode: node-postgres hiểu 'no-verify', libpq thì KHÔNG (chỉ nhận disable/allow/
# prefer/require/verify-ca/verify-full). Đổi sang 'require' — với libpq nghĩa là mã hóa
# nhưng không xác minh CA, đúng bằng ý nghĩa 'no-verify' phía Node.
PGURL=$(grep '^DATABASE_URL=' /opt/eaudit/.env | head -1 | cut -d= -f2- | sed 's/sslmode=no-verify/sslmode=require/')
pg_dump "$PGURL" --no-owner --no-privileges | gzip > "$BACKUP_FILE"

aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/backups/$TIMESTAMP.sql.gz" --region ${aws_region}
rm -f "$BACKUP_FILE"

echo "[Backup] Complete: s3://$S3_BUCKET/backups/$TIMESTAMP.sql.gz"
BACKUPEOF
chmod +x /opt/eaudit/backup-db.sh
chown ubuntu:ubuntu /opt/eaudit/backup-db.sh

# --- Deploy Script ---
echo ">>> Creating deploy script..."
cat > /opt/eaudit/deploy.sh << 'DEPLOYEOF'
#!/bin/bash
set -euo pipefail
echo "=== Deploying E-Audit: $(date) ==="

APP_DIR=/opt/eaudit/app
APP_USER=ubuntu

# git PHẢI chạy bằng chủ sở hữu repo, kể cả khi wrapper được gọi bằng sudo.
#
# Trước đây các lệnh git chạy dưới quyền người gọi. Gọi `sudo /opt/eaudit/deploy.sh`
# khiến git chạy dưới root và ghi .git/FETCH_HEAD, .git/index, .git/refs/*, objects/*
# thành sở hữu của root. Ngay sau đó deploy/scripts/deploy.sh hạ quyền xuống ubuntu
# đúng như thiết kế, và lần pull kế tiếp chết với:
#     error: cannot open '.git/FETCH_HEAD': Permission denied
# Repo hỏng quyền vĩnh viễn cho tới khi chown lại, dù deploy đầu tiên trông như thành
# công. Chạy không sudo cũng không thoát: bước cài .env cần root.
run_as_app_user() {
    if [ "$(id -un)" = "$APP_USER" ]; then
        bash -lc "$1"
    else
        su - "$APP_USER" -c "$1"
    fi
}

# Dọn file build cũ để git pull không vướng. KHÔNG xóa lockfile: deploy/scripts/deploy.sh
# chạy `npm ci`, mà lệnh đó bắt buộc phải có package-lock.json và sẽ dừng ngay với
# "can only install with an existing package-lock.json". Lockfile là file được track nên
# `git checkout -- .` bên dưới đã đưa nó về đúng trạng thái của repo rồi.
run_as_app_user "cd $APP_DIR && git checkout -- . || true"
run_as_app_user "cd $APP_DIR && rm -rf dist client/dist"

echo ">>> Pulling latest code..."
run_as_app_user "cd $APP_DIR && git pull origin main"

# Script trong repo tự xử lý cả hai trường hợp root và ubuntu, nên gọi thẳng.
echo ">>> Executing repository deploy script..."
cd "$APP_DIR"
bash deploy/scripts/deploy.sh
DEPLOYEOF
chmod +x /opt/eaudit/deploy.sh
chown ubuntu:ubuntu /opt/eaudit/deploy.sh

# =============================================================================
# STEP 6: Auto-Deploy Application
# =============================================================================
echo ">>> AUTO-DEPLOYING APPLICATION..."

# Clone the repository into /opt/eaudit/app
echo ">>> Cloning repository into /opt/eaudit/app ..."
# Remove placeholder dir created above so git clone can write into it
rm -rf /opt/eaudit/app
su - ubuntu -c "git clone https://github.com/minhmaihuy/e-proc.git /opt/eaudit/app" || {
    echo "ERROR: Failed to clone repository. Retrying after 15 seconds..."
    sleep 15
    rm -rf /opt/eaudit/app
    su - ubuntu -c "git clone https://github.com/minhmaihuy/e-proc.git /opt/eaudit/app"
}
echo ">>> Repository cloned to /opt/eaudit/app"

# Cài bản script được review từ repository; ghi đè helper bootstrap cũ để deploy mới
# luôn dùng cùng một source và có cả kiểm tra restore định kỳ.
install -m 0755 -o ubuntu -g ubuntu /opt/eaudit/app/scripts/backup-db.sh /opt/eaudit/backup-db.sh
install -m 0755 -o ubuntu -g ubuntu /opt/eaudit/app/scripts/restore-db.sh /opt/eaudit/restore-db.sh
install -m 0755 -o ubuntu -g ubuntu /opt/eaudit/app/scripts/verify-latest-backup.sh /opt/eaudit/verify-latest-backup.sh

# Copy .env to app directory
echo ">>> Copying .env into app..."
cp /opt/eaudit/.env /opt/eaudit/app/.env
chown ubuntu:ubuntu /opt/eaudit/app/.env
chmod 600 /opt/eaudit/app/.env
echo ">>> .env synced to /opt/eaudit/app/.env"

# Install server dependencies & build
# Dùng `npm ci` chứ không phải `npm install`: cài đúng theo lockfile và phát hiện
# dependency bị gỡ khỏi package.json — `npm install` có thể để lại node_modules lệch.
echo ">>> Installing server dependencies..."
cd /opt/eaudit/app
su - ubuntu -c "cd /opt/eaudit/app && npm ci --include=dev"

# Chặn sớm: thiếu base64-js/mammoth thì phải dừng TRƯỚC khi đụng tới database,
# thay vì để app chết lúc chạy với lỗi khó lần.
echo ">>> Verifying runtime dependencies..."
su - ubuntu -c "cd /opt/eaudit/app && npm run deps:verify"

echo ">>> Building server..."
su - ubuntu -c "cd /opt/eaudit/app && npm run build:server"

# ---------------------------------------------------------------------------
# Tạo và migrate BA database plane.
#
# RDS chỉ tạo sẵn một database (var.db_name). Nhưng .env khai báo ba plane tách
# biệt — assessment, control, log — và ở production server sẽ DỪNG nếu thiếu
# CONTROL_DATABASE_URL hoặc LOG_DATABASE_URL. Không có bước này thì PM2 khởi động
# rồi app crash ngay, biểu hiện đúng như "deploy xong nhưng web không vào được".
#
# db:ensure chỉ TẠO database còn thiếu (cần quyền CREATEDB), db:migrate dựng lược đồ
# theo thứ tự assessment → control → log. Cả hai đều idempotent.
# ---------------------------------------------------------------------------
echo ">>> Ensuring the three PostgreSQL databases exist..."
su - ubuntu -c "cd /opt/eaudit/app && npm run db:ensure"

echo ">>> Migrating database schemas..."
su - ubuntu -c "cd /opt/eaudit/app && npm run db:migrate"

# Install client dependencies & build
echo ">>> Installing client dependencies..."
su - ubuntu -c "cd /opt/eaudit/app/client && npm ci --include=dev"

echo ">>> Building client..."
su - ubuntu -c "cd /opt/eaudit/app/client && npm run build"

# Start application with PM2
echo ">>> Starting application with PM2..."
su - ubuntu -c "cd /opt/eaudit/app && pm2 start dist/server/server.js --name eaudit --max-memory-restart 512M"
su - ubuntu -c "pm2 save"

# Wait for app to start
echo ">>> Waiting for app to start..."
sleep 5

# Lược đồ database đã được dựng ở bước db:migrate phía trên.
# KHÔNG gọi /api/init-tables: endpoint đó đã bị gỡ khỏi ứng dụng.

# =============================================================================
# STEP 7: PM2 Startup & Cron Jobs
# =============================================================================

# --- PM2 startup ---
echo ">>> Configuring PM2 startup..."
env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
su - ubuntu -c "pm2 save" || true

# --- Cron Jobs ---
echo ">>> Setting up cron jobs..."
cat > /tmp/eaudit-cron << 'CRONEOF'
# SSL auto-renew (daily 3 AM)
0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'

# DB backup to S3 (daily 2 AM)
0 2 * * * S3_BACKUP_BUCKET='${s3_bucket}' AWS_REGION='${aws_region}' /opt/eaudit/backup-db.sh >> /var/log/eaudit-backup.log 2>&1

# Monthly restore drill into a temporary, newly-created database.
0 4 1 * * S3_BACKUP_BUCKET='${s3_bucket}' AWS_REGION='${aws_region}' /opt/eaudit/verify-latest-backup.sh >> /var/log/eaudit-restore-check.log 2>&1

# AI queue processor (every minute)
* * * * * curl -s http://localhost:3001/api/queue/process > /dev/null 2>&1
CRONEOF
crontab -u ubuntu /tmp/eaudit-cron
rm /tmp/eaudit-cron
echo "    Cron jobs configured"

# =============================================================================
# STEP 8: Firewall
# =============================================================================
echo ">>> Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# =============================================================================
# DONE!
# =============================================================================
echo ""
echo "=========================================="
echo "=== E-Audit IPv6 Deployment COMPLETE! ==="
echo "=========================================="
echo "=== Finished at: $(date) ==="
echo ""
echo ">>> App Status:"
su - ubuntu -c "pm2 status" || true
echo ""
echo ">>> Health Check:"
curl -s http://localhost:${app_port}/api/health || echo "(App may still be starting...)"
echo ""
echo ">>> DNS64/NAT64: nat64.net (public, free)"
echo ">>> Domain: ${domain_name}"
echo ">>> Access via Cloudflare: https://${domain_name}"
