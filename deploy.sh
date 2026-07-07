#!/usr/bin/env bash
# deploy.sh — Build, push to ECR and force a new ECS deployment
#
# Usage:
#   ./deploy.sh [--env dev|staging|prod] [--region eu-west-1] [--tag v1.2.3]
#
# Prerequisites:
#   - AWS CLI v2 configured (aws configure or env vars)
#   - Docker running
#   - terraform init already run in terraform/ (the script itself applies the
#     infrastructure: it works on a virgin AWS account — step 1 creates the ECR
#     repository first, then the full infra is applied in step 4 after the
#     image has been pushed)
#   - jq installed
#
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
ENV="dev"
REGION="eu-west-1"
TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
APP_NAME="finops"
BACK_DIR="$(cd "$(dirname "$0")/back" && pwd)"
TF_DIR="$(cd "$(dirname "$0")/terraform" && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)     ENV="$2";    shift 2 ;;
    --region)  REGION="$2"; shift 2 ;;
    --tag)     TAG="$2";    shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  FinOps Deploy"
echo "  env    : $ENV"
echo "  region : $REGION"
echo "  tag    : $TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1 — Terraform apply targeted on ECR (repository must exist to push) ──
# image_tag is intentionally NOT passed here; ECS lifecycle ignores task_definition.
# No VPC endpoints are needed: ECS tasks run in public subnets with a public IP
# (cost trade-off, see terraform/README.md INFRA-001) and reach ECR/CloudWatch
# through the Internet Gateway.
echo "[1/6] Applying Terraform (ECR repository)..."
cd "$TF_DIR"
terraform apply \
  -var "env=${ENV}" \
  -var "aws_region=${REGION}" \
  -target=aws_ecr_repository.app \
  -auto-approve

# Only the ECR output is guaranteed to exist at this point (virgin infra:
# the other outputs become available after the full apply in step 4).
ECR_URL=$(terraform output -raw ecr_repository_url)

echo "  ECR  : $ECR_URL"

# ── Step 2 — Docker build ─────────────────────────────────────────────────────
echo "[2/6] Building Docker image (linux/amd64)..."
cd "$BACK_DIR"
docker build \
  --platform linux/amd64 \
  --tag "${ECR_URL}:${TAG}" \
  --tag "${ECR_URL}:latest" \
  .

# ── Step 3 — ECR login & push ─────────────────────────────────────────────────
echo "[3/6] Pushing image to ECR..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_URL"

docker push "${ECR_URL}:${TAG}"
docker push "${ECR_URL}:latest"

# ── Step 4 — Full Terraform apply with the new image tag ──────────────────────
# Image is in ECR now — safe to update the task definition
echo "[4/6] Updating task definition (image_tag=$TAG)..."
cd "$TF_DIR"
terraform apply \
  -var "image_tag=${TAG}" \
  -var "env=${ENV}" \
  -var "aws_region=${REGION}" \
  -auto-approve

# Full infra now exists — safe to read the remaining outputs (robust on a
# virgin AWS account, where these outputs only appear after the apply above).
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw ecs_service_name)
API_URL=$(terraform output -raw api_base_url)

echo "  ECS  : $CLUSTER / $SERVICE"
echo "  URL  : $API_URL"

# ── Step 5 — Force new ECS deployment ─────────────────────────────────────────
# Terraform's ignore_changes = [task_definition] means the ECS service is not
# pinned to the revision Terraform just registered. Passing the service's
# current taskDefinition ARN back to update-service would redeploy the OLD
# revision. Pass the family name only — ECS resolves it to the latest ACTIVE
# revision, which is the one we just wrote in step 4.
TASK_FAMILY=$(terraform output -raw ecs_task_family 2>/dev/null || echo "${APP_NAME}-${ENV}-task")

echo "[5/6] Triggering rolling deployment (task-def family: $TASK_FAMILY)..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$TASK_FAMILY" \
  --force-new-deployment \
  --region "$REGION" \
  --output json | jq -r '.service.deployments[0] | "  deployment: \(.id)  status: \(.status)  task-def: \(.taskDefinition)"'

# ── Step 6 — Wait for stability ───────────────────────────────────────────────
echo "[6/6] Waiting for service to stabilise (up to 5 min)..."
aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region "$REGION"

echo ""
echo "  Deployment stable!"
echo "  API base URL : $API_URL"
echo "  Health check : $API_URL/health"
echo "  Swagger docs : $API_URL/docs"
