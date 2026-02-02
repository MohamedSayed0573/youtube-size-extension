# AWS Deployment - Quick Reference

## Prerequisites Checklist

- [ ] AWS CLI installed and configured (`aws configure`)
- [ ] Docker installed locally
- [ ] SSH key pair created (`ytdlp-api-key.pem`)
- [ ] Terraform installed (optional but recommended)

## Deployment Steps

### 1. Create SSH Key (if needed)

```bash
aws ec2 create-key-pair --key-name ytdlp-api-key \
  --query 'KeyMaterial' --output text > ~/.ssh/ytdlp-api-key.pem
chmod 600 ~/.ssh/ytdlp-api-key.pem
```

### 2. Configure Terraform

```bash
cd cloud_api/aws-deployment/terraform
nano terraform.tfvars
```

**Edit these values:**
- `key_name = "ytdlp-api-key"`
- `ssh_allowed_ips = ["YOUR_IP/32"]` (get IP: `curl ifconfig.me`)

### 3. Provision Infrastructure

```bash
terraform init
terraform apply
# Type 'yes' to confirm
terraform output  # Save the EC2 IP
```

### 4. Configure Application

```bash
cd ../..
nano .env.production
```

**Set these:**
- `API_KEY` - Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `REQUIRE_AUTH=true`
- `ALLOWED_ORIGINS` - Your extension ID or domain
- `SENTRY_DSN` - Your Sentry DSN (optional)

### 5. Deploy

```bash
./aws-deployment/scripts/deploy.sh
```

### 6. Test

```bash
EC2_IP=$(cd aws-deployment/terraform && terraform output -raw instance_public_ip)
curl http://$EC2_IP:3000/health
```

## Common Commands

```bash
# Update application
./aws-deployment/scripts/update-app.sh

# View logs
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$EC2_IP
docker logs -f ytdlp-api

# Restart container
docker restart ytdlp-api

# Check status
docker ps
docker stats ytdlp-api

# Destroy infrastructure
cd aws-deployment/terraform
terraform destroy
```

## Troubleshooting

**Container won't start:**
```bash
docker logs ytdlp-api
docker restart ytdlp-api
```

**Can't connect to EC2:**
- Check security group allows your IP
- Verify instance is running: `aws ec2 describe-instances`
- Check SSH key permissions: `chmod 600 ~/.ssh/ytdlp-api-key.pem`

**Health check fails:**
```bash
docker exec ytdlp-api yt-dlp --version
docker logs ytdlp-api
```

## Costs

- **t3.micro**: ~$8/month (1GB RAM)
- **t3.small**: ~$15/month (2GB RAM) - **Recommended**
- **t3.medium**: ~$30/month (4GB RAM)

## URLs

- **API**: `http://EC2_IP:3000`
- **Health**: `http://EC2_IP:3000/health`
- **Metrics**: `http://EC2_IP:3000/metrics`

---

For detailed documentation, see [AWS_DEPLOYMENT.md](./AWS_DEPLOYMENT.md)
