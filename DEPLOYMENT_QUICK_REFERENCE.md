# Docker Deployment Quick Reference

## TL;DR - Deploy in 5 Steps

```bash
# 1. Configure AWS credentials
aws configure

# 2. Create EC2 key pair
aws ec2 create-key-pair --key-name ytdlp-api-key \
  --query 'KeyMaterial' --output text > ~/.ssh/ytdlp-api-key.pem
chmod 400 ~/.ssh/ytdlp-api-key.pem

# 3. Deploy infrastructure
cd cloud_api/aws-deployment/terraform
terraform init
terraform apply
PUBLIC_IP=$(terraform output -raw instance_public_ip)

# 4. Deploy containers
cd ..
./scripts/deploy.sh $PUBLIC_IP

# 5. Verify
curl http://$PUBLIC_IP:3000/health
```

---

## Prerequisites Checklist

- [ ] AWS Account with appropriate permissions
- [ ] AWS CLI installed (`aws --version`)
- [ ] Terraform installed (`terraform version`)
- [ ] Docker installed locally (for testing)
- [ ] SSH client installed (`ssh -V`)
- [ ] Git installed (`git --version`)
- [ ] AWS Access Key ID and Secret Access Key ready

---

## File Structure

```
/
├── DOCKER_DEPLOYMENT.md              ← Detailed guide
├── AWS_DEPLOYMENT_STRATEGY.md        ← Architecture & strategy
├── DEPLOYMENT_CONFIG.md              ← Configuration files
├── DEPLOYMENT_QUICK_REFERENCE.md     ← This file
├── Dockerfile                         ← Container image
├── docker-compose.yml                ← Container orchestration
└── cloud_api/
    ├── server.js                     ← Express API
    ├── aws-deployment/
    │   ├── terraform/
    │   │   ├── main.tf              ← AWS infrastructure
    │   │   ├── variables.tf
    │   │   └── terraform.tfvars      ← Configuration
    │   └── scripts/
    │       ├── deploy.sh            ← Automated deployment
    │       ├── health-check.sh
    │       ├── setup-instance.sh
    │       └── update-app.sh
```

---

## Common Commands

### AWS Setup
```bash
# Configure credentials
aws configure

# Create key pair
aws ec2 create-key-pair --key-name ytdlp-api-key \
  --query 'KeyMaterial' --output text > ~/.ssh/ytdlp-api-key.pem
chmod 400 ~/.ssh/ytdlp-api-key.pem

# Get EC2 instances
aws ec2 describe-instances --query 'Reservations[*].Instances[*].[InstanceId,PublicIpAddress,State.Name]' --output table

# Stop instance
aws ec2 stop-instances --instance-ids i-0123456789abcdef0

# Terminate instance
aws ec2 terminate-instances --instance-ids i-0123456789abcdef0
```

### Terraform
```bash
cd cloud_api/aws-deployment/terraform

# Initialize
terraform init

# Plan
terraform plan -out=tfplan

# Apply
terraform apply tfplan

# Get outputs
terraform output
terraform output instance_public_ip

# Destroy
terraform destroy --auto-approve
```

### Docker
```bash
# Build locally
docker build -t ytdlp-sizer-api:latest cloud_api/

# Run locally
docker run -p 3000:3000 ytdlp-sizer-api:latest

# Compose
docker-compose up -d
docker-compose down
docker-compose logs -f api
docker-compose restart api

# Container operations
docker ps                    # List running
docker ps -a                 # List all
docker logs CONTAINER_ID     # View logs
docker exec CONTAINER_ID bash # Shell access
docker stop CONTAINER_ID     # Stop
docker rm CONTAINER_ID       # Remove
```

### SSH
```bash
# Connect to EC2
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# Copy file to EC2
scp -i ~/.ssh/ytdlp-api-key.pem file.txt ubuntu@$PUBLIC_IP:/home/ubuntu/

# Copy file from EC2
scp -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP:/home/ubuntu/file.txt .
```

### Monitoring
```bash
# Container stats
docker stats

# API health
curl http://localhost:3000/health

# External health check
curl http://$PUBLIC_IP:3000/health

# View logs
docker-compose logs -f api
docker logs api --since 1h

# System resources
df -h          # Disk usage
free -h        # Memory usage
top            # Process monitor
```

---

## Troubleshooting Quick Fixes

### Container won't start
```bash
docker logs api              # Check error message
docker-compose ps           # Check status
docker-compose restart api  # Restart
```

### Can't connect to API
```bash
# Check if running
curl http://localhost:3000/health

# Check security group
aws ec2 describe-security-groups --group-ids sg-xxx

# Check port
sudo lsof -i :3000

# Test from different machine
curl http://$PUBLIC_IP:3000/health
```

### High memory usage
```bash
docker stats                # Check usage
docker system prune -a     # Clean up
docker logs api --tail=100 # Check for errors
```

### Can't SSH
```bash
# Check key permissions
chmod 400 ~/.ssh/ytdlp-api-key.pem

# Check security group allows SSH
aws ec2 describe-security-groups --group-ids sg-xxx

# Try verbose
ssh -vv -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP

# Check instance running
aws ec2 describe-instances --instance-ids i-xxx
```

### Redis connection failed
```bash
docker ps | grep redis      # Check if running
docker exec redis redis-cli # Test connection
docker-compose restart redis # Restart
```

---

## Environment Variables Quick Reference

| Variable | Development | Production |
|----------|-------------|------------|
| `NODE_ENV` | `development` | `production` |
| `PORT` | `3000` | `3000` |
| `REDIS_ENABLED` | `false` | `true` |
| `SENTRY_DSN` | empty | `https://key@sentry.io/id` |
| `RATE_LIMIT_MAX_REQUESTS` | `1000` | `100` |
| `LOG_LEVEL` | `debug` | `info` |

