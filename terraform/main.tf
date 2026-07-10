terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  # INFRA-011: remote state is REQUIRED before any team apply — a local
  # tfstate on one operator's laptop is impossible to review, back up, or
  # reconcile after a failed apply. Partial config: the bucket/table names
  # are supplied via `terraform init -backend-config="bucket=..." \
  # -backend-config="dynamodb_table=..."` so we don't commit the account-
  # specific values. Encryption + DynamoDB locking must always be on.
  #
  # Bootstrapping (once per account, done by an admin):
  #   aws s3api create-bucket --bucket finops-tfstate-<acct> ...
  #   aws dynamodb create-table --table-name finops-tflock ...
  #   terraform init \
  #     -backend-config="bucket=finops-tfstate-<acct>" \
  #     -backend-config="dynamodb_table=finops-tflock" \
  #     -backend-config="region=eu-west-1"
  backend "s3" {
    key     = "finops-backend/terraform.tfstate"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "finops-gcp"
      Environment = var.env
      ManagedBy   = "terraform"
    }
  }
}
