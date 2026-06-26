# ── VPC Endpoints ──────────────────────────────────────────────────────────────
# Required for ECS Fargate tasks in private subnets to reach AWS APIs
# without routing through the NAT gateway for every ECR pull / log push.
#
# If these are missing and the NAT is slow or misconfigured, the task agent
# fails to pull the image → deployment stays in PROVISIONING forever.

# Security group shared by all Interface endpoints
resource "aws_security_group" "vpc_endpoints" {
  name        = "${local.prefix}-sg-vpce"
  description = "Allow HTTPS from private subnets to VPC Interface endpoints"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.prefix}-sg-vpce" }
}

# ── ECR API endpoint (image manifest fetch) ───────────────────────────────────
resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = { Name = "${local.prefix}-vpce-ecr-api" }
}

# ── ECR DKR endpoint (layer pulls) ────────────────────────────────────────────
resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = { Name = "${local.prefix}-vpce-ecr-dkr" }
}

# ── CloudWatch Logs endpoint (log shipping from container) ────────────────────
resource "aws_vpc_endpoint" "logs" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = { Name = "${local.prefix}-vpce-logs" }
}

# ── S3 Gateway endpoint (ECR stores layers in S3) ─────────────────────────────
# Gateway endpoint is free — no per-hour cost unlike Interface endpoints
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = { Name = "${local.prefix}-vpce-s3" }
}
