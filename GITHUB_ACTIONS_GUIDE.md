# 🚀 GitHub Actions → Docker Hub → EC2 Deployment Guide

## How the Workflow Works

```
Step 1: You push code
    ↓
    git push origin main

Step 2: GitHub detects changes
    ↓
    Triggers .github/workflows/build-and-push.yml

Step 3: GitHub Actions builds image in cloud
    ↓
    docker build (runs on GitHub's servers, ~5 min)
    docker push to Docker Hub

Step 4: You deploy to EC2
    ↓
    ./scripts/deploy.sh <IP> <REGISTRY> <TAG>

Step 5: EC2 pulls pre-built image
    ↓
    docker load from transferred tar file
    docker run

TOTAL TIME: ~7 minutes (no build on EC2!)
```

---

## The Full Flow in Detail

### Phase 1: GitHub Actions (Automatic - 5 minutes)

**File**: `.github/workflows/build-and-push.yml`

```yaml
on:
  push:
    branches: [main]
    paths: ['cloud_api/**']
```

**What it does**:
1. Detects when you push to main branch
2. Only triggers if cloud_api/ files changed
3. Builds Docker image in GitHub's infrastructure (parallel Linux VMs)
4. Logs into Docker Hub with secrets:
   - `DOCKER_USERNAME` (your Docker Hub username)
   - `DOCKER_PASSWORD` (your Docker Hub access token)
5. Tags image with:
   - `latest` (always points to newest build)
   - `sha-abc1234` (specific commit SHA for rollback)
6. Pushes to Docker Hub

**Output**:
```
✓ Image available at: docker.io/mohamedsayed1/ytdlp-sizer-api:latest
✓ Also available as: docker.io/mohamedsayed1/ytdlp-sizer-api:sha-abc1234
```

---

### Phase 2: Manual Deployment (30 seconds setup + 2 minutes transfer)

**File**: `cloud_api/aws-deployment/scripts/deploy.sh`

**Option A: Pull from Docker Hub (RECOMMENDED)**
```bash
./scripts/deploy.sh 52.5.44.112 mohamedsayed1/ytdlp-sizer-api latest
```

What this does:
1. Takes 3 parameters:
   - `52.5.44.112` = Your EC2 IP
   - `mohamedsayed1/ytdlp-sizer-api` = Docker Hub registry
   - `latest` = Image tag
2. **Skips building** (10 minutes saved!)
3. Pulls image from Docker Hub locally (cached)
4. Transfers via SSH to EC2
5. EC2 loads image and starts container

**Time**: ~2-3 minutes total

**Option B: Build Locally (Only if GitHub Actions not available)**
```bash
./scripts/deploy.sh 52.5.44.112
```

What this does:
1. Takes only 1 parameter (EC2 IP)
2. Builds Docker image locally (10+ minutes)
3. Transfers to EC2
4. EC2 loads and runs

**Time**: ~15-20 minutes total

---

## Setup Instructions

### 1. Create Docker Hub Account (Free)

1. Go to https://hub.docker.com/
2. Sign up for free
3. Create public repository: `ytdlp-sizer-api`
4. Note your username (e.g., `mohamedsayed1`)

### 2. Create Docker Hub Access Token

