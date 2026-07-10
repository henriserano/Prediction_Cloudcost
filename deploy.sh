#!/usr/bin/env bash
# deploy.sh — Build, push to ECR and force a new ECS deployment
#
# Usage:
#   ./deploy.sh [--env dev|staging|prod] [--region eu-west-1] [--tag v1.2.3]
#
# Prerequisites (validated up-front by the preflight step below):
#   - AWS CLI v2, terraform, docker, jq, git in PATH
#   - AWS credentials configured (aws configure or env vars) and reachable
#   - Docker daemon running
#
# Post-deploy behaviour (INFRA-016):
#   The script waits for services-stable, then hits /health via the ALB. If
#   /health does not return 200 within HEALTH_TIMEOUT_S seconds, the previous
#   task-definition revision is rolled back automatically via
#   `aws ecs update-service --task-definition <prev-revision>`.
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
ENV="dev"
REGION="eu-west-1"
TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "")
APP_NAME="finops"
BACK_DIR="$(cd "$(dirname "$0")/back" && pwd)"
TF_DIR="$(cd "$(dirname "$0")/terraform" && pwd)"
HEALTH_TIMEOUT_S=180
HEALTH_INTERVAL_S=5

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)     ENV="$2";    shift 2 ;;
    --region)  REGION="$2"; shift 2 ;;
    --tag)     TAG="$2";    shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Preflight ─────────────────────────────────────────────────────────────────
# INFRA-016: fail fast when a required CLI is missing (or when Docker is not
# running / AWS creds are stale) rather than half-way through the deploy.
fail() { echo "❌ $*" >&2; exit 1; }

check_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but not in PATH. Install it and retry."
}

echo "[preflight] Checking required tooling…"
for c in aws docker jq terraform git; do check_cmd "$c"; done

docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable — start Docker Desktop / the daemon."
aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1 \
  || fail "AWS credentials are not configured for region ${REGION}. Run 'aws configure' or export AWS_* env vars."

if [[ -z "${TAG}" || "${TAG}" == "latest" ]]; then
  fail "Refusing to deploy with an empty tag or the moving tag 'latest'. Pass --tag <git-sha> (variables.tf validation also enforces this)."
fi

# INFRA-011: the S3 backend must be initialised locally before the first apply.
# ``bootstrap-backend.sh`` provisions the bucket + Dynamo lock table + writes
# terraform/backend.hcl and runs ``terraform init``. Detect the un-initialised
# state and point the operator at the fix instead of surfacing terraform's
# opaque "Backend initialization required" error.
if [[ ! -d "${TF_DIR}/.terraform" || ! -f "${TF_DIR}/backend.hcl" ]]; then
  echo "❌ Terraform backend is not initialised in ${TF_DIR}."
  echo ""
  echo "   Run the one-shot bootstrap first:"
  echo "     ${TF_DIR}/bootstrap-backend.sh --region ${REGION}"
  echo ""
  echo "   That script creates the S3 state bucket + DynamoDB lock table"
  echo "   (idempotent) and configures the backend. After it succeeds,"
  echo "   re-run ./deploy.sh."
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  FinOps Deploy"
echo "  env    : $ENV"
echo "  region : $REGION"
echo "  tag    : $TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1 — Terraform apply targeted on ECR (repository must exist to push) ──
# image_tag is required by the variable's validation block, so we pass a
# placeholder tag here — targeted at ECR, no task-definition change happens
# on this pass (aws_ecr_repository is unaffected by image_tag).
echo "[1/7] Applying Terraform (ECR repository)..."
cd "$TF_DIR"
terraform apply \
  -var "env=${ENV}" \
  -var "aws_region=${REGION}" \
  -var "image_tag=${TAG}" \
  -target=aws_ecr_repository.app \
  -auto-approve

ECR_URL=$(terraform output -raw ecr_repository_url)
echo "  ECR  : $ECR_URL"

