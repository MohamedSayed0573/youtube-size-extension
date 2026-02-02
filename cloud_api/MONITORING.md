# Monitoring & Health Checks Guide

## Overview

The YouTube Size API includes comprehensive monitoring capabilities for production deployment, including health checks, metrics tracking, and performance monitoring.

## Health Check Endpoints

### 1. Basic Health Check

**Endpoint:** `GET /health`

**Purpose:** Simple health check for load balancers and uptime monitors.

**Rate Limit:** 100 requests/minute

**Response:**
```json
{
  "ok": true,
  "status": "healthy",
  "timestamp": "2026-02-02T12:34:56.789Z"
}
```

**Use Cases:**
- Load balancer health checks
- Uptime monitoring services (UptimeRobot, Pingdom)
- Basic service availability checks

**Example:**
```bash
curl https://api.example.com/health
```

### 2. Detailed Health Check

**Endpoint:** `GET /health/detailed`

**Purpose:** Comprehensive system metrics and dependency status.

**Configuration:** Can be disabled in production via `ENABLE_HEALTH_DETAILS=false`

**Response:**
```json
{
  "ok": true,
  "status": "healthy",
  "timestamp": "2026-02-02T12:34:56.789Z",
  "version": "v1",
  "uptime": {
    "seconds": 86400,
    "formatted": "1d"
  },
  "system": {
    "platform": "linux",
    "arch": "x64",
    "nodeVersion": "v18.17.0",
    "cpus": 4,
    "memory": {
      "total": 8589934592,
      "free": 4294967296,
      "used": 4294967296,
      "usagePercent": "50.00"
    },
    "loadAverage": [1.2, 1.5, 1.8]
  },
  "process": {
    "pid": 12345,
    "memory": {
      "rss": 52428800,
      "heapTotal": 20971520,
      "heapUsed": 15728640,
      "external": 1048576
    },
    "uptime": 86400
  },
  "dependencies": {
    "ytdlp": {
      "available": true,
      "version": "2024.01.01"
    }
  },
  "config": {
    "environment": "production",
    "authEnabled": true,
    "corsOrigins": 1,
    "rateLimit": {
      "windowMs": 60000,
      "maxRequests": 20
    }
  }
}
```

**Status Values:**
- `healthy` - All systems operational
- `degraded` - yt-dlp unavailable but service running
- `unhealthy` - Critical error

### 3. Metrics Endpoint

**Endpoint:** `GET /health/metrics`

**Purpose:** Request statistics and performance metrics.

**Configuration:** Can be disabled via `ENABLE_METRICS=false`

**Response:**
```json
{
  "ok": true,
  "timestamp": "2026-02-02T12:34:56.789Z",
  "uptime": {
    "seconds": 86400,
    "formatted": "1d"
  },
  "requests": {
    "total": 15000,
    "success": 14500,
    "failed": 500,
    "successRate": "96.67%",
    "byEndpoint": {
      "POST /api/v1/size": 14000,
      "POST /size": 500,
      "GET /health": 500
    }
  },
  "errors": {
    "validation": 200,
    "ytdlp": 150,
    "timeout": 100,
    "auth": 30,
    "rateLimit": 20
  },
  "performance": {
    "avgResponseTime": "1250ms",
    "minResponseTime": "500ms",
    "maxResponseTime": "24500ms"
  }
}
```

**Metrics Tracked:**
- Total requests
- Success/failure rates
- Requests per endpoint
- Error types breakdown
- Response time statistics

### 4. Readiness Probe

**Endpoint:** `GET /health/ready`

**Purpose:** Kubernetes/container orchestration readiness check.

**Response (Ready):**
```json
{
  "ok": true,
  "ready": true
}
```

**Response (Not Ready):**
```json
{
  "ok": false,
  "ready": false,
  "reason": "yt-dlp not available"
}
```

**Use Cases:**
- Kubernetes readiness probes
- Traffic routing decisions
- Deployment health verification

### 5. Liveness Probe

**Endpoint:** `GET /health/live`

**Purpose:** Kubernetes/container orchestration liveness check.

**Response:**
```json
{
  "ok": true,
  "alive": true
}
```

**Use Cases:**
- Container restart decisions
- Process health verification
- Deadlock detection

## Kubernetes Configuration

