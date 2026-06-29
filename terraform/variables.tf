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

variable "health_check_path" {
  description = "ALB target group health check path"
  type        = string
  default     = "/health"
}
