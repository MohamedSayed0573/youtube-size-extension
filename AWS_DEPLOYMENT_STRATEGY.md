# AWS EC2 Docker Deployment Strategy

## Overview

This document outlines the complete strategy for deploying the YouTube Size Extension API server on AWS EC2 using Docker, including infrastructure provisioning, containerization, and operational procedures.

---

## 1. Architecture Components

### 1.1 Deployment Stack

```
┌────────────────────────────────────────────────────────────┐
│               AWS Account (us-east-1)                      │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ VPC (10.0.0.0/16)                                   │ │
│  │                                                      │ │
│  │  ┌────────────────────────────────────────────────┐ │ │
│  │  │ Public Subnet (10.0.1.0/24)                   │ │ │
│  │  │                                                │ │ │
│  │  │  ┌─────────────────────────────────────────┐  │ │ │
│  │  │  │ EC2 Instance (t3.small)                │  │ │ │
│  │  │  │ - Ubuntu 22.04 LTS                     │  │ │ │
│  │  │  │ - Docker Runtime                       │  │ │ │
│  │  │  │ - 2 vCPU, 2GB RAM                      │  │ │ │
│  │  │  │ - 20GB EBS Volume (gp3)                │  │ │ │
│  │  │  │                                        │  │ │ │
│  │  │  │  ┌──────────────────────────────────┐ │  │ │ │
│  │  │  │  │ Docker Container (API)          │ │  │ │ │
│  │  │  │  │ - Node.js 20                    │ │  │ │ │
│  │  │  │  │ - yt-dlp                        │ │  │ │ │
│  │  │  │  │ - Port 3000                     │ │  │ │ │
│  │  │  │  └──────────────────────────────────┘ │  │ │ │
│  │  │  │                                        │  │ │ │
│  │  │  │  ┌──────────────────────────────────┐ │  │ │ │
│  │  │  │  │ Docker Container (Redis)        │ │  │ │ │
│  │  │  │  │ - Cache/Session Storage         │ │  │ │ │
│  │  │  │  │ - Port 6379                     │ │  │ │ │
│  │  │  │  └──────────────────────────────────┘ │  │ │ │
│  │  │  │                                        │  │ │ │
│  │  │  └─────────────────────────────────────────┘  │ │ │
│  │  │                                                │ │ │
│  │  │  ┌─────────────────────────────────────────┐  │ │ │
│  │  │  │ Nginx Reverse Proxy (optional)        │  │ │ │
│  │  │  │ - Port 80 → 3000                      │  │ │ │
│  │  │  │ - Port 443 (SSL/TLS)                 │  │ │ │
│  │  │  └─────────────────────────────────────────┘  │ │ │
│  │  └────────────────────────────────────────────────┘ │ │
│  │                                                      │ │
│  │  ┌────────────────────────────────────────────────┐ │ │
│  │  │ Security Group                                │ │ │
│  │  │ - SSH (22) - restricted to your IP            │ │ │
│  │  │ - HTTP (80) - public                          │ │ │
│  │  │ - HTTPS (443) - public                        │ │ │
│  │  │ - Custom ports - internal only                │ │ │
│  │  └────────────────────────────────────────────────┘ │ │
│  │                                                      │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Monitoring & Logging                               │ │
│  │ - CloudWatch (optional)                            │ │
│  │ - Sentry (error tracking)                          │ │
│  │ - Docker logs (JSON format)                        │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
User Request
    ↓
┌─────────────────────────────────────┐
│ Nginx Reverse Proxy (Port 443)      │
│ - HTTPS/SSL Termination             │
│ - Request logging                   │
│ - Rate limiting                     │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Express API (Port 3000)             │
│ - Request validation                │
│ - Route handling                    │
│ - Error handling                    │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ yt-dlp Worker Pool                  │
│ - Video metadata extraction         │
│ - Concurrent requests (2-10 workers)│
│ - Circuit breaker pattern           │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Redis Cache                         │
│ - Result caching (1 hour TTL)       │
│ - Session storage                   │
│ - Rate limit counters               │
└─────────────────────────────────────┘
    ↓
Response → User
```

---

## 2. Deployment Workflow

