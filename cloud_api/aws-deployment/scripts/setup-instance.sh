#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== EC2 Instance Setup Script ===${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

# Update system
echo -e "${YELLOW}Updating system packages...${NC}"
apt-get update
apt-get upgrade -y

# Install Docker
echo -e "${YELLOW}Installing Docker...${NC}"
apt-get install -y apt-transport-https ca-certificates curl software-properties-common gnupg lsb-release

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up Docker repository
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start and enable Docker
systemctl enable docker
systemctl start docker

# Add ubuntu user to docker group
usermod -aG docker ubuntu

# Install Docker Compose standalone
echo -e "${YELLOW}Installing Docker Compose...${NC}"
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create application directory
echo -e "${YELLOW}Creating application directory...${NC}"
mkdir -p /opt/ytdlp-api/{logs,data}
chown -R ubuntu:ubuntu /opt/ytdlp-api

# Install monitoring and utility tools
echo -e "${YELLOW}Installing monitoring tools...${NC}"
apt-get install -y htop iotop nethogs ncdu tree jq

# Configure firewall
echo -e "${YELLOW}Configuring firewall...${NC}"
apt-get install -y ufw
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 3000/tcp comment 'API Server'
echo "y" | ufw enable

# Configure log rotation
echo -e "${YELLOW}Configuring log rotation...${NC}"
cat > /etc/logrotate.d/ytdlp-api <<EOF
/opt/ytdlp-api/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 ubuntu ubuntu
    sharedscripts
    postrotate
        docker restart ytdlp-api 2>/dev/null || true
    endscript
}
EOF

# Install CloudWatch agent (optional)
if [ "${INSTALL_CLOUDWATCH:-false}" = "true" ]; then
    echo -e "${YELLOW}Installing CloudWatch agent...${NC}"
    wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
    dpkg -i -E ./amazon-cloudwatch-agent.deb
    rm amazon-cloudwatch-agent.deb
fi

# System optimizations for Node.js
echo -e "${YELLOW}Applying system optimizations...${NC}"
cat >> /etc/sysctl.conf <<EOF

# Network optimizations for Node.js
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.ip_local_port_range = 10000 65535
EOF
sysctl -p

# Set up automatic security updates
echo -e "${YELLOW}Configuring automatic security updates...${NC}"
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Create health check script
cat > /usr/local/bin/health-check <<'EOF'
#!/bin/bash
HEALTH_URL="http://localhost:3000/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ "$RESPONSE" = "200" ]; then
    echo "✓ API is healthy"
    exit 0
else
    echo "✗ API is unhealthy (HTTP $RESPONSE)"
    exit 1
fi
EOF
chmod +x /usr/local/bin/health-check

# Create cleanup script
cat > /usr/local/bin/docker-cleanup <<'EOF'
#!/bin/bash
# Clean up old Docker images and containers
docker system prune -af --volumes --filter "until=72h"
EOF
chmod +x /usr/local/bin/docker-cleanup

# Add weekly cleanup cron job
(crontab -l 2>/dev/null; echo "0 2 * * 0 /usr/local/bin/docker-cleanup") | crontab -

echo -e "${GREEN}=== Setup Complete ===${NC}"
echo -e "${GREEN}Docker version: $(docker --version)${NC}"
echo -e "${GREEN}Docker Compose version: $(docker-compose --version)${NC}"
echo -e "${YELLOW}Note: You may need to log out and back in for docker group changes to take effect${NC}"
