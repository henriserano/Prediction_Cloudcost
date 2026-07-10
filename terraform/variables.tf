variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "eu-west-1"
}

variable "env" {
  description = "Deployment environment (dev | staging | prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be one of: dev, staging, prod."
  }
}

variable "app_name" {
  description = "Application name — used as prefix for all resource names"
  type        = string
  default     = "finops"
}

# ── Networking ─────────────────────────────────────────────────────────────────

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones to deploy into (2 minimum recommended)"
  type        = number
  default     = 2
}

# ── ECS / Fargate ──────────────────────────────────────────────────────────────

variable "container_cpu" {
  description = "CPU units for the Fargate task (512 = 0.5 vCPU — sufficient for this workload)"
  type        = number
  default     = 512
}

variable "container_memory" {
  description = "Memory (MiB) for the Fargate task — numpy/scipy/statsmodels need ≥ 1.5 GB at cold start"
  type        = number
  default     = 2048
}

variable "desired_count" {
  description = "Number of running ECS tasks"
  type        = number
  default     = 1
}

variable "app_port" {
  description = "Port the FastAPI container listens on"
  type        = number
  default     = 8080
}

variable "image_tag" {
  description = <<-EOT
    Immutable Docker image tag to deploy (git SHA, semver, or CI build ID).
    No default: a manual `terraform apply` without -var="image_tag=..." now
    fails fast instead of silently redeploying whatever "latest" pointed to
    at that moment (INFRA-015). deploy.sh always supplies the SHA it just
    pushed to ECR, so the guard rail only bites unintended manual applies.
  EOT
  type        = string

  validation {
    condition     = length(var.image_tag) > 0 && var.image_tag != "latest"
    error_message = "image_tag must be an immutable tag (git SHA, semver, CI build ID). 'latest' is refused because it makes apply non-reproducible."
  }
}

# ── ALB / HTTPS ────────────────────────────────────────────────────────────────

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener. Leave empty to use HTTP-only."
  type        = string
  default     = ""
}

variable "api_key" {
  description = "API key protecting the mutating backend endpoints (POST /api/events, /api/events/upload, /api/aws/connect, /admin/cache/clear). Required in prod. Injected as the API_KEY env var only when non-empty."
  type        = string
  sensitive   = true
  default     = ""
}

variable "session_secret" {
  description = "Random string used to sign the session JWT cookie. Must be ≥32 chars in prod. Rotating it invalidates every logged-in session. Set via TF_VAR_session_secret or terraform.tfvars — never hardcode."
  type        = string
  sensitive   = true
  default     = ""
}

variable "health_check_path" {
  description = "ALB target group health check path"
  type        = string
  default     = "/health"
}

# ── Google OAuth2 ──────────────────────────────────────────────────────────────

variable "google_client_id" {
  description = "Google OAuth2 client ID"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth2 client secret. DEPRECATED for production — set google_client_secret_arn instead and let ECS resolve it from Secrets Manager at startup. Leaving this in plain tfvars persists the secret in terraform.tfstate."
  type        = string
  sensitive   = true
  default     = ""
}

variable "google_client_secret_arn" {
  description = "ARN of a Secrets Manager secret storing GOOGLE_CLIENT_SECRET. When set, ECS resolves it at startup and injects it as an env var; leave the plain google_client_secret empty in that case."
  type        = string
  default     = ""
}

variable "google_redirect_uri" {
  description = "OAuth2 redirect URI — must match what is registered in Google Cloud Console"
  type        = string
  default     = ""
}

variable "frontend_url" {
  description = "Frontend URL for post-OAuth redirects"
  type        = string
  default     = ""
}

# ── AWS Bedrock ────────────────────────────────────────────────────────────────
# Bedrock is called via the ECS task role (aws_iam_role.ecs_task) — no AWS
# credentials are injected as env vars. Only non-sensitive config is passed.

variable "bedrock_region" {
  description = "AWS region for Bedrock API calls. May differ from aws_region if the target model is not available in the primary region (e.g. Claude in eu-west-3 / eu-central-1)."
  type        = string
  default     = "eu-west-3"
}

variable "bedrock_model_id" {
  description = "Bedrock foundation model ID or inference profile ID. Must match what the LangGraph agent expects (see back/agent/graph.py DEFAULT_MODEL). EU inference profile is required in eu-west-3 / eu-central-1."
  type        = string
  default     = "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
}

variable "bedrock_api_key_secret_arn" {
  description = "ARN of a Secrets Manager secret storing the AWS_BEARER_TOKEN_BEDROCK. Leave empty to use the ECS task role (SigV4) instead — recommended path. When set, the value is injected as the AWS_BEARER_TOKEN_BEDROCK env var via the ECS `secrets` block."
  type        = string
  default     = ""
}

variable "bedrock_guardrail_id" {
  description = "Bedrock Guardrail ID for PII / prompt-injection filtering. Leave empty to disable guardrails (not recommended for client data)."
  type        = string
  default     = ""
}

variable "bedrock_guardrail_version" {
  description = "Bedrock Guardrail version (e.g. 'DRAFT' or a numeric version). Ignored when bedrock_guardrail_id is empty."
  type        = string
  default     = "DRAFT"
}

variable "bedrock_allowed_model_arns" {
  description = <<-EOT
    Bedrock ARNs the task role is allowed to invoke. Least privilege — narrow to
    the exact model(s)/profiles you use.

    Calling an inference profile (e.g. eu.anthropic.claude-sonnet-4-5-*) requires
    IAM permission on BOTH the profile ARN AND the underlying foundation models
    it routes to, because Bedrock's authorization walks through both hops.

    ARN forms accepted:
      - Foundation model:  arn:aws:bedrock:<region>::foundation-model/<id>
      - Inference profile: arn:aws:bedrock:<region>:<account>:inference-profile/<id>

    Default = the exact Sonnet 4.5 model driving the LangGraph agent
    (bedrock_model_id) plus the EU cross-region inference profile it routes
    through. Do NOT re-broaden to `anthropic.claude-*` — that lets any newly
    released Anthropic model (Opus, future versions) run on this account with
    no code change and no cost review.
  EOT
  type        = list(string)
  default = [
    # Foundation model actually invoked (Sonnet 4.5, versioned).
    "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0",
    # EU cross-region inference profile the agent targets (see bedrock_model_id).
    "arn:aws:bedrock:*:*:inference-profile/eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
  ]
}

variable "bedrock_max_tokens" {
  description = "Default max output tokens sent to Bedrock InvokeModel. Non-sensitive tuning knob exposed as env var so it can be changed without a code deploy."
  type        = number
  default     = 4096
}

# ── Ops alerting ─────────────────────────────────────────────────────────────
variable "alarm_email_subscribers" {
  description = <<-EOT
    Email addresses subscribed to the CloudWatch alarm SNS topic (INFRA-010).
    Leave empty in dev/staging; set to the on-call rota in prod so CPU / memory
    / 5xx / unhealthy-target alarms actually page someone. For PagerDuty or
    Opsgenie, subscribe the integration URL to the topic ARN outside of Terraform
    (or extend this file with an additional aws_sns_topic_subscription).
  EOT
  type        = list(string)
  default     = []
}
