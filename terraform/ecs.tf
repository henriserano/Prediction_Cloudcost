# ── ECS Cluster ────────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${local.prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled"
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
        ],
        # API key protecting the mutating endpoints — injected only when set.
        var.api_key != "" ? [{ name = "API_KEY", value = var.api_key }] : [],
        # JWT signing key for the session cookie (POC auth).
        var.session_secret != "" ? [{ name = "SESSION_SECRET", value = var.session_secret }] : []
      )
      # TODO: move API_KEY (and any other sensitive value) to AWS Secrets
      # Manager — a plain env var is visible in the task definition (ECS
      # console, DescribeTaskDefinition). See the commented `secrets` block
      # below for the recommended pattern.
      # For production: use AWS Secrets Manager instead of plain env vars for
      # any sensitive values (OAuth secrets, API keys, etc.).
      # secrets = [
      #   {
      #     name      = "GOOGLE_CLIENT_SECRET"
      #     valueFrom = "arn:aws:secretsmanager:<region>:<account>:secret:finops/google-client-secret"
      #   }
      # ]
      # Grant the ecs_execution role secretsmanager:GetSecretValue on those ARNs.

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

      # SECURITY NOTE (INFRA-009): readonlyRootFilesystem = true is the recommended
      # hardening posture. Set to true and mount explicit tmpfs volumes for any
      # paths the app writes to (e.g. /tmp). Requires verifying the app starts
      # cleanly with a read-only root.
      readonlyRootFilesystem = false
      user                   = "1000"
    }
  ])

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