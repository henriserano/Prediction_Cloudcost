# FinOps GCP · Analyse & prévision des coûts cloud

Plateforme d'analyse et de prévision des coûts multi-cloud (GCP + AWS) pour un compte de facturation GCP d'entreprise (données de démonstration). Ingère les exports de billing (BigQuery Export, Cost Explorer, CSV, Excel), exécute une pipeline statistique complète (EDA, décomposition STL, détection d'anomalies, benchmark de 6 modèles de prévision, diagnostics avancés) et expose les résultats via une API REST FastAPI consommée par un dashboard Next.js 16.

---

## Sommaire

1. [Architecture globale](#architecture-globale)
2. [Structure du dépôt](#structure-du-dépôt)
3. [Démarrage rapide](#démarrage-rapide)
4. [Déploiement AWS](#déploiement-aws)
5. [Données source](#données-source)
6. [Sécurité & conformité](#sécurité--conformité)
7. [Documentation détaillée](#documentation-détaillée)

---

## Architecture globale

```
┌────────────────────────────────────────────────────────────────────────┐
│                             Navigateur                                 │
│               Next.js 16 · React 19 · Tailwind CSS 4 · Recharts        │
│                                                                        │
│  /dashboard  /forecast  /services  /analytics                          │
│  /diagnostics  /data-sources  /gcp-connect                             │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │  TanStack Query 5 · axios (rewrites → API)
┌──────────────────────────▼─────────────────────────────────────────────┐
│                    FastAPI 0.115 · Python 3.11                          │
│                                                                        │
│  /health   /admin/cache/clear                                          │
│                                                                        │
│  Analytics (9)          Forecast (4)         Advanced (7)              │
│  /api/kpi               /api/forecast        /api/analysis/outliers    │
│  /api/daily             /forecast/summary    /analysis/drift           │
│  /api/services          /forecast/models     /analysis/distribution    │
│  /api/anomalies         /forecast/models/list /analysis/scaling        │
│  /api/stats                                  /analysis/missing         │
│  /api/stationarity      GCP OAuth (10)       /analysis/dim-reduction   │
│  /api/stl               /api/gcp/auth        /analysis/ensemble        │
│  /api/stl/strengths     /gcp/callback                                  │
│  /api/acf               /gcp/status          Ingest (3)                │
│                         /gcp/logout          /api/events               │
│  AWS (3)                /gcp/projects        /api/events/upload        │
│  /api/aws/status        /gcp/billing         /api/events/preview       │
│  /api/aws/billing       /gcp/sync                                      │
│  /api/aws/services      /gcp/logs            Data status (1)           │
│                         /gcp/services        /api/data/status          │
│                         /gcp/billing-accounts                          │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │  in-memory AppCache (thread-safe, TTL)
                           │  ▲ pré-chauffé au démarrage via warm_cache()
┌──────────────────────────▼─────────────────────────────────────────────┐
│         Résolution données (ordre de priorité)                         │
│                                                                        │
│  1. Événements injectés   (POST /api/events ou /api/gcp/sync)          │
│  2. Parquet démo bundlé   (si DATA_ALLOW_PARQUET_FALLBACK=true)        │
│  3. Vide                  (le frontend affiche "sync your data")       │
│                                                                        │
│  ↳ La source retenue est exposée via /api/data/status                  │
└────────────────────────────────────────────────────────────────────────┘
```

**Stack**

| Couche | Technologies |
|---|---|
| Backend | Python 3.11, FastAPI 0.115, Uvicorn, Pydantic v2, pandas, statsmodels, scikit-learn |
| Intégrations cloud | google-auth + google-api-python-client (GCP), boto3 (AWS Cost Explorer, STS) |
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, Recharts 2, TanStack Query 5, axios, Zod |
| Infra | AWS ECS Fargate + FARGATE_SPOT · ALB · ECR · VPC (2 AZ, subnets publics uniquement — pas de NAT, trade-off coût documenté INFRA-001) · CloudWatch · Terraform ≥ 1.6 |
| CI | GitHub Actions (frontend build+lint, docker smoke test, weekly pip-audit + bandit + semgrep) |

---

## Structure du dépôt

```
Facturation_prediction/
│
├── back/                         # API FastAPI + pipeline analytique et forecast
│   ├── main.py                   # Entry point : lifespan, middleware, routers
│   ├── Dockerfile                # Multi-stage python:3.11-slim
│   ├── pytest.ini
│   ├── requirements.txt
│   ├── core/
│   │   ├── config.py             # Pydantic Settings (env, CORS, OAuth, frontend URL)
│   │   ├── errors.py             # Hiérarchie AppError → HTTP codes structurés
│   │   ├── logging.py            # JSON logs + request-id ContextVar
│   │   ├── cache.py              # AppCache thread-safe (get/set/invalidate/TTL/stats)
│   │   └── precompute.py         # warm_cache() : precompute concurrent au démarrage
│   ├── data/
│   │   ├── loader.py             # @lru_cache : events → parquet → empty
│   │   ├── daily_costs.parquet
│   │   └── daily_per_service.parquet
│   ├── analysis/
│   │   ├── timeseries.py         # série journalière, STL, ADF/KPSS, anomalies, ACF/PACF
│   │   ├── services.py           # Pareto services, KPI globaux
│   │   └── advanced.py           # outliers multi-méthodes, drift, PCA, ensemble, etc.
│   ├── forecast/
│   │   └── engine.py             # 6 modèles + walk-forward CV + IC gaussien
│   ├── routes/
│   │   ├── routes_health.py      # /health, /admin/cache/clear
│   │   ├── routes_analytics.py   # /api/{kpi,daily,services,anomalies,stats,stationarity,stl,stl/strengths,acf}
│   │   ├── routes_forecast.py    # /api/forecast{,/summary,/models,/models/list}
│   │   ├── routes_advanced.py    # /api/analysis/{outliers,drift,distribution,scaling,missing,dim-reduction,ensemble-forecast}
│   │   ├── routes_gcp.py         # OAuth2 Google + Cloud Billing + Logging + Service Usage + BigQuery Export
│   │   ├── routes_aws.py         # STS + Cost Explorer
│   │   ├── routes_events.py      # ingest JSON / upload CSV/Excel / preview
│   │   └── routes_data.py        # /api/data/status (provenance données)
│   ├── schemas/                  # analytics · forecast · gcp · aws · advanced (Pydantic v2)
│   └── tests/                    # smoke tests (ASGI transport) + calculations
│
├── front_finops/                 # Dashboard Next.js 16 (App Router)
│   ├── app/
│   │   ├── dashboard/            # KPIs, tendance, services, anomalies
│   │   ├── forecast/             # Prévision + benchmark 6 modèles
│   │   ├── services/             # Pareto 80/20, dual-source local/GCP
│   │   ├── analytics/            # STL, stats, stationnarité, ACF
│   │   ├── diagnostics/          # 7 onglets ML/stats avancés
│   │   ├── data-sources/         # Upload CSV/Excel + connect GCP + AWS
│   │   └── gcp-connect/          # OAuth GCP, projets, billing, logs, services
│   ├── components/               # Sidebar, PageShell, KPI/Section cards, Badge, Explain, etc.
│   └── lib/
│       ├── types.ts              # Interfaces = contrat API (camelCase)
│       ├── api.ts                # axios + intercepteur snake_case → camelCase
│       ├── mockData.ts           # (obsolète, plus utilisé — voir doc frontend)
│       ├── hooks/useApi.ts       # 31 hooks TanStack Query
│       ├── hooks/useSelectedGCPProject.ts  # localStorage-backed via useSyncExternalStore
│       ├── parsers/billing-file.ts  # parse CSV/Excel bilingue (aliases fuzzy)
│       └── context/sidebar-context.tsx
│
├── terraform/                    # Infra AWS as code (ECS Fargate + ALB + ECR + VPC)
│   ├── main.tf variables.tf locals.tf outputs.tf
│   ├── vpc.tf security_groups.tf ecr.tf iam.tf alb.tf ecs.tf
│   ├── cloudwatch.tf autoscaling.tf
│   ├── terraform.tfvars.example  # committer celui-ci, PAS terraform.tfvars
│   └── README.md                 # doc infra détaillée
│
├── Timeseries.ipynb              # Notebook EDA (source de vérité analytique)
├── Benchmark_Forecasting.ipynb   # Notebook benchmark des modèles
├── deploy.sh                     # Build → push ECR → apply → force-new-deployment
├── .github/workflows/            # ci.yml (lint/build/docker) + security.yml (pip-audit, bandit, semgrep)
└── README.md
```

---

## Démarrage rapide

### Prérequis

- Python 3.11+ · Node.js 20+ · npm 10+
- Docker (pour builds locaux) · AWS CLI v2 · Terraform ≥ 1.6 (pour infra)
- Optionnel : `gcloud` CLI si vous souhaitez tester l'ingestion BigQuery Export

### Backend

```bash
cd back
pip install -r requirements.txt
cp .env.example .env       # si présent — sinon copier depuis back/README.md
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

| URL | Description |
|---|---|
| `http://localhost:8080/health` | Health check + statistiques cache |
| `http://localhost:8080/docs` | Swagger UI (désactivé en `ENV=prod`) |
| `http://localhost:8080/redoc` | ReDoc |
| `http://localhost:8080/api/data/status` | Provenance des données actuellement servies |

> **Important** : lancer avec `--workers 1` en production. Le state OAuth (`_oauth_states`) et le token store (`_token_store`) sont en mémoire process. Multi-worker → CSRF failures aléatoires. Voir `back/README.md` § OAuth2.

### Frontend

```bash
cd front_finops
npm install
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

Le rewrite `/api/:path*` dans `next.config.js` proxifie automatiquement vers `NEXT_PUBLIC_API_URL`. Si la variable n'est pas définie en dev, un fallback pointe vers `http://localhost:8080`.

> **Rappel Next.js 16** : cette version a des breaking changes vs Next.js 15. Consulter `front_finops/AGENTS.md` et `front_finops/node_modules/next/dist/docs/` avant modification.

### Tests

```bash
cd back && pytest                  # 26 tests (smoke + calculations)
cd front_finops && npm run lint    # ESLint 9 flat config
cd front_finops && npx tsc --noEmit # type check strict
```

---

## Déploiement AWS

### Première fois (infra)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Éditer terraform.tfvars — ne PAS committer les secrets (voir terraform/README.md)
export TF_VAR_google_client_secret="…"    # préférer TF_VAR à un fichier committé
terraform init
terraform apply
```

### Déploiements suivants (code)

```bash
./deploy.sh --env dev --region eu-west-1 [--tag v1.2.3]
```

Séquence (6 étapes, voir `deploy.sh`) :
1. `terraform apply` ciblé sur ECR (le repository doit exister avant le push)
2. `docker build --platform linux/amd64 -t <ecr>:<tag>` depuis `back/`
3. `docker push` (tag = git SHA + `latest`)
4. `terraform apply` complet avec `-var image_tag=<sha>` (les outputs ECS/ALB sont lus après cette étape — le script fonctionne donc aussi sur une infra vierge)
5. `aws ecs update-service --force-new-deployment`
6. `aws ecs wait services-stable`

> Pas de VPC endpoints : les tâches ECS tournent en subnets publics avec IP publique (trade-off coût documenté INFRA-001) et atteignent ECR/CloudWatch via l'Internet Gateway.

---

## Données source

Trois sources de données possibles, résolues dans cet ordre par `back/data/loader.py` :

| Priorité | Source | Déclencheur | `source` renvoyé |
|---|---|---|---|
| 1 | Événements injectés en mémoire | `POST /api/events` · `POST /api/events/upload` · `POST /api/gcp/sync` | `events` |
| 2 | Parquet démo bundlé dans `back/data/` | `DATA_ALLOW_PARQUET_FALLBACK=true` (défaut) | `parquet_fallback` |
| 3 | Vide (aucune donnée) | Sinon | `empty` |

Les parquets bundlés contiennent des **données synthétiques de démonstration** (aucune donnée client réelle) couvrant **2026-01-05 → 2026-06-23** (170 jours) au format export GCP Billing, sur 9 services : BigQuery, Cloud Run, Cloud SQL, Cloud Spanner, Vertex AI, Invoice, et divers Claude models. Utiles pour démo/dev sans devoir se connecter à GCP.

L'ingestion supporte :
- **CSV** (encodage auto : utf-8, cp1252, latin-1)
- **Excel** (`.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.ods`) — scan multi-sheet
- **Alias colonnes multilingues** : `Date` / `Mois` / `Usage Start Date` / `ds`, `Service` / `Description du service`, `Cost` / `Sous-total (€)` / `Coût`
- **Nombres locale EU** : `1 234,56` → `1234.56`
- **Dates** : `YYYY-MM-DD` ou `YYYY-MM` (→ premier du mois)

Caps de sécurité : 100 000 lignes en mémoire, 10 MB par fichier. Voir `back/README.md` § Ingestion.

---

## Sécurité & conformité

- **Middleware backend** : X-Content-Type-Options, X-Frame-Options DENY, X-XSS-Protection, Referrer-Policy strict-origin, Permissions-Policy caméra/micro/géoloc off, HSTS en prod (2 ans).
- **`/docs` et `/redoc` désactivés** en `ENV=prod`.
- **CORS wildcard** : warning loggé au démarrage si `CORS_ORIGINS=*` avec `ENV=prod` — à configurer explicitement.
- **OAuth2 GCP** : state TTL 600 s, whitelist des codes d'erreur avant log, validation projet_id/severity avant interpolation dans les filtres API.
- **Ingestion événements** : validation Pydantic (cost ∈ [0, 1M€], date YYYY-MM-DD), défense en profondeur re-validée en route.
- **CI weekly** : `pip-audit`, `npm audit --audit-level=high`, `bandit` (bloquant, config `bandit.yaml`), `semgrep p/python p/security-audit` (bloquant).
- **API_KEY backend** : les endpoints mutateurs (`POST /api/events`, `/api/events/upload`, `/api/aws/connect`, `/admin/cache/clear`) sont protégés par une clé API — obligatoire en `ENV=prod`. Voir `back/README.md` (backend) et `front_finops/README.md` (`BACKEND_API_KEY` sur Vercel).

**Gestion des secrets (Sia policy)** :
- `terraform.tfvars` ne doit **jamais** être committé s'il contient des secrets. Utiliser des variables d'environnement `TF_VAR_*` ou AWS Secrets Manager.
- Si un secret a été committé, considérer-le compromis : rotation immédiate.
- Les credentials clients ne doivent apparaître dans aucun artefact partageable.

---

## Documentation détaillée

| Doc | Contenu |
|---|---|
| **[`back/README.md`](back/README.md)** | Référence complète de l'API (35+ endpoints), pipeline statistique, moteur de forecast, cache layering, OAuth2, ingestion, schémas Pydantic, config, Docker |
| **[`front_finops/README.md`](front_finops/README.md)** | 7 pages, 31 hooks TanStack Query, composants UI Sia, parseur CSV/Excel, dual-source local/GCP, intégration API |
| **[`terraform/README.md`](terraform/README.md)** | Infra AWS ECS Fargate + ALB + ECR + VPC, IAM roles, sécurité réseau, monitoring, `deploy.sh` step-by-step, gaps connus |
| **[`CLAUDE.md`](CLAUDE.md)** | Guide pour l'agent IA — architecture cache, invariants, gotchas non évidents |
| **[`Timeseries.ipynb`](Timeseries.ipynb)** | Notebook EDA — source de vérité analytique |
| **[`Benchmark_Forecasting.ipynb`](Benchmark_Forecasting.ipynb)** | Notebook benchmark des 6 modèles |
