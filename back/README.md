# Backend · FinOps GCP API

API REST FastAPI exposant l'ensemble de la pipeline analytique, du moteur de prévision, des intégrations GCP OAuth2 + AWS Cost Explorer, et de l'ingestion CSV/Excel. Toutes les données sont mises en cache in-process (thread-safe `AppCache` + `@lru_cache` sur le loader) et pré-calculées au démarrage.

---

## Sommaire

1. [Structure du module](#structure-du-module)
2. [Installation](#installation)
3. [Lancement](#lancement)
4. [Configuration (variables d'environnement)](#configuration-variables-denvironnement)
5. [Architecture — cache & résolution des données](#architecture--cache--résolution-des-données)
6. [Référence API](#référence-api)
    - [Health & admin](#health--admin)
    - [Analytics](#analytics)
    - [Forecast](#forecast)
    - [Advanced analysis](#advanced-analysis)
    - [GCP (OAuth2 + Cloud Billing + Logging + Service Usage)](#gcp)
    - [AWS (STS + Cost Explorer)](#aws)
    - [Ingestion événements](#ingestion-événements)
    - [Data status](#data-status)
7. [Pipeline analytique](#pipeline-analytique)
8. [Moteur de prévision](#moteur-de-prévision)
9. [OAuth2 Google — flux détaillé](#oauth2-google--flux-détaillé)
10. [Ingestion CSV / Excel](#ingestion-csv--excel)
11. [Schémas Pydantic](#schémas-pydantic)
12. [Sécurité](#sécurité)
13. [Logs & observabilité](#logs--observabilité)
14. [Docker](#docker)
15. [Tests](#tests)
16. [Gestion des erreurs](#gestion-des-erreurs)

---

## Structure du module

```
back/
├── main.py                      # FastAPI app : lifespan, middlewares, routers
├── Dockerfile                   # Multi-stage python:3.11-slim
├── requirements.txt
├── pytest.ini                   # asyncio_mode = auto ; testpaths = tests
│
├── core/
│   ├── config.py                # Pydantic Settings (env, CORS, OAuth, frontend URL)
│   ├── errors.py                # Hiérarchie AppError → JSON structuré
│   ├── logging.py               # JSON formatter + ContextVar request_id
│   ├── cache.py                 # AppCache thread-safe (RLock, TTL, hit/miss stats)
│   └── precompute.py            # warm_cache() : ThreadPoolExecutor(4) au démarrage
│
├── data/
│   ├── loader.py                # @lru_cache : events → parquet → empty
│   ├── daily_costs.parquet      # 170 jours × [ds, y]
│   └── daily_per_service.parquet # 170 jours × [ds + 9 services]
│
├── analysis/
│   ├── timeseries.py            # MA7, CI95%, STL, ADF/KPSS, anomalies, ACF/PACF
│   ├── services.py              # Pareto services, KPI globaux
│   └── advanced.py              # outliers multi-méthodes, drift, PCA, ensemble
│
├── forecast/
│   └── engine.py                # 6 modèles + walk-forward CV + IC gaussien
│
├── routes/
│   ├── routes_health.py         # /health + /admin/cache/clear
│   ├── routes_analytics.py      # 9 endpoints sous /api
│   ├── routes_forecast.py       # 4 endpoints sous /api/forecast
│   ├── routes_advanced.py       # 7 endpoints sous /api/analysis
│   ├── routes_gcp.py            # 10 endpoints sous /api/gcp (OAuth + APIs)
│   ├── routes_aws.py            # 3 endpoints sous /api/aws (STS + Cost Explorer)
│   ├── routes_events.py         # 3 endpoints sous /api (ingest / upload / preview)
│   └── routes_data.py           # /api/data/status (provenance)
│
└── schemas/
    ├── analytics.py             # DailyPoint, ServiceShare, KPIData, STL*, ACF, …
    ├── forecast.py              # ForecastPoint, ModelBenchmark, ForecastSummary
    ├── gcp.py                   # BillingEvent, EventsIngestRequest, GCPBilling*, GCPLog, …
    ├── aws.py                   # AWSAuthStatus, AWSBillingResponse, AWSService
    └── advanced.py              # OutliersResponse, DriftResponse, DimReductionResponse, …
```

---

## Installation

```bash
# Python 3.11+ requis
pip install -r requirements.txt
```

Dépendances principales :

| Package | Rôle |
|---|---|
| `fastapi` `uvicorn[standard]` | Framework web async + serveur ASGI |
| `pydantic` `pydantic-settings` | Validation typée + settings via env |
| `pandas` `pyarrow` | Lecture Parquet, séries temporelles |
| `numpy` `scipy` | Statistiques descriptives et tests |
| `statsmodels` | STL, ADF, KPSS, ARIMA, Holt/Holt-Winters, ETS |
| `scikit-learn` | MAE/MSE, IsolationForest, LOF, PCA, t-SNE, StandardScaler/MinMax/Robust |
| `httpx` | Client HTTP (tests via ASGI transport) |
| `google-auth` `google-auth-oauthlib` `google-api-python-client` | OAuth2 + Cloud Billing / Logging / Service Usage APIs |
| (optionnel) `boto3` | AWS Cost Explorer + STS (lazy import, dégradation gracieuse si absent) |
| (optionnel) `openpyxl` `pyxlsb` `odfpy` | Support Excel `.xlsx` / `.xlsb` / `.ods` (imports paresseux) |

---

## Lancement

### Développement

```bash
cd back
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

### Production

```bash
ENV=prod \
  CORS_ORIGINS=https://finops.example.com \
  API_KEY=<clé-api-forte> \
  uvicorn main:app --host 0.0.0.0 --port 8080 --workers 1 --no-access-log
```

> ⚠️ **`--workers 1` OBLIGATOIRE**. Le state OAuth (`_oauth_states`) et le token store (`_token_store`) de `routes/routes_gcp.py` sont des dicts en mémoire process. Avec plusieurs workers, un state généré dans worker A n'est pas visible depuis worker B → CSRF failures aléatoires (~ `(N-1)/N` des callbacks échouent). Pour scaler horizontalement, il faut d'abord déporter ce store vers Redis / DB. Voir § [OAuth2 Google — flux détaillé](#oauth2-google--flux-détaillé).

---

## Configuration (variables d'environnement)

Chargées par `core/config.py` (Pydantic Settings). Priorité : env vars > fichier `.env` (à la racine `back/`) > défauts.

### App

| Variable | Défaut | Description |
|---|---|---|
| `APP_NAME` | `FinOps Analyser` | Titre Swagger |
| `APP_VERSION` | `0.2.0` | Version affichée |
| `ENV` | `dev` | `dev` · `test` · `prod` (validé strictement) |
| `DEBUG` | `false` | Logs verbeux |
| `HOST` | `0.0.0.0` | Adresse d'écoute |
| `PORT` | `8080` | Port d'écoute |
| `CORS_ORIGINS` | `*` | Virgule-séparé — **doit être explicite en prod** (warning au démarrage sinon) |
| `API_KEY` | `""` | Clé API protégeant les endpoints mutateurs : `POST /api/events`, `POST /api/events/upload`, `POST /api/aws/connect`, `POST /admin/cache/clear`. **Obligatoire en `ENV=prod`.** Ne jamais committer — injectée au runtime (env var, Terraform `TF_VAR_api_key`, ou Secrets Manager en prod) |

### OAuth2 Google

| Variable | Défaut | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `""` | Client ID OAuth (obligatoire pour `/api/gcp/*`) |
| `GOOGLE_CLIENT_SECRET` | `""` | Client secret — **jamais committer** (utiliser Secrets Manager / `TF_VAR_*`) |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8080/api/gcp/callback` | Doit correspondre exactement à ce qui est configuré côté Google Cloud Console |
| `FRONTEND_URL` | `http://localhost:3000` | URL de redirection post-OAuth |

### GCP Billing Export (BigQuery — optionnel)

Si configuré, `POST /api/gcp/sync` peut ingérer directement depuis BigQuery.

| Variable | Défaut | Description |
|---|---|---|
| `GCP_BILLING_EXPORT_PROJECT` | `""` | Projet BQ contenant l'export |
| `GCP_BILLING_EXPORT_DATASET` | `""` | Dataset BQ |
| `GCP_BILLING_EXPORT_TABLE` | `gcp_billing_export_v1` | Nom de table (souvent avec préfixe `gcp_billing_export_v1_<account>`) |

### Résolution données

| Variable | Défaut | Description |
|---|---|---|
| `DATA_ALLOW_PARQUET_FALLBACK` | `true` | Si `false`, retourne `empty` au lieu du parquet démo lorsque aucun event n'est ingéré |

### AWS (Cost Explorer — optionnel)

Le backend utilise la chaîne AWS standard (env vars `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`, ou instance role, ou `~/.aws/credentials`).

| Variable | Défaut | Description |
|---|---|---|
| `AWS_REGION` | `eu-west-1` | Région pour STS et clients par défaut |
| `AWS_COST_EXPLORER_REGION` | `us-east-1` | Cost Explorer n'est disponible qu'à us-east-1 |

Exemple `.env` production :

```env
ENV=prod
CORS_ORIGINS=https://finops.example.com
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_REDIRECT_URI=https://api.finops.example.com/api/gcp/callback
FRONTEND_URL=https://finops.example.com
GCP_BILLING_EXPORT_PROJECT=finops-billing
GCP_BILLING_EXPORT_DATASET=billing_export
# Ne pas mettre GOOGLE_CLIENT_SECRET ni API_KEY ici : Secrets Manager ou env var runtime uniquement
```

---

## Architecture — cache & résolution des données

### Cache à deux niveaux

```
Request /api/kpi
   │
   ▼
┌────────────────────────────────────────────────┐
│ Route handler                                  │
│  1. app_cache.get("analytics:kpi")             │
│     ├─ HIT  → return                            │
│     └─ MISS ↓                                   │
│  2. get_kpi()  (analysis/services.py)           │
│      └─ load_daily_costs()                      │
│          └─ @lru_cache(maxsize=1)               │
│              ├─ HIT  → return DataFrame         │
│              └─ MISS ↓                          │
│                 _read_events_df()  (events)     │
│                 IF events → aggregate           │
│                 ELIF fallback → read parquet   │
│                 ELSE → empty DataFrame          │
│  3. app_cache.set("analytics:kpi", result)      │
│  4. return                                       │
└────────────────────────────────────────────────┘
```

- `AppCache` (`core/cache.py`) : thread-safe (`RLock`), TTL par entrée optionnel, statistiques `hits/misses/hit_rate`.
- `@lru_cache(maxsize=1)` sur les deux loaders (`load_daily_costs`, `load_daily_per_service`) : garantit qu'un même DataFrame est retourné à toutes les fonctions analytiques (mémoire économisée, cohérence garantie).

### Warm cache au démarrage (`core/precompute.py`)

Le lifespan FastAPI :
1. Configure le logging JSON.
2. Charge les deux parquets (prime les `@lru_cache`).
3. Appelle `warm_cache()` — précompute concurrent via `ThreadPoolExecutor(max_workers=4)` :

| Clé cache | Fonction |
|---|---|
| `analytics:kpi` | `get_kpi()` |
| `analytics:services` | `get_service_shares()` |
| `analytics:daily` | `get_daily_series()` |
| `analytics:stats` | `get_descriptive_stats()` |
| `analytics:anomalies:2.0` | `get_anomalies(2.0)` |
| `analytics:stationarity` | `get_stationarity()` |
| `analytics:stl` | `get_stl_decomposition()` |
| `analytics:acf:28` | `get_acf_pacf(28)` |
| `forecast:benchmarks` | `get_model_benchmarks()` |
| `forecast:<model>:<h>` | pour tous les modèles × horizons `[30, 60, 90]` |

Le résumé (`{total, ok, failed, timings_ms}`) est loggé en `cache_ready`.

### Résolution des données (`data/loader.py`)

Ordre de priorité, transparent pour les callers :

| Priorité | Source | Déclencheur | `get_last_source()` |
|---|---|---|---|
| 1 | Événements en mémoire (`routes_events._injected_events`) | `POST /api/events`, `POST /api/events/upload`, `POST /api/gcp/sync` | `events` |
| 2 | Parquet démo bundlé | `DATA_ALLOW_PARQUET_FALLBACK=true` et parquet présent | `parquet_fallback` |
| 3 | DataFrame vide (colonnes seulement) | Sinon | `empty` |

`data/loader.py` expose aussi :
- `invalidate_cache()` — vide les `@lru_cache` + tracking mtimes
- `get_data_fingerprint()` — mtime + taille des parquets (health check)
- `reload_if_changed()` — détecte modif parquet, invalide si nécessaire

### Invalidation

| Événement | Effet |
|---|---|
| `POST /api/events` (JSON) | `_injected_events.extend(...)` + `app_cache.clear()` + `loader.invalidate_cache()` |
| `POST /api/events/upload` | idem + parsing fichiers |
| `POST /api/gcp/sync` | Fetch BigQuery → remplace `_injected_events` + invalide |
| `POST /admin/cache/clear` | Flush manuel de `app_cache` uniquement |

---

## Référence API

Base URL : `http://localhost:8080`  
Swagger : `GET /docs` (désactivé si `ENV=prod`)  
OpenAPI JSON : `GET /openapi.json`

### Health & admin

#### `GET /health`

Health check + stats cache + fingerprint données. Utilisé par ALB.

```json
{
  "status": "ok",
  "cache": { "keys": 27, "hits": 143, "misses": 27, "hit_rate": 0.84 },
  "data": {
    "daily_costs": { "mtime": 1719345600.0, "size_bytes": 4832 },
    "daily_per_service": { "mtime": 1719345600.0, "size_bytes": 12384 }
  }
}
```

#### `POST /admin/cache/clear`

Flush `app_cache` + invalide `@lru_cache` du loader. Utile après un import manuel ou en debug.

---

### Analytics

Tous les endpoints sont pré-cachés au démarrage. Latence typique < 5 ms sur cache hit.

| Endpoint | Params | Réponse | Description |
|---|---|---|---|
| `GET /api/kpi` | — | `KPIData` | Total, moyenne, pente OLS, forecast 30j (MA 14j×30), count anomalies |
| `GET /api/daily` | `last_n: int? [7-365]` | `List[DailyPoint]` | Coût + MA7 + IC 95% (expanding std) |
| `GET /api/services` | — | `List[ServiceShare]` | Somme par service + Pareto + CV |
| `GET /api/anomalies` | `z_threshold: float [1-4] = 2.0` | `List[AnomalyPoint]` | Z-score par jour + flag |
| `GET /api/stats` | — | `DescriptiveStats` | mean, median, std, CV, skew, kurt, IQR, MAD, min, max |
| `GET /api/stationarity` | — | `StationarityResult` | ADF (autolag=AIC) + KPSS (regression=c) |
| `GET /api/stl` | — | `List[STLPoint]` | STL period=7, robust=True |
| `GET /api/stl/strengths` | — | `STLStrengths` | Force tendance Ft + saisonnalité Fs (Wang 2006) |
| `GET /api/acf` | `nlags: int [5-60] = 28` | `List[ACFPoint]` | ACF (FFT) + PACF |

**Exemple `KPIData`** :

```json
{
  "total_spend": 3327.5,
  "daily_avg": 19.5735,
  "trend_slope": 0.000421,
  "forecast_next_30": 614.68,
  "anomaly_count": 4,
  "top_service": "Cloud SQL",
  "top_service_pct": 33.08,
  "data_points": 170,
  "period_start": "2026-01-05",
  "period_end": "2026-06-23"
}
```

---

### Forecast

| Endpoint | Params | Réponse | Description |
|---|---|---|---|
| `GET /api/forecast` | `horizon: int [7-180] = 60`, `model: str = AutoETS` | `List[ForecastPoint]` | 30 derniers points historiques + `horizon` prévisions avec IC 80% & 95% |
| `GET /api/forecast/summary` | idem | `ForecastSummary` | Total prévu, moyenne, meilleur modèle, MAE/MAPE |
| `GET /api/forecast/models` | — | `List[ModelBenchmark]` | Benchmark 6 modèles, walk-forward 5 folds × h=14 |
| `GET /api/forecast/models/list` | — | `{"models": [str]}` | Liste des noms utilisables comme `model` |

**Erreurs**

- `model` inconnu → `400 BAD_REQUEST` avec `details.available = [...]`.
- `horizon` hors bornes → 422 validation Pydantic.

---

### Advanced analysis

7 endpoints sous `/api/analysis`. Cache par combinaison de paramètres (clé `analysis:<name>:<params>`).

| Endpoint | Params | Contenu principal |
|---|---|---|
| `GET /api/analysis/outliers` | `z_threshold: float [1-5] = 2.0`, `iqr_multiplier: float [1-3] = 1.5` | 5 méthodes concurrentes (Z-score, MAD, IQR, Isolation Forest, LOF) + Mahalanobis multi-services + tableau de consensus |
| `GET /api/analysis/drift` | `reference_frac: float (0.1-0.9) = 0.5`, `psi_bins: int [5-20] = 10` | Kolmogorov-Smirnov, PSI (Population Stability Index) par bin, Page-Hinkley changepoint detection |
| `GET /api/analysis/distribution` | — | Skewness, kurtosis, Box-Cox λ, tests de normalité (Jarque-Bera, Shapiro-Wilk, D'Agostino), points QQ-plot |
| `GET /api/analysis/scaling` | — | Série normalisée par `StandardScaler`, `MinMaxScaler`, `RobustScaler` (comparaison) |
| `GET /api/analysis/missing` | — | Gaps calendaires, % manquant par service, hint MCAR/MAR/MNAR |
| `GET /api/analysis/dim-reduction` | `n_components: int [2-10] = 5`, `run_tsne: bool = true` | PCA (variance ratios + top loadings) + t-SNE 2D optionnelle |
| `GET /api/analysis/ensemble-forecast` | `horizon: int [7-180] = 60` | Bagging (moyenne des 6 modèles) + stacking (poids inverse-MAE) + décomposition bias²/variance par modèle |

Schémas Pydantic détaillés dans `schemas/advanced.py` — voir § [Schémas Pydantic](#schémas-pydantic).

---

### GCP

10 endpoints. Nécessitent OAuth2 (sauf `/status`, `/auth`, `/callback`, `/logout`).

| Endpoint | Params | Réponse | Description |
|---|---|---|---|
| `GET /api/gcp/auth` | — | 302 redirect | Génère un `state` + redirect vers Google consent screen |
| `GET /api/gcp/callback` | `code`, `state`, `error?` | 302 redirect → `FRONTEND_URL` | Échange code → tokens, stocke sous `_token_store["default"]` |
| `GET /api/gcp/status` | — | `GCPAuthStatus` | `{authenticated, email?, project_id?}` — public |
| `GET /api/gcp/logout` | — | `{logged_out: true}` | Vide le token store |
| `GET /api/gcp/projects` | — | `List[GCPProject]` | Cloud Resource Manager — projets accessibles |
| `GET /api/gcp/billing-accounts` | — | `List[GCPBillingAccount]` | Cloud Billing (pagination) |
| `GET /api/gcp/billing` | `project_id: str`, `months: int [1-24] = 6` | `GCPBillingResponse` | Résolution : BigQuery Export → events injectés → parquet démo (source retournée) |
| `POST /api/gcp/sync` | `project_id: str`, `months: int [1-24] = 6` | `GCPSyncResponse` | Ingère BigQuery Export → `_injected_events` + invalide caches downstream |
| `GET /api/gcp/logs` | `project_id: str`, `limit: int [1-500] = 50`, `severity?: str` | `List[GCPLogEntry]` | Cloud Logging (severity whitelist enforced) |
| `GET /api/gcp/services` | `project_id: str` | `List[GCPService]` | Service Usage — services activés avec catégorisation |

**Scopes OAuth requis**

```
openid userinfo.email
cloud-billing.readonly
logging.read
cloudplatformprojects.readonly
cloud-platform.read-only
```

**Erreurs upstream** — mapping strict pour éviter les fuites :

| Statut GCP | Réponse API |
|---|---|
| 401 | `401 UNAUTHORIZED` (session expirée) |
| 403 | `403 FORBIDDEN` (permission manquante — scope OAuth ou IAM) |
| 5xx | `502 DEPENDENCY_ERROR` (upstream GCP indisponible) |

Aucune exception amont n'est jamais forwardée telle quelle (SEC-001).

---

### AWS

3 endpoints. Utilisent `boto3` (import paresseux — dégradation gracieuse si non installé, retourne 500 explicite).

| Endpoint | Params | Réponse | Description |
|---|---|---|---|
| `GET /api/aws/status` | — | `AWSAuthStatus` | STS `GetCallerIdentity` — jamais 5xx, retourne `{authenticated: false, detail}` si pas de creds |
| `GET /api/aws/billing` | `start?: YYYY-MM-DD`, `end?: YYYY-MM-DD`, `months: int [1-24] = 6`, `granularity: DAILY\|MONTHLY = MONTHLY` | `AWSBillingResponse` | Cost Explorer `GetCostAndUsage`, métrique `UnblendedCost`, group by `SERVICE` |
| `GET /api/aws/services` | `months: int [1-12] = 3` | `List[AWSService]` | Services avec coûts observés sur les N derniers mois (léger vs Service Quotas API) |

Résolution période (`_resolve_period`) : si `start`/`end` absents, utilise `[today - months, tomorrow)` (Cost Explorer `end` est exclusif → +1 jour pour inclure aujourd'hui).

---

### Ingestion événements

Trois endpoints sous `/api/events`. Toute ingestion invalide `app_cache` et le `@lru_cache` du loader.

| Endpoint | Payload | Comportement |
|---|---|---|
| `POST /api/events` | JSON `EventsIngestRequest` | Ajoute (ou remplace si `replace=true`) des événements typés |
| `POST /api/events/upload` | Multipart `files[]` + `replace: bool` | Parse CSV / Excel multi-sheet, avec warnings détaillés |
| `POST /api/events/preview` | Multipart `files[]` | Dry-run : parse sans stocker, retourne sample + KPI preview |

**Limites**

- `_MAX_STORE_SIZE = 100_000` lignes en mémoire (rejet si append dépasserait)
- `_MAX_FILE_BYTES = 10 MB` par fichier
- `_MAX_EVENTS_PER_REQUEST = 10_000` (schema Pydantic)
- Cost ∈ `[0, 1_000_000]` € (validator)

Voir § [Ingestion CSV / Excel](#ingestion-csv--excel) pour les aliases colonnes et la logique de parse.

---

### Data status

| Endpoint | Réponse |
|---|---|
| `GET /api/data/status` | `DataStatus` : `source` (`events`/`parquet_fallback`/`empty`), `rows_daily`, `rows_per_service`, `services_count`, `period_start`, `period_end`, `bigquery_export_configured` |

Utilisé par le frontend pour indiquer visuellement l'origine des données affichées.

---

## Pipeline analytique

### `analysis/timeseries.py`

| Fonction | Algorithme | Lib |
|---|---|---|
| `get_daily_series(last_n)` | Rolling mean 7j + expanding std → CI 95% | pandas |
| `get_descriptive_stats()` | mean, median, std, CV, skew, kurt, IQR, MAD | numpy, scipy.stats |
| `get_stationarity()` | ADF (autolag=AIC) + KPSS (regression=c, nlags=auto) | statsmodels |
| `get_stl_decomposition()` | STL period=7, robust=True → (`STLPoint[]`, `STLStrengths`) | statsmodels.tsa.seasonal |
| `get_anomalies(z_threshold)` | Z-score = (x − μ) / σ | numpy |
| `get_acf_pacf(nlags)` | ACF (FFT) + PACF | statsmodels |

**Forces STL (Wang et al. 2006)** :

```
Ft = max(0, 1 − Var(R) / Var(T + R))
Fs = max(0, 1 − Var(R) / Var(S + R))
```

### `analysis/services.py`

| Fonction | Calcul |
|---|---|
| `get_service_shares()` | Somme par service → tri décroissant → CV(%) → `cum_pct` Pareto |
| `get_kpi()` | Total, daily avg, pente OLS, MA14×30 pour forecast_next_30, count \|Z\|>2 |

### `analysis/advanced.py`

| Fonction | Approche |
|---|---|
| `compute_outliers(z_thresh, iqr_mult)` | Z-score, MAD-modified Z, IQR, Isolation Forest (contamination auto), LOF, Mahalanobis multi-services |
| `compute_drift(reference_frac, psi_bins)` | KS (`scipy.stats.ks_2samp`), PSI par bin, Page-Hinkley (δ + λ config) |
| `compute_distribution()` | Skew, kurtosis, Box-Cox λ (scipy), Jarque-Bera + Shapiro-Wilk + D'Agostino K², QQ-plot |
| `compute_scaling()` | StandardScaler, MinMaxScaler, RobustScaler (`sklearn.preprocessing`) |
| `compute_missingness()` | Reindex sur calendrier complet, % NaN par service, hint MCAR/MAR/MNAR |
| `compute_dim_reduction(n_components, run_tsne)` | PCA sur matrice `[jours × services]` + t-SNE 2D optionnel (perplexity ~5-30) |
| `compute_ensemble_forecast(horizon)` | Ensemble uniforme + poids inverse-MAE + décomposition bias²/variance par modèle |

---

## Moteur de prévision

### Modèles (`forecast/engine.py`, dict `MODELS`)

| Clé API | Famille | Implémentation réelle |
|---|---|---|
| `AutoETS` | Exponential Smoothing | `statsmodels.tsa.holtwinters.ExponentialSmoothing` (Holt additive, no seasonal, MLE) |
| `AutoTheta` | Theta | OLS trend + `SimpleExpSmoothing(alpha=0.5)` détrended, combiné 50/50 |
| `AutoARIMA` | ARIMA | `statsmodels.tsa.arima.model.ARIMA(1,1,1)` |
| `Prophet (SES)` | Exponential Smoothing | `SimpleExpSmoothing` avec α optimisé |
| `N-HiTS (HW)` | Holt-Winters | ETS additive trend + saisonnier période 7 |
| `TimesNet (SNaive)` | Seasonal Naive | Répétition de la dernière semaine observée |

> ℹ️ Les préfixes `Prophet`, `N-HiTS`, `TimesNet` sont uniquement des labels de branding — **aucun deep learning n'est utilisé**. Toutes les implémentations sont statsmodels/numpy.

### Walk-forward cross-validation

```
Série de N jours (défaut 170) → 5 folds × horizon 14

Fold 1 : train=[0..100]   test=[101..114]
Fold 2 : train=[0..114]   test=[115..128]
Fold 3 : train=[0..128]   test=[129..142]
Fold 4 : train=[0..142]   test=[143..156]
Fold 5 : train=[0..156]   test=[157..170]
```

Métriques sur la concaténation des 5 folds :

- **MAE** — Mean Absolute Error (€)
- **RMSE** — Root Mean Squared Error (€)
- **MAPE** — Mean Absolute Percentage Error (%)
- **R²** — Coefficient de détermination
- **score = mae / best_mae** (1.0 = gagnant)

### Intervalles de confiance

Approximation gaussienne sur les résidus :

```
IC 80% : ŷ_t ± 1.282 × σ_résidus × √h
IC 95% : ŷ_t ± 1.960 × σ_résidus × √h
```

où `h` = pas dans le futur. Simple mais suffisant pour un dashboard exécutif. Pour des IC calibrés, préférer les intervalles analytiques d'ARIMA (`get_forecast()`).

---

## OAuth2 Google — flux détaillé

```
Frontend                Backend                       Google OAuth
   │                       │                              │
   │ GET /api/gcp/auth     │                              │
   │──────────────────────►│                              │
   │                       │ generate state (uuid)        │
   │                       │ _oauth_states[state] = {…}   │
   │                       │ build authorize URL          │
   │◄──────────────────────│ 302 Location: accounts.google│
   │                       │                              │
   │                       │        (user consent)        │
   │                       │                              │
   │  GET /api/gcp/callback?code=…&state=…                │
   │◄─────────────────────────────────────────────────────│
   │──────────────────────►│                              │
   │                       │ validate state (TTL, whitelist errors)
   │                       │ exchange code → tokens       │
   │                       │──────────────────────────────►│
   │                       │◄──────────────────────────────│
   │                       │ _token_store["default"] = …  │
   │◄──────────────────────│ 302 → FRONTEND_URL           │
```

**State management** (`routes/routes_gcp.py`)

- `_oauth_states: dict[str, dict]` — `state_token → {created_at, status}`, TTL **600 s**
- `_token_store: dict[str, dict]` — `"default" → {access_token, refresh_token, expires_at, email, project_id, …}`
- Cleanup opportuniste des states expirés à chaque `/auth` et `/callback`

**Protections** (marqués `SEC-00X` dans le code)

- SEC-001 : Aucune exception upstream forwardée → risque de fuite creds
- SEC-002 : Whitelist codes d'erreur OAuth avant logging (évite log injection + XSS)
- SEC-003 : Rejet des states expirés (TTL 600 s) → replay attack mitigée
- SEC-004 : Validation stricte `project_id` (regex GCP) et `severity` (enum) avant interpolation dans les filtres Cloud Logging

**Limitation critique — single-worker only**

Le store en mémoire process ne survit pas à un fork/spawn. Multi-worker uvicorn/gunicorn → callbacks OAuth échouent avec `invalid_state` quand la requête initiale et le callback tombent sur des workers différents.

Options pour scaler :
1. Rester en single-worker (recommandé pour l'échelle actuelle)
2. Déporter `_oauth_states` et `_token_store` vers Redis (ou DynamoDB, Firestore, …) — nécessite refactor de `routes_gcp.py`

---

## Ingestion CSV / Excel

`routes/routes_events.py` détecte le format à partir de l'extension et de la signature, puis normalise vers un DataFrame `[ds, service, cost, description]`.

### Aliases colonnes (case-insensitive, whitespace-tolerant)

| Champ interne | Aliases reconnus |
|---|---|
| `date` | `Mois`, `Date`, `Usage Start Date`, `usage_start_time`, `day`, `ds` |
| `service` | `Description du service`, `Service`, `service`, `service.description` |
| `cost` | `Sous-total (€)`, `Sous-total non arrondi (€)`, `Coût catalogue (€)`, `Cost`, `cost`, `Coût` |
| `description` | (optionnel) `description`, `Description` |

### Formats de date acceptés

- `YYYY-MM-DD` (canonique)
- `YYYY-MM` → premier jour du mois (utile pour l'export "Rapports_Billing Account" GCP mensuel)
- Timestamps ISO (`2026-01-15T00:00:00Z`) → date seulement

### Parsing nombres locale EU

- `1 234,56` → `1234.56` (espaces = milliers, virgule = décimale)
- `1,234.56` → `1234.56` (US)
- `224,59 €` → `224.59` (symbole devise ignoré)

### Formats supportés

| Format | Extensions | Bibliothèque |
|---|---|---|
| CSV | `.csv` | pandas (auto-détection encodage : utf-8, cp1252, latin-1) |
| Excel moderne | `.xlsx`, `.xlsm` | openpyxl (import paresseux) |
| Excel binaire | `.xlsb` | pyxlsb (import paresseux) |
| Excel legacy | `.xls` | xlrd (import paresseux) |
| OpenDocument | `.ods` | odfpy (import paresseux) |

Multi-sheet : tous les onglets d'un classeur Excel sont scannés — le premier avec des colonnes reconnaissables est retenu, un warning liste les autres.

### Erreurs & warnings

- Fichier > 10 MB → `400 BAD_REQUEST`
- Colonnes non reconnues → `400` avec `details.detected_columns` + `details.expected_aliases`
- Store size dépassé → `400` avec `details.current_size` + `details.max_size`
- Lignes individuelles invalides (cost < 0, date malformée) → ignorées avec warning agrégé

---

## Schémas Pydantic

Tous les schémas héritent de `pydantic.BaseModel` (v2). Les endpoints retournent des payloads en `snake_case` — le frontend applique une transformation `snake_case → camelCase` via un intercepteur axios.

### `schemas/analytics.py`

| Modèle | Champs principaux |
|---|---|
| `DailyPoint` | `date, cost, ma7, ci_low, ci_high` |
| `ServiceShare` | `service, cost, pct, cv, cum_pct` |
| `AnomalyPoint` | `date, cost, zscore, is_anomaly` |
| `STLPoint` | `date, trend, seasonal, residual` |
| `STLStrengths` | `ft, fs, period` |
| `DescriptiveStats` | `mean, median, std, cv, skewness, kurtosis, iqr, mad, min, max` |
| `StationarityTest` / `StationarityResult` | `statistic, p_value, is_stationary, lags_used` |
| `ACFPoint` | `lag, acf, pacf` |
| `KPIData` | `total_spend, daily_avg, trend_slope, forecast_next_30, anomaly_count, top_service, top_service_pct, data_points, period_start, period_end` |

### `schemas/forecast.py`

| Modèle | Champs |
|---|---|
| `ForecastPoint` | `date, forecast, low80, high80, low95, high95, actual?` (`actual=null` pour le futur) |
| `ModelBenchmark` | `rank, model, family, mae, rmse, mape, r2, score, winner` |
| `ForecastSummary` | `horizon_days, total_forecast, daily_avg_forecast, best_model, best_model_mae, best_model_mape, models_evaluated` |

### `schemas/gcp.py`

- `BillingEvent` — `date (YYYY-MM-DD), service, cost (0..1M €), description?`
- `EventsIngestRequest` — `events: BillingEvent[], replace: bool`
- `EventsIngestResponse`, `MultiFileUploadResponse`, `PreviewResponse`
- `GCPAuthStatus`, `GCPProject`, `GCPBillingAccount`
- `GCPBillingByService`, `GCPBillingByMonth`, `GCPBillingByAccount`, `GCPBillingResponse`
- `GCPSyncResponse`, `GCPLogEntry`, `GCPService`

Constantes internes :

```python
_DATE_RE                 = r'^\d{4}-\d{2}-\d{2}$'
_MAX_EVENTS_PER_REQUEST  = 10_000
_MAX_COST                = 1_000_000.0
```

### `schemas/aws.py`

- `AWSAuthStatus` — `authenticated, account_id?, arn?, region?, detail?`
- `AWSBillingByService`, `AWSBillingByMonth`, `AWSBillingByDay`
- `AWSBillingResponse`, `AWSService`
- `AWSBillingQuery` — validators sur `start/end` (format + ordre) et `granularity` (enum)

### `schemas/advanced.py`

- `OutlierRow`, `OutlierMethodSummary`, `MahalanobisRow`, `OutliersResponse`
- `KSResult`, `PSIBin`, `PSIResult`, `PageHinkleyPoint`, `DriftResponse`
- `NormalityTest`, `DistributionResponse`
- `ScaledSeriesPoint`, `ScalingResponse`
- `GapRow`, `MissingnessResponse`
- `PCAComponent`, `TSNEPoint`, `DimReductionResponse`
- `EnsembleForecastPoint`, `BiasVarianceRow`, `EnsembleForecastResponse`

---

## Sécurité

### Middlewares (`main.py`)

Appliqués à toutes les réponses :

| Header | Valeur |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (prod uniquement) |
| `X-Request-Id` | UUID généré ou repris de l'entête entrant (corrélation logs) |

### Docs API

- `/docs` et `/redoc` **désactivés** si `ENV=prod` (SEC-011)
- OpenAPI JSON reste servi (`/openapi.json`) — utile pour clients typés

### CORS

- Défaut `*` en dev
- **Warning loggé** si `CORS_ORIGINS=*` avec `ENV=prod` (SEC-008)
- `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`

### OAuth2 — voir § [OAuth2 Google — flux détaillé](#oauth2-google--flux-détaillé)

### Ingestion événements

- Cost ∈ [0, 1 000 000 €] (Pydantic validator)
- Date `^\d{4}-\d{2}-\d{2}$` (regex strict)
- Cap store 100 000 lignes, cap file 10 MB
- Re-validation en route (defense in depth)

### CI security

Workflow `.github/workflows/security.yml` (weekly + push main) :

- `pip-audit -r back/requirements.txt` — CVE Python
- `npm audit --audit-level=high` — CVE Node
- `bandit -r back/` — SAST Python (report en artifact)
- `semgrep --config=p/python --config=p/security-audit back/`

---

## Logs & observabilité

Formatter JSON structuré (`core/logging.py`) avec `ContextVar` `request_id_ctx` propagée dans tous les logs d'une même requête.

```json
{
  "ts": "2026-06-26T10:23:41.284Z",
  "level": "INFO",
  "logger": "analysis.timeseries",
  "msg": "STL decomposition computed",
  "request_id": "a3f891bc2d4e",
  "extra": { "duration_ms": 12.4 }
}
```

Header `X-Request-Id` :
- Généré au format hex 32 caractères si absent
- Repris de la requête entrante si fourni (permet la corrélation cross-service)
- Retourné dans la réponse

Événements notables loggés au démarrage :
- `data_loaded` (loaders LRU chauffés)
- `startup_config` (google_redirect_uri, frontend_url — pas de secrets)
- `cache_ready` (`{ok, total}` de warm_cache)
- `cache_warm_partial` (WARNING avec liste des `failed_keys`)

---

## Docker

### Build

```bash
docker build --platform linux/amd64 -t finops-backend:latest .
```

### Run

```bash
docker run --rm -p 8080:8080 \
  -e ENV=prod \
  -e CORS_ORIGINS=https://finops.example.com \
  -e API_KEY=… \
  -e GOOGLE_CLIENT_ID=… \
  -e GOOGLE_CLIENT_SECRET=… \
  -e GOOGLE_REDIRECT_URI=https://api.finops.example.com/api/gcp/callback \
  -e FRONTEND_URL=https://finops.example.com \
  finops-backend:latest
```

### Notes déploiement

- Dockerfile multi-stage `python:3.11-slim` → image finale ~250 MB
- Exécution en user non-root (UID 1000 dans la task definition ECS)
- Healthcheck ECS via `python -c "urllib.request.urlopen('http://localhost:8080/health')"` (voir `terraform/README.md` § ECS)
- Cold start ~2 min (numpy/scipy imports + warm_cache) → `startPeriod=120s` sur ECS

---

## Tests

```bash
pytest                              # tous les tests
pytest tests/test_smoke.py          # smoke uniquement
pytest -k "outliers"                # par mot-clé
pytest --cov=. --cov-report=term    # avec couverture
```

### `tests/test_smoke.py` — 13 tests

Monkeypatche les loaders parquet + `warm_cache` pour tourner sans données. Couvre :
- Import propre de `main.app`
- Validation Pydantic (`BillingEvent`, `EventsIngestRequest`)
- Routes clés via `httpx.ASGITransport` : `/health`, `/api/gcp/status`, `/api/gcp/sync` (401), `/api/aws/status`, `/api/events`, `/api/data/status`

### `tests/test_calculations.py` — 13 tests

Fixture `synthetic_events` (180 jours × 3 services, patterns connus). Couvre :
- Loaders `daily_from_events` (somme correcte) + `per_service_from_events` (pivot shape)
- Drift : KS/PSI stables sur série stationnaire, PSI détecte shift 5×
- Outliers : Z, IQR, Isolation Forest s'accordent sur un spike 10σ planté
- Scaling : `StandardScaler` (mean=0, std=1), `MinMaxScaler` (bornes [0,1])
- PCA : ratios de variance ∈ [0,1], décroissants, cumulatifs ≤ 1
- KPI : jamais de NaN dans `cost/pct/cv/cum_pct` (régression bug CV guard)
- Ensemble : poids inverse-MAE somment à 1, identité bias² + variance ≈ MSE total

**Non couvert (gaps)** : modèles de forecast individuels (AutoETS, ARIMA, Theta, …) — testés uniquement via le benchmark end-to-end.

---

## Gestion des erreurs

Toutes les routes lèvent des sous-classes de `core.errors.AppError`. Un handler unique dans `main.py` produit le JSON structuré suivant :

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown model 'XYZ'.",
    "details": {
      "available": ["AutoETS", "AutoTheta", "AutoARIMA", "Prophet (SES)", "N-HiTS (HW)", "TimesNet (SNaive)"]
    }
  }
}
```

| Exception | Statut | Code JSON |
|---|---|---|
| `BadRequest` | 400 | `BAD_REQUEST` |
| `Unauthorized` | 401 | `UNAUTHORIZED` |
| `Forbidden` | 403 | `FORBIDDEN` |
| `NotFound` | 404 | `NOT_FOUND` |
| `DependencyError` | 502 | `DEPENDENCY_ERROR` |

⚠️ Ne **jamais** lever `HTTPException` directement — la forme de réponse ne serait pas homogène. Utiliser `AppError` (ou une sous-classe) pour tout aller-retour métier.

Les erreurs de validation Pydantic (422) suivent leur propre format standard FastAPI ; le frontend les reconnaît via le champ `detail`.
