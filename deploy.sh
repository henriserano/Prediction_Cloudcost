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
BACK_DIR="$(cd "$(dirname "$0")/back" && pwd)"
TF_DIR="$(cd "$(dirname "$0")/terraform" && pwd)"
HEALTH_TIMEOUT_S=180
HEALTH_INTERVAL_S=5
DEPLOY_TIMEOUT_S=900   # App Runner deployments typically settle in 3-6 min

# ── Argument parsing ──────────────────────────────────────────────────────────
YES=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)     ENV="$2";    shift 2 ;;
    --region)  REGION="$2"; shift 2 ;;
    --tag)     TAG="$2";    shift 2 ;;
    --yes|-y)  YES=1;       shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Preflight ─────────────────────────────────────────────────────────────────
fail() { echo "❌ $*" >&2; exit 1; }

# SEC-030 (I-H2): a mistyped ``--env prod`` used to fire two auto-approved
# terraform applies against production. Require an explicit confirmation
# (CONFIRM_PROD=1, --yes/-y, or interactive "yes") before any prod work.
if [[ "$ENV" == "prod" ]]; then
  if [[ "${CONFIRM_PROD:-0}" != "1" && "$YES" != "1" ]]; then
    if [[ -t 0 ]]; then
      printf '⚠️  You are about to deploy to PRODUCTION (env=%s, region=%s, tag=%s).\n' "$ENV" "$REGION" "$TAG"
      printf '    Two `terraform apply -auto-approve` runs will follow.\n'
      read -r -p '    Type "yes" to continue: ' _confirm
      if [[ "$_confirm" != "yes" ]]; then
        echo "Aborted — no changes made."
        exit 1
      fi
    else
      fail "Refusing prod deploy in non-interactive mode without CONFIRM_PROD=1 or --yes."
    fi
  fi
fi

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
ECR_REPO_NAME=$(echo "$ECR_URL" | sed 's#.*/##')
echo "  ECR  : $ECR_URL"

# ── Step 2 — Docker build ─────────────────────────────────────────────────────
# SEC-034: only the immutable per-SHA tag is built + pushed. The old
# ``:latest`` alias is dropped so ECR is now the source of truth for exactly
# which image ran when. The service pins the SHA via variables.tf anyway.
#
# Idempotency: if the tag already exists in ECR (e.g. the previous run got
# past push but failed at App Runner update), skip the build+push entirely.
# With IMMUTABLE tags, re-pushing would be either a no-op (identical digest)
# or a 400 rejection — either way there's nothing to gain by rebuilding.
echo "[2/7] Building Docker image (linux/amd64)..."
if aws ecr describe-images \
    --repository-name "$ECR_REPO_NAME" \
    --image-ids "imageTag=${TAG}" \
    --region "$REGION" >/dev/null 2>&1; then
  echo "  image ${TAG} already exists in ECR — skipping build & push."
  SKIP_BUILD_PUSH=1
else
  SKIP_BUILD_PUSH=0
fi

# ── Step 3 — ECR login & push ─────────────────────────────────────────────────
# INFRA-017: build + push are fused into a single ``docker buildx build --push``
# call so BuildKit streams layers straight to ECR without materialising the
# OCI manifest list locally. ``--provenance=false --sbom=false`` strips
# BuildKit's default attestation sub-manifests — with them attached, ECR
# rejects the final tag PUT under IMMUTABLE mode with a 400 (layers push OK,
# the manifest list commit fails). Together, these two changes give us a
# plain single-arch image manifest that ECR IMMUTABLE accepts.
if (( SKIP_BUILD_PUSH == 0 )); then
  echo "[3/7] Building and pushing image to ECR..."
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "$ECR_URL"

  cd "$BACK_DIR"
  docker buildx build \
    --platform linux/amd64 \
    --provenance=false \
    --sbom=false \
    --tag "${ECR_URL}:${TAG}" \
    --push \
    .
else
  echo "[3/7] Skipping ECR push (image already present)."
fi

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
UPDATE_JSON=$(aws apprunner update-service \
  --service-arn "$SERVICE_ARN" \
  --region "$REGION" \
  --source-configuration "ImageRepository={ImageIdentifier=${ECR_URL}:${TAG},ImageRepositoryType=ECR,ImageConfiguration={Port=8080}}" \
  --output json)

OPERATION_ID=$(echo "$UPDATE_JSON" | jq -r '.OperationId // empty')

# update-service only triggers a deployment when source-configuration actually
# changed. If the tag is identical to what's already running, we need an
# explicit start-deployment — but only once the service is back in RUNNING.
if [[ -z "$OPERATION_ID" ]]; then
  echo "  update-service was a no-op — issuing explicit start-deployment"
  while [[ $(aws apprunner describe-service --service-arn "$SERVICE_ARN" --region "$REGION" --query 'Service.Status' --output text) != "RUNNING" ]]; do
    sleep 10
  done
  OPERATION_ID=$(aws apprunner start-deployment \
    --service-arn "$SERVICE_ARN" --region "$REGION" \
    --query 'OperationId' --output text)
fi
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
