#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_NAME="ytdlp-api"
REMOTE_USER="ubuntu"
REMOTE_DIR="/opt/ytdlp-api"

# Parse arguments
# Usage: ./deploy.sh [EC2_IP] [DOCKER_REGISTRY] [IMAGE_TAG]
# Examples:
#   ./deploy.sh 52.5.44.112 mohamedsayed1/ytdlp-sizer-api latest  (use Docker Hub)
#   ./deploy.sh 52.5.44.112                                         (build locally)
EC2_IP="${1:-}"
DOCKER_REGISTRY="${2:-}"
IMAGE_TAG="${3:-latest}"

# Function to print colored messages
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
log_info "Checking prerequisites..."
if ! command_exists docker; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command_exists aws; then
    log_error "AWS CLI is not installed. Please install AWS CLI first."
    exit 1
fi

# Get EC2 instance IP from Terraform output or user input
if [ -z "$EC2_IP" ]; then
    if [ -f "$SCRIPT_DIR/../terraform/terraform.tfstate" ]; then
        log_info "Reading EC2 IP from Terraform state..."
        EC2_IP=$(cd "$SCRIPT_DIR/../terraform" && terraform output -raw instance_public_ip 2>/dev/null || echo "")
    fi
    
    if [ -z "$EC2_IP" ]; then
        read -p "Enter EC2 instance IP address: " EC2_IP
    fi
fi

log_info "Target EC2 instance: $EC2_IP"

# Get SSH key path
if [ -z "$SSH_KEY" ]; then
    if [ -f "$HOME/.ssh/ytdlp-api-key.pem" ]; then
        SSH_KEY="$HOME/.ssh/ytdlp-api-key.pem"
    else
        read -p "Enter path to SSH private key: " SSH_KEY
    fi
fi

if [ ! -f "$SSH_KEY" ]; then
    log_error "SSH key not found: $SSH_KEY"
    exit 1
fi

# Ensure correct permissions on SSH key
chmod 600 "$SSH_KEY"

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no $REMOTE_USER@$EC2_IP"
SCP_CMD="scp -i $SSH_KEY -o StrictHostKeyChecking=no"

# Test SSH connection
log_info "Testing SSH connection..."
if ! $SSH_CMD "echo 'Connection successful'" >/dev/null 2>&1; then
    log_error "Cannot connect to EC2 instance. Please check:"
    log_error "  1. Instance is running"
    log_error "  2. Security group allows SSH from your IP"
    log_error "  3. SSH key is correct"
    exit 1
fi
log_success "SSH connection successful"

# Check if .env file exists
if [ ! -f "$PROJECT_ROOT/.env" ] && [ ! -f "$PROJECT_ROOT/.env.production" ]; then
    log_warning "No .env or .env.production file found!"
    log_warning "Creating from .env.example..."
    if [ -f "$PROJECT_ROOT/.env.example" ]; then
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env.production"
        log_warning "Please edit .env.production with your production settings before continuing"
        read -p "Press Enter when ready..."
    else
        log_error ".env.example not found. Cannot proceed."
        exit 1
    fi
fi

# Use .env.production if it exists, otherwise use .env
ENV_FILE="$PROJECT_ROOT/.env.production"
if [ ! -f "$ENV_FILE" ]; then
    ENV_FILE="$PROJECT_ROOT/.env"
fi

log_info "Using environment file: $ENV_FILE"

# Determine if we should use Docker Hub or build locally
if [ -n "$DOCKER_REGISTRY" ]; then
    DOCKER_IMAGE="$DOCKER_REGISTRY:$IMAGE_TAG"
    USE_REGISTRY=true
    log_info "Using pre-built image from Docker Hub: $DOCKER_IMAGE"
else
    DOCKER_IMAGE="$APP_NAME:latest"
    USE_REGISTRY=false
    log_info "Building Docker image locally..."
fi

if [ "$USE_REGISTRY" = false ]; then
    # Build Docker image locally
    log_info "Building Docker image..."
    cd "$PROJECT_ROOT"
    docker build -t $APP_NAME:latest .
    log_success "Docker image built successfully"
fi

