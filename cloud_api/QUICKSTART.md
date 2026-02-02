# Quick Start Guide - Cloud API v2.0

## 🚀 Quick Setup (5 Minutes)

### 1. Install Dependencies
```bash
cd cloud_api
npm install
```

### 2. Install yt-dlp
```bash
# Ubuntu/Debian
sudo apt install yt-dlp

# Or via pip
pip install yt-dlp

# Or download binary from https://github.com/yt-dlp/yt-dlp/releases
```

### 3. Configure Environment
```bash
# Copy example config
cp .env.example .env

# For development (no authentication)
echo "NODE_ENV=development" > .env
echo "PORT=3000" >> .env
echo "REQUIRE_AUTH=false" >> .env

# For production (with authentication)
echo "NODE_ENV=production" > .env
echo "PORT=3000" >> .env
echo "REQUIRE_AUTH=true" >> .env
echo "API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
echo "ALLOWED_ORIGINS=chrome-extension://your-extension-id" >> .env
```

### 4. Start Server
```bash
# Development
npm run dev

# Production
npm run prod
```

### 5. Verify
```bash
curl http://localhost:3000/health
```

## 📋 Essential Endpoints

### Health Check
```bash
curl http://localhost:3000/health
```

### Get Video Size
```bash
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key-here" \
  -d '{
    "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "duration_hint": 212
  }'
```

### View Metrics
```bash
curl http://localhost:3000/health/metrics
```

### API Documentation
```bash
curl http://localhost:3000/api/v1/docs
```

## ⚙️ Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `REQUIRE_AUTH` | false | Enable API key auth |
| `API_KEY` | "" | API key for authentication |
| `ALLOWED_ORIGINS` | * | CORS allowed origins |
| `RATE_LIMIT_MAX_REQUESTS` | 20 | Max requests per minute |
| `YTDLP_TIMEOUT` | 25000 | yt-dlp timeout (ms) |
| `ENABLE_HEALTH_DETAILS` | true | Enable detailed health |
| `ENABLE_METRICS` | true | Enable metrics tracking |

## 🐳 Docker Quick Start

### Build
```bash
docker build -t ytdlp-sizer-api .
```

### Run
```bash
docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e REQUIRE_AUTH=true \
  -e API_KEY=your-secure-key \
  --name ytdlp-api \
  ytdlp-sizer-api
```

### Check Health
```bash
docker exec ytdlp-api curl http://localhost:3000/health
```

## ☸️ Kubernetes Quick Deploy

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ytdlp-sizer-api
spec:
  replicas: 2
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
---
apiVersion: v1
kind: Service
metadata:
  name: ytdlp-sizer-api
spec:
  selector:
    app: ytdlp-sizer-api
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

Apply:
```bash
kubectl apply -f deployment.yaml
```

## 🔒 Security Quick Check

### ✅ Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Set `REQUIRE_AUTH=true`
- [ ] Generate strong `API_KEY`
- [ ] Restrict `ALLOWED_ORIGINS` to your extension ID
- [ ] Set `ENABLE_HEALTH_DETAILS=false`
- [ ] Use HTTPS/TLS (reverse proxy)
- [ ] Configure firewall rules
- [ ] Set up monitoring alerts
- [ ] Keep yt-dlp updated
- [ ] Review logs regularly

### Generate Secure API Key
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Test Security
```bash
# Test rate limiting (should fail after 20 requests)
for i in {1..25}; do curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=test"}'; done

# Test authentication (should return 401 without key)
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtube.com/watch?v=test"}'

# Test with valid key (should succeed)
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"url":"https://youtube.com/watch?v=test"}'
```

## 📊 Monitoring Quick Setup

### View Current Stats
```bash
# Basic health
curl http://localhost:3000/health

# Detailed system info
curl http://localhost:3000/health/detailed | jq

# Performance metrics
curl http://localhost:3000/health/metrics | jq

# Check if ready to serve traffic
curl http://localhost:3000/health/ready
```

### Common Monitoring Queries

**Success Rate:**
```bash
curl -s http://localhost:3000/health/metrics | jq '.requests.successRate'
```

**Average Response Time:**
```bash
curl -s http://localhost:3000/health/metrics | jq '.performance.avgResponseTime'
```

**Error Count:**
```bash
curl -s http://localhost:3000/health/metrics | jq '.requests.failed'
```

**Uptime:**
```bash
curl -s http://localhost:3000/health/metrics | jq '.uptime.formatted'
```

## 🔧 Troubleshooting

### Issue: "yt-dlp not found"
```bash
# Check if installed
which yt-dlp

# Install if missing
pip install yt-dlp

# Or download binary
sudo wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### Issue: "Port 3000 already in use"
```bash
# Use different port
PORT=3001 npm start

# Or kill existing process
lsof -ti:3000 | xargs kill
```

### Issue: "Rate limit exceeded"
```bash
# Increase limit in .env
RATE_LIMIT_MAX_REQUESTS=50

# Or wait 1 minute for window to reset
```

### Issue: "CORS error"
```bash
# Allow your extension in .env
ALLOWED_ORIGINS=chrome-extension://your-extension-id

# For development, allow all
ALLOWED_ORIGINS=*
```

### Issue: "Authentication failed"
```bash
# Check API key is set
echo $API_KEY

# Verify in request
curl -H "X-API-Key: your-actual-key" ...

# Or disable auth for testing
REQUIRE_AUTH=false npm start
```

## 📚 Documentation Links

- **[CHANGELOG.md](CHANGELOG.md)** - What's new in v2.0
- **[API_VERSIONING.md](API_VERSIONING.md)** - API versions and migration
- **[MONITORING.md](MONITORING.md)** - Detailed monitoring guide
- **[SECURITY.md](SECURITY.md)** - Security configuration
- **[.env.example](.env.example)** - All configuration options

## 🆘 Getting Help

### Check Health Status
```bash
curl http://localhost:3000/health/detailed
```

### View Logs
```bash
# If running directly
npm start

# If running as service
journalctl -u ytdlp-api -f

# If running in Docker
docker logs -f ytdlp-api
```

### Test Endpoint
```bash
# Test with known good video
curl -X POST http://localhost:3000/api/v1/size \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"url":"https://youtube.com/watch?v=jNQXAC9IVRw"}'
```

---

**Quick Start Complete!** 🎉

Your API is ready to handle requests. For detailed configuration and production deployment, see the full documentation.
