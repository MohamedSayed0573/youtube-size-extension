# Deployment Infrastructure Overview

## What's Already In Place

Your project has a complete Docker and AWS deployment infrastructure ready to use.

### ✅ Docker Container (Dockerfile)

**Location:** `/cloud_api/Dockerfile`

**Features:**
- Multi-stage build (optimized for production)
- Node.js 20 (latest LTS)
- yt-dlp pre-installed (v5+)
- Non-root user (security best practice)
- dumb-init signal handling
- Health check endpoint
- ~76 lines of well-structured configuration

**Build time:** ~2-3 minutes (includes yt-dlp download)

**Image size:** ~300MB

```bash
# Build the image
docker build -t ytdlp-sizer-api:latest cloud_api/

# Run locally
docker run -p 3000:3000 ytdlp-sizer-api:latest

# Test
curl http://localhost:3000/health
```

---

### ✅ Terraform Infrastructure

**Location:** `/cloud_api/aws-deployment/terraform/`

**Files:**
- `main.tf` (282 lines) - AWS resource definitions
- `variables.tf` - Input variables
- `outputs.tf` - Output values
- `terraform.tfvars` - Configuration

**Resources Created:**
- VPC (10.0.0.0/16)
- Public Subnet (10.0.1.0/24)
- Internet Gateway
- Route Tables & Routes
- Security Group (SSH, HTTP, HTTPS)
- EC2 Instance (Ubuntu 22.04 LTS)
  - Instance type: t3.small (configurable)
  - vCPU: 2
  - Memory: 2GB
  - EBS Volume: 20GB gp3

**Status:**
```bash
cd cloud_api/aws-deployment/terraform
terraform init          # ✅ Done
terraform plan          # ❌ Blocked (needs AWS credentials)
terraform apply         # ❌ Blocked (needs AWS credentials)
```

**Next steps to unblock:**
```bash
# 1. Configure AWS credentials
aws configure
# Enter your AWS Access Key ID and Secret

# 2. Try terraform plan again
terraform plan

# 3. Apply if plan looks good
terraform apply
```

---

### ✅ Deployment Scripts

**Location:** `/cloud_api/aws-deployment/scripts/`

**Available scripts:**

1. **deploy.sh** - Automated deployment
   ```bash
   chmod +x deploy.sh
   ./deploy.sh <EC2_IP> [docker_registry] [image_tag]
   # Example: ./deploy.sh 54.123.45.67 your-registry/ytdlp-sizer-api latest
   ```
   
   **What it does:**
   - Tests SSH connection
   - Installs Docker and Docker Compose
   - Creates deployment directory
   - Sets up docker-compose.yml
   - Starts API and Redis containers
   - Verifies deployment

2. **health-check.sh** - Health verification
   ```bash
   chmod +x health-check.sh
   ./health-check.sh
   ```

3. **setup-instance.sh** - Manual instance setup
   ```bash
   chmod +x setup-instance.sh
   scp setup-instance.sh ubuntu@$EC2_IP:/home/ubuntu/
   ssh ubuntu@$EC2_IP ./setup-instance.sh
   ```

4. **update-app.sh** - Application update
   ```bash
   chmod +x update-app.sh
   ./update-app.sh
   ```

---

### ✅ Docker Compose Configuration

**Location:** `/docker-compose.yml` and `cloud_api/aws-deployment/terraform/`

**Services defined:**
1. **API Service** (Node.js Express)
   - Port: 3000
   - Health check: /health endpoint
   - Environment: Configurable
   - Logging: JSON format
   - Restart: unless-stopped

2. **Redis Service** (Cache)
   - Port: 6379
   - Persistence: AOF enabled
   - Health check: redis-cli ping
   - Logging: JSON format
   - Restart: unless-stopped

**Networks:** Internal Docker network for API ↔ Redis communication

**Volumes:** Named volume for Redis data persistence

---

## How Everything Works Together

