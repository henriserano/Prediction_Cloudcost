#!/usr/bin/env bash
# deploy.sh — Build, push to ECR and force a new ECS deployment
#
# Usage:
#   ./deploy.sh [--env dev|staging|prod] [--region eu-west-1] [--tag v1.2.3]
#
# Prerequisites:
#   - AWS CLI v2 configured (aws configure or env vars)
#   - Docker running
#   - Terraform applied at least once (terraform apply)
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

PREFIX="${APP_NAME}-${ENV}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  FinOps Deploy"
echo "  env    : $ENV"
echo "  region : $REGION"
echo "  tag    : $TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1 — Read Terraform outputs ───────────────────────────────────────────
echo "[1/5] Reading Terraform outputs..."
cd "$TF_DIR"
ECR_URL=$(terraform output -raw ecr_repository_url)
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw ecs_service_name)
API_URL=$(terraform output -raw api_base_url)

echo "  ECR  : $ECR_URL"
echo "  ECS  : $CLUSTER / $SERVICE"
echo "  URL  : $API_URL"

# ── Step 2 — Docker build ─────────────────────────────────────────────────────
echo "[2/5] Building Docker image..."
cd "$BACK_DIR"
docker build \
  --platform linux/amd64 \
  --tag "${ECR_URL}:${TAG}" \
  --tag "${ECR_URL}:latest" \
  .

# ── Step 3 — ECR login & push ─────────────────────────────────────────────────
echo "[3/5] Pushing image to ECR..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_URL"

docker push "${ECR_URL}:${TAG}"
docker push "${ECR_URL}:latest"

# ── Step 4 — Terraform image_tag update ───────────────────────────────────────
echo "[4/5] Updating task definition (image_tag=$TAG)..."
cd "$TF_DIR"
terraform apply \
  -var "image_tag=${TAG}" \
  -var "env=${ENV}" \
  -var "aws_region=${REGION}" \
  -auto-approve

# ── Step 5 — Force new ECS deployment ─────────────────────────────────────────
echo "[5/5] Triggering rolling deployment..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --force-new-deployment \
  --region "$REGION" \
  --output json | jq -r '.service.deployments[0] | "  deployment: \(.id)  status: \(.status)"'

echo ""
echo "✓ Deploy kicked off. Monitor progress:"
echo "  aws ecs describe-services --cluster $CLUSTER --services $SERVICE --region $REGION --query 'services[0].deployments'"
echo ""
echo "  API base URL : $API_URL"
echo "  Health check : $API_URL/health"
echo "  Swagger docs : $API_URL/docs"
