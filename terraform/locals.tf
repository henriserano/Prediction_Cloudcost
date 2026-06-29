locals {
  prefix = "${var.app_name}-${var.env}"

  # Derive AZ names dynamically so the config works in any region
  azs            = slice(data.aws_availability_zones.available.names, 0, var.az_count)
  public_subnets = [for i in range(var.az_count) : cidrsubnet(var.vpc_cidr, 8, i)]

  # ECR image URI
  ecr_image = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"

  https_enabled = var.certificate_arn != ""
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}