```
┌─────────────────────────────────────────────────────────┐
│ Your Local Machine                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Run Terraform                                      │
│     cd cloud_api/aws-deployment/terraform             │
│     terraform apply                                    │
│              ↓                                         │
│  2. Get EC2 Public IP                                 │
│     PUBLIC_IP=$(terraform output -raw instance_...)  │
│              ↓                                         │
│  3. Run Deployment Script                             │
│     ./scripts/deploy.sh $PUBLIC_IP                    │
│              ↓                                         │
└─────────────────────────────────────────────────────────┘
                         ↓
         AWS (us-east-1 region)
                         ↓
┌─────────────────────────────────────────────────────────┐
│ AWS EC2 Instance (Ubuntu 22.04 LTS)                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Docker & Docker Compose installed                  │
│  2. SSH Key pair configured                            │
│  3. Security Group allows SSH/HTTP/HTTPS              │
│  4. EBS volume (20GB) attached                         │
│              ↓                                         │
│  5. Deploy script:                                     │
│     - Pulls Docker image                              │
│     - Starts API container (port 3000)                │
│     - Starts Redis container (port 6379)              │
│     - Sets up docker-compose.yml                      │
│     - Verifies health checks                          │
│              ↓                                         │
│  6. Services Running:                                 │
│     - API: http://localhost:3000                      │
│     - Redis: localhost:6379                           │
│     - Health: http://localhost:3000/health            │
│                                                         │
│  7. Access from External:                             │
│     - curl http://<PUBLIC_IP>:3000/health             │
│     - curl http://<PUBLIC_IP>:3000/api/v1/docs       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Complete Deployment Checklist

### Prerequisites (Do Once)
- [ ] AWS Account created
- [ ] AWS CLI installed
- [ ] Terraform installed
- [ ] Docker installed locally
- [ ] SSH client installed

### Setup Phase
- [ ] Run: `aws configure` (provide credentials)
- [ ] Create key pair: `aws ec2 create-key-pair --key-name ytdlp-api-key ...`
- [ ] Save key: `chmod 400 ~/.ssh/ytdlp-api-key.pem`
- [ ] Test: `ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@localhost`

### Infrastructure Phase
- [ ] Review: `cat cloud_api/aws-deployment/terraform/terraform.tfvars`
- [ ] Initialize: `terraform init`
- [ ] Plan: `terraform plan`
- [ ] Apply: `terraform apply`
- [ ] Save output: `terraform output > outputs.json`

### Deployment Phase
- [ ] Get IP: `PUBLIC_IP=$(terraform output -raw instance_public_ip)`
- [ ] Test SSH: `ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP`
- [ ] Run deploy: `./cloud_api/aws-deployment/scripts/deploy.sh $PUBLIC_IP`
- [ ] Wait: ~5 minutes for Docker build and container startup

### Verification Phase
- [ ] Test health: `curl http://$PUBLIC_IP:3000/health`
- [ ] Check logs: `ssh ubuntu@$PUBLIC_IP -i ~/.ssh/ytdlp-api-key.pem`
- [ ] Run API test: `curl -X POST http://$PUBLIC_IP:3000/api/v1/size ...`
- [ ] Monitor: Check Sentry dashboard for errors

### Production Hardening Phase
- [ ] Set up HTTPS with Let's Encrypt
- [ ] Configure Nginx reverse proxy
- [ ] Update Sentry DSN in environment
- [ ] Enable CloudWatch monitoring
- [ ] Set up automated backups
- [ ] Configure fail2ban for security

---

## Key Decision Points

### 1. Docker Registry
**Options:**
- **Docker Hub:** Free, public images
  ```bash
  docker tag ytdlp-sizer-api:latest youruser/ytdlp-sizer-api:latest
  docker push youruser/ytdlp-sizer-api:latest
  ```

- **AWS ECR:** Private, integrated with AWS
  ```bash
  aws ecr create-repository --repository-name ytdlp-sizer-api
  aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
  docker tag ytdlp-sizer-api:latest <account>.dkr.ecr.us-east-1.amazonaws.com/ytdlp-sizer-api:latest
  docker push <account>.dkr.ecr.us-east-1.amazonaws.com/ytdlp-sizer-api:latest
  ```

- **Local:** For testing only
  ```bash
  ./scripts/deploy.sh $PUBLIC_IP local latest
  ```

### 2. HTTPS/SSL
**Options:**
- **Let's Encrypt (Free):** Recommended for production
  - Auto-renewal available
  - No cost
  - Setup: ~5 minutes

- **AWS Certificate Manager (Free):** AWS integrated
  - Requires AWS Load Balancer
  - More complex setup

- **Self-signed:** Dev/test only
  - Quick but insecure

### 3. Monitoring
**Options:**
- **Sentry (Free tier):** Error tracking
  - Already integrated in code
  - 50 errors/month free

- **CloudWatch:** AWS native
  - Pay per metric
  - Better for metrics

- **Both:** Recommended for production
  - Sentry for errors
  - CloudWatch for metrics

### 4. Scaling
**Options:**
- **Vertical:** Upgrade instance type (t3.small → t3.medium)
  - Simple
  - Single point of failure

- **Horizontal:** Multiple instances + load balancer
  - Complex
  - High availability
  - Requires ELB setup

