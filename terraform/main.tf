terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  # ── Remote state (uncomment once you have an S3 bucket + DynamoDB table) ──
  # backend "s3" {
  #   bucket         = "demo-finops-tfstate"
  #   key            = "finops-backend/terraform.tfstate"
  #   region         = var.aws_region
  #   dynamodb_table = "demo-finops-tflock"
  #   encrypt        = true
  # }
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
