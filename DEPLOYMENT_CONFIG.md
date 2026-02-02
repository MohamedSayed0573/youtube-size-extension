# Deployment Configuration Guide

## Environment Files

### Development (.env.development)

```env
NODE_ENV=development
PORT=3000
SENTRY_DSN=
REDIS_ENABLED=false
RATE_LIMIT_MAX_REQUESTS=1000
RATE_LIMIT_WINDOW_MS=60000
LOG_LEVEL=debug
```

### Production (.env.production)

```env
NODE_ENV=production
PORT=3000
SENTRY_DSN=https://your-sentry-key@sentry.io/your-project-id
REDIS_ENABLED=true
REDIS_URL=redis://redis:6379/0
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
LOG_LEVEL=info
CACHE_TTL_SECONDS=3600
MAX_REQUEST_SIZE=50mb
REQUEST_TIMEOUT=30000
```

### Testing (.env.test)

```env
NODE_ENV=test
PORT=3001
REDIS_ENABLED=false
RATE_LIMIT_MAX_REQUESTS=10000
RATE_LIMIT_WINDOW_MS=1000
LOG_LEVEL=silent
```

---

## Docker Compose Examples

### Basic Deployment (docker-compose.yml)

```yaml
version: '3.8'

services:
  api:
    image: ytdlp-sizer-api:latest
    container_name: ytdlp-api
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      SENTRY_DSN: ${SENTRY_DSN}
      REDIS_ENABLED: "true"
      REDIS_URL: redis://redis:6379
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    depends_on:
      - redis
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  redis:
    image: redis:7-alpine
    container_name: ytdlp-redis
    ports:
      - "6379:6379"
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

networks:
  app-network:
    driver: bridge

volumes:
  redis_data:
    driver: local
```

### With Nginx Reverse Proxy (docker-compose.prod.yml)

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    container_name: ytdlp-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
      - nginx_cache:/var/cache/nginx
    restart: unless-stopped
    networks:
      - app-network
    depends_on:
      - api
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  api:
    image: ytdlp-sizer-api:latest
    container_name: ytdlp-api
    expose:
      - "3000"
    environment:
      NODE_ENV: production
      SENTRY_DSN: ${SENTRY_DSN}
      REDIS_ENABLED: "true"
      REDIS_URL: redis://redis:6379
      REDIS_POOL_SIZE: 10
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      - redis
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    resources:
      limits:
        cpus: '1'
        memory: 512M
      reservations:
        cpus: '0.5'
        memory: 256M

  redis:
    image: redis:7-alpine
    container_name: ytdlp-redis
    expose:
      - "6379"
    restart: unless-stopped
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    volumes:
      - redis_data:/data
      - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
    command: redis-server /usr/local/etc/redis/redis.conf
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    resources:
      limits:
        cpus: '0.5'
        memory: 256M

networks:
  app-network:
    driver: bridge

volumes:
  redis_data:
    driver: local
  nginx_cache:
    driver: local
```

---

## Nginx Configuration (nginx.conf)

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 50m;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/json application/javascript application/xml+rss 
               application/rss+xml font/truetype font/opentype 
               application/vnd.ms-fontobject image/svg+xml;

    # Cache
    proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m 
                     max_size=100m inactive=60m use_temp_path=off;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=health_limit:10m rate=100r/s;

    upstream api_backend {
        least_conn;
        server api:3000 weight=1 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name _;
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name api.yourdomain.com;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;

        # SSL Security Headers
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 10m;
        ssl_stapling on;
        ssl_stapling_verify on;

        # Security Headers
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

        # Rate limiting
        limit_req zone=api_limit burst=20 nodelay;

        # Health check endpoint (no cache, no rate limiting)
        location /health {
            limit_req zone=health_limit burst=100 nodelay;
            proxy_pass http://api_backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            access_log off;
        }

        # API endpoints
        location /api/ {
            limit_req zone=api_limit burst=20 nodelay;

            proxy_pass http://api_backend;
            proxy_http_version 1.1;

            # Proxy headers
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $server_name;

            # Timeouts
            proxy_connect_timeout 30s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;

            # Buffering
            proxy_buffering on;
            proxy_buffer_size 4k;
            proxy_buffers 8 4k;
            proxy_busy_buffers_size 8k;
        }

        # Static files (docs, etc.)
        location /api/v1/docs {
            proxy_pass http://api_backend;
            proxy_cache api_cache;
            proxy_cache_valid 200 1h;
            proxy_cache_key "$scheme$request_method$host$request_uri";
        }

        # Size endpoint with caching
        location /api/v1/size {
            limit_req zone=api_limit burst=50 nodelay;
            proxy_pass http://api_backend;
            
            # Cache GET requests for 1 hour
            proxy_cache api_cache;
            proxy_cache_methods GET HEAD;
            proxy_cache_valid 200 1h;
            proxy_cache_key "$scheme$request_method$host$request_uri$request_body";
            
            # Add cache status header
            add_header X-Cache-Status $upstream_cache_status;
        }

        # Default location
        location / {
            limit_req zone=api_limit burst=20 nodelay;
            proxy_pass http://api_backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

---

## Redis Configuration (redis.conf)

```conf
# Network
port 6379
bind 127.0.0.1
protected-mode yes
tcp-backlog 511
timeout 0
tcp-keepalive 300

