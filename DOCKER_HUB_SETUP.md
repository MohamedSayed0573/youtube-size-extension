# Docker Hub + GitHub Actions Setup Guide

## Why This Approach?

Building Docker images takes time (~5 minutes) with yt-dlp download. Instead of building on EC2 each time:

- **GitHub Actions builds automatically** on every push (free, fast)
- **Pushed to Docker Hub** (free public repo)
- **EC2 just pulls** the pre-built image (2 minutes)
- **Total deployment: ~7 minutes** instead of 25

---

## Step 1: Create Docker Hub Account (5 minutes)

1. Go to https://hub.docker.com/
2. Click "Sign Up"
3. Create free account
4. Verify email
5. Note your **username** (you'll need it later)

---

## Step 2: Create Repository on Docker Hub (2 minutes)

1. Log in to Docker Hub
2. Click "Create a Repository"
3. Name it: `ytdlp-sizer-api`
4. Set to **Public** (free)
5. Click "Create"

You now have: `yourusername/ytdlp-sizer-api`

---

## Step 3: Add GitHub Secrets (5 minutes)

GitHub Actions needs permission to push to your Docker Hub repo.

1. Go to your GitHub repo
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Add secret #1:
   - Name: `DOCKER_USERNAME`
   - Value: your Docker Hub username
   - Click "Add secret"

5. Add secret #2:
   - Name: `DOCKER_PASSWORD`
   - Value: your Docker Hub password
     - (Or use an Access Token for better security)
   - Click "Add secret"

Done! GitHub can now push to Docker Hub.

---

## Step 4: How It Works

### Automatic (GitHub Actions)

```mermaid
You push code to GitHub
        ↓
GitHub Actions triggered
        ↓
Builds Docker image
(includes yt-dlp download)
        ↓
Pushes to Docker Hub
        ↓
EC2 pulls image (fast)
```

### Manual (If you prefer)

```bash
# Build locally
docker build -t yourusername/ytdlp-sizer-api:latest cloud_api/
docker login
docker push yourusername/ytdlp-sizer-api:latest

# Then deploy
./scripts/deploy.sh $PUBLIC_IP yourusername/ytdlp-sizer-api latest
```

---

## Step 5: Deploy (Using Pre-Built Image)

```bash
# 1. AWS setup
aws configure
aws ec2 create-key-pair --key-name ytdlp-api-key ...

# 2. Terraform
cd cloud_api/aws-deployment/terraform
terraform init && terraform apply
PUBLIC_IP=$(terraform output -raw instance_public_ip)

# 3. Deploy (image already built, just pull and run)
cd ..
./scripts/deploy.sh $PUBLIC_IP yourusername/ytdlp-sizer-api latest
```

**Time: ~7 minutes** (no build on EC2)

---

## Docker Hub Access Token (Optional but Recommended)

For security, use an access token instead of password:

1. Docker Hub → Account Settings → Security
2. Click "New Access Token"
3. Name it: `github-actions`
4. Permissions: Read & Write
5. Copy the token
6. Use as `DOCKER_PASSWORD` in GitHub secrets

---

## Verifying It Worked

### Check GitHub Actions Build
1. Go to your GitHub repo
2. Click "Actions" tab
3. You should see `build-and-push` workflow
4. It runs automatically on push

### Check Docker Hub Image
1. Go to Docker Hub
2. Click your `ytdlp-sizer-api` repository
3. You should see tags like:
   - `latest` (most recent)
   - `commit-sha` (specific commit)

### Verify EC2 Deployment
```bash
ssh -i ~/.ssh/ytdlp-api-key.pem ubuntu@$PUBLIC_IP
docker images
# Should show your image from Docker Hub
```

---

## Troubleshooting

### "Permission denied" when pushing to Docker Hub
→ Check `DOCKER_PASSWORD` secret is correct

### GitHub Actions workflow not running
→ Check `.github/workflows/build-and-push.yml` exists
→ Try manual trigger: Actions tab → select workflow → Run workflow

### Image not appearing on Docker Hub
→ Check GitHub Actions logs for errors
→ Verify secrets are set correctly
→ Try `docker login` and `docker push` manually

### EC2 says "image not found"
→ Verify image is on Docker Hub
→ Check image name is correct: `yourusername/ytdlp-sizer-api:latest`
→ Make sure EC2 has internet access

---

## File Reference

**GitHub Actions workflow file:**
- `.github/workflows/build-and-push.yml`

**Deployment script (supports Docker Hub):**
- `cloud_api/aws-deployment/scripts/deploy.sh`

**Infrastructure:**
- `cloud_api/aws-deployment/terraform/main.tf`

---

## Cost

- **Docker Hub**: Free (public repository)
- **GitHub Actions**: Free (2000 minutes/month for free accounts)
- **No additional costs!**

---

## Next: Deploy!

Follow these commands:

```bash
# 1. Make sure GitHub secrets are set (DOCKER_USERNAME, DOCKER_PASSWORD)

# 2. Push code (triggers auto-build)
git push origin main

# 3. Wait for GitHub Actions to complete (~5 minutes)
# Go to Actions tab to monitor

# 4. AWS setup
aws configure

# 5. Create key pair
aws ec2 create-key-pair --key-name ytdlp-api-key \
  --query 'KeyMaterial' --output text > ~/.ssh/ytdlp-api-key.pem
chmod 400 ~/.ssh/ytdlp-api-key.pem

# 6. Deploy infrastructure
cd cloud_api/aws-deployment/terraform
terraform init && terraform apply
PUBLIC_IP=$(terraform output -raw instance_public_ip)

# 7. Deploy containers
cd ..
./scripts/deploy.sh $PUBLIC_IP yourusername/ytdlp-sizer-api latest
```

**Total: ~7 minutes for EC2 deployment (image already built)**

---

## Questions?

- **GitHub Actions not building?** → Check `.github/workflows/build-and-push.yml`
- **Docker image not pushed?** → Check DOCKER_USERNAME/PASSWORD secrets
- **EC2 can't pull image?** → Verify image is public on Docker Hub
