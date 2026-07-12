# ── AWS App Runner ────────────────────────────────────────────────────────────
#
# INFRA-018: App Runner replaces the previous ALB + Fargate + VPC stack.
# Rationale (July 2026): with ≤10 concurrent users the ALB (~$16/mo fixed)
# and public-IPv4 fees (~$7.20/mo for 2 tasks) dominated the bill while the
# service was idle 95% of the time. App Runner has:
#   - no dedicated load balancer (managed internally, no fixed hourly fee)
#   - no VPC / public IP to bill (the service runs on AWS-managed networking)
#   - request-driven CPU billing: $0.007/vCPU-h idle vs $0.064/vCPU-h active
# Result: idle cost drops from ~$40/mo to ~$8/mo for the same 1 vCPU / 2 GB.

# ── Access role (used by App Runner to pull the image from ECR) ───────────────

resource "aws_iam_role" "apprunner_access" {
  name = "${local.prefix}-apprunner-access-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "build.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# ── Instance role (used by the running container: DynamoDB, Bedrock, logs) ────

resource "aws_iam_role" "apprunner_instance" {
  name = "${local.prefix}-apprunner-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "tasks.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Bedrock invoke — scoped to the allow-list from variables.tf (see notes on the
# marketplace statement in the previous iam.tf).
resource "aws_iam_role_policy" "apprunner_bedrock" {
  name = "${local.prefix}-apprunner-bedrock"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ]
        Resource = var.bedrock_allowed_model_arns
      },
      {
        Effect   = "Allow"
        Action   = ["aws-marketplace:ViewSubscriptions"]
        Resource = "*"
      },
    ]
  })
}

# DynamoDB access — reuses the policy created in dynamodb.tf.
resource "aws_iam_role_policy_attachment" "apprunner_dynamodb" {
  role       = aws_iam_role.apprunner_instance.name
  policy_arn = aws_iam_policy.dynamodb_access.arn
}

# Secrets Manager — only granted when a secret ARN is configured. App Runner
# resolves `runtime_environment_secrets` with the *instance* role (unlike ECS
# where it was the execution role).
locals {
  apprunner_secret_arns = compact([
    var.bedrock_api_key_secret_arn,
    var.google_client_secret_arn,
  ])
}

resource "aws_iam_role_policy" "apprunner_secrets" {
  count = length(local.apprunner_secret_arns) > 0 ? 1 : 0
  name  = "${local.prefix}-apprunner-secrets"
  role  = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = local.apprunner_secret_arns
    }]
  })
}

# ── Autoscaling ───────────────────────────────────────────────────────────────
# min_size = 1 (App Runner's floor — cannot truly scale to zero, but idle
# vCPU is billed at 1/10th the active rate, so this stays cheap).
# max_size = 3 covers the ≤10 concurrent-user SLA even if max_concurrency
# is left at the 100-req default.

resource "aws_apprunner_auto_scaling_configuration_version" "app" {
  auto_scaling_configuration_name = "${local.prefix}-asc"
  min_size                        = 1
  max_size                        = var.env == "prod" ? 3 : 2
  max_concurrency                 = 100

  tags = { Name = "${local.prefix}-asc" }
}

# ── Observability (optional X-Ray tracing) ────────────────────────────────────

resource "aws_apprunner_observability_configuration" "app" {
  observability_configuration_name = "${local.prefix}-obs"

  trace_configuration {
    vendor = "AWSXRAY"
  }

  tags = { Name = "${local.prefix}-obs" }
}

# ── Service ───────────────────────────────────────────────────────────────────

resource "aws_apprunner_service" "app" {
  service_name = "${local.prefix}-svc"

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_access.arn
    }

    # Auto-redeploy on ECR push is intentionally OFF: deploy.sh drives the
    # roll-out explicitly with `apprunner start-deployment` after a health
    # gate, mirroring the previous ECS behaviour.
    auto_deployments_enabled = false

    image_repository {
      image_identifier      = local.ecr_image
      image_repository_type = "ECR"

      image_configuration {
        port = tostring(var.app_port)

        runtime_environment_variables = merge(
          {
            ENV                       = var.env
            PORT                      = tostring(var.app_port)
            AWS_REGION                = var.aws_region
            DDB_TABLE_USERS           = aws_dynamodb_table.users.name
            DDB_TABLE_CONVERSATIONS   = aws_dynamodb_table.conversations.name
            DDB_TABLE_CREDENTIALS     = aws_dynamodb_table.credentials.name
            BEDROCK_REGION            = var.bedrock_region
            BEDROCK_MODEL_ID          = var.bedrock_model_id
            BEDROCK_GUARDRAIL_ID      = var.bedrock_guardrail_id
            BEDROCK_GUARDRAIL_VERSION = var.bedrock_guardrail_version
            BEDROCK_MAX_TOKENS        = tostring(var.bedrock_max_tokens)
          },
          var.api_key != "" ? { API_KEY = var.api_key } : {},
          var.session_secret != "" ? { SESSION_SECRET = var.session_secret } : {},
          var.google_client_id != "" ? { GOOGLE_CLIENT_ID = var.google_client_id } : {},
          var.google_redirect_uri != "" ? { GOOGLE_REDIRECT_URI = var.google_redirect_uri } : {},
          var.frontend_url != "" ? { FRONTEND_URL = var.frontend_url } : {},
          (var.google_client_secret != "" && var.google_client_secret_arn == "")
          ? { GOOGLE_CLIENT_SECRET = var.google_client_secret } : {},
        )

        runtime_environment_secrets = merge(
          var.bedrock_api_key_secret_arn != "" ? {
            AWS_BEARER_TOKEN_BEDROCK = var.bedrock_api_key_secret_arn
          } : {},
          var.google_client_secret_arn != "" ? {
            GOOGLE_CLIENT_SECRET = var.google_client_secret_arn
          } : {},
        )
      }
    }
  }

  instance_configuration {
    cpu               = var.apprunner_cpu
    memory            = var.apprunner_memory
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.app.arn

  health_check_configuration {
    protocol            = "HTTP"
    path                = var.health_check_path
    interval            = 20
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  observability_configuration {
    observability_enabled           = true
    observability_configuration_arn = aws_apprunner_observability_configuration.app.arn
  }

  # Ignore image_identifier drift: deploy.sh calls `apprunner start-deployment`
  # after pushing to ECR, so the service tracks the latest image out-of-band.
  lifecycle {
    ignore_changes = [source_configuration[0].image_repository[0].image_identifier]
  }

  tags = { Name = "${local.prefix}-svc" }
}
