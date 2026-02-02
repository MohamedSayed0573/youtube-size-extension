# Deployment Guide

Complete guide for deploying the YouTube Size Extension Cloud API to production.

## Quick Start

```bash
# Clone and install dependencies
git clone <your-repo>
cd cloud_api
npm install

# Set environment variables (see below)
export SENTRY_DSN="your-sentry-dsn"
export NODE_ENV="production"
export PORT="3000"

# Start server
npm start
```

## Deployment Methods

### 1. Docker (Recommended)

**Best for**: Any cloud platform supporting containers (AWS ECS, GCP Cloud Run, Azure Container
Instances)

```bash
# Build image
docker build -t ytdlp-api:latest .

# Run locally
docker run -p 3000:3000 \
  -e SENTRY_DSN="your-dsn" \
  -e NODE_ENV="production" \
  ytdlp-api:latest

# Push to registry
docker tag ytdlp-api:latest your-registry/ytdlp-api:latest
docker push your-registry/ytdlp-api:latest
```

**Docker Compose** (with Redis):

```yaml
version: "3.8"
services:
    api:
        build: .
        ports:
            - "3000:3000"
        environment:
            - NODE_ENV=production
            - REDIS_URL=redis://redis:6379
            - SENTRY_DSN=${SENTRY_DSN}
        depends_on:
            - redis
        restart: unless-stopped

    redis:
        image: redis:7-alpine
        command: redis-server --requirepass ${REDIS_PASSWORD}
        volumes:
            - redis-data:/data
        restart: unless-stopped

volumes:
    redis-data:
```

Run: `docker-compose up -d`

---

### 2. Railway (Platform-as-a-Service)

**Best for**: Quick deployments with minimal configuration

**Steps:**

