# ── ECS Task Execution Role ────────────────────────────────────────────────────
# Used by ECS agent itself: pull from ECR, write to CloudWatch

resource "aws_iam_role" "ecs_execution" {
  name = "${local.prefix}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# AmazonECSTaskExecutionRolePolicy is the AWS-managed policy scoped to the
# minimum actions required by the ECS agent (ECR pull + CloudWatch Logs).
# No additional permissions are granted — this is intentionally minimal.
resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ── ECS Task Role ──────────────────────────────────────────────────────────────
# Used by the application code itself — principle of least privilege

resource "aws_iam_role" "ecs_task" {
  name = "${local.prefix}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Minimal task-role permissions: only CloudWatch log writes to the app log group.
# The application has no S3, SQS or other AWS service permissions beyond what
# is required for the chatbot (Bedrock) and the auth/conversation persistence
# (DynamoDB, added elsewhere). Principle of least privilege is preserved.
# Allow the app to write structured logs to CloudWatch
resource "aws_iam_role_policy" "ecs_task_logs" {
  name = "${local.prefix}-task-logs"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "${aws_cloudwatch_log_group.app.arn}:*"
    }]
  })
}

# Bedrock invoke permission — scoped to the allow-list from variables.tf so
# a compromised task cannot pivot to an arbitrary (potentially costly) model.
# This is the SigV4 path: when set, boto3 signs Bedrock calls with the task
# role's short-lived credentials and no bearer token is needed.
resource "aws_iam_role_policy" "ecs_task_bedrock" {
  name = "${local.prefix}-task-bedrock"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ]
      Resource = var.bedrock_allowed_model_arns
    }]
  })
}

# When bedrock_api_key_secret_arn or google_client_secret_arn is set, the ECS
# EXECUTION role (not the task role) needs permission to fetch the value at
# container start-up so it can be injected as an env var. Attaching this to
# the task role would be a mistake — the ECS agent, not the app, does the
# secretsmanager:GetSecretValue call.
locals {
  ecs_execution_secret_arns = compact([
    var.bedrock_api_key_secret_arn,
    var.google_client_secret_arn,
  ])
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  count = length(local.ecs_execution_secret_arns) > 0 ? 1 : 0
  name  = "${local.prefix}-execution-secrets"
  role  = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = local.ecs_execution_secret_arns
    }]
  })
}

# ── ECR Push Policy (attached to your CI/CD IAM user or role) ─────────────────

resource "aws_iam_policy" "ecr_push" {
  name        = "${local.prefix}-ecr-push"
  description = "Allows CI/CD to push images to the app ECR repository"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage"
        ]
        Resource = aws_ecr_repository.app.arn
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = aws_ecs_service.app.id
      }
    ]
  })
}