# General
daemonize no
pidfile /var/run/redis.pid
loglevel notice
logfile ""
databases 16
always-show-logo yes

# Snapshotting
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir ./

# Replication
replica-serve-stale-data yes
replica-read-only yes
repl-diskless-sync no
repl-diskless-sync-delay 5

# Security
# requirepass your-password

# Clients
maxclients 10000

# Memory Management
maxmemory 256mb
maxmemory-policy allkeys-lru
lazyfree-lazy-eviction no
lazyfree-lazy-expire no
lazyfree-lazy-server-del no
replica-lazy-flush no

# Persistence (AOF)
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes
aof-use-rdb-preamble yes

# Lua scripting
lua-time-limit 5000

# Slowlog
slowlog-log-slower-than 10000
slowlog-max-len 128

# Event notification
notify-keyspace-events ""

# Advanced config
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
list-compress-depth 0
set-max-intset-entries 512
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
hll-sparse-max-bytes 3000
stream-node-max-bytes 4096
stream-node-max-entries 100
activerehashing yes
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60

# Frequency of rehashing the main dict
hz 10

# Dynamic HZ
dynamic-hz yes

# Active defragmentation
activedefrag no
```

---

## Systemd Service File (optional)

For running Docker containers as a system service:

```ini
[Unit]
Description=YouTube Size Extension API
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/ytdlp-api

# Start
ExecStart=/usr/bin/docker-compose up -d

# Stop
ExecStop=/usr/bin/docker-compose down

# Restart on failure
Restart=on-failure
RestartSec=10s

User=ubuntu
Group=docker

[Install]
WantedBy=multi-user.target
```

**Installation:**
```bash
sudo cp ytdlp-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ytdlp-api
sudo systemctl start ytdlp-api
```

---

## Health Check Script

```bash
#!/bin/bash
# health-check.sh

set -e

HEALTH_ENDPOINT="http://localhost:3000/health"
MAX_RETRIES=5
RETRY_INTERVAL=5

echo "Checking API health..."

for i in $(seq 1 $MAX_RETRIES); do
    echo "Attempt $i/$MAX_RETRIES..."
    
    if response=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_ENDPOINT"); then
        if [ "$response" = "200" ]; then
            echo "✓ API is healthy"
            exit 0
        else
            echo "✗ API returned status $response"
        fi
    else
        echo "✗ Failed to connect"
    fi
    
    if [ $i -lt $MAX_RETRIES ]; then
        sleep $RETRY_INTERVAL
    fi
done

echo "✗ Health check failed after $MAX_RETRIES attempts"
exit 1
```

---

## Backup Script

```bash
#!/bin/bash
# backup.sh

set -e

BACKUP_DIR="/home/ubuntu/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REDIS_BACKUP="$BACKUP_DIR/redis_backup_$TIMESTAMP.rdb"

mkdir -p "$BACKUP_DIR"

# Backup Redis
echo "Creating Redis backup..."
docker exec redis redis-cli BGSAVE
docker cp redis:/data/dump.rdb "$REDIS_BACKUP"
echo "✓ Redis backup: $REDIS_BACKUP"

# List recent backups
echo "Recent backups:"
ls -lh "$BACKUP_DIR" | tail -5

# Cleanup old backups (keep last 30 days)
find "$BACKUP_DIR" -mtime +30 -delete
```

---

## Monitoring Script

```bash
#!/bin/bash
# monitor.sh

while true; do
    clear
    echo "=== Docker Container Status ==="
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
    
    echo ""
    echo "=== Disk Usage ==="
    df -h | grep -E "^/dev|Filesystem"
    
    echo ""
    echo "=== Container Logs (Last 5 lines) ==="
    docker logs --tail 5 api
    
    sleep 10
done
```

---

## Update Script

```bash
#!/bin/bash
# update.sh - Update and redeploy application

set -e

echo "Pulling latest image..."
docker-compose pull api

echo "Rebuilding containers..."
docker-compose up -d --force-recreate

echo "Waiting for healthcheck..."
sleep 10

if curl -s http://localhost:3000/health > /dev/null; then
    echo "✓ Update successful"
    docker-compose logs api --tail 20
else
    echo "✗ Update failed - health check failed"
    docker-compose logs api
    exit 1
fi
```

---

## Terraform Variables (terraform.tfvars)

```hcl
aws_region       = "us-east-1"
project_name     = "ytdlp-api"
environment      = "production"
instance_type    = "t3.small"
key_name         = "ytdlp-api-key"

# Security
ssh_allowed_ips  = ["YOUR_IP/32"]  # Replace with your IP

# Storage
root_volume_size = 20

# Monitoring
enable_monitoring = true

# Tags
tags = {
  ManagedBy = "Terraform"
  Project   = "YouTube Size Extension"
  Environment = "production"
  CostCenter = "engineering"
}
```

---

**These configuration files are ready for production use. Customize as needed for your environment.**
