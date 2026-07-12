# App Runner service, instance and access roles now live in apprunner.tf
# (kept co-located with the service they authorise). This file only carries
# the CI/CD-facing ECR push policy.

resource "aws_iam_policy" "ecr_push" {
  name        = "${local.prefix}-ecr-push"
  description = "Allows CI/CD to push images to the app ECR repository and trigger App Runner deployments"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
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
          "ecr:PutImage",
        ]
        Resource = aws_ecr_repository.app.arn
      },
      {
        Effect = "Allow"
        Action = [
          "apprunner:StartDeployment",
          "apprunner:DescribeService",
        ]
        Resource = aws_apprunner_service.app.arn
      },
    ]
  })
}
