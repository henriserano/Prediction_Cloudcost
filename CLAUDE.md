# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

FinOps platform for GCP cloud cost analysis and forecasting. It ingests billing CSV/Excel exports, runs a statistical pipeline (EDA, STL decomposition, anomaly detection, model benchmark) and exposes results through a FastAPI REST API consumed by a Next.js dashboard. The bundled parquet files contain **synthetic demo data** (generated, not client data).

## Repository layout

| Path | Description |
|---|---|
| `back/` | FastAPI API (Python 3.11): `main.py`, `core/` (config, errors, logging, cache, precompute), `data/loader.py` + parquet demo data, `analysis/` (timeseries, services, advanced), `forecast/engine.py` (6 models + walk-forward CV), `routes/`, `schemas/`, `tests/` |
| `front_finops/` | Next.js 16 / React 19 / TypeScript / Tailwind 4 dashboard. Data layer: TanStack Query hooks in `lib/hooks/useApi.ts`, types in `lib/types.ts` (mirror of the Pydantic schemas) |
| `terraform/` | AWS infra (ECS Fargate + ALB + ECR + CloudWatch), one file per concern |
| `.github/workflows/` | CI (back pytest, front tsc/lint/build, Docker smoke) + security scans (pip-audit, npm audit, bandit, semgrep) |
| `deploy.sh` | One-shot AWS deploy: docker build → ECR push → terraform apply → ECS rolling update |
| `Timeseries.ipynb`, `Benchmark_Forecasting.ipynb` | Original EDA / model benchmark notebooks (outputs stripped) |

## Commands

```bash
# Backend (from back/)
uvicorn main:app --port 8080 --reload    # dev server → /docs for Swagger
python -m pytest                          # tests

# Frontend (from front_finops/)
npm run dev                               # http://localhost:3000
npx tsc --noEmit && npm run lint && npm run build

# Infra (from terraform/)
terraform init -backend=false && terraform validate
```

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `API_KEY` | backend | Required in `ENV=prod`. Protects mutating endpoints (`POST /api/events*`, `POST /api/aws/connect`, `POST /admin/cache/clear`) via `X-API-Key` header |
| `BACKEND_API_KEY` | front (server-side, never `NEXT_PUBLIC`) | Injected by the Next.js proxy route handlers into `X-API-Key` |
| `NEXT_PUBLIC_API_URL` | front | Backend base URL used by the rewrites/proxy |
| `ENV` | backend | `dev` / `test` / `prod`. Prod fails fast on wildcard CORS or missing `API_KEY` |

## Conventions

- Security fixes are tagged with `SEC-00x` comments, infra trade-offs with `INFRA-00x`.
- Backend responses are Pydantic schemas (`back/schemas/`); the front mirrors them in `lib/types.ts` — keep both in sync.
- GCP OAuth tokens are session-bound via an httpOnly `sid` cookie; never store tokens under a shared key.
- The snake_case→camelCase response transformer in `front_finops/lib/api.ts` must NOT recurse into data-keyed `Record<string, …>` fields (service names, GCP labels, model weights).
- Data files: only synthetic parquets are committed. Real billing exports (`*.csv` at repo root) stay untracked — never commit client data.
