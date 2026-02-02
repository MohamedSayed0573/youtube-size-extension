# YouTube Size Extension

A browser extension that displays YouTube video download sizes for different quality levels before downloading. Works with Chrome, Firefox, Edge, and other Chromium-based browsers.

## 📋 Features

- **Real-time size calculation** for multiple resolutions (144p - 1440p)
- **Auto-prefetch** video sizes when loading YouTube pages
- **Badge indicators** showing size information
- **Native host** and **Cloud API** support (dual backend)
- **Duration hints optimization** to reduce redundant calls
- **Comprehensive error tracking** with Sentry integration
- **Rate limiting** and security hardening

## 🏗️ Architecture

3-tier system with fallback support:

```
Browser Extension (MV3)
    ↓
Native Messaging Host (Python + yt-dlp)
    ↓ (fallback)
Cloud API (Node.js/Express + yt-dlp)
```

- **Extension**: Popup UI, background worker, content script
- **Native Host**: Python script using Chrome native messaging protocol
- **Cloud API**: RESTful Node.js server with monitoring and security

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (for Cloud API)
- Python 3.11+ (for Native Host)
- yt-dlp installed and in PATH
- Chrome/Firefox browser

### Installation

#### 1. Install yt-dlp

```bash
# Linux/Mac
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Windows
winget install yt-dlp
```

#### 2. Load Extension

**Chrome/Edge:**
1. Navigate to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the extension root directory

**Firefox:**
1. Navigate to `about:debugging`
2. Click "Load Temporary Add-on"
3. Select `manifest.json`

#### 3. Install Native Host (Recommended)

**Linux/Mac:**
```bash
cd native_host
./install_host.sh YOUR_CHROME_EXTENSION_ID
```

**Windows:**
```powershell
cd native_host
.\install_win.ps1
```

Replace `YOUR_CHROME_EXTENSION_ID` with the ID from `chrome://extensions`

#### 4. Cloud API Setup (Optional Fallback)

```bash
cd cloud_api
npm install

# Set environment variables
export SENTRY_DSN="your-sentry-dsn"
export NODE_ENV="production"
export PORT="3000"

# Start server
npm start
```

## 🔧 Configuration

### Environment Variables (Cloud API)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment (development/production/test) | `development` |
| `SENTRY_DSN` | Sentry error tracking DSN (required for monitoring) | `` |
| `API_KEY` | API authentication key (generate with `openssl rand -hex 32`) | `` |
| `REQUIRE_AUTH` | Enable API key authentication | `false` |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated or `*`) | `*` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `20` |
| `YTDLP_TIMEOUT` | yt-dlp execution timeout (ms) | `25000` |
| `YTDLP_MAX_BUFFER` | Maximum buffer for yt-dlp output | `10485760` |

**Configuration Validation:**
- All environment variables are validated using Zod schemas at startup
- Invalid configuration causes server to exit with detailed error messages
- See [cloud_api/.env.example](cloud_api/.env.example) for complete examples

### Extension Settings

Access via extension options page:

- **Auto-prefetch**: Automatically fetch sizes when loading YouTube
- **Show badge**: Display size on extension icon
- **Cache TTL**: How long to cache size data (default: 2 hours)
- **Cloud API URL**: Alternative backend endpoint

## 📖 API Documentation

### POST `/api/v1/size`

Extract video size information for multiple resolutions.

**Request:**
```json
{
  "url": "https://youtube.com/watch?v=VIDEO_ID",
  "duration_hint": 180
}
```

**Response:**
```json
{
  "ok": true,
  "bytes": {
    "s720p": 45234567,
    "s1080p": 89123456,
    "s1440p": 134567890
  },
  "human": {
    "s720p": "45.23 MB",
    "s1080p": "89.12 MB",
    "s1440p": "134.57 MB"
  },
  "duration": 180
}
```

**Error Response:**
```json
{
  "ok": false,
  "error": "Invalid or unsafe YouTube URL"
}
```

### Health Endpoints

- `GET /` - Service information
- `GET /health` - Comprehensive health check with:
  - System metrics (CPU, memory, load)
  - Process information
  - **Dependency validation** (yt-dlp availability check)
  - Configuration status
  - Returns `healthy` or `degraded` status

## 🧪 Testing

### Cloud API Tests

```bash
cd cloud_api
npm test              # Run with coverage
npm run test:watch   # Watch mode
npm run test:ci      # CI mode
```

**Coverage:** 84% (21 tests)

### Native Host Tests

```bash
cd native_host
pip install pytest pytest-cov
pytest --cov=ytdlp_host --cov-report=xml --cov-report=term
```

### Linting & Formatting

```bash
# Root directory
npm run check        # Format check + lint
npm run lint:fix     # Auto-fix issues
npm run format       # Format all files
```

## 🐳 Docker Deployment

```bash
cd cloud_api
docker build -t ytdlp-sizer-api .
docker run -p 3000:3000 \
  -e SENTRY_DSN="your-dsn" \
  -e NODE_ENV="production" \
  -e REQUIRE_AUTH="true" \
  -e API_KEY="your-secret-key" \
  ytdlp-sizer-api
```

