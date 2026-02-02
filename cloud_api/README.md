# YouTube Size API - Cloud Service

**Version:** 2.0.0  
**Status:** Production Ready  
**Node.js:** >=18.0.0

A production-ready REST API for extracting YouTube video size information using yt-dlp, featuring comprehensive monitoring, security, and API versioning.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start server
npm start
```

**See [QUICKSTART.md](QUICKSTART.md) for detailed 5-minute setup guide.**

## ✨ Features

### Core Functionality
- ✅ Extract video sizes for multiple resolutions (144p-1440p)
- ✅ Support for multiple codec variants (H.264, VP9, AV1)
- ✅ Duration hints for faster responses
- ✅ Combined video+audio size calculation

### Production Features (v2.0)
- ✅ **API Versioning** - URL-based versioning with backward compatibility
- ✅ **Health Monitoring** - Comprehensive health checks for Kubernetes/Docker
- ✅ **Metrics Tracking** - Real-time request statistics and performance metrics
- ✅ **Enhanced Rate Limiting** - Configurable tiered rate limits
- ✅ **CORS Configuration** - Fine-grained origin control
- ✅ **Environment Config** - Complete environment-based configuration

### Security Features
- ✅ Command injection prevention
- ✅ URL validation with security checks
- ✅ API key authentication
- ✅ Request body size limits
- ✅ Timeout protection
- ✅ Rate limiting

## 📋 Requirements

- **Node.js** >= 18.0.0
- **yt-dlp** installed and in PATH
  ```bash
  # Ubuntu/Debian
  sudo apt install yt-dlp
  
  # Or via pip
  pip install yt-dlp
  
  # Or download from https://github.com/yt-dlp/yt-dlp/releases
  ```

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [QUICKSTART.md](QUICKSTART.md) | 5-minute setup guide |
| [CHANGELOG.md](CHANGELOG.md) | What's new in v2.0 |
| [API_VERSIONING.md](API_VERSIONING.md) | API versions and migration |
| [MONITORING.md](MONITORING.md) | Health checks and metrics |
| [SECURITY.md](SECURITY.md) | Security configuration |
| [.env.example](.env.example) | Configuration reference |

## 🔌 API Endpoints

### Main API (v1)

#### POST /api/v1/size
Extract video size information.

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
    "s144p": 12345678,
    "s240p": 23456789,
    "s360p": 34567890,
    "s480p": 45678901,
    "s720p": 67890123,
    "s1080p": 123456789
  },
  "human": {
    "s144p": "11.77 MB",
    "s240p": "22.38 MB",
    "s360p": "32.97 MB",
    "s480p": "43.56 MB",
    "s720p": "64.75 MB",
    "s1080p": "117.74 MB",
    "duration": "3:00"
  },
  "duration": 180
}
```

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: your-api-key` (if auth enabled)

### Health Endpoints

| Endpoint | Purpose | Rate Limit |
|----------|---------|------------|
| `GET /` | Basic service info | None |
| `GET /health` | Simple health check | 100/min |
| `GET /health/detailed` | System metrics | 100/min |
| `GET /health/metrics` | Request statistics | 100/min |
| `GET /health/ready` | Readiness probe | 100/min |
| `GET /health/live` | Liveness probe | 100/min |
| `GET /api/v1/docs` | API documentation | None |

### Legacy Endpoint (Deprecated)

| Endpoint | Status | Migration |
|----------|--------|-----------|
| `POST /size` | Deprecated | Use `/api/v1/size` |

## ⚙️ Configuration

### Environment Variables

Create a `.env` file from `.env.example`:

```env
# Server
PORT=3000
NODE_ENV=production

# Authentication
REQUIRE_AUTH=true
API_KEY=your-secure-api-key-here

# CORS
ALLOWED_ORIGINS=chrome-extension://your-extension-id

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=20

# Features
ENABLE_HEALTH_DETAILS=false
ENABLE_METRICS=true
```

### Generate Secure API Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Configuration Examples

**Development:**
```env
NODE_ENV=development
REQUIRE_AUTH=false
ALLOWED_ORIGINS=*
ENABLE_HEALTH_DETAILS=true
```

**Production:**
```env
NODE_ENV=production
REQUIRE_AUTH=true
API_KEY=<generated-secure-key>
ALLOWED_ORIGINS=chrome-extension://your-id
ENABLE_HEALTH_DETAILS=false
RATE_LIMIT_MAX_REQUESTS=10
```

## 🚀 Deployment

### Local Development

```bash
npm run dev
```

Server starts on `http://localhost:3000` with auto-reload.

### Production Server

```bash
npm run prod
```

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start
pm2 start server.js --name ytdlp-api

# Monitor
pm2 monit

# Auto-start on boot
pm2 startup
pm2 save
```

### Docker

**Dockerfile:**
```dockerfile
FROM node:18-alpine

RUN apk add --no-cache python3 py3-pip && \
    pip3 install yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "server.js"]
