# ── ECR Repository ─────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "app" {
  name = "${local.prefix}-backend"
  # SEC-034: immutable tags. Once pushed, a tag can no longer be overwritten;
  # forensic references (rollback target, "which image ran on 2026-01-15")
  # stay unambiguous. deploy.sh pushes per-SHA tags — see the drop of the
  # ``:latest`` alias there.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${local.prefix}-ecr" }
}

# Keep only the last 10 images to control storage costs
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}
