# CI/CD Pipeline Documentation

## Overview

This project uses GitHub Actions for continuous integration and deployment. The CI/CD pipeline ensures code quality, runs tests, performs security scans, and automates deployments.

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Actions Workflows                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │      CI      │    │   Deploy     │    │   Security   │      │
│  │   Pipeline   │    │   Pipeline   │    │    Scans     │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                    │              │
│         ▼                   ▼                    ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │ Lint/Format │    │ Build Docker│    │   CodeQL    │        │
│  │   Tests     │    │   Deploy    │    │  Snyk Scan  │        │
│  │   Build     │    │   Release   │    │  Dep Review │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Workflows

### 1. CI Pipeline (`.github/workflows/ci.yml`)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches

**Jobs:**

#### Lint & Format Check
- Runs Prettier format check
- Runs ESLint
- Ensures code style consistency

#### Test Cloud API
- Sets up Node.js 20
- Installs yt-dlp
- Runs Jest tests with coverage
- Uploads coverage to Codecov

#### Test Native Host
- Sets up Python 3.11
- Installs yt-dlp
- Runs pytest (when tests exist)

#### Security Scan
- Runs `npm audit`
- Runs Snyk security scanner
- Checks for vulnerabilities in dependencies

#### Build Docker
- Builds Docker image for cloud API
- Tests image runs correctly
- Uses layer caching for faster builds

#### Validate Extension
- Validates manifest.json syntax
- Checks required manifest fields

#### All Checks Passed
- Final gate that requires all jobs to pass
- Provides clear success/failure indication

### 2. Deploy Pipeline (`.github/workflows/deploy.yml`)

**Triggers:**
- Push to `main` branch
- Version tags (`v*`)
- Manual workflow dispatch

**Jobs:**

#### Deploy Cloud API
- Builds and pushes Docker image to Docker Hub
- Deploys to Railway (if configured)
- Deploys to Render (if configured)
- Performs health check on deployed API

#### Create GitHub Release
- Generates changelog from git commits
- Creates GitHub release with artifacts
- Attaches manifest.json and README.md

### 3. Security Workflows

#### CodeQL Analysis (`.github/workflows/codeql.yml`)
- Runs on push, PR, and weekly schedule
- Analyzes JavaScript and Python code
- Detects security vulnerabilities
- Runs extended security queries

#### Dependency Review (`.github/workflows/dependency-review.yml`)
- Runs on pull requests
- Reviews new/updated dependencies
- Fails on moderate+ severity vulnerabilities
- Checks for restricted licenses

### 4. Maintenance Workflows

#### Dependabot (`.github/dependabot.yml`)
- Automated dependency updates
- Weekly schedule for npm, Docker, GitHub Actions
- Creates PRs for version bumps
- Includes security updates

#### Stale Issues (`.github/workflows/stale.yml`)
- Marks stale issues (60 days)
- Marks stale PRs (30 days)
- Auto-closes after 7 days of inactivity
- Excludes pinned/security items

## Required Secrets

Configure these in GitHub Settings → Secrets and Variables → Actions:

### Docker Deployment
```
DOCKER_USERNAME=your-docker-hub-username
DOCKER_PASSWORD=your-docker-hub-token
```

### Cloud Deployment
```
RAILWAY_TOKEN=your-railway-token          # Optional
RENDER_DEPLOY_HOOK=your-render-hook-url   # Optional
API_URL=https://your-api-url.com          # For health checks
```

### Security Scanning
```
SNYK_TOKEN=your-snyk-token                # Optional
```

### Code Coverage
```
CODECOV_TOKEN=your-codecov-token          # Optional
```

## CI/CD Best Practices

### ✅ What's Implemented

1. **Automated Testing**
   - Test framework configured (Jest)
   - Coverage reporting enabled
   - Multiple test environments (Node.js, Python)

2. **Code Quality Gates**
   - Linting required before merge
   - Format checking enforced
   - Test coverage thresholds (70%)

3. **Security**
   - Dependency scanning (npm audit, Snyk)
   - Static analysis (CodeQL)
   - Dependency review on PRs
   - Security updates via Dependabot

4. **Deployment**
   - Multi-platform support (Railway, Render)
   - Docker containerization
   - Health checks after deployment
   - Automated releases with changelog

5. **Developer Experience**
   - PR template for consistency
   - Clear job names and steps
   - Parallel job execution
   - Fast feedback loops

### 📋 Usage Examples

#### Running CI Locally

```bash
# Check formatting
npm run format:check

# Run linting
npm run lint

# Run tests
cd cloud_api && npm test

# Run full check
npm run check
```

#### Manual Deployment

```bash
# Trigger manual deployment via GitHub CLI
gh workflow run deploy.yml -f environment=staging

# Or use GitHub UI:
# Actions → Deploy → Run workflow → Select environment
```

#### Building Docker Locally

```bash
cd cloud_api
docker build -t ytdlp-sizer-api:local .
docker run -p 3000:3000 ytdlp-sizer-api:local
```

## Workflow Status Badges

Add these to your README.md:

```markdown
![CI](https://github.com/YOUR_USERNAME/extention/workflows/CI%20Pipeline/badge.svg)
![Deploy](https://github.com/YOUR_USERNAME/extention/workflows/Deploy/badge.svg)
![CodeQL](https://github.com/YOUR_USERNAME/extention/workflows/CodeQL/badge.svg)
```

## Troubleshooting

### Tests Failing in CI

**Problem:** Tests pass locally but fail in CI

**Solutions:**
- Check Node.js version matches (20.x)
- Verify yt-dlp is installed correctly
- Check environment variables
- Review CI logs for missing dependencies

### Docker Build Fails

**Problem:** Docker image build fails

**Solutions:**
- Test locally: `docker build -t test ./cloud_api`
- Check Dockerfile syntax
- Verify base image is accessible
- Review build context size

### Deployment Fails

**Problem:** Deployment job fails

**Solutions:**
- Verify all secrets are configured
- Check API_URL for health checks
- Review deployment service logs
- Ensure Docker image is pushed successfully

### Security Scan Failures

**Problem:** Snyk or npm audit fails

**Solutions:**
- Review vulnerability details
- Update vulnerable dependencies
- Add exceptions for false positives
- Consider alternative packages

## Future Improvements

- [ ] Add integration tests
- [ ] Implement E2E testing for extension
- [ ] Add performance benchmarks
- [ ] Implement canary deployments
- [ ] Add rollback mechanism
- [ ] Set up monitoring alerts
- [ ] Add test result dashboard
- [ ] Implement branch protection rules

## Contributing

When contributing, ensure:
1. All CI checks pass before requesting review
2. Tests added for new features
3. Documentation updated
4. PR template filled out
5. Conventional commit messages used

## Support

For CI/CD issues:
1. Check workflow run logs
2. Review this documentation
3. Open an issue with the `ci/cd` label
4. Contact the DevOps team