### 2.1 Phase 1: Prerequisites (Estimated time: 15 minutes)

```bash
# 1. Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# 2. Configure AWS credentials
aws configure
# Enter your AWS Access Key ID and Secret Access Key

# 3. Install Terraform
wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip
unzip terraform_1.6.0_linux_amd64.zip
sudo mv terraform /usr/local/bin/

# 4. Create EC2 key pair
aws ec2 create-key-pair \
  --key-name ytdlp-api-key \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/ytdlp-api-key.pem
chmod 400 ~/.ssh/ytdlp-api-key.pem

# 5. Verify installation
aws --version
terraform version
ssh -V
```

### 2.2 Phase 2: Infrastructure Provisioning (Estimated time: 10-15 minutes)

```bash
# 1. Navigate to terraform directory
cd cloud_api/aws-deployment/terraform

# 2. Update terraform.tfvars with your settings
cat terraform.tfvars

# 3. Initialize Terraform
terraform init

# 4. Plan infrastructure
terraform plan -out=tfplan

# 5. Review the plan and apply
terraform apply tfplan

# 6. Save outputs
terraform output -json > ../outputs.json
```

**What gets created:**
- VPC with CIDR 10.0.0.0/16
- Public subnet with CIDR 10.0.1.0/24
- Internet Gateway
- Route tables and associations
- Security group with SSH/HTTP/HTTPS access
- EC2 instance (Ubuntu 22.04 LTS)
- EBS volume (20GB gp3)

### 2.3 Phase 3: Containerization (Estimated time: 5 minutes)

```bash
# 1. Build Docker image locally (for testing)
docker build -t ytdlp-sizer-api:latest cloud_api/

# 2. Test the image locally
docker run -p 3000:3000 ytdlp-sizer-api:latest

# 3. Tag for registry (optional - for Docker Hub/ECR)
docker tag ytdlp-sizer-api:latest your-registry/ytdlp-sizer-api:latest

# 4. Push to registry
docker push your-registry/ytdlp-sizer-api:latest
```

### 2.4 Phase 4: Instance Configuration (Estimated time: 2-3 minutes)

```bash
# 1. Get EC2 instance public IP
PUBLIC_IP=$(terraform output -raw instance_public_ip)

# 2. Test SSH connection
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# 3. Run automated setup script
./scripts/deploy.sh $PUBLIC_IP your-registry/ytdlp-sizer-api latest

# OR manually run:
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP << 'EOF'
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER
  newgrp docker
  mkdir -p ~/ytdlp-api
EOF
```

### 2.5 Phase 5: Container Deployment (Estimated time: 2-3 minutes)

```bash
# 1. Connect to instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# 2. Create docker-compose configuration
cat > ~/ytdlp-api/docker-compose.yml << 'EOF'
version: '3.8'
services:
  api:
    image: your-registry/ytdlp-sizer-api:latest
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      SENTRY_DSN: ${SENTRY_DSN}
      REDIS_ENABLED: "true"
      REDIS_URL: redis://redis:6379
    restart: unless-stopped
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  redis_data:
EOF

# 3. Create environment file
cat > ~/ytdlp-api/.env << 'EOF'
NODE_ENV=production
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
EOF

# 4. Start containers
cd ~/ytdlp-api
docker-compose up -d
docker-compose ps
```

### 2.6 Phase 6: Verification (Estimated time: 2 minutes)

```bash
# 1. Check container status
docker ps

# 2. Test API endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/docs

# 3. Test with actual YouTube URL
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}'

# 4. View logs
docker-compose logs -f api
```

---

## 3. Configuration Management

### 3.1 Environment Variables

| Variable | Default | Purpose | Example |
|----------|---------|---------|---------|
| `NODE_ENV` | `production` | Runtime environment | `production` |
| `PORT` | `3000` | Express server port | `3000` |
| `SENTRY_DSN` | (empty) | Error tracking | `https://key@sentry.io/id` |
| `REDIS_ENABLED` | `true` | Enable Redis cache | `true` |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string | `redis://redis:6379` |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max requests per window | `100` |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) | `60000` |
| `LOG_LEVEL` | `info` | Logging verbosity | `info`, `debug`, `error` |