# ── Step 2 — Docker build ─────────────────────────────────────────────────────
echo "[2/7] Building Docker image (linux/amd64)..."
cd "$BACK_DIR"
docker build \
  --platform linux/amd64 \
  --tag "${ECR_URL}:${TAG}" \
  --tag "${ECR_URL}:latest" \
  .

# ── Step 3 — ECR login & push ─────────────────────────────────────────────────
echo "[3/7] Pushing image to ECR..."
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_URL"

docker push "${ECR_URL}:${TAG}"
docker push "${ECR_URL}:latest"

# ── Step 4 — Full Terraform apply with the new image tag ──────────────────────
echo "[4/7] Updating task definition (image_tag=$TAG)..."
cd "$TF_DIR"
terraform apply \
  -var "image_tag=${TAG}" \
  -var "env=${ENV}" \
  -var "aws_region=${REGION}" \
  -auto-approve

CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw ecs_service_name)
API_URL=$(terraform output -raw api_base_url)
TASK_FAMILY=$(terraform output -raw ecs_task_family 2>/dev/null || echo "${APP_NAME}-${ENV}-task")

echo "  ECS  : $CLUSTER / $SERVICE"
echo "  URL  : $API_URL"

# INFRA-016: capture the currently-running task-def BEFORE we point the
# service at the new one, so we have a target to roll back to.
PREV_TASK_DEF=$(aws ecs describe-services \
  --cluster "$CLUSTER" --services "$SERVICE" --region "$REGION" \
  --query 'services[0].taskDefinition' --output text)
echo "  prev task-def : $PREV_TASK_DEF"

# ── Step 5 — Force new ECS deployment ─────────────────────────────────────────
echo "[5/7] Triggering rolling deployment (task-def family: $TASK_FAMILY)..."
aws ecs update-service \
  --cluster "$CLUSTER" \
  --service "$SERVICE" \
  --task-definition "$TASK_FAMILY" \
  --force-new-deployment \
  --region "$REGION" \
  --output json | jq -r '.service.deployments[0] | "  deployment: \(.id)  status: \(.status)  task-def: \(.taskDefinition)"'

# ── Step 6 — Wait for stability ───────────────────────────────────────────────
echo "[6/7] Waiting for service to stabilise (up to 10 min)..."
aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region "$REGION"

# ── Step 7 — Post-deploy health check (with automatic rollback) ───────────────
# INFRA-016: services-stable only confirms ECS finished the rolling update; a
# container may still crash on the /health probe or serve 5xx. We hit /health
# directly through the ALB and roll back the task-def if it fails to come
# green within HEALTH_TIMEOUT_S.
HEALTH_URL="${API_URL%/}/health"
echo "[7/7] Probing $HEALTH_URL (timeout ${HEALTH_TIMEOUT_S}s)..."

deadline=$((SECONDS + HEALTH_TIMEOUT_S))
health_ok=0
while (( SECONDS < deadline )); do
  http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || echo "000")
  if [[ "$http_code" == "200" ]]; then
    health_ok=1
    break
  fi
  echo "  waiting… (got ${http_code})"
  sleep "$HEALTH_INTERVAL_S"
done

if (( health_ok == 0 )); then
  echo "❌ Health check failed after ${HEALTH_TIMEOUT_S}s — rolling back to ${PREV_TASK_DEF}"
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE" \
    --task-definition "$PREV_TASK_DEF" \
    --force-new-deployment \
    --region "$REGION" >/dev/null
  echo "   Rollback issued. Investigate CloudWatch logs before retrying:"
  echo "   aws logs tail /ecs/${APP_NAME}-${ENV} --region ${REGION} --since 15m"
  exit 1
fi

echo ""
echo "  ✅ Deployment stable and healthy!"
echo "  API base URL : $API_URL"
echo "  Health check : $HEALTH_URL"
echo "  Swagger docs : $API_URL/docs"
