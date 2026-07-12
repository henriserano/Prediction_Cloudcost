locals {
  prefix = "${var.app_name}-${var.env}"

  # ECR image URI consumed by the App Runner service.
  ecr_image = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
}

data "aws_caller_identity" "current" {}
