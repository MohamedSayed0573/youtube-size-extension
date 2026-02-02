# YouTube Size Extension - AI Agent Instructions

## Architecture Overview

**3-tier system** fetching YouTube video sizes via yt-dlp:

1. **Browser Extension** (MV3): popup.js, background.js (service worker), content.js
2. **Native Host** (Python): `native_host/ytdlp_host.py` - native messaging protocol
3. **Cloud API** (Node.js): `cloud_api/server.js` - alternative HTTP endpoint

**Data flow**: content.js → background.js → (native host OR cloud API) → yt-dlp → response →
popup.js

**Fallback strategy**: Native host preferred, cloud API as fallback (configurable in options)

## Critical Patterns

### Shared Code via utils.js

- **ALL** files import `utils.js` for `isYouTubeUrl()`, `extractVideoId()`, `humanizeBytes()`
- Background worker: `importScripts("utils.js")`
- Content script: injected via manifest.json order
- NO duplicate implementations allowed

### Resolution Mapping

Video format IDs hardcoded across all 3 tiers:

```javascript
// Must stay in sync: background.js, server.js, ytdlp_host.py
s720p: format 398 (video) + 251 (audio)
s1080p: format 399/299/303 + 251 (codec variants: AV1/H.264/VP9)
s1440p: format 400/308 + 251
```

### Native Messaging Protocol

Python host uses **Chrome native messaging**: 4-byte length prefix (little-endian) + JSON payload

- Input: `{url: string, duration_hint?: number}`
- Output:
  `{ok: boolean, bytes: {s720p: number, ...}, human: {s720p: "45 MB", ...}, duration: number}`
- Host identifier: `"com.ytdlp.sizer"` in manifest.json and JSON configs

### Duration Hints Optimization

Background worker collects duration from content.js to avoid redundant yt-dlp calls:

- Cached 1 hour: `durationHints Map<videoId, {d: seconds, ts: timestamp}>`
- Passed to both native host and cloud API as `duration_hint` parameter
- Host/API skips `--get-duration` call if hint provided

## Developer Workflows

### Testing Locally

```bash
# Root: Lint/format entire project
npm run check              # format:check + lint
npm run lint:fix          # auto-fix linting issues

# Cloud API: Run tests
cd cloud_api && npm test   # Jest with coverage
```

### Loading Extension

1. Chrome: `chrome://extensions` → Load unpacked → select root directory
2. Firefox: `about:debugging` → Load Temporary Add-on → select `manifest.json`
3. Note extension ID for native host setup

### Installing Native Host

```bash
# Linux/Mac
cd native_host
./install_host.sh YOUR_CHROME_EXTENSION_ID

# Windows: Edit install_host.reg with extension ID, then double-click
```

### Debugging

- Background worker: `chrome://extensions` → Inspect service worker
- Content script: Open DevTools on YouTube page → Sources → content.js
- Native host: Check stderr logs (written by `_dbg()` function)
- Cloud API: `NODE_ENV=development npm run dev` for colorized pino logs
- Sentry Dashboard: https://mohamed-sayed-dx.sentry.io/issues/?project=node-express
- Error Tracking: All unhandled errors automatically sent to Sentry

### Logging System (Cloud API)

Structured logging with **pino**:

```javascript
// Environment-based configuration:
// - Test: silent (no output)
// - Development: pino-pretty (colorized readable)
// - Production: JSON (for log aggregation)

// Usage:
logger.info({ url, duration }, "Message");
logger.error({ error: err.message, path }, "Error occurred");
```

## Code Conventions

### JSDoc Required

Every function needs complete JSDoc with @param, @returns, @example:

```javascript
/**
 * Brief description
 *
 * @param {string} url - Description
 * @returns {boolean} Description
 * @example
 *   isYouTubeUrl('https://youtube.com/watch?v=xxx') // true
 */
```

### Error Handling Pattern

```javascript
try {
    // operation
} catch (_) {
    // silent fail for non-critical paths (badge updates, cleanup)
    // BUT throw/return error for critical paths (API calls)
}
```

### Settings Access

Global `settings` object loaded in background.js from chrome.storage.sync:

```javascript
settings.autoPrefetch; // boolean
settings.showBadge; // boolean
settings.cacheTtlSec; // number (default: 7200)
settings.cloudApiUrl; // string (empty = use native host)
```

### Cache Structure

Background worker stores in chrome.storage.local:

```javascript
{
  "cache-VIDEO_ID": {
    bytes: {s720p: 123456, ...},
    human: {s720p: "1.23 MB", ...},
    ts: 1704067200000,  // timestamp
    duration: 180
  }
}
```

## External Dependencies

**Cloud API:**

- **@sentry/node**: Error tracking and performance monitoring (v10.38.0+)
- **@sentry/profiling-node**: CPU profiling for performance analysis
- **pino**: Structured logging (v8.17.2+)
- **pino-pretty**: Development log formatting (v10.3.1+)
- **express**: HTTP framework (v4.18.2+)
- **express-rate-limit**: API rate limiting (v7.1.5+)
- **zod**: Input validation (v3.22.4+)

**Browser Extension:**

- **yt-dlp** CLI tool: Must be in PATH for both native host and cloud API
- **Chrome/Firefox APIs**: tabs, nativeMessaging, storage, action (badges)
- **YouTube DOM**: Watches `ytd-player video.html5-main-video` element
- **YouTube events**: `yt-navigate-finish`, `yt-page-data-updated` for SPA navigation

## Integration Points

### Background ↔ Content Script

```javascript
// Content → Background
chrome.runtime.sendMessage({ type: "updateDuration", videoId, duration, itag });

// Background → Content (via popup)
chrome.tabs.sendMessage(tabId, { type: "ping" });
```

### Extension ↔ Native Host

```javascript
chrome.runtime.sendNativeMessage(
  "com.ytdlp.sizer",
  {url, duration_hint},
  response => {...}
)
```

### Extension ↔ Cloud API

```javascript
fetch(cloudApiUrl, {
    method: "POST",
    body: JSON.stringify({ url, duration_hint }),
});
```

## Cloud API Testing

**Jest test suite** (21 tests, 84% coverage):

```bash
cd cloud_api
npm test              # Run with coverage
npm run test:watch   # Watch mode
npm run test:ci      # CI mode (force exit)
```

**Coverage thresholds:**

- Statements: 75%
- Functions: 80%
- Branches: 60%
- Lines: 75%

**Test categories:**

- Health endpoints (3 tests)
- API validation (8 tests)
- Security features (5 tests)
- Error handling (3 tests)
- CORS configuration (2 tests)

## Sentry Monitoring

**Error Tracking:**

- `instrument.js` initializes Sentry at startup (MUST be first require)
- All uncaught exceptions automatically captured
- Environment tagged (development/staging/production)
- Breadcrumbs track user actions before error

**Performance Monitoring:**

- 100% sampling in development
- 10% sampling in production
- CPU profiling enabled (relative to trace sampling)
- Automatic HTTP request tracking

**Configuration:**

```javascript
// instrument.js
Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: isProd ? 0.1 : 1.0,
    profilesSampleRate: isProd ? 0.1 : 1.0,
});
```

## CI/CD Pipeline

GitHub Actions runs on push/PR:

- **Lint**: Prettier + ESLint (blocks merge if fails)
- **Test**: Jest for cloud_api (21 tests, min 84% coverage), pytest for native_host
- **Security**: CodeQL, npm audit, Snyk, dependency review
- **Deploy**: Docker build → Railway/Render (main branch only)

Required secrets for deployment: `DOCKER_USERNAME`, `DOCKER_PASSWORD`, `RAILWAY_TOKEN`

## Project-Specific Rules

1. **Never create .md files** unless explicitly requested
2. **Keep format ID mappings synchronized** across all 3 tiers
3. **Use execFile (not exec)** to prevent command injection
4. **Decimal units (1000-based)** for humanizeBytes: KB, MB, GB (not KiB, MiB)
5. **Cache TTL default: 2 hours** (7200 seconds)
6. **Rate limit: 1 request per 10 seconds** per video ID
7. **Service worker imports**: Use `importScripts()` not ES6 imports
8. **Native host logs**: stderr only (stdout reserved for protocol)
9. **Logging**: Use `logger.info()`, `logger.error()`, NOT `console.log()`
10. **Error context**: Always include relevant data in log objects:
    `logger.error({ url, error }, "msg")`
11. **Sentry breadcrumbs**: Add for important API calls: `Sentry.addBreadcrumb({ message, data })`
12. **Test mode**: Set `NODE_ENV=test` to silence logs in test suite
13. **instrument.js**: MUST be first require in server.js (before other imports)
14. **Error handler order**: Sentry handler must come AFTER all routes, BEFORE custom error handler