### 3.2 Secrets Management

**Option A: Environment File (.env)**
```bash
# .env file in ~/ytdlp-api/
NODE_ENV=production
SENTRY_DSN=https://your-sentry-key@sentry.io/project-id
```

**Option B: AWS Secrets Manager** (Recommended for production)
```bash
# Store in AWS Secrets Manager
aws secretsmanager create-secret \
  --name ytdlp-api/prod/sentry-dsn \
  --secret-string "https://your-sentry-key@sentry.io/project-id"

# Retrieve in docker-compose
SENTRY_DSN=$(aws secretsmanager get-secret-value \
  --secret-id ytdlp-api/prod/sentry-dsn \
  --query SecretString \
  --output text)
```

**Option C: Parameter Store**
```bash
# Store in AWS Systems Manager Parameter Store
aws ssm put-parameter \
  --name /ytdlp-api/prod/sentry-dsn \
  --value "https://your-sentry-key@sentry.io/project-id" \
  --type SecureString

# Retrieve in docker-compose
SENTRY_DSN=$(aws ssm get-parameter \
  --name /ytdlp-api/prod/sentry-dsn \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text)
```

---

## 4. Production Hardening

### 4.1 SSL/TLS with Let's Encrypt

```bash
# 1. SSH into instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# 2. Install Nginx and Certbot
sudo apt-get install -y nginx certbot python3-certbot-nginx

# 3. Get SSL certificate (replace domain.com)
sudo certbot certonly --standalone \
  -d api.domain.com \
  -m admin@domain.com \
  --agree-tos

# 4. Configure Nginx reverse proxy
sudo tee /etc/nginx/sites-available/default > /dev/null << 'EOF'
upstream api {
    server localhost:3000;
}

server {
    listen 80;
    server_name api.domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.domain.com;

    ssl_certificate /etc/letsencrypt/live/api.domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
EOF

# 5. Enable Nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# 6. Auto-renew certificates
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### 4.2 Firewall Configuration

```bash
# SSH into instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# Enable UFW (Uncomplicated Firewall)
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP
sudo ufw allow 80/tcp

# Allow HTTPS
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Verify
sudo ufw status
```

### 4.3 Fail2ban (Brute Force Protection)

```bash
# Install Fail2ban
sudo apt-get install -y fail2ban

# Configure for SSH protection
sudo tee /etc/fail2ban/jail.local > /dev/null << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
EOF

# Start Fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Check status
sudo fail2ban-client status
```

---

## 5. Monitoring & Observability

### 5.1 Application Monitoring (Sentry)

```bash
# 1. Go to https://sentry.io and create account
# 2. Create a project for Node.js/Express
# 3. Copy the DSN
# 4. Update .env file:
echo "SENTRY_DSN=https://key@sentry.io/project-id" >> ~/ytdlp-api/.env

# 5. Restart API container
docker-compose restart api

# 6. Verify errors are tracked
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -d '{"url":"invalid-url"}'

# Errors should appear in Sentry dashboard
```

### 5.2 Docker Log Monitoring

```bash
# View real-time logs
docker-compose logs -f api

# View logs for last 100 lines
docker-compose logs api --tail=100

# View logs with timestamps
docker-compose logs api --timestamps

# Export logs to file
docker-compose logs api > api-logs.txt

# View specific time range (requires json-file logging driver)
docker logs api --since 2024-01-01T00:00:00 --until 2024-01-02T00:00:00
```

### 5.3 CloudWatch Integration (Optional)

```bash
# Install CloudWatch Logs agent
sudo apt-get install -y awslogs

