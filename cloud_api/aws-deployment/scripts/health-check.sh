#!/bin/bash
set -e

# Configuration
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/health}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
MAX_RETRIES=3
RETRY_DELAY=5

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1"; }
log_error() { echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"; }
log_success() { echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS: $1${NC}"; }

# Function to send alert
send_alert() {
    local message="$1"
    log_error "$message"
    
    if [ -n "$ALERT_EMAIL" ]; then
        echo "$message" | mail -s "API Health Check Failed" "$ALERT_EMAIL" 2>/dev/null || true
    fi
    
    # Log to syslog
    logger -t ytdlp-api-health "$message"
}

# Function to check health
check_health() {
    local response
    local http_code
    
    response=$(curl -s -w "\n%{http_code}" "$HEALTH_URL" 2>&1)
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "200" ]; then
        # Check if response contains "healthy"
        if echo "$body" | grep -q "healthy"; then
            return 0
        else
            log_error "Health endpoint returned 200 but body doesn't contain 'healthy'"
            log_error "Response: $body"
            return 1
        fi
    else
        log_error "Health endpoint returned HTTP $http_code"
        log_error "Response: $body"
        return 1
    fi
}

# Main health check with retries
attempt=1
while [ $attempt -le $MAX_RETRIES ]; do
    log_info "Health check attempt $attempt/$MAX_RETRIES..."
    
    if check_health; then
        log_success "API is healthy"
        
        # Optional: Check metrics endpoint
        if curl -s http://localhost:3000/metrics >/dev/null 2>&1; then
            log_info "Metrics endpoint is accessible"
        fi
        
        exit 0
    fi
    
    if [ $attempt -lt $MAX_RETRIES ]; then
        log_info "Retrying in $RETRY_DELAY seconds..."
        sleep $RETRY_DELAY
    fi
    
    attempt=$((attempt + 1))
done

# All retries failed
send_alert "API health check failed after $MAX_RETRIES attempts. URL: $HEALTH_URL"

# Optional: Attempt to restart the service
if command -v docker >/dev/null 2>&1; then
    log_info "Attempting to restart Docker container..."
    docker restart ytdlp-api 2>/dev/null || true
fi

exit 1
