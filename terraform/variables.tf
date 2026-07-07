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
  description = "Docker image tag to deploy (overridden by deploy script)"
  type        = string
  default     = "latest"
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
  description = "List of Bedrock foundation-model ARNs the task role is allowed to invoke. Least privilege — narrow this to the exact model(s) you use. Wildcards in the model portion are allowed."
  type        = list(string)
  default = [
    "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
  ]
}

variable "bedrock_max_tokens" {
  description = "Default max output tokens sent to Bedrock InvokeModel. Non-sensitive tuning knob exposed as env var so it can be changed without a code deploy."
  type        = number
  default     = 4096
}