---

## Monitoring Dashboards

- **Sentry:** https://sentry.io/organizations/your-org/issues/
- **AWS Console:** https://console.aws.amazon.com/ec2/
- **CloudWatch:** https://console.aws.amazon.com/cloudwatch/

---

## Cost Reference

| Resource | Type | Monthly Cost |
|----------|------|--------------|
| EC2 | t3.micro | ~$8 |
| EC2 | t3.small | ~$18 |
| EC2 | t3.medium | ~$32 |
| EBS | 20GB | ~$2 |
| Data Transfer | 100GB | ~$5 |
| **Total (t3.small)** | | **~$25** |

---

## SSH Key Management

```bash
# Create new key pair
aws ec2 create-key-pair --key-name new-key \
  --query 'KeyMaterial' --output text > new-key.pem
chmod 400 new-key.pem

# List key pairs
aws ec2 describe-key-pairs

# Delete key pair
aws ec2 delete-key-pair --key-name old-key

# Add key to agent (macOS/Linux)
ssh-add ~/.ssh/ytdlp-api-key.pem

# List keys in agent
ssh-add -l
```

---

## Health Check Endpoints

```bash
# API health
curl http://localhost:3000/health
# Expected response: {"ok":true}

# API docs
curl http://localhost:3000/api/v1/docs

# Test size endpoint
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}'
```

---

## Automated Deployment Scripts

### deploy.sh
```bash
chmod +x cloud_api/aws-deployment/scripts/deploy.sh
./cloud_api/aws-deployment/scripts/deploy.sh $PUBLIC_IP
```

### health-check.sh
```bash
chmod +x cloud_api/aws-deployment/scripts/health-check.sh
./cloud_api/aws-deployment/scripts/health-check.sh
```

### update-app.sh
```bash
chmod +x cloud_api/aws-deployment/scripts/update-app.sh
./cloud_api/aws-deployment/scripts/update-app.sh
```

---

## Backup & Recovery

### Backup Redis
```bash
docker exec redis redis-cli BGSAVE
docker cp redis:/data/dump.rdb ~/backups/dump.rdb.$(date +%Y%m%d)
```

### Restore Redis
```bash
docker cp ~/backups/dump.rdb.20240101 redis:/data/dump.rdb
docker-compose restart redis
```

### Backup EBS Volume
```bash
VOLUME_ID=$(aws ec2 describe-instances --instance-ids i-xxx \
  --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' \
  --output text)
aws ec2 create-snapshot --volume-id $VOLUME_ID \
  --description "ytdlp-api backup $(date +%Y-%m-%d)"
```

---

## Performance Tuning

### Increase rate limit (for testing)
```env
RATE_LIMIT_MAX_REQUESTS=1000
```

### Increase container resources
In docker-compose.yml:
```yaml
api:
  resources:
    limits:
      cpus: '2'
      memory: 1G
    reservations:
      cpus: '1'
      memory: 512M
```

### Increase Redis memory
```env
REDIS_MAXMEMORY=512mb
```

---

## Security Best Practices

- [ ] Use HTTPS/SSL (see section 4.1 in AWS_DEPLOYMENT_STRATEGY.md)
- [ ] Restrict SSH to your IP only
- [ ] Use strong passwords for Sentry
- [ ] Enable AWS MFA
- [ ] Regularly update Docker images
- [ ] Use VPC security groups properly
- [ ] Monitor Sentry for errors
- [ ] Enable CloudWatch alarms
- [ ] Rotate AWS credentials periodically
- [ ] Use IAM roles instead of access keys (when possible)

---

## Next Steps After Deployment

1. **Get Sentry DSN**
   - Go to https://sentry.io
   - Create project
   - Copy DSN

2. **Update environment variables**
   ```bash
   ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP
   cd ~/ytdlp-api
   nano .env
   # Add SENTRY_DSN
   ```

3. **Restart with new config**
   ```bash
   docker-compose restart api
   ```

4. **Set up HTTPS** (see section 4.1 in AWS_DEPLOYMENT_STRATEGY.md)

5. **Configure monitoring** (Sentry dashboard)

6. **Set up backups** (see section 7 in AWS_DEPLOYMENT_STRATEGY.md)

7. **Test thoroughly**
   ```bash
   curl http://$PUBLIC_IP:3000/health
   curl -X POST http://$PUBLIC_IP:3000/api/v1/size \
     -H "Content-Type: application/json" \
     -d '{"url":"https://www.youtube.com/watch?v=jNQXAC9IVRw"}'
   ```

---

## Support Resources

- **Docker Docs:** https://docs.docker.com/
- **AWS Documentation:** https://docs.aws.amazon.com/
- **Terraform Registry:** https://registry.terraform.io/
- **yt-dlp:** https://github.com/yt-dlp/yt-dlp
- **Sentry:** https://docs.sentry.io/

---

## Useful Aliases (add to ~/.bashrc)

```bash
alias ytdlp-ssh='ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@'
alias ytdlp-logs='docker-compose logs -f api'
alias ytdlp-health='curl -s http://localhost:3000/health | jq'
alias ytdlp-stats='docker stats'
alias ytdlp-terraform='cd cloud_api/aws-deployment/terraform'
```

---

**For detailed information, see:**
- DOCKER_DEPLOYMENT.md (full guide)
- AWS_DEPLOYMENT_STRATEGY.md (architecture & strategy)
- DEPLOYMENT_CONFIG.md (configuration examples)
