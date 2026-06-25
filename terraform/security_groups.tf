# ── ALB Security Group ─────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "${local.prefix}-sg-alb"
  description = "Allow HTTP/HTTPS from the internet to the ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = local.https_enabled ? [1] : []
    content {
      description = "HTTPS"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.prefix}-sg-alb" }
}

# ── ECS Task Security Group ────────────────────────────────────────────────────

resource "aws_security_group" "ecs" {
  name        = "${local.prefix}-sg-ecs"
  description = "Allow traffic only from the ALB to ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "From ALB on app port"
    from_port       = var.app_port
    to_port         = var.app_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound (for pip install at init, ECR pull, CloudWatch)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.prefix}-sg-ecs" }
}
