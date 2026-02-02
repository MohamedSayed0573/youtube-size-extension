# AWS Region (change as needed)
aws_region = "us-east-1"

# Project Configuration
project_name = "ytdlp-api"
environment  = "production"

# EC2 Configuration
instance_type = "t3.small"  # Options: t3.micro (~$8/mo), t3.small (~$15/mo), t3.medium (~$30/mo)

# IMPORTANT: You must specify your EC2 key pair name here
# Create a key pair first: aws ec2 create-key-pair --key-name ytdlp-api-key --query 'KeyMaterial' --output text > ~/.ssh/ytdlp-api-key.pem
key_name = "ytdlp-api-key"

# Security: Restrict SSH access to your IP (recommended)
# Find your IP: curl ifconfig.me
# Example: ssh_allowed_ips = ["203.0.113.0/32"]
ssh_allowed_ips = ["0.0.0.0/0"]  # WARNING: Allows SSH from anywhere - change this!

# Storage
root_volume_size = 20  # GB

# Monitoring
enable_monitoring = false  # Set to true for detailed CloudWatch metrics (additional cost)

# Additional Tags
tags = {
  ManagedBy = "Terraform"
  Project   = "YouTube Size Extension"
}