### Deployment with Health Checks

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
        image: ytdlp-sizer-api:latest
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
        - name: ENABLE_HEALTH_DETAILS
          value: "false"  # Disable in production for security
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Service Configuration

```yaml
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

## Docker Health Check

### Dockerfile with Health Check

```dockerfile
FROM node:18-alpine

# Install yt-dlp
RUN apk add --no-cache python3 py3-pip
RUN pip3 install yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "server.js"]
```

### Docker Compose with Health Check

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      REQUIRE_AUTH: "true"
      API_KEY: ${API_KEY}
      ENABLE_HEALTH_DETAILS: "false"
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health/live', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    restart: unless-stopped
```

## Monitoring Integration

### Prometheus Metrics

To integrate with Prometheus, install `prom-client`:

```bash
npm install prom-client
```

Add to `server.js`:

```javascript
const promClient = require('prom-client');

// Create a Registry
const register = new promClient.Registry();

// Add default metrics
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_ms',
    help: 'Duration of HTTP requests in ms',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});
```

### Grafana Dashboard

Example queries for Grafana:

```promql
# Request rate
rate(http_requests_total[5m])

# Error rate
rate(http_requests_total{status_code=~"5.."}[5m])

# Average response time
rate(http_request_duration_ms_sum[5m]) / rate(http_request_duration_ms_count[5m])

# Success rate
sum(rate(http_requests_total{status_code=~"2.."}[5m])) / sum(rate(http_requests_total[5m])) * 100
```

### DataDog Integration

```javascript
const StatsD = require('node-dogstatsd').StatsD;
const dogstatsd = new StatsD();

// Track API calls
dogstatsd.increment('api.request', 1, ['endpoint:/api/v1/size']);

// Track response times
dogstatsd.histogram('api.response_time', duration, ['endpoint:/api/v1/size']);

// Track errors
dogstatsd.increment('api.error', 1, ['type:validation']);
```

## Alerting Rules

### Critical Alerts

1. **Service Down**
   - Condition: `/health` returns non-200 status
   - Threshold: 3 consecutive failures
   - Action: Page on-call engineer

2. **High Error Rate**
   - Condition: Error rate > 5% over 5 minutes
   - Threshold: 5%
   - Action: Send alert to team channel

3. **yt-dlp Unavailable**
   - Condition: `/health/ready` returns false
   - Threshold: 2 consecutive failures
   - Action: Alert DevOps team

### Warning Alerts

1. **High Response Time**
   - Condition: Average response time > 5 seconds
   - Threshold: 5000ms
   - Action: Send notification

2. **Memory Usage**
   - Condition: Process memory > 80% of limit
   - Threshold: 80%
   - Action: Send notification

3. **Rate Limiting**
   - Condition: Rate limit errors > 100/hour
   - Threshold: 100/hour
   - Action: Log for review

## Log Management

### Structured Logging

Install Winston for structured logging:

```bash
npm install winston
```

Example configuration:

```javascript
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'ytdlp-sizer-api' },
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

// Use in code
logger.info('Processing request', { url, duration_hint });
logger.error('yt-dlp failed', { error: error.message, url });
```

### ELK Stack Integration

```javascript
// Send logs to Elasticsearch
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

const esTransport = new ElasticsearchTransport({
    level: 'info',
    clientOpts: { node: 'http://localhost:9200' },
    index: 'ytdlp-api-logs'
});

logger.add(esTransport);
```

## Performance Monitoring

### Key Metrics to Track

1. **Request Rate** - Requests per second/minute
2. **Response Time** - Average, P50, P95, P99
3. **Error Rate** - Percentage of failed requests
4. **Success Rate** - Percentage of successful requests
5. **yt-dlp Execution Time** - Time spent waiting for yt-dlp
6. **Memory Usage** - Heap size, RSS
7. **CPU Usage** - Process CPU percentage
8. **Rate Limit Hits** - Number of rate-limited requests

### Performance Baselines

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Response Time (avg) | < 2s | 2-5s | > 5s |
| Error Rate | < 1% | 1-5% | > 5% |
| Success Rate | > 99% | 95-99% | < 95% |
| Memory Usage | < 60% | 60-80% | > 80% |
| CPU Usage | < 50% | 50-80% | > 80% |

---

**Last Updated:** February 2, 2026
