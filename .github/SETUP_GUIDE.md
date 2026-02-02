# GitHub Actions Setup Guide

This guide will help you set up and configure the CI/CD pipelines for this project.

## Quick Setup (5 Minutes)

### Step 1: Enable GitHub Actions

1. Go to your repository on GitHub
2. Click **Settings** → **Actions** → **General**
3. Under "Actions permissions", select **Allow all actions and reusable workflows**
4. Click **Save**

### Step 2: Configure Secrets

Go to **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

#### Required for Basic CI (Optional - CI works without these):
```
None - Basic CI/CD will work without any secrets
```

#### Optional for Docker Deployment:
```
DOCKER_USERNAME     = your-docker-hub-username
DOCKER_PASSWORD     = your-docker-hub-access-token
```

#### Optional for Cloud Deployment:
```
RAILWAY_TOKEN       = your-railway-project-token
RENDER_DEPLOY_HOOK  = https://api.render.com/deploy/srv-xxxxx
API_URL             = https://your-deployed-api.com
```

#### Optional for Security Scanning:
```
SNYK_TOKEN          = your-snyk-api-token
CODECOV_TOKEN       = your-codecov-upload-token
```

### Step 3: Enable Dependabot

1. Go to **Settings** → **Code security and analysis**
2. Enable **Dependabot alerts**
3. Enable **Dependabot security updates**
4. Dependabot version updates are already configured in `.github/dependabot.yml`

### Step 4: Verify Setup

1. Make a small change to any file
2. Commit and push:
   ```bash
   git add .
   git commit -m "test: verify CI/CD pipeline"
   git push
   ```
3. Go to **Actions** tab and watch your workflows run

## Detailed Configuration

### Docker Hub Setup

1. Create account at https://hub.docker.com
2. Create access token:
   - Account Settings → Security → New Access Token
   - Name: "GitHub Actions"
   - Permissions: Read, Write, Delete
3. Add to GitHub secrets as `DOCKER_USERNAME` and `DOCKER_PASSWORD`

### Railway Setup

1. Create account at https://railway.app
2. Create new project
3. Get project token:
   - Project Settings → Tokens → Create Token
4. Add to GitHub secrets as `RAILWAY_TOKEN`
5. Install Railway CLI:
   ```bash
   npm install -g railway
   railway login
   ```

### Render Setup

1. Create account at https://render.com
2. Create new Web Service
3. Get deploy hook:
   - Service → Settings → Deploy Hook
   - Copy webhook URL
4. Add to GitHub secrets as `RENDER_DEPLOY_HOOK`

### Snyk Setup

1. Create account at https://snyk.io
2. Get API token:
   - Account Settings → API Token
   - Generate and copy token
3. Add to GitHub secrets as `SNYK_TOKEN`

### Codecov Setup

1. Create account at https://codecov.io
2. Add your GitHub repository
3. Get upload token:
   - Repository → Settings → General
4. Add to GitHub secrets as `CODECOV_TOKEN`

## Testing the Pipelines

### Test CI Pipeline

```bash
# Create a branch
git checkout -b test-ci

# Make a change
echo "# Test" >> README.md

# Commit and push
git add .
git commit -m "test: CI pipeline"
git push -u origin test-ci

# Create PR and watch CI run
gh pr create --title "Test CI" --body "Testing CI pipeline"
```

### Test Deployment

```bash
# Tag a release
git tag v1.0.0-test
git push origin v1.0.0-test

# Watch deployment in Actions tab
```

### Test Manual Deployment

```bash
# Using GitHub CLI
gh workflow run deploy.yml -f environment=staging

# Or via GitHub UI:
# Actions → Deploy → Run workflow → Select environment → Run
```

## Workflow Files Explained

### `.github/workflows/ci.yml`
Main CI pipeline that runs on every push/PR:
- Lints and formats code
- Runs tests with coverage
- Builds Docker image
- Validates extension manifest
- Security scanning

### `.github/workflows/deploy.yml`
Deployment pipeline that runs on main branch:
- Builds and pushes Docker images
- Deploys to cloud platforms
- Creates GitHub releases
- Runs health checks

### `.github/workflows/codeql.yml`
Security analysis that runs weekly:
- Analyzes code for vulnerabilities
- Checks for security issues
- Provides security alerts

### `.github/workflows/dependency-review.yml`
Reviews dependencies on PRs:
- Checks for new vulnerabilities
- Enforces license compliance
- Comments on PRs with findings

### `.github/workflows/stale.yml`
Maintains repository health:
- Marks inactive issues/PRs
- Auto-closes after inactivity
- Reduces noise

## Branch Protection Rules

Recommended settings for `main` branch:

1. Go to **Settings** → **Branches**
2. Add rule for `main` branch:
   - ✅ Require a pull request before merging
   - ✅ Require approvals (1)
   - ✅ Require status checks to pass
   - ✅ Require branches to be up to date
   - Select status checks:
     - `lint-and-format`
     - `test-cloud-api`
     - `validate-extension`
     - `build-docker`
   - ✅ Do not allow bypassing the above settings

## Troubleshooting

### "Resource not accessible by integration"
**Solution:** Enable write permissions:
- Settings → Actions → General → Workflow permissions
- Select "Read and write permissions"

### Tests not running
**Solution:** Install dependencies first:
```bash
cd cloud_api
npm install
```

### Docker push fails
**Solution:** Check Docker Hub credentials:
- Verify `DOCKER_USERNAME` and `DOCKER_PASSWORD` are set
- Ensure token has write permissions

### Deployment not triggering
**Solution:** Check deployment conditions:
- Verify you're pushing to `main` branch
- Check if all required checks pass
- Review workflow file triggers

## Getting Help

- 📖 [GitHub Actions Documentation](https://docs.github.com/en/actions)
- 💬 Open an issue with the `ci/cd` label
- 📧 Contact the DevOps team

## Next Steps

After setup:
1. ✅ Verify CI pipeline runs successfully
2. ✅ Add status badges to README.md
3. ✅ Configure branch protection
4. ✅ Set up deployment environments
5. ✅ Add team reviewers
6. ✅ Document your deployment process
