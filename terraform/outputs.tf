output "alb_dns_name" {
  description = "Public DNS of the Application Load Balancer"
  value       = aws_lb.app.dns_name
}

output "api_base_url" {
  description = "Base URL to call the FastAPI backend"
  value       = local.https_enabled ? "https://${aws_lb.app.dns_name}" : "http://${aws_lb.app.dns_name}"
}

output "ecr_repository_url" {
  description = "ECR repository URL (use as Docker push target)"
  value       = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.app.name
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group for ECS task output"
  value       = aws_cloudwatch_log_group.app.name
}

output "ecr_push_policy_arn" {
  description = "ARN of the IAM policy to attach to your CI/CD role for ECR push + service update"
  value       = aws_iam_policy.ecr_push.arn
}

output "aws_region" {
  value = var.aws_region
}