### 5. Database
**For production, consider:**
- **RDS PostgreSQL:** Managed relational database
- **DynamoDB:** Managed NoSQL database
- **ElastiCache:** Managed Redis (instead of container Redis)

---

## Common Tasks

### Deploy Updated Code
```bash
# From your local machine
docker build -t ytdlp-sizer-api:latest cloud_api/
docker push youruser/ytdlp-sizer-api:latest

# On EC2 instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP
cd ~/ytdlp-api
docker-compose pull api
docker-compose restart api
```

### Update Environment Variables
```bash
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP
cd ~/ytdlp-api
nano .env  # Edit as needed
docker-compose restart api
```

### View Logs
```bash
# Real-time logs
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP
cd ~/ytdlp-api
docker-compose logs -f api

# Or from your machine
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP \
  "cd ~/ytdlp-api && docker-compose logs api --tail 50"
```

### Scale the Instance
```bash
# Stop instance
aws ec2 stop-instances --instance-ids i-xxx

# Change instance type
aws ec2 modify-instance-attribute --instance-id i-xxx \
  --instance-type "{\"Value\": \"t3.medium\"}"

# Start instance
aws ec2 start-instances --instance-ids i-xxx

# Reconnect and restart containers
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP
cd ~/ytdlp-api
docker-compose up -d
```

### Backup Redis Data
```bash
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP
cd ~/ytdlp-api
docker exec redis redis-cli BGSAVE
docker cp redis:/data/dump.rdb ~/backups/dump.rdb.$(date +%Y%m%d)
```

---

## Cost Breakdown (Monthly)

```
EC2 Instance (t3.small)        $18.00
EBS Volume (20GB gp3)           $2.00
Data Transfer (100GB)           $5.00
Route53 DNS (optional)          $0.50
─────────────────────────────────────
TOTAL                          ~$25.50
```

**For higher traffic:**
- t3.medium (+$14)
- Additional data transfer (depends on usage)

---

## Next Actions (Step-by-Step)

### Immediate (Next 15 minutes)
1. Get AWS Access Key ID and Secret Access Key
2. Run: `aws configure`
3. Create EC2 key pair
4. Review `terraform/terraform.tfvars`

### Short-term (Next hour)
1. Run: `terraform plan`
2. Review the resources that will be created
3. Run: `terraform apply`
4. Wait for EC2 instance to start

### Medium-term (Next 2 hours)
1. Get EC2 public IP from Terraform output
2. Run deployment script
3. Wait for containers to start
4. Test API endpoints

### Long-term (Production)
1. Set up HTTPS/SSL (Let's Encrypt)
2. Configure Sentry monitoring
3. Set up automated backups
4. Enable CloudWatch alarms
5. Set up CI/CD pipeline (GitHub Actions → ECR → EC2)

---

## Support Resources

**Documentation in this project:**
- `DOCKER_DEPLOYMENT.md` - Detailed step-by-step guide
- `AWS_DEPLOYMENT_STRATEGY.md` - Architecture and best practices
- `DEPLOYMENT_CONFIG.md` - Configuration file examples
- `DEPLOYMENT_QUICK_REFERENCE.md` - Command reference

**External Resources:**
- Docker: https://docs.docker.com/
- AWS EC2: https://docs.aws.amazon.com/ec2/
- Terraform: https://www.terraform.io/docs/
- yt-dlp: https://github.com/yt-dlp/yt-dlp
- Sentry: https://docs.sentry.io/

---

## Quick Debugging

**Terraform stuck on "terraform plan"?**
```bash
# Make sure AWS credentials are configured
aws sts get-caller-identity

# If no output, run:
aws configure
```

**Can't SSH to EC2?**
```bash
# Check key permissions
chmod 400 ~/.ssh/ytdlp-api-key.pem

# Check instance status
aws ec2 describe-instance-status --instance-ids i-xxx

# Check security group allows port 22
aws ec2 describe-security-groups --group-ids sg-xxx | grep "22"
```

**Containers won't start?**
```bash
# SSH to instance
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# Check Docker
docker --version
docker ps

# Check logs
cd ~/ytdlp-api
docker-compose logs api
docker-compose logs redis

# Rebuild
docker-compose down
docker-compose up -d
```

**API not responding?**
```bash
# Check if container is running
docker ps | grep api

# Check logs
docker logs api

# Check port
sudo lsof -i :3000

# Test locally
curl http://localhost:3000/health

# Test externally
curl http://$PUBLIC_IP:3000/health
```

---

**You have everything you need. The infrastructure is ready. Just add AWS credentials and deploy!**