1. Fork/clone repo to GitHub
2. Visit [Railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Add environment variables in Settings:
    - `SENTRY_DSN`
    - `NODE_ENV=production`
    - `REDIS_URL` (optional, add Redis service)
6. Railway auto-detects Node.js and deploys

**Add Redis:**

- Click "New" → "Database" → "Add Redis"
- Railway automatically sets `REDIS_URL`

**Custom Domain:**

- Settings → Domains → Add custom domain
- Configure DNS CNAME: `<your-domain>` → `<railway-url>`

---

### 3. Render (Platform-as-a-Service)

**Best for**: Free tier with automatic SSL, simple deployments

**Steps:**

1. Visit [Render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
    - **Name**: ytdlp-api
    - **Environment**: Node
    - **Build Command**: `npm install`
    - **Start Command**: `npm start`
    - **Instance Type**: Free or Starter ($7/mo)
5. Add environment variables:
    - `SENTRY_DSN`
    - `NODE_ENV=production`
6. Click "Create Web Service"

**Add Redis:**

- Click "New +" → "Redis"
- Copy connection string
- Add to web service as `REDIS_URL`

---

### 4. PM2 (Process Manager for Node.js)

**Best for**: VPS deployments (DigitalOcean, Linode, AWS EC2)

**Installation:**

```bash
npm install -g pm2

# Start application
pm2 start server.js --name ytdlp-api

# Configure environment
pm2 start server.js --name ytdlp-api \
  --env production \
  --instances 4 \
  --exec-mode cluster

# Save configuration
pm2 save
pm2 startup  # Enable auto-restart on reboot
```

**ecosystem.config.js:**

```javascript
module.exports = {
    apps: [
        {
            name: "ytdlp-api",
            script: "./server.js",
            instances: "max", // Use all CPU cores
            exec_mode: "cluster",
            env: {
                NODE_ENV: "development",
                PORT: 3000,
            },
            env_production: {
                NODE_ENV: "production",
                PORT: 3000,
                SENTRY_DSN: "your-dsn",
                REDIS_URL: "redis://localhost:6379",
            },
            max_memory_restart: "500M",
            error_file: "./logs/error.log",
            out_file: "./logs/out.log",
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",
        },
    ],
};
```

**Commands:**

```bash
pm2 start ecosystem.config.js --env production
pm2 status
pm2 logs ytdlp-api
pm2 restart ytdlp-api
pm2 stop ytdlp-api
```

---

### 5. Systemd Service (Linux)

**Best for**: Traditional VPS deployments, long-term production servers

**Create service file:** `/etc/systemd/system/ytdlp-api.service`

```ini
[Unit]
Description=YouTube Size Extension Cloud API
After=network.target redis.service

[Service]
Type=simple
User=nodejs
WorkingDirectory=/opt/ytdlp-api
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10

# Environment variables
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=SENTRY_DSN=your-dsn
Environment=REDIS_URL=redis://localhost:6379

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/ytdlp-api/logs

[Install]
WantedBy=multi-user.target
```

**Setup:**

```bash
# Create user
sudo useradd -r -s /bin/false nodejs

# Install application
sudo mkdir -p /opt/ytdlp-api
sudo cp -r . /opt/ytdlp-api/
sudo chown -R nodejs:nodejs /opt/ytdlp-api

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable ytdlp-api
sudo systemctl start ytdlp-api

# Check status
sudo systemctl status ytdlp-api
sudo journalctl -u ytdlp-api -f  # View logs
```

---

### 6. Vercel (Serverless)

**Note:** Serverless deployment has limitations:

- Cold starts (2-5 second delay on first request)
- 10 second timeout (yt-dlp may exceed this)
- No persistent worker pool or circuit breaker state

**Only use for low-traffic, non-critical deployments.**

**vercel.json:**

```json
{
    "version": 2,
    "builds": [
        {
            "src": "server.js",
            "use": "@vercel/node"
        }
    ],
    "routes": [
        {
            "src": "/(.*)",
            "dest": "server.js"
        }
    ],
    "env": {
        "NODE_ENV": "production",
        "SENTRY_DSN": "@sentry_dsn"
    }
}
```

Deploy: `vercel --prod`

---

## Environment Variables

### Required

| Variable     | Description                                  | Example                         |
| ------------ | -------------------------------------------- | ------------------------------- |
| `SENTRY_DSN` | Sentry error tracking DSN                    | `https://xxx@xxx.sentry.io/xxx` |
| `NODE_ENV`   | Environment (development/staging/production) | `production`                    |

### Optional

| Variable                  | Default  | Description                                        |
| ------------------------- | -------- | -------------------------------------------------- |
| `PORT`                    | `3000`   | Server port                                        |
| `API_KEY`                 | `""`     | API key for authentication                         |
| `REQUIRE_AUTH`            | `false`  | Enable API key authentication                      |
| `ALLOWED_ORIGINS`         | `*`      | CORS allowed origins (comma-separated)             |
| `REDIS_URL`               | -        | Redis connection URL for distributed rate limiting |
| `REDIS_PASSWORD`          | -        | Redis password                                     |
| `MIN_WORKERS`             | `2`      | Minimum worker pool size                           |
| `MAX_WORKERS`             | `10`     | Maximum worker pool size                           |
| `RATE_LIMIT_WINDOW_MS`    | `600000` | Rate limit window (10 minutes)                     |
| `RATE_LIMIT_MAX_REQUESTS` | `60`     | Max requests per window                            |
| `YTDLP_TIMEOUT`           | `25000`  | yt-dlp timeout in milliseconds                     |

### Example .env file

```bash
# Server
NODE_ENV=production
PORT=3000

# Authentication
REQUIRE_AUTH=true
API_KEY=your-secure-api-key-here

# Security
ALLOWED_ORIGINS=https://yourextension.com,https://www.yourextension.com

# Monitoring
SENTRY_DSN=https://xxx@xxx.sentry.io/xxx

# Redis (for horizontal scaling)
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-redis-password

# Worker Pool
MIN_WORKERS=4
MAX_WORKERS=16

# Rate Limiting
RATE_LIMIT_WINDOW_MS=300000
RATE_LIMIT_MAX_REQUESTS=30
```

---

## Load Balancer Setup

For horizontal scaling with multiple instances:

### Nginx

See [nginx.conf](./nginx.conf) for complete configuration.

**Key features:**

- Least connections load balancing
- Health checks (`/health`)
- Request ID injection
- Connection pooling

```bash
# Install nginx
sudo apt install nginx

# Copy configuration
sudo cp nginx.conf /etc/nginx/sites-available/ytdlp-api
sudo ln -s /etc/nginx/sites-available/ytdlp-api /etc/nginx/sites-enabled/

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

### HAProxy

See [haproxy.cfg](./haproxy.cfg) for complete configuration.

**Key features:**

- Layer 7 routing
- Statistics dashboard (`:8404/stats`)
- Health checks
- Automatic failover

```bash
# Install HAProxy
sudo apt install haproxy

# Copy configuration
sudo cp haproxy.cfg /etc/haproxy/haproxy.cfg

# Restart
sudo systemctl restart haproxy
```

---

## Health Checks

All platforms should monitor these endpoints:

- **`GET /health`** - Overall health status
- **`GET /health/redis`** - Redis connectivity (if enabled)
- **`GET /metrics`** - Worker pool and circuit breaker metrics

**Expected response:**

```json
{
    "status": "healthy",
    "uptime": 3600,
    "timestamp": "2026-02-02T10:00:00.000Z",
    "redis": {
        "enabled": true,
        "connected": true
    }
}
```

---

## SSL/TLS Configuration

### Automatic (PaaS platforms)

Railway, Render, and Vercel provide automatic SSL certificates via Let's Encrypt.

### Manual (VPS)

Use [Certbot](https://certbot.eff.org/) for Let's Encrypt:

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate (nginx)
sudo certbot --nginx -d api.yourdomain.com

# Auto-renewal (already configured)
sudo certbot renew --dry-run
```

---

## Monitoring & Logging

### Sentry (Included)

- Error tracking: https://sentry.io
- Performance monitoring (10% sampling in production)
- Automatic error capture and breadcrumbs

### Log Aggregation

**Recommended tools:**

- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **Grafana Loki** (lightweight alternative)
- **AWS CloudWatch** (if on AWS)
- **Datadog** (comprehensive monitoring)

**Configure structured JSON logging:**

```bash
# Logs are already in JSON format for production
NODE_ENV=production npm start | pino-elasticsearch
```

---

## Performance Optimization

### 1. Enable Redis

Distributed rate limiting across instances:

```bash
export REDIS_URL=redis://your-redis-host:6379
```

### 2. Scale Worker Pool

Match CPU cores:

```bash
export MIN_WORKERS=4
export MAX_WORKERS=16
```

### 3. Horizontal Scaling

Deploy multiple instances behind load balancer (see [SCALING.md](./SCALING.md)).

### 4. CDN for Static Assets

If serving any static content, use Cloudflare or AWS CloudFront.

---

## Troubleshooting

### yt-dlp not found

```bash
# Install yt-dlp
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp

# Verify
yt-dlp --version
```

### High memory usage

```bash
# Reduce worker pool size
export MAX_WORKERS=4

# Enable worker recycling (default: 100 tasks per worker)
# Workers auto-recycle to prevent memory leaks
```

### Circuit breaker opening

Check yt-dlp health:

```bash
yt-dlp --version
yt-dlp "https://www.youtube.com/watch?v=jNQXAC9IVRw" --dump-json
```

### Redis connection issues

```bash
# Check Redis connectivity
redis-cli -h <redis-host> ping

# Check Redis password
redis-cli -h <redis-host> -a <password> ping
```

---

## Security Best Practices

1. **Enable authentication** in production:

    ```bash
    export REQUIRE_AUTH=true
    export API_KEY=<strong-random-key>
    ```

2. **Restrict CORS origins**:

    ```bash
    export ALLOWED_ORIGINS=https://yourextension.com
    ```

3. **Use secrets manager** (AWS Secrets Manager, Azure Key Vault):
    - Don't commit `.env` files
    - Rotate API keys regularly

4. **Enable firewall**:

    ```bash
    sudo ufw allow 3000/tcp
    sudo ufw enable
    ```

5. **Keep dependencies updated**:
    ```bash
    npm audit
    npm update
    ```

---

## Cost Optimization

### Free Tier Options

- **Render**: Free plan (with limitations)
- **Railway**: $5/month credit for free
- **Fly.io**: 3 shared-cpu VMs free

### Budget-Friendly

- **DigitalOcean Droplet**: $6/month (1GB RAM, 1 CPU)
- **Linode**: $5/month (1GB RAM, 1 CPU)
- **AWS t3.micro**: ~$8/month (2GB RAM, 2 vCPU)

### Recommendations by Scale

- **< 1000 req/day**: Free tier (Render, Railway)
- **1000-10000 req/day**: Single VPS ($5-10/month)
- **> 10000 req/day**: Multi-instance + Redis ($20-50/month)

---

## Next Steps

1. Choose deployment method based on your needs
2. Set up environment variables (especially `SENTRY_DSN`)
3. Deploy and test with health checks
4. Monitor Sentry dashboard for errors
5. Scale horizontally if needed (see [SCALING.md](./SCALING.md))

For questions or issues, check the logs:

```bash
# PM2
pm2 logs ytdlp-api

# Systemd
sudo journalctl -u ytdlp-api -f

# Docker
docker logs <container-id> -f
```
