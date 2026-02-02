# Cloud API - YouTube Size Extension

Non-blocking, fault-tolerant, horizontally scalable Node.js API for extracting YouTube video size information using yt-dlp.

## Features

- ✅ **Non-blocking execution**: Worker pool prevents yt-dlp from blocking event loop
- ✅ **Fault tolerance**: Circuit breaker pattern with automatic recovery
- ✅ **Horizontal scaling**: Redis-backed distributed rate limiting
- ✅ **Load balancing**: nginx/HAProxy configurations included
- ✅ **High availability**: No single point of failure
- ✅ **Comprehensive monitoring**: Health checks, metrics, Sentry integration
- ✅ **Production-ready**: Battle-tested patterns and configurations

## Quick Start

### Prerequisites

- Node.js 18+ 
- yt-dlp installed and in PATH
- Redis (optional, required for multi-instance deployments)

### Installation

```bash
cd cloud_api
npm install
cp .env.example .env
nano .env  # Configure environment variables
```

### Running Locally

```bash
# Development mode
npm run dev

# Production mode
npm start
```

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## API Endpoints

### Core

- **POST /api/v1/size** - Extract video sizes
  ```bash
  curl -X POST http://localhost:3000/api/v1/size \
    -H "Content-Type: application/json" \
    -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
  ```

### Health & Monitoring

- **GET /health** - System health + metrics
- **GET /health/redis** - Redis connectivity check
- **GET /api/v1/metrics** - Detailed worker pool and circuit breaker metrics
- **GET /api/v1/docs** - API documentation
- **GET /api/v1/openapi** - OpenAPI 3.0 specification

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical architecture and patterns
- [SCALING.md](./SCALING.md) - **Horizontal scaling deployment guide**
- [VISUAL_GUIDE.md](./VISUAL_GUIDE.md) - Visual diagrams and workflows
- [nginx.conf](./nginx.conf) - nginx load balancer configuration
- [haproxy.cfg](./haproxy.cfg) - HAProxy load balancer configuration

## Deployment

### Single Instance (Development)

```bash
# Using systemd
sudo cp ytdlp-api.service /etc/systemd/system/
sudo systemctl enable ytdlp-api
sudo systemctl start ytdlp-api
```

### Multiple Instances (Production)

**See [SCALING.md](./SCALING.md) for complete guide**

Quick overview:

1. Deploy Redis for distributed rate limiting
2. Configure multiple API instances with `REDIS_ENABLED=true`
3. Set up load balancer (nginx or HAProxy)
4. Configure health checks and auto-scaling

**Docker Compose example:**

```bash
docker-compose up -d
```

This starts:
- 3 API instances
- Redis for distributed rate limiting
- nginx load balancer

## Configuration

### Environment Variables

```bash
# Server
PORT=3000
NODE_ENV=production

# Redis (required for horizontal scaling)
REDIS_ENABLED=true
REDIS_URL=redis://:password@redis.example.com:6379

# Worker Pool
MIN_WORKERS=2
MAX_WORKERS=10

# Rate Limiting (enforced globally when Redis enabled)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=20

# Authentication
REQUIRE_AUTH=true
API_KEY=your-secret-key

# Monitoring
SENTRY_DSN=https://your-sentry-dsn
```

See [.env.example](./.env.example) for complete configuration.

## Monitoring

### Health Checks

```bash
# Overall health (for load balancer)
curl http://localhost:3000/health

# Redis connectivity
curl http://localhost:3000/health/redis

# Detailed metrics
curl http://localhost:3000/api/v1/metrics
```

### Sentry Dashboard

Error tracking and performance monitoring:
- Issues: https://mohamed-sayed-dx.sentry.io/issues/
- Performance: Track API response times
- Releases: Track errors by deployment version

### Logs

```bash
# View logs (systemd)
journalctl -u ytdlp-api -f

# View logs (Docker)
docker-compose logs -f api1
```

## Troubleshooting

### Rate Limiting Not Working Across Instances

**Problem**: Users can exceed rate limits by hitting different instances

**Solution**: Enable Redis

```bash
REDIS_ENABLED=true
REDIS_URL=redis://:password@redis.example.com:6379
```

Verify Redis connectivity:

```bash
curl http://localhost:3000/health/redis
```

### Circuit Breaker Opening Frequently

**Problem**: Circuit breaker state is "OPEN", causing 503 errors

**Causes**:
- yt-dlp not installed
- YouTube rate limiting
- Network issues

**Check**:

```bash
# Verify yt-dlp installation
yt-dlp --version

# Check circuit breaker status
curl http://localhost:3000/api/v1/metrics | jq '.circuitBreaker'

# Check logs
journalctl -u ytdlp-api -f | grep -i circuit
```

### High Memory Usage

**Problem**: API instances consuming too much memory

**Solutions**:
- Reduce `MAX_WORKERS` (fewer concurrent yt-dlp processes)
- Reduce `YTDLP_MAX_BUFFER` (less memory per request)
- Enable worker recycling (already enabled: 100 tasks/worker)
- Check for memory leaks via Sentry profiling

## Performance

### Benchmarks

Single instance (4 CPU cores):
- **Throughput**: 10-20 requests/second
- **Response time**: p50=2s, p95=5s, p99=10s
- **Worker utilization**: 60-80% under load

Horizontal scaling (3 instances):
- **Throughput**: 30-60 requests/second
- **Response time**: p50=2s, p95=4s, p99=8s (better due to load distribution)

### Optimization Tips

1. **Tune worker pool**: Start with `MIN_WORKERS=2`, `MAX_WORKERS=10`
2. **Enable Redis**: Required for multi-instance deployments
3. **Use load balancer**: nginx or HAProxy for traffic distribution
4. **Monitor metrics**: Track worker utilization, circuit breaker state
5. **Configure auto-scaling**: Scale instances based on CPU/memory

## Development

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Code Style

```bash
# Format code (root directory)
npm run format

# Check formatting
npm run format:check
```

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT License - see [../LICENSE](../LICENSE) for details

## Support

- GitHub Issues: https://github.com/MohamedSayed0573/youtube-size-extension/issues
- Documentation: See [ARCHITECTURE.md](./ARCHITECTURE.md) and [SCALING.md](./SCALING.md)
