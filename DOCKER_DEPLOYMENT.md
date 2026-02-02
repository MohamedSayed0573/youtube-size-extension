# Docker Deployment Guide for AWS EC2

This guide walks you through deploying the YouTube Size Extension API server on AWS EC2 using Docker and Terraform.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     AWS EC2 Instance                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  Docker Container                      │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  Node.js Express Server (cloud_api)             │ │ │
│  │  │  - API endpoints                                │ │ │
│  │  │  - Worker pool (yt-dlp)                         │ │ │
│  │  │  - Circuit breaker                              │ │ │
│  │  │  - Sentry monitoring                            │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Port: 3000 (mapped to 80/443 via load balancer)           │
│  Storage: EBS volume (20GB by default)                      │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Local Machine
- AWS CLI configured with credentials
- Terraform installed (v1.0+)
- Docker installed (for testing)
- Git

### AWS Account
- AWS account with appropriate permissions
- EC2 key pair created (for SSH access)

## Step 1: Configure AWS Credentials

### Option A: AWS CLI Configuration (Recommended)

```bash
# Configure AWS credentials interactively
aws configure

# Enter your AWS Access Key ID and Secret Access Key
# Example:
# AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
# AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
# Default region name [None]: us-east-1
# Default output format [None]: json
```

### Option B: Environment Variables

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-1"
```

## Step 2: Create EC2 Key Pair

```bash
# Create a key pair for SSH access
aws ec2 create-key-pair \
  --key-name ytdlp-api-key \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/ytdlp-api-key.pem

# Secure the key file
chmod 400 ~/.ssh/ytdlp-api-key.pem
```

## Step 3: Update Terraform Configuration

Edit `cloud_api/aws-deployment/terraform/terraform.tfvars`:

```hcl
aws_region = "us-east-1"
project_name = "ytdlp-api"
environment = "production"
instance_type = "t3.small"
key_name = "ytdlp-api-key"  # Must match the key pair name above

# Restrict SSH to your IP (recommended)
# Find your IP: curl ifconfig.me
ssh_allowed_ips = ["YOUR_IP/32"]  # e.g., ["203.0.113.0/32"]

root_volume_size = 20
enable_monitoring = true
tags = {
  ManagedBy = "Terraform"
  Project   = "YouTube Size Extension"
}
```

## Step 4: Deploy Infrastructure with Terraform

```bash
cd cloud_api/aws-deployment/terraform

# Initialize Terraform (first time only)
terraform init

# Preview the infrastructure
terraform plan

# Create the infrastructure
terraform apply

# Save the outputs (you'll need the EC2 public IP)
terraform output -json > outputs.json
```

Expected resources created:
- VPC with public subnet
- Internet Gateway
- Security Group (port 22 for SSH, 80/443 for HTTP/HTTPS)
- EC2 instance (Ubuntu 22.04)
- EBS volume (20GB)

## Step 5: Deploy Docker Container

After Terraform completes, retrieve the EC2 instance public IP:

```bash
# Get the public IP from Terraform outputs
PUBLIC_IP=$(terraform output -raw instance_public_ip)
echo "EC2 Instance IP: $PUBLIC_IP"
```

### Option A: Automated Deployment Script

We'll create a deployment script that:
1. Connects to the EC2 instance
2. Installs Docker and Docker Compose
3. Pulls the latest Docker image
4. Starts the container

```bash
# Make the script executable
chmod +x cloud_api/aws-deployment/scripts/deploy.sh

# Run the deployment
./cloud_api/aws-deployment/scripts/deploy.sh $PUBLIC_IP
```

### Option B: Manual Deployment

```bash
# 1. SSH into the EC2 instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# 2. Once on the instance, update the system
sudo apt-get update
sudo apt-get upgrade -y

# 3. Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# 4. Add your user to docker group
sudo usermod -aG docker $USER
newgrp docker

# 5. Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 6. Create application directory
mkdir -p ~/ytdlp-api
cd ~/ytdlp-api

# 7. Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  api:
    image: your-docker-registry/ytdlp-sizer-api:latest
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      SENTRY_DSN: ${SENTRY_DSN}
      REDIS_ENABLED: "true"
      REDIS_URL: redis://redis:6379
      RATE_LIMIT_MAX_REQUESTS: 100
      RATE_LIMIT_WINDOW_MS: 60000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    volumes:
      - redis_data:/data

