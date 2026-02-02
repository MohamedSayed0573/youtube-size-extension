# AWS EC2 Container Deployment Guide

Complete guide for deploying the YouTube Size Extension Cloud API to AWS EC2 using Docker containers.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Deployment Steps](#detailed-deployment-steps)
- [Configuration](#configuration)
- [Maintenance](#maintenance)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Local Machine

- **AWS CLI** installed and configured
  ```bash
  aws --version
  aws configure  # Set up your AWS credentials
  ```

- **Terraform** (recommended) or AWS CLI for infrastructure
  ```bash
  # Install Terraform
  wget https://releases.hashicorp.com/terraform/1.6.0/terraform_1.6.0_linux_amd64.zip
  unzip terraform_1.6.0_linux_amd64.zip
  sudo mv terraform /usr/local/bin/
  ```

- **Docker** for building images
  ```bash
  docker --version
  ```

- **Docker Hub account**
  - Sign up at [hub.docker.com](https://hub.docker.com)
  - Log in locally: `docker login`

- **SSH key pair** for EC2 access
  ```bash
  # Create a new key pair
  aws ec2 create-key-pair --key-name ytdlp-api-key \
    --query 'KeyMaterial' --output text > ~/.ssh/ytdlp-api-key.pem
  chmod 600 ~/.ssh/ytdlp-api-key.pem
  ```

### AWS Account

- Active AWS account with appropriate permissions
- Estimated monthly cost: **$15-20** for t3.small instance

## Quick Start

### Option 1: Terraform (Recommended)

```bash
# 1. Navigate to Terraform directory
cd cloud_api/aws-deployment/terraform

# 2. Edit terraform.tfvars with your settings
nano terraform.tfvars
# Set: key_name, ssh_allowed_ips, etc.

# 3. Initialize and apply Terraform
terraform init
terraform plan
terraform apply

# 4. Note the output (EC2 IP address)
terraform output

# 5. Wait for instance initialization (~3 minutes)
# Then deploy the application
cd ../..
./aws-deployment/scripts/deploy-docker-hub.sh
```

### Option 2: Manual AWS CLI

See [Manual Deployment](#manual-deployment) section below.

## Detailed Deployment Steps

### Step 1: Configure Infrastructure

Edit `aws-deployment/terraform/terraform.tfvars`:

```hcl
# Required: Your EC2 key pair name
key_name = "ytdlp-api-key"

# Recommended: Restrict SSH to your IP
ssh_allowed_ips = ["YOUR_IP/32"]  # Get your IP: curl ifconfig.me

# Optional: Change instance type or region
instance_type = "t3.small"  # or "t3.micro" for lower cost
aws_region = "us-east-1"
```

### Step 2: Provision Infrastructure

```bash
cd aws-deployment/terraform

# Initialize Terraform
terraform init

# Review planned changes
terraform plan

# Apply configuration
terraform apply
# Type 'yes' to confirm

# Save outputs
terraform output > ../outputs.txt
```

**Expected outputs:**
- `instance_public_ip`: Your EC2 instance IP
- `ssh_command`: Command to SSH into instance
- `api_url`: Your API endpoint URL

### Step 3: Configure Application

Edit `.env.production` with your production settings:

```bash
# Generate a secure API key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Edit .env.production
nano .env.production
```

**Critical settings:**
- `API_KEY`: Set to a strong random key
- `REQUIRE_AUTH`: Set to `true`
- `ALLOWED_ORIGINS`: Set to your extension ID or domain
- `SENTRY_DSN`: Add your Sentry DSN for error tracking

### Step 4: Deploy Application

We use Docker Hub to transfer the image, which is much more reliable than manual SCP.

```bash
# From cloud_api directory
./aws-deployment/scripts/deploy-docker-hub.sh
```

**The script will:**
1. Ask for your Docker Hub username
2. Build Docker image locally
3. Push to Docker Hub
4. Pull on EC2
5. Start container
6. Run health checks

**First deployment takes ~3-5 minutes** (depending on your upload speed).

### Step 5: Verify Deployment

```bash
# Get your EC2 IP
EC2_IP=$(cd aws-deployment/terraform && terraform output -raw instance_public_ip)

# Test health endpoint
curl http://$EC2_IP:3000/health

# Test API endpoint (with authentication)
curl -H "X-API-Key: YOUR_API_KEY" \
  "http://$EC2_IP:3000/api/video-size?url=https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

### Step 6: Set Up SSL (Optional but Recommended)

If you have a domain name:

```bash
# SSH into instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$EC2_IP

# Install Certbot
sudo apt update
sudo apt install -y certbot

# Install Nginx
sudo apt install -y nginx

# Configure Nginx as reverse proxy
sudo nano /etc/nginx/sites-available/ytdlp-api

# Add configuration (see nginx.conf in repo)
# Then enable site and get SSL certificate
sudo ln -s /etc/nginx/sites-available/ytdlp-api /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.yourdomain.com
```

## Configuration

### Environment Variables

Key production settings in `.env.production`:

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `REQUIRE_AUTH` | Enable API key auth | `true` |
| `API_KEY` | Secret API key | `abc123...` |
| `ALLOWED_ORIGINS` | CORS origins | `chrome-extension://xyz` |
| `SENTRY_DSN` | Error tracking | `https://...` |

### Instance Sizing

| Instance Type | vCPU | RAM | Cost/month | Use Case |
|---------------|------|-----|------------|----------|
| t3.micro | 2 | 1GB | ~$8 | Light usage (<1000 req/day) |
| t3.small | 2 | 2GB | ~$15 | **Recommended** (1K-10K req/day) |
| t3.medium | 2 | 4GB | ~$30 | Heavy usage (>10K req/day) |

## Maintenance

### Updating the Application

```bash
# Quick update (code changes only)
./aws-deployment/scripts/update-app.sh
```

### Viewing Logs

```bash
# SSH into instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$EC2_IP

# View container logs
docker logs -f ytdlp-api

# View last 100 lines
docker logs --tail 100 ytdlp-api
```

### Monitoring

```bash
# Check container status
docker ps

# View resource usage
docker stats ytdlp-api

# Run health check
/usr/local/bin/health-check
```

### Backup

```bash
# Backup environment file
scp -i ~/.ssh/ytdlp-api-key.pem \
  ubuntu@$EC2_IP:/opt/ytdlp-api/.env \
  ./backup/.env.backup

# Backup logs
scp -i ~/.ssh/ytdlp-api-key.pem -r \
  ubuntu@$EC2_IP:/opt/ytdlp-api/logs \
  ./backup/logs
```

### Scaling

To handle more traffic:

1. **Vertical scaling**: Change instance type
   ```bash
   cd aws-deployment/terraform
   # Edit terraform.tfvars: instance_type = "t3.medium"
   terraform apply
   ```

2. **Horizontal scaling**: Deploy multiple instances with load balancer
   - See `SCALING.md` for details
   - Use Redis for distributed rate limiting

## Troubleshooting

### Container Won't Start

```bash
# Check Docker logs
docker logs ytdlp-api

# Common issues:
# - Missing environment variables
# - Port already in use
# - Insufficient memory

# Restart container
docker restart ytdlp-api
```

### Health Check Fails

```bash
# Check if container is running
docker ps -a

# Check application logs
docker logs ytdlp-api

# Test yt-dlp installation
docker exec ytdlp-api yt-dlp --version

# Restart if needed
docker restart ytdlp-api
```

### Cannot Connect to Instance

```bash
# Check security group allows your IP
aws ec2 describe-security-groups \
  --group-ids $(cd aws-deployment/terraform && terraform output -raw security_group_id)

# Verify instance is running
aws ec2 describe-instances \
  --instance-ids $(cd aws-deployment/terraform && terraform output -raw instance_id)

# Check SSH key permissions
chmod 600 ~/.ssh/ytdlp-api-key.pem
```

### High Memory Usage

```bash
# Reduce worker pool size
# Edit .env.production:
MAX_WORKERS=4
MIN_WORKERS=2

# Redeploy
./aws-deployment/scripts/update-app.sh
```

### Rate Limiting Issues

For multiple instances, enable Redis:

```bash
# On EC2, edit .env
REDIS_ENABLED=true
REDIS_URL=redis://:password@redis:6379

# Use docker-compose instead
docker-compose up -d
```

## Manual Deployment

If not using Terraform:

### 1. Create EC2 Instance Manually

```bash
# Launch instance
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.small \
  --key-name ytdlp-api-key \
  --security-group-ids sg-xxxxx \
  --subnet-id subnet-xxxxx \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ytdlp-api}]'
```

### 2. Configure Security Group

```bash
# Allow SSH, HTTP, HTTPS, and API port
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxx \
  --protocol tcp --port 22 --cidr YOUR_IP/32

aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxx \
  --protocol tcp --port 3000 --cidr 0.0.0.0/0
```

### 3. Set Up Instance

```bash
# SSH into instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@EC2_IP

# Run setup script
curl -sSL https://raw.githubusercontent.com/yourusername/repo/main/aws-deployment/scripts/setup-instance.sh | sudo bash
```

### 4. Deploy Application

Follow Step 4 from [Detailed Deployment Steps](#detailed-deployment-steps).

## Cost Optimization

### Free Tier

AWS Free Tier includes:
- 750 hours/month of t2.micro (first 12 months)
- 30GB EBS storage

### Reducing Costs

1. **Use t3.micro** instead of t3.small (~$7/month savings)
2. **Stop instance when not needed** (development)
3. **Use spot instances** (up to 90% discount, but can be terminated)
4. **Enable detailed monitoring only when debugging**

### Monitoring Costs

```bash
# Check current month's estimated charges
aws ce get-cost-and-usage \
  --time-period Start=2026-02-01,End=2026-02-28 \
  --granularity MONTHLY \
  --metrics BlendedCost
```

## Cleanup

To destroy all resources:

```bash
cd aws-deployment/terraform
terraform destroy
# Type 'yes' to confirm
```

**Warning**: This will permanently delete your EC2 instance and all data.

## Next Steps

- Set up CloudWatch alarms for monitoring
- Configure automatic backups
- Implement CI/CD pipeline
- Set up staging environment
- Review security best practices

## Support

For issues or questions:
1. Check application logs: `docker logs ytdlp-api`
2. Review Sentry dashboard for errors
3. Check AWS CloudWatch (if enabled)
4. Review this documentation

---

**Security Reminder**: Always use strong API keys, restrict CORS origins, and limit SSH access to your IP address.
