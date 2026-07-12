#!/usr/bin/env bash
# deploy.sh — Build, push to ECR and trigger an App Runner deployment
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
#   The script waits for the App Runner deployment to reach RUNNING, then
#   probes /health on the public service URL. On failure the previous image
#   tag is redeployed automatically via `apprunner update-service`.
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
DEPLOY_TIMEOUT_S=900   # App Runner deployments typically settle in 3-6 min

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
echo "  FinOps Deploy (App Runner)"
echo "  env    : $ENV"
echo "  region : $REGION"
echo "  tag    : $TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1 — Terraform apply targeted on ECR (repo must exist to push) ────────
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

# ── Step 4 — Full Terraform apply (ensures service exists, envvars up to date) ─
echo "[4/7] Applying Terraform (App Runner service, envvars, IAM)..."
cd "$TF_DIR"
terraform apply \
  -var "image_tag=${TAG}" \
  -var "env=${ENV}" \
  -var "aws_region=${REGION}" \
  -auto-approve

SERVICE_ARN=$(terraform output -raw apprunner_service_arn)
SERVICE_NAME=$(terraform output -raw apprunner_service_name)
API_URL=$(terraform output -raw api_base_url)

echo "  service : $SERVICE_NAME"
echo "  URL     : $API_URL"

# INFRA-016: capture the current image identifier BEFORE we redeploy, so we
# have a rollback target if the new image fails its health probe.
PREV_IMAGE=$(aws apprunner describe-service \
  --service-arn "$SERVICE_ARN" --region "$REGION" \
  --query 'Service.SourceConfiguration.ImageRepository.ImageIdentifier' \
  --output text)
echo "  prev image : $PREV_IMAGE"

# ── Step 5 — Point the service at the new image tag & start deployment ────────
# Terraform ignores image_identifier drift (see apprunner.tf lifecycle block),
# so we mutate the service directly via the API.
echo "[5/7] Updating service image and triggering deployment..."
aws apprunner update-service \
  --service-arn "$SERVICE_ARN" \
  --region "$REGION" \
  --source-configuration "ImageRepository={ImageIdentifier=${ECR_URL}:${TAG},ImageRepositoryType=ECR,ImageConfiguration={Port=8080}}" \
  --output json >/dev/null

OPERATION_ID=$(aws apprunner start-deployment \
  --service-arn "$SERVICE_ARN" \
  --region "$REGION" \
  --query 'OperationId' --output text)
echo "  deployment operation : $OPERATION_ID"

# ── Step 6 — Wait for the App Runner service to reach RUNNING ─────────────────
echo "[6/7] Waiting for service to stabilise (up to $((DEPLOY_TIMEOUT_S / 60)) min)..."
deploy_deadline=$((SECONDS + DEPLOY_TIMEOUT_S))
while (( SECONDS < deploy_deadline )); do
  STATUS=$(aws apprunner describe-service \
    --service-arn "$SERVICE_ARN" --region "$REGION" \
    --query 'Service.Status' --output text)
  case "$STATUS" in
    RUNNING)             echo "  status: RUNNING"; break ;;
    OPERATION_IN_PROGRESS) echo "  status: OPERATION_IN_PROGRESS…"; sleep 15 ;;
    CREATE_FAILED|DELETE_FAILED|PAUSED)
                         fail "App Runner service in unrecoverable state: $STATUS" ;;
    *)                   echo "  status: $STATUS"; sleep 15 ;;
  esac
done

FINAL_STATUS=$(aws apprunner describe-service \
  --service-arn "$SERVICE_ARN" --region "$REGION" \
  --query 'Service.Status' --output text)
if [[ "$FINAL_STATUS" != "RUNNING" ]]; then
  fail "App Runner service did not reach RUNNING within ${DEPLOY_TIMEOUT_S}s (last: $FINAL_STATUS)"
fi

# ── Step 7 — Post-deploy health check (with automatic rollback) ───────────────
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
  echo "❌ Health check failed after ${HEALTH_TIMEOUT_S}s — rolling back to ${PREV_IMAGE}"
  aws apprunner update-service \
    --service-arn "$SERVICE_ARN" \
    --region "$REGION" \
    --source-configuration "ImageRepository={ImageIdentifier=${PREV_IMAGE},ImageRepositoryType=ECR,ImageConfiguration={Port=8080}}" \
    --output json >/dev/null
  aws apprunner start-deployment \
    --service-arn "$SERVICE_ARN" --region "$REGION" >/dev/null
  echo "   Rollback issued. Investigate App Runner logs before retrying:"
  echo "   aws logs tail /aws/apprunner/${SERVICE_NAME} --region ${REGION} --since 15m --follow"
  exit 1
fi

echo ""
echo "  ✅ Deployment stable and healthy!"
echo "  API base URL : $API_URL"
echo "  Health check : $HEALTH_URL"
echo "  Swagger docs : $API_URL/docs"
