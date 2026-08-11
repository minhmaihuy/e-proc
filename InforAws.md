
Outputs:

app_url = "https://epoc.devfasttrack.cloud"
connectivity_guide = <<EOT
┌────────────────────────────────────────────────────────────────────────┐
│ E-Audit IPv6-Only Platform Deployment Successful!                      │
├────────────────────────────────────────────────────────────────────────┤
│ Public IPv6 Address: 2406:da18:126d:9101:6fb8:b9ed:55a9:3200
│ EC2 Instance ID:     i-068b69b4852bfea99
│ S3 Backup Bucket:    eaudit-db-backup-a7c36c3a
├────────────────────────────────────────────────────────────────────────┤
│ How to Connect & Manage:                                               │
│                                                                        │
│ 1. [Free & No IPv6 Required] AWS SSM Session Manager:                   │
│    You can open a browser terminal directly from the AWS Console.      │
│    - Go to EC2 Console -> Select 'i-068b69b4852bfea99'           │
│    - Click "Connect" -> Select "Session Manager" tab -> Click "Connect"│
│    - Or run locally: aws ssm start-session --target i-068b69b4852bfea99
│                                                                        │
│ 2. [SSH via IPv6] (Only works if your home Internet supports IPv6):    │
│    ssh -i eaudit-key-ipv6.pem ubuntu@2406:da18:126d:9101:6fb8:b9ed:55a9:3200
│                                                                        │
│ 3. Cloudflare Setup:                                                   │
│    - Add an AAAA record pointing 'epoc' to:                            │
│      2406:da18:126d:9101:6fb8:b9ed:55a9:3200                          │
│    - Enable Cloudflare SSL/TLS Proxy and set to "Full" or "Full(strict)"│
└────────────────────────────────────────────────────────────────────────┘

EOT
ec2_instance_id = "i-068b69b4852bfea99"
ec2_public_ipv6 = "2406:da18:126d:9101:6fb8:b9ed:55a9:3200"
rds_endpoint = "eaudit-db.cj2qeu0i2g9c.ap-southeast-1.rds.amazonaws.com:5432"
s3_backup_bucket = "eaudit-db-backup-a7c36c3a"
