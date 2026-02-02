# Horizontal Scaling Guide

This guide explains how to deploy the YouTube Size Extension Cloud API in a horizontally scaled
configuration with multiple instances, distributed rate limiting, and load balancing.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Architecture](#architecture)
- [Redis Setup](#redis-setup)
- [API Configuration](#api-configuration)
- [Load Balancer Setup](#load-balancer-setup)
- [Deployment](#deployment)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Overview

### Why Horizontal Scaling?

Single-instance deployments have limitations:

- **In-memory rate limiting** doesn't work across instances
- **Worker pool** is limited to single machine's CPU cores
- **Single point of failure** affects availability
- **Vertical scaling** has physical limits and higher costs

Horizontal scaling solves these issues by:

- Distributing load across multiple servers
- Providing redundancy and high availability
- Enabling independent scaling of components
- Reducing cost through commodity hardware

### Architecture Components

1. **Load Balancer** (nginx or HAProxy): Distributes incoming requests
2. **API Instances** (Node.js): Multiple server processes
3. **Redis** (distributed cache): Shared rate limiting state
4. **yt-dlp** (external process): Installed on each API instance

## Prerequisites

### System Requirements (per API instance)

- **OS**: Linux (Ubuntu 20.04+ or Debian 11+)
- **CPU**: 2+ cores (4+ recommended)
- **RAM**: 2GB minimum (4GB+ recommended)
- **Disk**: 10GB minimum
- **Node.js**: 18.x or later
- **yt-dlp**: Latest version in PATH

### Software Dependencies

```bash
# Install on each API instance
sudo apt update
sudo apt install -y nodejs npm yt-dlp

# Install on load balancer
sudo apt install -y nginx  # OR haproxy

# Install Redis (single instance or cluster)
sudo apt install -y redis-server
```

## Redis Setup

### Option 1: Single Redis Instance (Simple)

**Best for**: Development, small deployments (<5 API instances)

```bash
# Install Redis
sudo apt install -y redis-server

# Configure Redis for network access
sudo nano /etc/redis/redis.conf
```

Edit the following settings:

```conf
# Allow connections from all interfaces
bind 0.0.0.0

# Set password for security
requirepass YOUR_STRONG_PASSWORD_HERE

# Persistence configuration
save 900 1
save 300 10
save 60 10000

# Max memory policy (prevent OOM)
maxmemory 256mb
maxmemory-policy allkeys-lru

# Connection limits
maxclients 10000
```

Restart Redis:

```bash
sudo systemctl restart redis-server
sudo systemctl enable redis-server
```

Test connectivity:

```bash
redis-cli -h localhost -a YOUR_STRONG_PASSWORD_HERE ping
# Expected output: PONG
```

### Option 2: Redis Cluster (Production)

**Best for**: Production, large deployments (5+ API instances)

Use managed Redis services:

- **AWS ElastiCache** (recommended)
- **Azure Cache for Redis**
- **Google Cloud Memorystore**
- **Redis Cloud**

Example ElastiCache setup:

```bash
# Create Redis replication group (AWS CLI)
aws elasticache create-replication-group \
  --replication-group-id ytdlp-api-redis \
  --replication-group-description "Redis for ytdlp API rate limiting" \
  --engine redis \
  --cache-node-type cache.t3.micro \
  --num-cache-clusters 2 \
  --automatic-failover-enabled \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled \
  --auth-token "YOUR_STRONG_PASSWORD_HERE"
```

### Redis Configuration Best Practices

1. **Enable persistence**: Use RDB or AOF for data durability
2. **Set password**: Always use authentication in production
3. **Network security**: Use VPC/private network, restrict firewall rules
4. **Memory limits**: Configure `maxmemory` and eviction policy
5. **Monitoring**: Track memory usage, connection count, hit/miss ratio
6. **Replication**: Use master-replica for high availability
7. **Backup**: Regular snapshots for disaster recovery

### Redis URL Format

```bash
# Without password
redis://hostname:6379

# With password
redis://:password@hostname:6379

# With SSL/TLS (AWS ElastiCache)
rediss://:password@hostname:6379
```

## API Configuration

### Environment Variables

Configure each API instance with these environment variables:

```bash
# Required for horizontal scaling
export REDIS_ENABLED=true
export REDIS_URL="redis://:YOUR_PASSWORD@redis.example.com:6379"

# Server configuration
export PORT=3000
export NODE_ENV=production

# Authentication
export REQUIRE_AUTH=true
export API_KEY="your-api-key-here"

# Rate limiting (distributed via Redis)
export RATE_LIMIT_WINDOW_MS=60000      # 1 minute
export RATE_LIMIT_MAX_REQUESTS=20      # 20 requests per minute

# Worker pool (per instance)
export MIN_WORKERS=2
export MAX_WORKERS=10

# yt-dlp configuration
export YTDLP_TIMEOUT=25000
export YTDLP_MAX_BUFFER=10485760

# Logging
export LOG_LEVEL=info

# Sentry (optional)
export SENTRY_DSN="https://your-sentry-dsn"
```

### systemd Service (API Instance)

Create `/etc/systemd/system/ytdlp-api.service`:

```ini
[Unit]
Description=YouTube Size Extension Cloud API
After=network.target redis.service
Wants=redis.service

[Service]
Type=simple
User=nodejs
Group=nodejs
WorkingDirectory=/opt/ytdlp-api
EnvironmentFile=/opt/ytdlp-api/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ytdlp-api

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/ytdlp-api/logs

[Install]
WantedBy=multi-user.target
```

Start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ytdlp-api
sudo systemctl start ytdlp-api
sudo systemctl status ytdlp-api
```

### Docker Deployment (Recommended)

**docker-compose.yml** (3 API instances + Redis):

```yaml
version: "3.8"

services:
    # Redis for distributed rate limiting
    redis:
        image: redis:7-alpine
        command: redis-server --requirepass ${REDIS_PASSWORD}
        ports:
            - "6379:6379"
        volumes:
            - redis-data:/data
        restart: unless-stopped
        networks:
            - api-network
        healthcheck:
            test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
            interval: 10s
            timeout: 3s
            retries: 3

    # API Instance 1
    api1:
        build: .
        environment:
            - NODE_ENV=production
            - PORT=3000
            - REDIS_ENABLED=true
            - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
            - REQUIRE_AUTH=${REQUIRE_AUTH}
            - API_KEY=${API_KEY}
            - RATE_LIMIT_WINDOW_MS=60000
            - RATE_LIMIT_MAX_REQUESTS=20
            - SENTRY_DSN=${SENTRY_DSN}
        ports:
            - "3001:3000"
        depends_on:
            - redis
        restart: unless-stopped
        networks:
            - api-network
        healthcheck:
            test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
            interval: 30s
            timeout: 10s
            retries: 3
            start_period: 40s

    # API Instance 2
    api2:
        build: .
        environment:
            - NODE_ENV=production
            - PORT=3000
            - REDIS_ENABLED=true
            - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
            - REQUIRE_AUTH=${REQUIRE_AUTH}
            - API_KEY=${API_KEY}
            - RATE_LIMIT_WINDOW_MS=60000
            - RATE_LIMIT_MAX_REQUESTS=20
            - SENTRY_DSN=${SENTRY_DSN}
        ports:
            - "3002:3000"
        depends_on:
            - redis
        restart: unless-stopped
        networks:
            - api-network
        healthcheck:
            test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
            interval: 30s
            timeout: 10s
            retries: 3
            start_period: 40s

    # API Instance 3
    api3:
        build: .
        environment:
            - NODE_ENV=production
            - PORT=3000
            - REDIS_ENABLED=true
            - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
            - REQUIRE_AUTH=${REQUIRE_AUTH}
            - API_KEY=${API_KEY}
            - RATE_LIMIT_WINDOW_MS=60000
            - RATE_LIMIT_MAX_REQUESTS=20
            - SENTRY_DSN=${SENTRY_DSN}
        ports:
            - "3003:3000"
        depends_on:
            - redis
        restart: unless-stopped
        networks:
            - api-network
        healthcheck:
            test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
            interval: 30s
            timeout: 10s
            retries: 3
            start_period: 40s

    # nginx Load Balancer
    nginx:
        image: nginx:alpine
        ports:
            - "80:80"
            - "443:443"
        volumes:
            - ./nginx.conf:/etc/nginx/nginx.conf:ro
            - ./ssl:/etc/nginx/ssl:ro
        depends_on:
            - api1
            - api2
            - api3
        restart: unless-stopped
        networks:
            - api-network

networks:
    api-network:
        driver: bridge

volumes:
    redis-data:
```

**.env** file:

```bash
REDIS_PASSWORD=your_strong_redis_password
REQUIRE_AUTH=true
API_KEY=your_api_key
SENTRY_DSN=https://your-sentry-dsn
```

Start the stack:

```bash
docker-compose up -d
docker-compose ps
docker-compose logs -f
```

## Load Balancer Setup

### Option 1: nginx

Use the provided `nginx.conf` configuration file.

**Key features**:

- Round-robin or least-connections load balancing
- Active health checks on `/health` endpoint
- Request ID injection for distributed tracing
- Rate limiting at proxy level (optional, in addition to API rate limiting)
- Connection pooling and keepalive

**Setup**:

```bash
# Copy configuration
sudo cp nginx.conf /etc/nginx/sites-available/ytdlp-api
sudo ln -s /etc/nginx/sites-available/ytdlp-api /etc/nginx/sites-enabled/

# Edit upstream servers
sudo nano /etc/nginx/sites-available/ytdlp-api
# Update server addresses in upstream block

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

**Update upstream servers**:

```nginx
upstream ytdlp_api_backend {
    least_conn;
    server 10.0.1.10:3000 max_fails=3 fail_timeout=30s;
    server 10.0.1.11:3000 max_fails=3 fail_timeout=30s;
    server 10.0.1.12:3000 max_fails=3 fail_timeout=30s;
    keepalive 32;
}
```

### Option 2: HAProxy

Use the provided `haproxy.cfg` configuration file.

**Key features**:

- Layer 7 (HTTP) load balancing
- Least-connections algorithm
- Active health checks
- Statistics dashboard on `:8404`
- Automatic failover to backup servers

**Setup**:

```bash
# Copy configuration
sudo cp haproxy.cfg /etc/haproxy/haproxy.cfg

# Edit backend servers
sudo nano /etc/haproxy/haproxy.cfg
# Update server addresses in backend section

# Test configuration
sudo haproxy -c -f /etc/haproxy/haproxy.cfg

# Restart HAProxy
sudo systemctl restart haproxy
sudo systemctl enable haproxy
```

**Update backend servers**:

```haproxy
backend api_backend
    balance leastconn
    server api1 10.0.1.10:3000 check inter 10s fall 3 rise 2
    server api2 10.0.1.11:3000 check inter 10s fall 3 rise 2
    server api3 10.0.1.12:3000 check inter 10s fall 3 rise 2
```

**Access stats dashboard**:

```bash
# Open browser to http://load-balancer-ip:8404
# Default credentials: admin / changeme (CHANGE THIS!)
```

## Deployment

### Step-by-Step Deployment

1. **Deploy Redis**:

    ```bash
    # Start Redis server or use managed service
    sudo systemctl start redis-server
    ```

2. **Configure API instances**:

    ```bash
    # On each API server
    cd /opt/ytdlp-api
    cp .env.example .env
    nano .env  # Configure REDIS_URL and other variables
    ```

3. **Start API instances**:

    ```bash
    # Using systemd
    sudo systemctl start ytdlp-api

    # OR using Docker
    docker-compose up -d
    ```

4. **Verify API instances**:

    ```bash
    # Check each instance
    curl http://api1.example.com:3000/health
    curl http://api2.example.com:3000/health
    curl http://api3.example.com:3000/health
    ```

5. **Configure load balancer**:

    ```bash
    # nginx
    sudo nano /etc/nginx/sites-available/ytdlp-api
    sudo nginx -t && sudo systemctl reload nginx

    # OR HAProxy
    sudo nano /etc/haproxy/haproxy.cfg
    sudo haproxy -c -f /etc/haproxy/haproxy.cfg && sudo systemctl restart haproxy
    ```

6. **Test load balancer**:

    ```bash
    # Check root endpoint
    curl http://load-balancer.example.com/

    # Check health
    curl http://load-balancer.example.com/health

    # Check Redis health
    curl http://load-balancer.example.com/health/redis

    # Test API (replace with your video URL)
    curl -X POST http://load-balancer.example.com/api/v1/size \
      -H "Content-Type: application/json" \
      -H "X-API-Key: your-api-key" \
      -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
    ```

7. **Verify distributed rate limiting**:

    ```bash
    # Make 25 requests quickly (should hit rate limit at 20)
    for i in {1..25}; do
      curl -X POST http://load-balancer.example.com/api/v1/size \
        -H "Content-Type: application/json" \
        -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' &
    done

    # Expected: First 20 succeed, last 5 return 429 Too Many Requests
    ```

### Scaling Up/Down

**Add new API instance**:

1. Deploy new server with API code
2. Configure environment variables (same as other instances)
3. Start the service
4. Add to load balancer configuration
5. Reload load balancer

**Remove API instance**:

1. Remove from load balancer configuration
2. Reload load balancer (gracefully drains connections)
3. Wait for active connections to finish
4. Stop the API service
5. Decommission server

### Auto-scaling (Cloud Platforms)

**AWS Auto Scaling Group**:

```bash
# Create launch template with API AMI
# Configure auto-scaling policy based on CPU or request count
# Attach to Application Load Balancer
```

**Kubernetes Horizontal Pod Autoscaler**:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
    name: ytdlp-api-hpa
spec:
    scaleTargetRef:
        apiVersion: apps/v1
        kind: Deployment
        name: ytdlp-api
    minReplicas: 2
    maxReplicas: 10
    metrics:
        - type: Resource
          resource:
              name: cpu
              target:
                  type: Utilization
                  averageUtilization: 70
        - type: Resource
          resource:
              name: memory
              target:
                  type: Utilization
                  averageUtilization: 80
```

## Monitoring

### Health Checks

1. **API health**: `GET /health`
    - Returns: system metrics, worker pool stats, circuit breaker status
    - Use for: Load balancer health probes, monitoring alerts

2. **Redis health**: `GET /health/redis`
    - Returns: Redis connectivity status
    - Use for: Redis-specific monitoring

### Metrics to Monitor

**Per-instance metrics**:

- CPU usage (target: <70%)
- Memory usage (target: <80%)
- Active worker threads
- Circuit breaker state
- Request rate
- Error rate
- Response time (p50, p95, p99)

**Cluster-wide metrics**:

- Total request rate
- Rate limit rejections
- Load balancer distribution
- Redis connection count
- Redis memory usage

**Redis metrics**:

- Memory usage
- Hit/miss ratio
- Connection count
- Eviction count
- Persistence status

### Monitoring Tools

**Prometheus + Grafana**:

```yaml
# prometheus.yml
scrape_configs:
    - job_name: "ytdlp-api"
      static_configs:
          - targets:
                - "api1.example.com:3000"
                - "api2.example.com:3000"
                - "api3.example.com:3000"
      metrics_path: "/api/v1/metrics"
```

**Sentry** (already integrated):

- Error tracking
- Performance monitoring
- Release tracking
- Custom alerts

**CloudWatch / Datadog / New Relic**:

- Infrastructure monitoring
- Application performance monitoring (APM)
- Log aggregation
- Custom dashboards

### Log Aggregation

Centralize logs from all instances:

**ELK Stack** (Elasticsearch, Logstash, Kibana):

```bash
# Install filebeat on each API instance
sudo apt install filebeat
sudo nano /etc/filebeat/filebeat.yml
# Configure to send logs to Logstash
```

**Loki + Grafana**:

```bash
# Install promtail on each API instance
# Configure to send logs to Loki
```

## Troubleshooting

### Redis Connection Issues

**Symptom**: API falls back to in-memory rate limiting

```bash
# Check Redis connectivity from API instance
redis-cli -h redis.example.com -a YOUR_PASSWORD ping

# Check Redis logs
sudo tail -f /var/log/redis/redis-server.log

# Check API logs for Redis errors
journalctl -u ytdlp-api -f | grep -i redis
```

**Solutions**:

- Verify `REDIS_URL` environment variable
- Check network connectivity (firewall rules)
- Verify Redis password
- Check Redis memory limits (maxmemory)

### Uneven Load Distribution

**Symptom**: Some instances receiving more traffic than others

**Check load balancer stats**:

```bash
# nginx
curl http://localhost:8080/nginx_status

# HAProxy
curl http://localhost:8404/stats
```

**Solutions**:

- Switch from round-robin to least-connections
- Verify all instances are healthy
- Check for CPU/memory differences between instances
- Ensure worker pool sizes are consistent

### Rate Limiting Not Working Across Instances

**Symptom**: Users can exceed rate limit by hitting different instances

**Verify**:

```bash
# Check Redis keys
redis-cli -a YOUR_PASSWORD
> KEYS rl:*
> TTL rl:127.0.0.1

# Check API logs for Redis errors
docker-compose logs api1 | grep -i redis
```

**Solutions**:

- Verify `REDIS_ENABLED=true` on all instances
- Check Redis connectivity
- Ensure all instances use same `REDIS_URL`
- Verify Redis is not evicting keys (check maxmemory-policy)

### Circuit Breaker Opening Frequently

**Symptom**: Circuit breaker opens, causing 503 errors

**Check**:

```bash
# Check circuit breaker status
curl http://load-balancer.example.com/api/v1/metrics

# Check yt-dlp availability
yt-dlp --version
```

**Solutions**:

- Verify yt-dlp is installed on all instances
- Check yt-dlp rate limiting from YouTube
- Increase circuit breaker thresholds (not recommended)
- Investigate YouTube API issues

### High Memory Usage

**Symptom**: API instances running out of memory

**Check**:

```bash
# Check memory usage
free -h
docker stats

# Check Node.js heap usage
curl http://localhost:3000/api/v1/metrics | jq '.process.memory'
```

**Solutions**:

- Reduce `MAX_WORKERS` (fewer worker threads)
- Reduce `YTDLP_MAX_BUFFER` (less buffer per request)
- Increase instance memory
- Enable swap (not recommended for production)
- Check for memory leaks (Sentry profiling)

## Best Practices

1. **Start small**: Begin with 2-3 instances, scale as needed
2. **Monitor continuously**: Set up alerts for all critical metrics
3. **Test thoroughly**: Load test before production deployment
4. **Use managed services**: Redis Cloud, AWS ElastiCache for Redis
5. **Automate deployment**: Use CI/CD for consistent deployments
6. **Document changes**: Keep runbooks for operational procedures
7. **Regular backups**: Redis snapshots, configuration backups
8. **Security first**: Use TLS, strong passwords, network isolation
9. **Graceful degradation**: Handle Redis failures gracefully
10. **Capacity planning**: Monitor trends, plan for peak traffic

## Cost Optimization

**Estimated monthly costs** (AWS us-east-1):

| Component                  | Size            | Monthly Cost    |
| -------------------------- | --------------- | --------------- |
| 3x EC2 t3.medium           | 2 vCPU, 4GB RAM | $100            |
| ElastiCache Redis t3.micro | 2 replicas      | $30             |
| Application Load Balancer  |                 | $20             |
| Data transfer (100GB)      |                 | $10             |
| **Total**                  |                 | **~$160/month** |

**Cost reduction tips**:

- Use Reserved Instances (40% savings)
- Right-size instances based on metrics
- Use spot instances for non-critical workloads
- Enable auto-scaling (scale down during low traffic)
- Use CloudFront CDN for static content

## Conclusion

This horizontal scaling setup provides:

- ✅ **High availability**: No single point of failure
- ✅ **Distributed rate limiting**: Works across all instances
- ✅ **Load balancing**: Automatic traffic distribution
- ✅ **Scalability**: Add/remove instances as needed
- ✅ **Monitoring**: Comprehensive metrics and logs
- ✅ **Production-ready**: Battle-tested configuration

For questions or issues, consult the main [README.md](../README.md) or open an issue on GitHub.
