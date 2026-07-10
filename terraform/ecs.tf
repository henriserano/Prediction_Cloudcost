# ── ECS Cluster ────────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${local.prefix}-cluster"

  # INFRA-012: Container Insights enabled in every env — the marginal cost is
  # negligible next to the visibility gain (CPU, memory, network, task
  # transitions surfaced in CloudWatch without instrumenting the container).
  # Required to root-cause the alarms wired up in cloudwatch.tf.
  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${local.prefix}-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  # prod: guarantee at least one task on on-demand FARGATE (base = 1), with
  # FARGATE_SPOT absorbing extra capacity. dev/staging: SPOT only (~70% cheaper,
  # interruptions acceptable).
  dynamic "default_capacity_provider_strategy" {
    for_each = var.env == "prod" ? [1] : []
    content {
      capacity_provider = "FARGATE"
      weight            = 1
      base              = 1
    }
  }

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 4
    base              = 0
  }
}

# ── Task Definition ────────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.prefix}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.container_cpu
  memory                   = var.container_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = local.ecr_image
      essential = true

      portMappings = [
        {
          containerPort = var.app_port
          protocol      = "tcp"
        }
      ]

      environment = concat(
        [
          { name = "ENV", value = var.env },
          { name = "PORT", value = tostring(var.app_port) },
          { name = "AWS_REGION", value = var.aws_region },
          { name = "DDB_TABLE_USERS", value = aws_dynamodb_table.users.name },
          { name = "DDB_TABLE_CONVERSATIONS", value = aws_dynamodb_table.conversations.name },
          { name = "DDB_TABLE_CREDENTIALS", value = aws_dynamodb_table.credentials.name },
          # Bedrock config (non-sensitive: region + model ID + tuning).
          # Credentials come from the ECS task role (SigV4) — no keys here.
          { name = "BEDROCK_REGION", value = var.bedrock_region },
          { name = "BEDROCK_MODEL_ID", value = var.bedrock_model_id },
          { name = "BEDROCK_GUARDRAIL_ID", value = var.bedrock_guardrail_id },
          { name = "BEDROCK_GUARDRAIL_VERSION", value = var.bedrock_guardrail_version },
          { name = "BEDROCK_MAX_TOKENS", value = tostring(var.bedrock_max_tokens) },
        ],
        # API key protecting the mutating endpoints — injected only when set.
        var.api_key != "" ? [{ name = "API_KEY", value = var.api_key }] : [],
        # JWT signing key for the session cookie (POC auth).
        var.session_secret != "" ? [{ name = "SESSION_SECRET", value = var.session_secret }] : [],
        # Google OAuth (public config — client_id, redirect URI, frontend URL).
        var.google_client_id != "" ? [{ name = "GOOGLE_CLIENT_ID", value = var.google_client_id }] : [],
        var.google_redirect_uri != "" ? [{ name = "GOOGLE_REDIRECT_URI", value = var.google_redirect_uri }] : [],
        var.frontend_url != "" ? [{ name = "FRONTEND_URL", value = var.frontend_url }] : [],
        # Plain-var fallback for the OAuth client secret. Prefer
        # google_client_secret_arn (Secrets Manager) — this path leaks the
        # value into terraform.tfstate and into DescribeTaskDefinition.
        (var.google_client_secret != "" && var.google_client_secret_arn == "")
        ? [{ name = "GOOGLE_CLIENT_SECRET", value = var.google_client_secret }] : []
      )

      # Sensitive values are resolved by the ECS agent at start-up via the
      # execution role and injected as env vars — never persisted in the task
      # definition JSON. The `bedrock_api_key_secret_arn` path is optional:
      # when empty, boto3 falls back to the task role (SigV4), which is the
      # recommended posture. When set, the AWS_BEARER_TOKEN_BEDROCK path is
      # honoured by langchain-aws / boto3 transparently.
      secrets = concat(
        var.bedrock_api_key_secret_arn != "" ? [{
          name      = "AWS_BEARER_TOKEN_BEDROCK"
          valueFrom = var.bedrock_api_key_secret_arn
        }] : [],
        var.google_client_secret_arn != "" ? [{
          name      = "GOOGLE_CLIENT_SECRET"
          valueFrom = var.google_client_secret_arn
        }] : []
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }

      # python:3.11-slim has no curl — use python instead
      healthCheck = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:${var.app_port}/health')\" || exit 1"]
        interval    = 30
        timeout     = 10
        retries     = 3
        startPeriod = 120
      }

      # INFRA-009: read-only root filesystem blocks persistence of any malware
      # that lands in the container — writes to /app, /usr, /etc etc. all fail.
      # Fargate does not support the `tmpfs` container option, so writable
      # scratch space is provided via ephemeral in-task volumes mounted at the
      # paths Python/uvicorn actually need (matplotlib cache, tmpfile, etc.).
      readonlyRootFilesystem = true
      user                   = "1000"

      mountPoints = [
        { sourceVolume = "tmp", containerPath = "/tmp", readOnly = false },
        { sourceVolume = "shm", containerPath = "/dev/shm", readOnly = false },
      ]
    }
  ])

  # Ephemeral scratch volumes for the read-only root filesystem hardening
  # above. Fargate emptyDir-style volumes have their lifecycle tied to the
  # task — nothing persists across task restarts.
  volume {
    name = "tmp"
  }
  volume {
    name = "shm"
  }

  tags = { Name = "${local.prefix}-task" }
}

# ── ECS Service ────────────────────────────────────────────────────────────────

resource "aws_ecs_service" "app" {
  name            = "${local.prefix}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count

  # Allow Terraform to manage the task definition without replacing the service
  # when a new image is deployed (handled by the deploy script)
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  # SECURITY NOTE (INFRA-001): Tasks are placed in public subnets with
  # assign_public_ip = true because no NAT gateway is provisioned (cost
  # trade-off for this deployment size). The ECS security group restricts
  # inbound traffic to the ALB security group on the app port only — tasks
  # are not directly reachable from the internet on the application port.
  # For a higher-security posture: add private subnets + a NAT gateway,
  # move tasks to aws_subnet.private[*].id, and set assign_public_ip = false.
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "backend"
    container_port   = var.app_port
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_controller {
    type = "ECS"
  }

  # Minimum 50% healthy during deploy, max 200% (one extra task)
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]

  tags = { Name = "${local.prefix}-service" }
}