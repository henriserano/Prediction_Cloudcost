output "apprunner_service_url" {
  description = "Public HTTPS URL of the App Runner service (managed cert, HTTPS by default)"
  value       = "https://${aws_apprunner_service.app.service_url}"
}

output "api_base_url" {
  description = "Base URL to call the FastAPI backend"
  value       = "https://${aws_apprunner_service.app.service_url}"
}

output "apprunner_service_arn" {
  description = "App Runner service ARN — passed to `aws apprunner start-deployment` by deploy.sh"
  value       = aws_apprunner_service.app.arn
}

output "apprunner_service_name" {
  description = "App Runner service name"
  value       = aws_apprunner_service.app.service_name
}

output "ecr_repository_url" {
  description = "ECR repository URL (use as Docker push target)"
  value       = aws_ecr_repository.app.repository_url
}

output "ecr_push_policy_arn" {
  description = "ARN of the IAM policy to attach to your CI/CD role for ECR push + App Runner deploy"
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