```

**Build and Run:**
```bash
docker build -t ytdlp-sizer-api .
docker run -d -p 3000:3000 \
  -e NODE_ENV=production \
  -e REQUIRE_AUTH=true \
  -e API_KEY=your-key \
  --name ytdlp-api \
  ytdlp-sizer-api
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ytdlp-sizer-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ytdlp-sizer-api
  template:
    metadata:
      labels:
        app: ytdlp-sizer-api
    spec:
      containers:
      - name: api
        image: ytdlp-sizer-api:2.0.0
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: REQUIRE_AUTH
          value: "true"
        - name: API_KEY
          valueFrom:
            secretKeyRef:
              name: api-secrets
              key: api-key
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
```

See [MONITORING.md](MONITORING.md) for complete Kubernetes configuration.

## 🔒 Security

### Production Security Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Enable authentication: `REQUIRE_AUTH=true`
- [ ] Generate strong API key
- [ ] Restrict CORS origins
- [ ] Disable detailed health: `ENABLE_HEALTH_DETAILS=false`
- [ ] Deploy behind HTTPS/TLS
- [ ] Configure firewall rules
- [ ] Set up monitoring
- [ ] Keep dependencies updated

### Security Features

1. **Command Injection Prevention** - Uses `execFile()` with argument array
2. **URL Validation** - Blocks shell metacharacters and validates YouTube domains
3. **Rate Limiting** - 20 requests/minute per IP (configurable)
4. **API Key Authentication** - Optional header-based authentication
5. **CORS Restrictions** - Configurable allowed origins
6. **Request Size Limits** - 10KB maximum body size
7. **Timeout Protection** - 25-second limit on yt-dlp execution

See [SECURITY.md](SECURITY.md) for detailed security guide.

## 📊 Monitoring

### Health Checks

```bash
# Basic health
curl http://localhost:3000/health

# Detailed metrics
curl http://localhost:3000/health/detailed

# Performance stats
curl http://localhost:3000/health/metrics
```

### Metrics Available

- Request counts (total, success, failed)
- Success rate percentage
- Response time statistics
- Error breakdown by type
- System resource usage
- yt-dlp availability

### Monitoring Integration

- **Kubernetes** - Liveness and readiness probes
- **Docker** - Built-in health checks
- **Prometheus** - Metrics endpoint (see MONITORING.md)
- **Grafana** - Dashboard templates
- **DataDog** - StatsD integration
- **ELK Stack** - Structured logging

See [MONITORING.md](MONITORING.md) for integration guides.

## 🧪 Testing

### Test Health Endpoint

```bash
curl http://localhost:3000/health
```

### Test Size Extraction

```bash
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "url": "https://youtube.com/watch?v=jNQXAC9IVRw",
    "duration_hint": 212
  }'
```

### Test Rate Limiting

```bash
for i in {1..25}; do
  curl -X POST http://localhost:3000/api/v1/size \
    -H "Content-Type: application/json" \
    -d '{"url":"https://youtube.com/watch?v=test"}' &
done
wait
```

### Test Authentication

```bash
# Without key (should fail)
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=test"}'

# With key (should succeed)
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"url":"https://youtube.com/watch?v=test"}'
```

## 🔧 Troubleshooting

### Common Issues

**Issue: "yt-dlp not found"**
```bash
# Install yt-dlp
pip install yt-dlp

# Verify installation
which yt-dlp
yt-dlp --version
```

**Issue: "Port already in use"**
```bash
# Use different port
PORT=3001 npm start

# Or kill existing process
lsof -ti:3000 | xargs kill
```

**Issue: "CORS error"**
```bash
# Update .env
ALLOWED_ORIGINS=chrome-extension://your-extension-id

# For development
ALLOWED_ORIGINS=*
```

**Issue: "Rate limit exceeded"**
```bash
# Increase limit in .env
RATE_LIMIT_MAX_REQUESTS=50

# Or wait for window to reset (1 minute)
```

See [QUICKSTART.md](QUICKSTART.md) for more troubleshooting.

## 📈 Performance

### Benchmarks

- **Average Response Time:** 1-3 seconds
- **Success Rate:** >99% (with valid URLs)
- **Throughput:** 20 req/min per IP (configurable)
- **Memory Usage:** ~50MB baseline
- **CPU Usage:** Minimal (<5% idle, spikes during yt-dlp execution)

### Optimization Tips

1. Use `duration_hint` to speed up size calculation
2. Implement caching layer (Redis) for repeated requests
3. Scale horizontally with load balancer
4. Use CDN for static assets
5. Monitor metrics and adjust rate limits

## 🔄 Migration

### From v1 to v2

**No breaking changes** - v2 is fully backward compatible.

**Recommended updates:**
1. Update endpoint URL from `/size` to `/api/v1/size`
2. Add API key authentication for production
3. Configure environment variables properly
4. Enable health monitoring

See [API_VERSIONING.md](API_VERSIONING.md) for migration guide.

## 📝 License

MIT License - See root LICENSE file

## 🤝 Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) in root directory

## 📞 Support

- **Documentation:** Check docs in this folder
- **Issues:** GitHub Issues
- **Health Status:** `curl http://your-api.com/health/detailed`

---

**Version:** 2.0.0  
**Last Updated:** February 2, 2026  
**Status:** Production Ready ✅
