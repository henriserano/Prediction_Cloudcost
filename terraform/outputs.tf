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

output "ecs_task_family" {
  description = "Task-definition family name — pass this (not an ARN) to `ecs update-service --task-definition` so ECS resolves to the latest ACTIVE revision."
  value       = aws_ecs_task_definition.app.family
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

output "dynamodb_table_users" {
  description = "DynamoDB table storing user identity"
  value       = aws_dynamodb_table.users.name
}

output "dynamodb_table_conversations" {
  description = "DynamoDB table storing chat threads per user"
  value       = aws_dynamodb_table.conversations.name
}

output "dynamodb_table_credentials" {
  description = "DynamoDB table storing per-user encrypted provider credentials"
  value       = aws_dynamodb_table.credentials.name
}
