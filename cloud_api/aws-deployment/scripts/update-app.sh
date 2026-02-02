#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_NAME="ytdlp-api"
REMOTE_USER="ubuntu"
REMOTE_DIR="/opt/ytdlp-api"

# Get EC2 IP
if [ -z "$EC2_IP" ]; then
    if [ -f "$SCRIPT_DIR/../terraform/terraform.tfstate" ]; then
        EC2_IP=$(cd "$SCRIPT_DIR/../terraform" && terraform output -raw instance_public_ip 2>/dev/null || echo "")
    fi
    if [ -z "$EC2_IP" ]; then
        read -p "Enter EC2 instance IP address: " EC2_IP
    fi
fi

# Get SSH key
if [ -z "$SSH_KEY" ]; then
    SSH_KEY="$HOME/.ssh/ytdlp-api-key.pem"
    if [ ! -f "$SSH_KEY" ]; then
        read -p "Enter path to SSH private key: " SSH_KEY
    fi
fi

chmod 600 "$SSH_KEY"
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $REMOTE_USER@$EC2_IP"

# Get Docker Hub username
if [ -z "$DOCKER_HUB_USER" ]; then
    read -p "Enter your Docker Hub username: " DOCKER_HUB_USER
fi

if [ -z "$DOCKER_HUB_USER" ]; then
    log_error "Docker Hub username is required."
    exit 1
fi

IMAGE_NAME="$DOCKER_HUB_USER/$APP_NAME:latest"

log_info "Updating application on $EC2_IP using Docker Hub..."

# Build new image
log_info "Building Docker image..."
cd "$PROJECT_ROOT"
docker build -t "$IMAGE_NAME" .

# Push to Docker Hub
log_info "Pushing image to Docker Hub..."
docker push "$IMAGE_NAME"
log_success "Image pushed to Docker Hub"

# Pull and restart on EC2
log_info "Pulling image and restarting container on EC2..."
$SSH_CMD "cd $REMOTE_DIR && \
    docker pull $IMAGE_NAME && \
    docker stop $APP_NAME 2>/dev/null || true && \
    docker rm $APP_NAME 2>/dev/null || true && \
    docker run -d \
        --name $APP_NAME \
        --restart unless-stopped \
        -p 3000:3000 \
        --env-file .env \
        -v $REMOTE_DIR/logs:/app/logs \
        $IMAGE_NAME"


# Clean up
rm -rf "$TEMP_DIR"

# Wait and test
sleep 5
log_info "Testing health endpoint..."
HEALTH=$($SSH_CMD "curl -s http://localhost:3000/health" || echo "failed")
if [[ "$HEALTH" == *"healthy"* ]]; then
    log_success "Update complete! API is healthy."
else
    log_error "Health check failed: $HEALTH"
    exit 1
fi

log_success "Application updated successfully!"
echo -e "${GREEN}API URL:${NC} http://$EC2_IP:3000"