## 🔒 Security

- **Input validation** with Zod schemas
- **Command injection prevention** using `execFile`
- **Rate limiting** to prevent abuse
- **CORS** properly configured
- **API key authentication** support
- **Shell metacharacter blocking**
- **HTTPS enforcement** for YouTube URLs
- **Request size limits** (10KB max)
- **Request correlation** via X-Request-ID headers for tracing

## 🏗️ Architecture Details

### Request Flow & Error Recovery

1. **Request Tracing**: Each request gets a unique ID (X-Request-ID) for distributed tracing
2. **Retry Logic**: Failed yt-dlp calls automatically retry with exponential backoff (up to 2 retries)
3. **Circuit Breaking**: Timeouts and fatal errors fail fast without retries
4. **Graceful Degradation**: Health endpoint reports "degraded" status if yt-dlp unavailable

### Cache Strategy

**Extension (Client-Side):**
- In-memory cache in background worker
- Configurable TTL (default: 2 hours)
- Cache key: `cache-{videoId}`
- Stored in `chrome.storage.local`
- Invalidation: Manual via options page or TTL expiry

**Duration Hints:**
- Collected from content script on page load
- Cached for 1 hour to optimize yt-dlp calls
- Reduces redundant `--get-duration` executions

**Cloud API (Stateless):**
- No server-side caching (stateless design)
- Clients responsible for caching responses
- Idempotent: Same request always returns same result (until video changes)

## 📊 Monitoring

### Sentry Integration

Error tracking and performance monitoring enabled:

```bash
# View errors at
https://sentry.io/organizations/YOUR_ORG/issues/

# Metrics tracked:
# - API response times
# - Error rates with request context
# - CPU profiling
# - Request breadcrumbs
# - Request correlation IDs
```

### Request Tracing

All API requests include correlation IDs for distributed tracing:

- **Header**: `X-Request-ID` (generated or forwarded from client)
- **Format**: `req_{timestamp}_{random}`
- **Propagation**: Included in logs, errors, and responses
- **Usage**: Track requests across load balancers, proxies, and services

Example:
```bash
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: custom-trace-id-123" \
  -d '{"url": "https://youtube.com/watch?v=VIDEO_ID"}'

# Response includes:
# X-Request-ID: custom-trace-id-123
```

### Logging

Structured logging with Pino:

- **Development**: Colorized pretty output
- **Production**: JSON format for aggregation
- **Test**: Silent mode

## 🛠️ Development

### Project Structure

```
.
├── background.js           # Service worker
├── content.js             # YouTube page injection
├── popup.js               # Extension popup UI
├── utils.js               # Shared utilities
├── manifest.json          # Extension manifest
├── cloud_api/
│   ├── server.js          # Express API server
│   ├── instrument.js      # Sentry initialization
│   ├── Dockerfile         # Container build
│   └── tests/             # Jest test suite
└── native_host/
    ├── ytdlp_host.py      # Native messaging host
    ├── install_host.sh    # Linux/Mac installer
    └── install_win.ps1    # Windows installer
```

### Adding New Resolutions

Update format IDs in all 3 files:

1. [background.js](background.js) - `VIDEO_FORMAT_IDS`
2. [cloud_api/server.js](cloud_api/server.js#L163) - `VIDEO_FORMAT_IDS`
3. [native_host/ytdlp_host.py](native_host/ytdlp_host.py#L199) - `parse_sizes_from_format_list`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests and linting (`npm run check && npm test`)
4. Commit changes (`git commit -m 'Add amazing feature'`)
5. Push to branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Code Standards

- JSDoc comments required for all functions
- Prettier formatting enforced
- ESLint rules must pass
- Test coverage >80%
- Security best practices

## 📝 License

MIT License - see LICENSE file for details

## 🐛 Troubleshooting

### "Native host not found"

- Ensure yt-dlp is installed: `yt-dlp --version`
- Check extension ID matches in native host JSON files
- Verify registry entries (Windows) or JSON file location (Linux/Mac)

### "Cloud API connection failed"

- Check Cloud API is running: `curl http://localhost:3000/health`
- Verify `cloudApiUrl` in extension options
- Check CORS configuration allows your origin

### "No size data available"

- Video may be private or region-locked
- Try clearing cache (extension options)
- Check yt-dlp can access video: `yt-dlp -F VIDEO_URL`

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/YOUR_REPO/issues)
- **Sentry Dashboard**: [View Errors](https://sentry.io)
- **Documentation**: [Wiki](https://github.com/YOUR_REPO/wiki)

## 🙏 Acknowledgments

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - Video metadata extraction
- [Sentry](https://sentry.io) - Error tracking
- [Express](https://expressjs.com) - Web framework
- [Zod](https://zod.dev) - Schema validation

---

**Version:** 0.2.0  
**Last Updated:** February 2, 2026
