# DynamoDB tables for user identity, conversations, encrypted credentials.
#
# Design notes (POC scope):
# - PAY_PER_REQUEST: no capacity planning needed for the POC traffic volume,
#   and the tables sit idle most of the time (chatbot usage bursts).
# - Server-side encryption uses AWS-owned CMK by default. That protects
#   at-rest against a raw disk exfil, not against a compromised app account.
#   Application-level AES-GCM (KEK derived from the user PIN) is layered on
#   top for the credentials table, so tokens are opaque even to us without
#   the user's PIN.
# - No point-in-time recovery / streams for now — enable when the POC graduates.

resource "aws_dynamodb_table" "users" {
  name         = "${local.prefix}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  attribute {
    name = "user_id"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${local.prefix}-users"
    Environment = var.env
    Purpose     = "user-identity"
  }
}

resource "aws_dynamodb_table" "conversations" {
  name         = "${local.prefix}-conversations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"
  range_key    = "thread_id"

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "thread_id"
    type = "S"
  }

  attribute {
    name = "updated_at"
    type = "S"
  }

  # LSI to list a user's conversations sorted by recency without a full scan.
  local_secondary_index {
    name            = "user-updated-at-index"
    range_key       = "updated_at"
    projection_type = "INCLUDE"
    non_key_attributes = ["title", "message_count"]
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${local.prefix}-conversations"
    Environment = var.env
    Purpose     = "chat-history"
  }
}

resource "aws_dynamodb_table" "credentials" {
  name         = "${local.prefix}-credentials"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"
  range_key    = "provider"

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "provider"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${local.prefix}-credentials"
    Environment = var.env
    Purpose     = "encrypted-credentials"
  }
}

# IAM permissions so the ECS task role can read/write the tables.
# Attached in iam.tf; declared here to keep the table-related policy
# grouped with the resources.
data "aws_iam_policy_document" "dynamodb_access" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      aws_dynamodb_table.users.arn,
      aws_dynamodb_table.conversations.arn,
      "${aws_dynamodb_table.conversations.arn}/index/*",
      aws_dynamodb_table.credentials.arn,
    ]
  }
}

resource "aws_iam_policy" "dynamodb_access" {
  name        = "${local.prefix}-dynamodb-access"
  description = "Read/write access to the FinOps DynamoDB tables"
  policy      = data.aws_iam_policy_document.dynamodb_access.json
}

resource "aws_iam_role_policy_attachment" "task_dynamodb" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.dynamodb_access.arn
}
