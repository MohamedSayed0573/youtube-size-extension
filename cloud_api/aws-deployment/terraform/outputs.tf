output "instance_id" {
  description = "ID of the EC2 instance"
  value       = aws_instance.api_server.id
}

output "instance_public_ip" {
  description = "Public IP address of the EC2 instance"
  value       = aws_eip.api_server.public_ip
}

output "instance_public_dns" {
  description = "Public DNS name of the EC2 instance"
  value       = aws_instance.api_server.public_dns
}

output "security_group_id" {
  description = "ID of the security group"
  value       = aws_security_group.api_server.id
}

output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "ssh_command" {
  description = "SSH command to connect to the instance"
  value       = "ssh -i ~/.ssh/${var.key_name}.pem ubuntu@${aws_eip.api_server.public_ip}"
}

output "api_url" {
  description = "API endpoint URL"
  value       = "http://${aws_eip.api_server.public_ip}:3000"
}

output "health_check_url" {
  description = "Health check endpoint URL"
  value       = "http://${aws_eip.api_server.public_ip}:3000/health"
}

output "deployment_info" {
  description = "Deployment information"
  value = {
    instance_id   = aws_instance.api_server.id
    public_ip     = aws_eip.api_server.public_ip
    instance_type = var.instance_type
    region        = var.aws_region
    environment   = var.environment
  }
}
