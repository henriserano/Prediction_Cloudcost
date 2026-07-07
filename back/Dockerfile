# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Pin to a specific digest in prod to prevent supply-chain attacks:
#   docker pull python:3.11-slim
#   docker inspect python:3.11-slim --format '{{index .RepoDigests 0}}'
# Then replace the line below with:
#   FROM python:3.11-slim@sha256:<digest> AS builder
FROM python:3.11-slim AS builder

WORKDIR /app

# System deps required by scipy/statsmodels wheel builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir --prefix=/install -r requirements.txt
# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# See digest pinning note above — apply the same digest here in prod.
FROM python:3.11-slim

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy source code
COPY . .

# Non-root user for security
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

# Single worker required — _token_store and _injected_events are process-local
# (in-memory session state is not shared across processes).
# Scale horizontally via ECS desired_count instead of adding workers.
# NOTE: --no-access-log is intentionally absent: access logs are required for
# security monitoring (attack detection, audit trails, incident response).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", \
     "--workers", "1", "--log-level", "info"]
