# FinOps GCP — Analyse & Prévision des Coûts Cloud

Plateforme d'analyse et de prévision des coûts GCP de demo. Le système ingère des exports CSV de billing, exécute une pipeline statistique complète (EDA, décomposition STL, détection d'anomalies, benchmark de 6 modèles de prévision) et expose les résultats via une API REST consommée par un dashboard interactif Next.js.

---

## Architecture globale

```
┌────────────────────────────────────────────────────────────┐
│                        Navigateur                          │
│         Next.js 16 · Tailwind CSS · Recharts               │
│   /dashboard   /forecast   /services   /analytics          │
└───────────────────────┬────────────────────────────────────┘
                        │  HTTP/JSON
┌───────────────────────▼────────────────────────────────────┐
│                 FastAPI · Python 3.11                       │
│                                                            │
│  GET /api/kpi              GET /api/daily                  │
│  GET /api/services         GET /api/anomalies              │
│  GET /api/stats            GET /api/stl[/strengths]        │
│  GET /api/stationarity     GET /api/acf                    │
│  GET /api/forecast/        GET /api/forecast/summary       │
│  GET /api/forecast/models  GET /api/forecast/models/list   │
└───────────────────────┬────────────────────────────────────┘
                        │  pandas · statsmodels · scipy
┌───────────────────────▼────────────────────────────────────┐
│              Données Parquet  (back/data/)                  │
│  daily_costs.parquet          170 jours  ·  ds + y         │
│  daily_per_service.parquet    170 jours  ·  ds + 9 svc     │
└────────────────────────────────────────────────────────────┘
```

**Stack**

| Couche | Technologies |
|---|---|
| Backend | Python 3.11, FastAPI 0.115, Uvicorn, Pydantic v2 |
| Analyse | pandas, numpy, scipy, statsmodels, scikit-learn |
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 |
| Visualisation | Recharts 2 |
| Infrastructure | AWS ECS Fargate · ALB · ECR · VPC · CloudWatch (Terraform ≥ 1.6) |

---

## Structure du dépôt

```
Prediction_Cloudcost/
│
├── back/                        # API FastAPI + pipeline analytique
│   ├── main.py                  # Entry point : app, middleware, routers
│   ├── Dockerfile               # Multi-stage python:3.11-slim
│   ├── requirements.txt
│   ├── core/
│   │   ├── config.py            # Pydantic Settings (env, port, CORS)
│   │   ├── errors.py            # Hiérarchie AppError → HTTP codes
│   │   └── logging.py           # JSON logs + request-id ContextVar
│   ├── data/
│   │   ├── loader.py            # LRU cache sur les 2 parquets
│   │   ├── daily_costs.parquet
│   │   └── daily_per_service.parquet
│   ├── analysis/
│   │   ├── timeseries.py        # daily series, STL, ADF/KPSS, anomalies, ACF/PACF
│   │   └── services.py          # Pareto services, KPI aggregates
│   ├── forecast/
│   │   └── engine.py            # 6 modèles + walk-forward CV + intervalles de confiance
│   ├── routes/
│   │   ├── routes_health.py     # GET /health
│   │   ├── routes_analytics.py  # 9 endpoints analytique
│   │   └── routes_forecast.py   # 4 endpoints forecast
│   └── schemas/
│       ├── analytics.py         # Pydantic models analytics
│       └── forecast.py          # Pydantic models forecast
│
├── front_finops/                # Dashboard Next.js
│   ├── app/
│   │   ├── dashboard/page.tsx   # KPIs, tendance, services, anomalies
│   │   ├── forecast/page.tsx    # Prévision + benchmark modèles
│   │   ├── services/page.tsx    # Pareto 80/20 + tableau CV
│   │   └── analytics/page.tsx   # STL, stats desc., tests stationnarité
│   ├── components/
│   │   ├── layout/Sidebar.tsx   # Navigation 4 pages
│   │   ├── layout/PageShell.tsx # Wrapper titre + contenu
│   │   └── ui/                  # Card, Button, Input, Dialog (shadcn)
│   └── lib/
│       ├── types.ts             # Interfaces TypeScript (contrat API)
│       └── mockData.ts          # Données déterministes (dev sans API)
│
├── terraform/                   # Infrastructure AWS as Code
│   ├── main.tf                  # Provider + backend S3 (commenté)
│   ├── variables.tf             # Région, env, CPU, mémoire, HTTPS…
│   ├── locals.tf                # Préfixes, CIDRs, AZ dynamiques
│   ├── vpc.tf                   # VPC + subnets pub/priv + NAT + routes
│   ├── security_groups.tf       # SG ALB (internet→80/443) + SG ECS
│   ├── ecr.tf                   # ECR + lifecycle policy (10 images)
│   ├── iam.tf                   # Execution role + task role + CI/CD policy
│   ├── alb.tf                   # ALB + target group + listeners HTTP/HTTPS
│   ├── ecs.tf                   # Cluster + task definition + service
│   ├── cloudwatch.tf            # Log group + 4 alarmes métriques
│   ├── autoscaling.tf           # Auto-scaling ECS (CPU 60%, mémoire 70%)
│   ├── outputs.tf               # URLs, noms de ressources
│   └── terraform.tfvars.example
│
├── Timeseries.ipynb             # Notebook EDA — source de vérité analytique
├── Benchmark_Forecasting.ipynb  # Notebook benchmark des 6 modèles
├── deploy.sh                    # Script déploiement AWS one-shot
└── README.md
```