1. Go to https://hub.docker.com/settings/security
2. Click "New Access Token"
3. Name: `github-actions`
4. Select "Read, Write" permissions
5. Copy the token (you won't see it again!)

### 3. Add GitHub Secrets

1. Go to your GitHub repo
2. Settings → Secrets and variables → Actions
3. Create secret `DOCKER_USERNAME` = your Docker Hub username
4. Create secret `DOCKER_PASSWORD` = the access token from step 2

### 4. Verify GitHub Actions File Exists

Check if `.github/workflows/build-and-push.yml` exists:

```bash
ls -la .github/workflows/
```

If not found, see the file at end of this guide.

---

## Usage Examples

### Example 1: Deploy Latest Build from Docker Hub

```bash
# Step 1: Push code (triggers GitHub Actions auto-build)
git add .
git commit -m "Update API"
git push origin main

# Wait 5 minutes for GitHub Actions to complete...

# Step 2: Deploy to EC2
PUBLIC_IP=52.5.44.112
./cloud_api/aws-deployment/scripts/deploy.sh $PUBLIC_IP mohamedsayed1/ytdlp-sizer-api latest

# Step 3: Verify
curl http://$PUBLIC_IP:3000/health
```

### Example 2: Deploy Specific Commit

```bash
# Deploy the exact commit you want (easy rollback!)
COMMIT_SHA=$(git rev-parse --short HEAD)
./cloud_api/aws-deployment/scripts/deploy.sh $PUBLIC_IP mohamedsayed1/ytdlp-sizer-api sha-$COMMIT_SHA
```

### Example 3: Deploy Locally Built Image (Offline Mode)

```bash
# Don't have Docker Hub? Build locally instead
./cloud_api/aws-deployment/scripts/deploy.sh 52.5.44.112

# No registry parameter = build locally
```

---

## Check GitHub Actions Build Status

### Via GitHub UI
1. Go to your GitHub repo
2. Click "Actions" tab
3. See the build status (running/success/failed)
4. Click the build to see logs

### Via Command Line
```bash
# View recent workflow runs (requires GitHub CLI)
gh run list --repo your-username/your-repo

# View latest run details
gh run view --repo your-username/your-repo
```

---

## Troubleshooting

### "docker pull: error pulling image"
**Problem**: GitHub Actions built but image isn't on Docker Hub yet
**Solution**: Wait 5 minutes after push, or check GitHub Actions succeeded

### "docker login failed"
**Problem**: DOCKER_PASSWORD secret is wrong or expired
**Solution**: 
1. Go to Docker Hub → Settings → Security
2. Create new access token
3. Update GitHub secret with new token

### "No such image"
**Problem**: Image name doesn't match between GitHub Actions and deploy.sh
**Solution**: Make sure both use same name:
```bash
# GitHub Actions pushes to:
docker.io/mohamedsayed1/ytdlp-sizer-api:latest

# deploy.sh must use:
./scripts/deploy.sh $IP mohamedsayed1/ytdlp-sizer-api latest
```

### Build didn't trigger
**Problem**: GitHub Actions workflow file not found or disabled
**Solution**:
1. Check file exists: `.github/workflows/build-and-push.yml`
2. Check it has correct trigger: `on: push: branches: [main]`
3. Check paths trigger: `paths: ['cloud_api/**']`

---

## GitHub Actions Configuration (Reference)

File: `.github/workflows/build-and-push.yml`

```yaml
name: Build and Push Docker Image

on:
  push:
    branches:
      - main
    paths:
      - 'cloud_api/**'
  workflow_dispatch:  # Allow manual trigger

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Docker
        uses: docker/setup-buildx-action@v2
      
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: ./cloud_api
          push: true
          tags: |
            ${{ secrets.DOCKER_USERNAME }}/ytdlp-sizer-api:latest
            ${{ secrets.DOCKER_USERNAME }}/ytdlp-sizer-api:sha-${{ github.sha }}
          cache-from: type=registry,ref=${{ secrets.DOCKER_USERNAME }}/ytdlp-sizer-api:buildcache
          cache-to: type=registry,ref=${{ secrets.DOCKER_USERNAME }}/ytdlp-sizer-api:buildcache,mode=max
```

---

## deploy.sh Parameters (Updated)

The updated deploy.sh script now supports Docker registries:

```bash
# Syntax
./deploy.sh [EC2_IP] [DOCKER_REGISTRY] [IMAGE_TAG]

# All parameters are optional, but recommended for Docker Hub
```

### Parameter Details

| Parameter | Required | Default | Example |
|-----------|----------|---------|---------|
| `EC2_IP` | Optional | Reads from Terraform | `52.5.44.112` |
| `DOCKER_REGISTRY` | Optional | None (builds locally) | `mohamedsayed1/ytdlp-sizer-api` |
| `IMAGE_TAG` | Optional | `latest` | `latest` or `sha-abc123` |

### Examples

```bash
# Use Docker Hub pre-built image (FASTEST)
./scripts/deploy.sh 52.5.44.112 mohamedsayed1/ytdlp-sizer-api latest
#                   ↑ IP        ↑ Registry              ↑ Tag

# Use Docker Hub with specific commit
./scripts/deploy.sh 52.5.44.112 mohamedsayed1/ytdlp-sizer-api sha-abc1234

# Build locally (no registry specified)
./scripts/deploy.sh 52.5.44.112

# Read IP from Terraform, build locally
./scripts/deploy.sh
```

---

## Time Comparison

| Method | Time | Why |
|--------|------|-----|
| GitHub Actions + Docker Hub | 5 min | Build in cloud + transfer tar |
| Build locally on EC2 | 20-25 min | npm install + yt-dlp download + build |
| Build on local machine | 15-20 min | Upload to EC2 |

**Winner**: GitHub Actions saves 15-20 minutes per deployment! 🎉

---

## Key Benefits

✅ **Faster deployments**: 5 minutes instead of 20+  
✅ **Parallel building**: GitHub builds while you work  
✅ **Easy rollback**: Tag each commit SHA separately  
✅ **Free**: GitHub Actions free tier includes 2000 min/month  
✅ **Reliable**: No local build issues affecting deployment  
✅ **Auditable**: All builds visible in GitHub Actions tab  
✅ **Cacheable**: Docker layer caching speeds up rebuilds  

---

## Next Steps

1. ✅ Create Docker Hub account
2. ✅ Create access token
3. ✅ Add GitHub secrets (DOCKER_USERNAME, DOCKER_PASSWORD)
4. ✅ Verify `.github/workflows/build-and-push.yml` exists
5. ✅ Push code: `git push origin main`
6. ✅ Wait 5 minutes for GitHub Actions to complete
7. ✅ Deploy: `./scripts/deploy.sh $IP yourusername/ytdlp-sizer-api latest`
8. ✅ Verify: `curl http://$IP:3000/health`

---

## Questions?

**Q: Does the script work without Docker Hub?**
A: Yes! Omit the registry parameter to build locally

**Q: Can I use a different registry?**
A: Yes! Any Docker registry works: `./deploy.sh $IP ghcr.io/user/image latest`

**Q: Why is the image so large?**
A: It includes Node.js + yt-dlp + dependencies (~600MB)

**Q: Can I make it smaller?**
A: Yes, multi-stage Dockerfile already removes dev dependencies

**Q: What if GitHub Actions fails?**
A: You can still build locally with `./deploy.sh $IP`