# Save Docker image to tar file
log_info "Saving Docker image to tar file..."
TEMP_DIR=$(mktemp -d)
IMAGE_TAR="$TEMP_DIR/$APP_NAME.tar"
docker save -o "$IMAGE_TAR" $DOCKER_IMAGE
log_success "Docker image saved to $IMAGE_TAR"

# Create remote directory
log_info "Creating remote directory..."
$SSH_CMD "sudo mkdir -p $REMOTE_DIR/{logs,data} && sudo chown -R $REMOTE_USER:$REMOTE_USER $REMOTE_DIR"

# Transfer Docker image
log_info "Transferring Docker image to EC2 (this may take a few minutes)..."
$SCP_CMD "$IMAGE_TAR" "$REMOTE_USER@$EC2_IP:$REMOTE_DIR/"
log_success "Docker image transferred"

# Transfer environment file
log_info "Transferring environment file..."
$SCP_CMD "$ENV_FILE" "$REMOTE_USER@$EC2_IP:$REMOTE_DIR/.env"
log_success "Environment file transferred"

# Transfer docker-compose file if it exists
if [ -f "$PROJECT_ROOT/docker-compose.yml" ]; then
    log_info "Transferring docker-compose.yml..."
    $SCP_CMD "$PROJECT_ROOT/docker-compose.yml" "$REMOTE_USER@$EC2_IP:$REMOTE_DIR/"
fi

# Load Docker image on EC2
log_info "Loading Docker image on EC2..."
$SSH_CMD "cd $REMOTE_DIR && docker load -i $APP_NAME.tar && rm $APP_NAME.tar"
log_success "Docker image loaded"

# Stop existing container if running
log_info "Stopping existing container (if any)..."
$SSH_CMD "docker stop $APP_NAME 2>/dev/null || true && docker rm $APP_NAME 2>/dev/null || true"

# Start new container
log_info "Starting new container..."
LOADED_IMAGE=$(echo $DOCKER_IMAGE | sed 's/:/:latest/' | sed 's/.*\///')
if [ "$USE_REGISTRY" = true ]; then
    # When loaded from Docker Hub, use the original registry name
    LOADED_IMAGE=$DOCKER_IMAGE
else
    # When built locally, use the local app name
    LOADED_IMAGE="$APP_NAME:latest"
fi

$SSH_CMD "cd $REMOTE_DIR && docker run -d \
    --name $APP_NAME \
    --restart unless-stopped \
    -p 3000:3000 \
    --env-file .env \
    -v $REMOTE_DIR/logs:/app/logs \
    $LOADED_IMAGE"
log_success "Container started"

# Wait for container to be ready
log_info "Waiting for container to be ready..."
sleep 5

# Check container status
log_info "Checking container status..."
CONTAINER_STATUS=$($SSH_CMD "docker ps --filter name=$APP_NAME --format '{{.Status}}'")
if [ -z "$CONTAINER_STATUS" ]; then
    log_error "Container is not running!"
    log_error "Checking logs..."
    $SSH_CMD "docker logs $APP_NAME"
    exit 1
fi
log_success "Container is running: $CONTAINER_STATUS"

# Test health endpoint
log_info "Testing health endpoint..."
sleep 3
HEALTH_CHECK=$($SSH_CMD "curl -s http://localhost:3000/health" || echo "failed")
if [[ "$HEALTH_CHECK" == *"healthy"* ]]; then
    log_success "Health check passed!"
else
    log_warning "Health check failed or returned unexpected response"
    log_warning "Response: $HEALTH_CHECK"
fi

# Clean up local temp files
rm -rf "$TEMP_DIR"

# Display deployment info
echo ""
log_success "=== Deployment Complete ==="
echo -e "${GREEN}API URL:${NC} http://$EC2_IP:3000"
echo -e "${GREEN}Health Check:${NC} http://$EC2_IP:3000/health"
echo -e "${GREEN}Metrics:${NC} http://$EC2_IP:3000/metrics"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo -e "  View logs:        $SSH_CMD 'docker logs -f $APP_NAME'"
echo -e "  Restart:          $SSH_CMD 'docker restart $APP_NAME'"
echo -e "  Stop:             $SSH_CMD 'docker stop $APP_NAME'"
echo -e "  Container stats:  $SSH_CMD 'docker stats $APP_NAME'"
echo ""
