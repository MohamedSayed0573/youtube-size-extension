variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "ytdlp-api"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  default     = "production"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
  
  validation {
    condition     = can(regex("^t[2-3]\\.(micro|small|medium)", var.instance_type))
    error_message = "Instance type must be a valid t2 or t3 instance (micro, small, or medium)."
  }
}

variable "key_name" {
  description = "Name of the EC2 key pair for SSH access"
  type        = string
  default     = ""
  
  validation {
    condition     = var.key_name != ""
    error_message = "You must specify an EC2 key pair name. Create one in AWS Console or use 'aws ec2 create-key-pair --key-name ytdlp-api-key'."
  }
}

variable "ssh_allowed_ips" {
  description = "List of IP addresses allowed to SSH (CIDR notation)"
  type        = list(string)
  default     = ["0.0.0.0/0"] # WARNING: Change this to your IP for better security
}

variable "root_volume_size" {
  description = "Size of the root EBS volume in GB"
  type        = number
  default     = 20
}

variable "enable_monitoring" {
  description = "Enable detailed CloudWatch monitoring"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Additional tags to apply to all resources"
  type        = map(string)
  default     = {}
}