volumes:
  redis_data:
EOF

# 8. Set environment variables
cat > .env << 'EOF'
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
NODE_ENV=production
EOF

# 9. Start the containers
docker-compose up -d

# 10. Verify the service is running
docker-compose logs -f api
```

## Step 6: Verify Deployment

```bash
# Check if the container is running
docker ps

# Check the logs
docker logs -f $(docker ps -q)

# Test the API
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/docs

# Test the health endpoint
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw"}'
```

## Step 7: Set Up HTTPS/SSL (Recommended for Production)

### Using Let's Encrypt with Nginx Reverse Proxy

```bash
# 1. Install Nginx
sudo apt-get install -y nginx

# 2. Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 3. Get SSL certificate
sudo certbot certonly --nginx -d your-domain.com

# 4. Configure Nginx
sudo cat > /etc/nginx/sites-available/default << 'EOF'
upstream api {
    server localhost:3000;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# 5. Test and enable Nginx
sudo nginx -t
sudo systemctl restart nginx

# 6. Auto-renew certificates
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

## Step 8: Monitor and Maintain

### Health Checks

```bash
# Check container status
docker ps

# View logs
docker logs -f api

# View resource usage
docker stats

# Restart container
docker-compose restart api
```

### Backup Redis Data

```bash
# Create backup directory
mkdir -p ~/backups

# Backup Redis data
docker exec redis redis-cli BGSAVE

# Copy backup file
docker cp redis:/data/dump.rdb ~/backups/dump.rdb.$(date +%Y%m%d)
```

### Update Docker Image

```bash
# Pull latest image
docker pull your-docker-registry/ytdlp-sizer-api:latest

# Restart with new image
docker-compose up -d api

# Verify
docker-compose logs api
```

## Step 9: Monitoring with Sentry

1. Go to https://sentry.io
2. Create a project for your API
3. Copy the DSN
4. Update the `.env` file with your Sentry DSN
5. Restart the container:

```bash
docker-compose restart api
```

Errors will now be automatically tracked in your Sentry dashboard.

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs api

# Check if port 3000 is already in use
sudo lsof -i :3000

# Rebuild the image
docker-compose build --no-cache

# Restart
docker-compose up -d
```

### DNS resolution issues

```bash
# Check DNS configuration
docker exec api nslookup redis

# Add DNS to docker-compose.yml if needed
# dns:
#   - 8.8.8.8
#   - 8.8.4.4
```

### Out of disk space

```bash
# Check disk usage
df -h

# Clean up Docker images
docker image prune -a

# Clean up volumes
docker volume prune
```

### Redis connection failed

```bash
# Check Redis is running
docker ps | grep redis

# Test Redis connection
docker exec redis redis-cli ping

# Restart Redis
docker-compose restart redis
```

## Production Checklist

- [ ] AWS credentials configured
- [ ] Terraform infrastructure deployed
- [ ] EC2 instance running
- [ ] Docker containers running
- [ ] Health endpoints responding
- [ ] HTTPS/SSL configured
- [ ] Sentry monitoring enabled
- [ ] Backup strategy in place
- [ ] Auto-scaling policies configured (optional)
- [ ] CloudWatch alarms set up (optional)

## Cleanup (Destroy Infrastructure)

```bash
cd cloud_api/aws-deployment/terraform

# Remove all AWS resources
terraform destroy

# Confirm destruction
# Type "yes" when prompted
```

## Cost Estimation

| Service | Instance Type | Monthly Cost |
|---------|--------------|--------------|
| EC2 | t3.micro | ~$8 |
| EC2 | t3.small | ~$15 |
| EC2 | t3.medium | ~$30 |
| EBS | 20GB | ~$2 |
| Data Transfer | 100GB/month | ~$5 |

**Total (t3.small):** ~$22/month

## Next Steps

1. Set up GitHub Actions for automated deployment
2. Configure auto-scaling for high traffic
3. Set up RDS for database (if needed)
4. Configure CloudFront CDN (for static assets)
5. Set up monitoring alerts in CloudWatch

## References

- [Docker Documentation](https://docs.docker.com/)
- [AWS EC2 Documentation](https://docs.aws.amazon.com/ec2/)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [Sentry Documentation](https://docs.sentry.io/)
