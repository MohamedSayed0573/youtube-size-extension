# Cloud API - Architecture & Implementation

## Overview

Non-blocking, fault-tolerant Node.js API for YouTube video size extraction using yt-dlp.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                    Express HTTP Server                   │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │  API Routes  │  │ Rate Limiter│  │ Auth Middleware│  │
│  └──────────────┘  └─────────────┘  └───────────────┘  │
└────────────┬────────────────────────────────────────────┘
             │
             ▼
    ┌────────────────┐
    │ Circuit Breaker │◄──── Monitors failure rates
    │  (CLOSED/OPEN)  │      Auto recovery after cooldown
    └────────┬────────┘
             │
             ▼
    ┌────────────────┐
    │  Worker Pool   │◄──── Manages 2-10 worker threads
    │  (Queue + LB)  │      Dynamic scaling
    └────────┬────────┘
             │
        ┌────┴────┬────────┐
        ▼         ▼        ▼
    ┌──────┐  ┌──────┐  ┌──────┐
    │Worker│  │Worker│  │Worker│  ◄──── Execute yt-dlp
    │  #1  │  │  #2  │  │  #n  │        in subprocess
    └──────┘  └──────┘  └──────┘
```

### Worker Pool Pattern

**Why?** yt-dlp subprocess blocks Node.js event loop → all requests stall

**Solution:** Worker threads execute yt-dlp in parallel

**Benefits:**
- ✅ Non-blocking: Main thread handles HTTP while workers execute yt-dlp
- ✅ Scalability: Auto-scales from 2 to 10 workers based on load
- ✅ Fault isolation: Worker crash doesn't kill main process
- ✅ Resource management: Auto-recycles workers after 100 tasks

**Implementation:** `worker-pool.js`

```javascript
const pool = new WorkerPool({
  minWorkers: 2,        // Always active
  maxWorkers: 10,       // Scale up under load
  taskTimeout: 30000,   // 30s per task
  maxTasksPerWorker: 100 // Recycle to prevent memory leaks
});

// Execute task (queues if all workers busy)
const result = await pool.execute({
  url: 'https://youtube.com/watch?v=xxx',
  timeout: 25000,
  maxBuffer: 10485760
});
```

### Circuit Breaker Pattern

**Why?** yt-dlp failures cascade → overload → more failures

**Solution:** Fail-fast when error rate exceeds threshold

**States:**
- **CLOSED** (normal): All requests pass through
- **OPEN** (failing): Reject all requests immediately (no wasted resources)
- **HALF_OPEN** (testing): Allow limited requests to test recovery

**Thresholds:**
- Opens after **5 failures** in **10 requests**
- Tests recovery after **60s cooldown**
- Closes after **2 consecutive successes**

**Implementation:** `circuit-breaker.js`

```javascript
const breaker = new CircuitBreaker({
  failureThreshold: 5,    // Open after 5 failures
  successThreshold: 2,    // Close after 2 successes
  timeout: 60000,         // 1 minute cooldown
  volumeThreshold: 10     // Min requests before evaluating
});

// Execute with circuit protection
const data = await breaker.execute(async () => {
  return await workerPool.execute({ url, timeout, maxBuffer });
});
```

**Events:**
```javascript
breaker.on('open', () => {
  logger.error('Circuit opened - service degraded');
  // Alert ops team
});

breaker.on('closed', () => {
  logger.info('Circuit closed - service recovered');
});
```

## API Endpoints

### Core

- **POST /api/v1/size** - Extract video sizes
  - Request: `{ url: string, duration_hint?: number }`
  - Response: `{ ok: boolean, bytes: Object, human: Object, duration: number }`
  
### Monitoring

- **GET /health** - System health + worker pool + circuit breaker status
- **GET /api/v1/metrics** - Detailed metrics
- **GET /api/v1/docs** - API documentation

### Admin

- **POST /api/v1/admin/circuit-breaker/reset** - Manually reset circuit (requires auth)

## Configuration

Environment variables (see `.env.example`):

```bash
# Server
PORT=3000
NODE_ENV=production

# Worker Pool
MIN_WORKERS=2           # Minimum workers (always active)
MAX_WORKERS=10          # Maximum workers (scales dynamically)

# Authentication (optional)
REQUIRE_AUTH=false
API_KEY=your-secret-key

# CORS
ALLOWED_ORIGINS=*       # Comma-separated or *

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000      # 1 minute
RATE_LIMIT_MAX_REQUESTS=20      # 20 requests per window

# yt-dlp
YTDLP_TIMEOUT=25000             # 25 seconds
YTDLP_MAX_BUFFER=10485760       # 10 MB

# Monitoring
SENTRY_DSN=https://...          # Optional error tracking
```

## Deployment

### Docker

```bash
# Build
docker build -t ytdlp-sizer-api .