# Configure CloudWatch Logs
sudo tee /etc/awslogs/config/docker.conf > /dev/null << 'EOF'
[/var/log/docker]
log_group_name = /aws/ec2/ytdlp-api
log_stream_name = docker-logs
file = /var/lib/docker/containers/*/*.log
datetime_format = %Y-%m-%dT%H:%M:%S
EOF

# Start CloudWatch Logs agent
sudo systemctl start awslogsd
sudo systemctl enable awslogsd

# View in AWS Console
# CloudWatch → Logs → /aws/ec2/ytdlp-api
```

---

## 6. Scaling & High Availability

### 6.1 Vertical Scaling (Upgrade Instance)

```bash
# 1. Stop container
docker-compose down

# 2. Stop EC2 instance
aws ec2 stop-instances --instance-ids i-0123456789abcdef0

# 3. Change instance type (e.g., t3.small → t3.medium)
aws ec2 modify-instance-attribute \
  --instance-id i-0123456789abcdef0 \
  --instance-type "{\"Value\": \"t3.medium\"}"

# 4. Start instance
aws ec2 start-instances --instance-ids i-0123456789abcdef0

# 5. Wait and reconnect
sleep 30
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# 6. Restart container
cd ~/ytdlp-api
docker-compose up -d
```

### 6.2 Horizontal Scaling (Multiple Instances)

For multiple EC2 instances, use:
- **AWS Elastic Load Balancer (ELB)** for traffic distribution
- **Auto Scaling Group** for automatic instance management
- **Application Load Balancer (ALB)** for advanced routing

```bash
# This would require additional Terraform configuration
# See AWS documentation for ELB setup
```

### 6.3 Database Scaling (RDS)

```bash
# Create RDS instance for persistent data
aws rds create-db-instance \
  --db-instance-identifier ytdlp-api-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --allocated-storage 20 \
  --master-username postgres \
  --master-user-password "your-secure-password"
```

---

## 7. Backup & Recovery

### 7.1 Redis Backup

```bash
# Create backup directory
mkdir -p ~/backups

# Trigger Redis backup
docker exec redis redis-cli BGSAVE

# Copy backup file
docker cp redis:/data/dump.rdb ~/backups/dump.rdb.$(date +%Y%m%d_%H%M%S)

# Automated daily backup (cron)
crontab -e
# Add: 0 2 * * * docker exec redis redis-cli BGSAVE && cp /var/lib/docker/volumes/*/data/dump.rdb ~/backups/dump.rdb.$(date +\%Y\%m\%d)
```

### 7.2 EBS Volume Snapshot

```bash
# Create snapshot of EC2 volume
VOLUME_ID=$(aws ec2 describe-instances \
  --instance-ids i-0123456789abcdef0 \
  --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' \
  --output text)

aws ec2 create-snapshot \
  --volume-id $VOLUME_ID \
  --description "ytdlp-api backup $(date +%Y-%m-%d)"

# List snapshots
aws ec2 describe-snapshots --filters "Name=volume-id,Values=$VOLUME_ID"
```

### 7.3 Disaster Recovery

```bash
# To restore from snapshot:
# 1. Create new volume from snapshot
aws ec2 create-volume \
  --snapshot-id snap-0123456789abcdef0 \
  --availability-zone us-east-1a

# 2. Attach to new EC2 instance
# 3. Mount and restore
```

---

## 8. Cost Optimization

### 8.1 Instance Sizing

| Tier | Instance Type | vCPU | RAM | EBS | Monthly Cost |
|------|---------------|------|-----|-----|--------------|
| Minimal | t3.micro | 1 | 1GB | 20GB | ~$10 |
| Small | t3.small | 2 | 2GB | 20GB | ~$18 |
| Medium | t3.medium | 2 | 4GB | 20GB | ~$32 |
| Large | t3.large | 2 | 8GB | 20GB | ~$65 |

**Recommendation for starting:** t3.small ($18/month)

### 8.2 Cost Reduction Strategies

- **Reserved Instances:** Save 40% with 1-year commitment
- **Spot Instances:** Save 70% (suitable for non-critical workloads)
- **VPC Endpoint:** Reduce data transfer costs
- **CloudFront:** Cache static assets at edge locations
- **EBS Optimization:** Right-size volume capacity

### 8.3 Cost Estimation

```
EC2 (t3.small)      $18.00
EBS Volume (20GB)   $ 2.00
Data Transfer       $ 5.00 (estimated, 100GB/month)
Route53 (DNS)       $ 0.50
─────────────────────────────
Total Monthly       ~$25.50
```

---

## 9. Troubleshooting Guide

### 9.1 Container Won't Start

```bash
# Check Docker logs
docker logs api

# Check system resources
docker stats

# Check port availability
sudo lsof -i :3000

# Rebuild image
docker-compose build --no-cache api

# Restart with verbose output
docker-compose up api (no -d flag to see output)
```

### 9.2 Redis Connection Issues

```bash
# Check Redis container
docker ps | grep redis

# Test Redis connection
docker exec redis redis-cli ping

# View Redis logs
docker logs redis

# Check REDIS_URL environment variable
docker inspect api | grep REDIS_URL

# Restart Redis
docker-compose restart redis
```

### 9.3 High Memory Usage

```bash
# Check memory usage
docker stats

# Check if memory leaks
docker ps -a | grep exited  # Find stopped containers

# Clean up unused containers
docker container prune

# Remove unused images
docker image prune

# Limit container memory
# Edit docker-compose.yml:
# services:
#   api:
#     mem_limit: 1g
#     memswap_limit: 1g
```

### 9.4 API Not Responding

```bash
# Test from instance
curl http://localhost:3000/health

# Test from external
curl http://$PUBLIC_IP:3000/health

# Check security group rules
aws ec2 describe-security-groups \
  --group-ids sg-0123456789abcdef0

# Check network connectivity
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP
sudo tcpdump -i eth0 -n port 3000
```

### 9.5 Out of Disk Space

```bash
# Check disk usage
df -h

# Find large files
du -sh /* | sort -rh

# Clean Docker resources
docker system prune -a

# Remove old logs
docker logs api --since 30d > /dev/null

# Check Docker volume size
docker volume ls
docker volume inspect redis_data
```

---

## 10. Maintenance Checklist

### Daily
- [ ] Monitor Sentry dashboard for errors
- [ ] Check API response times
- [ ] Verify database backups completed

### Weekly
- [ ] Review CloudWatch logs
- [ ] Check disk usage
- [ ] Update system packages (`sudo apt-get update`)
- [ ] Review error logs

### Monthly
- [ ] Test backup recovery procedures
- [ ] Review security group rules
- [ ] Analyze costs and optimize
- [ ] Update Docker images
- [ ] Review Sentry insights

### Quarterly
- [ ] Upgrade to new Node.js LTS version
- [ ] Review and update dependencies
- [ ] Conduct security audit
- [ ] Test disaster recovery plan
- [ ] Capacity planning review

---

## 11. Quick Reference Commands

```bash
# Deployment
terraform init && terraform apply
./scripts/deploy.sh $PUBLIC_IP

# Container Management
docker-compose up -d           # Start
docker-compose down            # Stop
docker-compose restart api     # Restart API
docker-compose logs -f api     # View logs

# Monitoring
docker stats                   # Resource usage
docker ps                      # Container status
curl http://localhost:3000/health  # Health check

# SSH
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# Cleanup
docker system prune -a         # Remove unused resources
docker image prune -a          # Remove unused images
docker volume prune            # Remove unused volumes

# Destroy Infrastructure
terraform destroy --auto-approve
```

---

## 12. References

- **Docker Documentation:** https://docs.docker.com/
- **Docker Compose:** https://docs.docker.com/compose/
- **Terraform AWS:** https://registry.terraform.io/providers/hashicorp/aws/latest/docs
- **AWS EC2:** https://docs.aws.amazon.com/ec2/
- **Sentry Docs:** https://docs.sentry.io/
- **Let's Encrypt:** https://letsencrypt.org/docs/
- **Redis:** https://redis.io/documentation
- **Node.js:** https://nodejs.org/en/docs/

---

## Next Steps

1. **Configure AWS credentials** → Run `aws configure`
2. **Create EC2 key pair** → `aws ec2 create-key-pair ...`
3. **Update Terraform variables** → Edit `terraform/terraform.tfvars`
4. **Deploy infrastructure** → `cd terraform && terraform apply`
5. **Get EC2 IP** → `terraform output instance_public_ip`
6. **Deploy containers** → `./scripts/deploy.sh $IP`
7. **Configure Sentry** → Get DSN from https://sentry.io
8. **Set up HTTPS** → Follow section 4.1
9. **Monitor** → Check Sentry dashboard and logs

---

**Questions or issues?** Check the troubleshooting guide (Section 9) or review the detailed DOCKER_DEPLOYMENT.md file.