---

## Démarrage rapide (local)

### Prérequis

- Python 3.11+
- Node.js 20+ / npm 10+
- Packages Python : `pip install -r back/requirements.txt`
- Packages Node : `cd front_finops && npm install`

### Backend

```bash
cd back
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

| URL | Description |
|---|---|
| `http://localhost:8080/health` | Health check |
| `http://localhost:8080/docs` | Swagger UI interactif |
| `http://localhost:8080/redoc` | ReDoc |
| `http://localhost:8080/api/kpi` | Exemple d'endpoint |

### Frontend

```bash
cd front_finops
npm run dev
# → http://localhost:3000  (redirige automatiquement vers /dashboard)
```

### Connecter le front à l'API

Créer `front_finops/.env.local` :

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

Puis remplacer les imports `mockData` par des appels TanStack Query / axios (déjà installés). Les types TypeScript dans `lib/types.ts` correspondent exactement aux schémas Pydantic de l'API.

---

## Déploiement AWS

### Première fois (infra)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Éditer la région, l'env, etc.
terraform init
terraform apply
```

### Déploiements suivants (code)

```bash
./deploy.sh --env dev --region eu-west-1 [--tag v1.2.3]
```

Le script :
1. Lit les outputs Terraform (ECR URL, cluster, service)
2. Build l'image Docker `linux/amd64`
3. Push vers ECR avec le tag git + `latest`
4. Lance `terraform apply -var image_tag=...`
5. Force un rolling deployment ECS

---

## Données source

Exports CSV billing GCP — compte demo — période **2026-01-05 → 2026-06-23** (170 jours).

| Parquet | Lignes | Colonnes clés |
|---|---|---|
| `daily_costs.parquet` | 170 | `ds` (date), `y` (€ total/jour) |
| `daily_per_service.parquet` | 170 | `ds` + 9 services GCP |

Services analysés : BigQuery · Claude Opus 4.5 · Claude Sonnet 4.5 · Claude Sonnet 4.6 · Cloud Run · Cloud SQL · Cloud Spanner · Invoice · Vertex AI.

---

## Documentation détaillée

- **[Backend → `back/README.md`](back/README.md)** — référence complète de l'API, pipeline statistique, modèles de prévision, configuration, déploiement Docker
- **[Frontend → `front_finops/README.md`](front_finops/README.md)** — architecture des pages, composants, contrat API/types, guide d'intégration