# Run
docker run -d \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e API_KEY=secret \
  -e REQUIRE_AUTH=true \
  ytdlp-sizer-api
```

### Railway / Render

1. Connect GitHub repository
2. Set environment variables
3. Deploy automatically on push to `main`

### Requirements

- **Node.js** 18+
- **yt-dlp** installed and in PATH
- **2 GB RAM** minimum (for 10 workers)
- **2 CPU cores** recommended

## Monitoring

### Metrics

```bash
curl http://localhost:3000/api/v1/metrics
```

Response:
```json
{
  "workerPool": {
    "totalTasks": 1532,
    "completedTasks": 1498,
    "failedTasks": 34,
    "activeWorkers": 4,
    "queueLength": 0,
    "peakWorkers": 10
  },
  "circuitBreaker": {
    "state": "CLOSED",
    "failures": 1,
    "successes": 150,
    "stats": {
      "totalRequests": 1532,
      "rejectedRequests": 0
    }
  }
}
```

### Health Check

```bash
curl http://localhost:3000/health
```

Status codes:
- **healthy**: All systems operational
- **degraded**: yt-dlp issues OR circuit HALF_OPEN
- **unhealthy**: yt-dlp unavailable AND (circuit OPEN OR no workers)

### Sentry Integration

All errors automatically sent to Sentry:
- Unhandled exceptions
- Circuit breaker trips
- Worker failures
- Request timeouts

Dashboard: https://mohamed-sayed-dx.sentry.io/issues/

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# CI mode
npm run test:ci
```

Test suites:
- **server.test.js** - API endpoints (21 tests)
- **worker-pool.test.js** - Worker pool + circuit breaker (27 tests)

Coverage: 80%+ (statements, functions, lines)

## Troubleshooting

### High Queue Length

**Symptom:** `/api/v1/metrics` shows `queueLength > 10`

**Cause:** All workers busy, requests queuing

**Solution:**
- Increase `MAX_WORKERS` (default: 10)
- Reduce `YTDLP_TIMEOUT` (default: 25s)
- Scale horizontally (multiple instances)

### Circuit Opens Frequently

**Symptom:** Circuit breaker state = OPEN in `/health`

**Causes:**
- yt-dlp rate limited by YouTube
- Network issues
- yt-dlp not installed or outdated

**Solutions:**
- Check `docker logs` or `stderr` for yt-dlp errors
- Update yt-dlp: `pip install -U yt-dlp`
- Reduce request rate
- Use multiple IP addresses (proxy/VPN)

### Memory Usage Growing

**Symptom:** `process.memory.heapUsed` keeps increasing

**Cause:** Workers not recycling

**Solution:** Workers auto-recycle after 100 tasks. If issue persists:
- Reduce `maxTasksPerWorker` in `worker-pool.js`
- Restart workers manually via admin endpoint (future feature)

## Performance

**Benchmarks** (yt-dlp installed, 4 CPU cores, 8 GB RAM):

| Metric | Value |
|--------|-------|
| Requests/sec | 20-30 |
| Avg latency | 800-1500 ms |
| P95 latency | 2000 ms |
| P99 latency | 3000 ms |
| Concurrent workers | 4-6 avg, 10 peak |
| Memory usage | 300-500 MB |
| CPU usage | 40-60% |

**Bottleneck:** yt-dlp execution time (800-1500 ms)

**Optimization tips:**
- Use `duration_hint` to skip redundant metadata calls
- Enable client-side caching (extension handles this)
- Deploy multiple instances behind load balancer

## Security

✅ **Input validation** - Zod schemas, URL allowlisting  
✅ **Command injection prevention** - execFile, no shell expansion  
✅ **Rate limiting** - 20 req/min per IP  
✅ **Optional API key auth** - X-API-Key header  
✅ **CORS restrictions** - Configurable origins  
✅ **Request timeouts** - 25s yt-dlp, 30s task  
✅ **Graceful shutdown** - Waits for active tasks  

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (with pretty logs)
npm run dev

# Format code
npm run format

# Lint code
npm run lint

# Run tests with coverage
npm test
```

## Files

| File | Purpose |
|------|---------|
| `server.js` | Main HTTP server, routes, middleware |
| `worker-pool.js` | Worker thread manager, queue, scaling |
| `ytdlp-worker.js` | Worker thread code, yt-dlp execution |
| `circuit-breaker.js` | Fault tolerance, state management |
| `instrument.js` | Sentry initialization |
| `tests/server.test.js` | API endpoint tests |
| `tests/worker-pool.test.js` | Worker pool + circuit breaker tests |
| `Dockerfile` | Container image |
| `package.json` | Dependencies, scripts |

## License

MIT
