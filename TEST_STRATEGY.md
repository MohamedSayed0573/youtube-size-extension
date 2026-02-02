# Test Strategy

## Overview

The YouTube Size Extension uses a **two-tier testing strategy** to balance development speed with comprehensive CI/CD coverage.

## Local Development (Fast)

```bash
# Run only unit tests (excludes integration tests)
npm test                    # Quick feedback (~6 seconds)
npm test:watch            # Watch mode for TDD
```

**Why skip integration tests locally?**
- Integration tests make real YouTube API calls (30+ seconds)
- Slow feedback loop reduces developer productivity
- Real API calls may fail due to rate limits or network issues
- Not needed for rapid development iteration

**What's included:**
- Unit tests for server endpoints
- Worker pool functionality tests
- Circuit breaker tests
- Error handling tests
- Security validation tests

## CI/CD Pipeline (Comprehensive)

```bash
# GitHub Actions runs the full test suite
npm run test:all          # Includes integration tests
```

**Why run integration tests in CI/CD?**
- CI/CD has ample time budget (no developer waiting)
- Integration tests validate real YouTube API integration
- Catches regressions before deployment
- Ensures production readiness

**What's included:**
- All unit tests (from local development)
- Integration tests with real API calls
- End-to-end workflow validation
- Actual video metadata extraction
- Rate limiting behavior tests

## Test Files

| File | Type | Duration | Runs Locally | Runs in CI/CD |
|------|------|----------|--------------|---------------|
| `tests/server.test.js` | Unit | ~10s | ✅ Yes | ✅ Yes |
| `tests/worker-pool.test.js` | Unit | ~8s | ✅ Yes | ✅ Yes |
| `tests/integration.test.js` | Integration | ~60s | ❌ No | ✅ Yes |

## Running Tests Locally

### Run unit tests only (default)
```bash
cd cloud_api
npm test
```

### Run all tests (including slow integration tests)
```bash
cd cloud_api
npm run test:all
```

### Run tests in watch mode
```bash
cd cloud_api
npm test:watch
```

## GitHub Actions CI/CD

The `.github/workflows/ci.yml` pipeline automatically:
1. Runs linting and formatting checks
2. Sets up yt-dlp (required for integration tests)
3. Runs the **full test suite** including integration tests
4. Uploads coverage reports
5. Runs security scans (CodeQL, dependency review)

**Pipeline step:**
```yaml
- name: Run Cloud API tests (all)
  working-directory: ./cloud_api
  run: npm run test:all
```

## Coverage Requirements

Coverage thresholds are enforced in CI/CD only:
- **Statements:** 75%
- **Functions:** 80%
- **Branches:** 60%
- **Lines:** 75%

Local development doesn't enforce these to keep the feedback loop fast.

## Test Skip Reasons

Integration tests are **intentionally skipped in local development** because they:

1. **Make real API calls** - Slow (30+ seconds each)
2. **Depend on external services** - Network latency, potential failures
3. **Rate limited** - YouTube may reject rapid requests
4. **Not needed for TDD** - Unit tests provide sufficient feedback for changes

Example slow tests:
- "should successfully extract video size information" (~30s)
- "should handle concurrent requests without blocking" (~30s)
- "should handle network failures gracefully" (~15s)

## Summary

| Scenario | Command | Duration | Integration Tests |
|----------|---------|----------|-------------------|
| Local development | `npm test` | ~6s | ❌ Skipped |
| Local full suite | `npm run test:all` | ~70s | ✅ Included |
| GitHub Actions CI/CD | `npm run test:all` | ~70s | ✅ Included |

This strategy provides **fast feedback for developers** while ensuring **comprehensive validation** before deployment.
