# Backend — FinOps GCP API

API REST FastAPI exposant l'intégralité de la pipeline analytique et de prévision des coûts GCP demo. Les données sont lues depuis des fichiers Parquet pré-calculés, traitées à chaque requête (avec LRU cache sur le chargement), et retournées sous forme de JSON typés Pydantic.

---

## Sommaire

1. [Structure](#structure)
2. [Installation](#installation)
3. [Lancement](#lancement)
4. [Référence API complète](#référence-api-complète)
5. [Pipeline analytique](#pipeline-analytique)
6. [Moteur de prévision](#moteur-de-prévision)
7. [Schémas de réponse](#schémas-de-réponse)
8. [Configuration](#configuration)
9. [Logs & Observabilité](#logs--observabilité)
10. [Docker](#docker)
11. [Gestion des erreurs](#gestion-des-erreurs)

---

## Structure

```
back/
├── main.py                  # FastAPI app : lifespan, CORS, middleware, routers
├── Dockerfile               # Multi-stage build python:3.11-slim
├── .dockerignore
├── requirements.txt
│
├── core/
│   ├── config.py            # Pydantic Settings — env vars, .env file, defaults
│   ├── errors.py            # Hiérarchie d'exceptions → réponses HTTP propres
│   └── logging.py           # Formatter JSON + ContextVar request-id
│
├── data/
│   ├── loader.py            # Chargement parquet avec @lru_cache(maxsize=1)
│   ├── daily_costs.parquet  # Série quotidienne agrégée (ds, y)
│   └── daily_per_service.parquet  # Série par service (ds + 9 colonnes)
│
├── analysis/
│   ├── timeseries.py        # Série journalière, STL, ADF/KPSS, anomalies, ACF/PACF
│   └── services.py          # Répartition Pareto par service, KPIs globaux
│
├── forecast/
│   └── engine.py            # 6 modèles, walk-forward CV, intervalles de confiance
│
├── routes/
│   ├── routes_health.py     # GET /health
│   ├── routes_analytics.py  # 9 routes sous /api
│   └── routes_forecast.py   # 4 routes sous /api/forecast
│
└── schemas/
    ├── analytics.py         # DailyPoint, ServiceShare, KPIData, STLPoint, …
    └── forecast.py          # ForecastPoint, ModelBenchmark, ForecastSummary
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
| `fastapi` | Framework web async |
| `uvicorn[standard]` | Serveur ASGI |
| `pydantic-settings` | Configuration via env vars |
| `pandas` + `pyarrow` | Lecture Parquet, manipulation de séries |
| `numpy` + `scipy` | Calculs statistiques |
| `statsmodels` | STL, ADF, KPSS, ARIMA, Holt-Winters |
| `scikit-learn` | MAE, MSE (métriques benchmark) |

---

## Lancement

### Développement

```bash
cd back
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

### Production (2 workers)

```bash
uvicorn main:app --host 0.0.0.0 --port 8080 --workers 2 --no-access-log
```

### Variables d'environnement

```bash
ENV=prod PORT=8080 CORS_ORIGINS=https://mon-front.com uvicorn main:app ...
```

---

## Référence API complète

Base URL : `http://localhost:8080`

Swagger interactif : `GET /docs`  
ReDoc : `GET /redoc`  
OpenAPI JSON : `GET /openapi.json`

---

### Health

#### `GET /health`

Vérification de disponibilité du service.

**Réponse 200**
```json
{ "status": "ok" }
```

---

### Analytics — `/api`

#### `GET /api/kpi`

Agrégats globaux pour les cartes KPI du dashboard.

**Réponse 200** — `KPIData`
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

#### `GET /api/daily`

Série journalière avec moyenne mobile 7 jours et bandes IC 95%.

| Paramètre | Type | Défaut | Contraintes | Description |
|---|---|---|---|---|
| `last_n` | `int` | `null` | 7 ≤ n ≤ 365 | Limiter aux N derniers jours |

**Réponse 200** — `List[DailyPoint]`
```json
[
  {
    "date": "2026-01-05",
    "cost": 0.9001,
    "ma7": 5.4832,
    "ci_low": 0.0,
    "ci_high": 14.8201
  }
]
```

---

#### `GET /api/services`

Répartition des coûts par service, triée par Pareto (coût décroissant).

**Réponse 200** — `List[ServiceShare]`
```json
[
  {
    "service": "Cloud SQL",
    "cost": 1100.59,
    "pct": 33.08,
    "cv": 74.72,
    "cum_pct": 33.08
  },
  {
    "service": "BigQuery",
    "cost": 623.62,
    "pct": 18.74,
    "cv": 163.68,
    "cum_pct": 51.82
  }
]
```

> `cv` = coefficient de variation (%) — mesure de la volatilité du service.  
> `cum_pct` = part cumulée Pareto.

---

#### `GET /api/anomalies`

Tous les points journaliers avec Z-score. `is_anomaly=true` si `|Z| > z_threshold`.

| Paramètre | Type | Défaut | Contraintes |
|---|---|---|---|
| `z_threshold` | `float` | `2.0` | 1.0 ≤ threshold ≤ 4.0 |

**Réponse 200** — `List[AnomalyPoint]`
```json
[
  {
    "date": "2026-03-12",
    "cost": 70.16,
    "zscore": 5.1592,
    "is_anomaly": true
  }
]
```

---

#### `GET /api/stats`

Statistiques descriptives complètes de la distribution des coûts quotidiens.

**Réponse 200** — `DescriptiveStats`
```json
{
  "mean": 19.5735,
  "median": 17.775,
  "std": 9.8299,
  "cv": 50.2206,
  "skewness": 0.7481,
  "kurtosis": 6.3159,
  "iqr": 11.84,
  "mad": 4.905,
  "min": 0.0,
  "max": 70.16
}
```

---

#### `GET /api/stationarity`

Tests ADF et KPSS sur la série quotidienne.

**Réponse 200** — `StationarityResult`
```json
{
  "adf": {
    "statistic": -3.271864,
    "p_value": 0.016184,
    "is_stationary": true,
    "lags_used": 13
  },
  "kpss": {
    "statistic": 0.940856,
    "p_value": 0.01,
    "is_stationary": false,
    "lags_used": 7
  }
}
```

> **Interprétation :** ADF — H₀ = racine unitaire ; p < 0.05 → stationnaire.  
> KPSS — H₀ = stationnarité ; p < 0.05 → non-stationnaire.  
> Résultats contradictoires → série **trend-stationnaire**.

---

#### `GET /api/stl`

Décomposition STL (Seasonal-Trend decomposition using Loess) sur l'ensemble de la série. Période = 7 jours (cycle hebdomadaire), robuste aux outliers.

**Réponse 200** — `List[STLPoint]`
```json
[
  {
    "date": "2026-01-05",
    "trend": -0.8233,
    "seasonal": -0.0768,
    "residual": 0.9001
  }
]
```

---

#### `GET /api/stl/strengths`

Force de la tendance (Ft) et de la saisonnalité (Fs) calculées selon Wang et al. (2006).

**Réponse 200** — `STLStrengths`
```json
{
  "ft": 0.4387,
  "fs": 0.3555,
  "period": 7
}
```

> `Ft = max(0, 1 - Var(R) / Var(T+R))` — tendance modérée si 0.3 < Ft < 0.6.  
> `Fs = max(0, 1 - Var(R) / Var(S+R))` — saisonnalité faible à modérée.

---

#### `GET /api/acf`

Valeurs ACF et PACF jusqu'au lag `nlags`.

| Paramètre | Type | Défaut | Contraintes |
|---|---|---|---|
| `nlags` | `int` | `28` | 5 ≤ nlags ≤ 60 |

**Réponse 200** — `List[ACFPoint]`
```json
[
  { "lag": 1, "acf": 0.312456, "pacf": 0.312456 },
  { "lag": 7, "acf": 0.187234, "pacf": 0.098123 }
]
```

---

### Forecast — `/api/forecast`

#### `GET /api/forecast/`

Série de prévision pour l'horizon demandé. Retourne les 30 derniers jours historiques + `horizon` points futurs, chacun avec IC 80% et 95%.

| Paramètre | Type | Défaut | Contraintes |
|---|---|---|---|
| `horizon` | `int` | `60` | 7 ≤ horizon ≤ 180 |
| `model` | `str` | `AutoETS` | Voir `/api/forecast/models/list` |

**Réponse 200** — `List[ForecastPoint]`
```json
[
  {
    "date": "2026-05-24",
    "forecast": 18.5432,
    "low80": 13.2145,
    "high80": 23.8719,
    "low95": 10.4321,
    "high95": 26.6543,
    "actual": 18.5432
  },
  {
    "date": "2026-06-24",
    "forecast": 18.9884,
    "low80": 7.92,
    "high80": 30.0569,
    "low95": 2.0663,
    "high95": 35.9105,
    "actual": null
  }
]
```

> Les points avec `actual != null` sont des données historiques (les 30 derniers jours).  
> Les points avec `actual = null` sont les prévisions futures.

---

#### `GET /api/forecast/summary`

Cartes résumé : total prévu, modèle gagnant, métriques.

Mêmes paramètres que `GET /api/forecast/`.

**Réponse 200** — `ForecastSummary`
```json
{
  "horizon_days": 60,
  "total_forecast": 614.68,
  "daily_avg_forecast": 20.4893,
  "best_model": "TimesNet (SNaive)",
  "best_model_mae": 4.7829,
  "best_model_mape": 20.88,
  "models_evaluated": 6
}
```

---

#### `GET /api/forecast/models`

Benchmark complet des 6 modèles par walk-forward cross-validation (5 folds, horizon 14 jours). Résultats triés par MAE croissant.

**Réponse 200** — `List[ModelBenchmark]`
```json
[
  {
    "rank": 1,
    "model": "TimesNet (SNaive)",
    "family": "Seasonal Naive",
    "mae": 4.7829,
    "rmse": 7.1234,
    "mape": 20.88,
    "r2": 0.1234,
    "score": 1.0,
    "winner": true
  },
  {
    "rank": 2,
    "model": "N-HiTS (HW)",
    "family": "Holt-Winters",
    "mae": 5.4142,
    "rmse": 8.2341,
    "mape": 22.14,
    "r2": 0.0891,
    "score": 1.1319,
    "winner": false
  }
]
```

> `score = mae / best_mae` — ratio par rapport au meilleur modèle. Plus bas = meilleur.

---

#### `GET /api/forecast/models/list`

Liste des noms de modèles disponibles.

**Réponse 200**
```json
{
  "models": [
    "AutoETS",
    "AutoTheta",
    "AutoARIMA",
    "Prophet (SES)",
    "N-HiTS (HW)",
    "TimesNet (SNaive)"
  ]
}
```

---

## Pipeline analytique

### Chargement des données (`data/loader.py`)

Les deux fichiers Parquet sont chargés une seule fois au démarrage du serveur (lifespan) puis mis en cache via `@lru_cache(maxsize=1)`. Les requêtes suivantes ne font aucune I/O disque.

```
Startup
  └── load_daily_costs()          → df (170×2)   [LRU cache]
  └── load_daily_per_service()    → df (170×10)  [LRU cache]
```

### Analyse de la série (`analysis/timeseries.py`)

| Fonction | Algorithme | Bibliothèque |
|---|---|---|
| `get_daily_series()` | Rolling mean 7j + expanding std pour CI 95% | pandas |
| `get_descriptive_stats()` | Mean, median, std, CV, skew, kurtosis, IQR, MAD | numpy, scipy.stats |
| `get_stationarity()` | ADF (autolag=AIC) + KPSS (regression=c, nlags=auto) | statsmodels |
| `get_stl_decomposition()` | STL period=7, robust=True + forces Ft/Fs | statsmodels |
| `get_anomalies()` | Z-score = (x - μ) / σ | numpy |
| `get_acf_pacf()` | ACF (FFT) + PACF jusqu'à nlags | statsmodels |

### Analyse par service (`analysis/services.py`)

| Fonction | Calcul |
|---|---|
| `get_service_shares()` | Sum par service → sort Pareto → CV par service |
| `get_kpi()` | Total, moyenne, pente OLS, forecast 14j MA, count anomalies |

---

## Moteur de prévision

### Modèles implémentés (`forecast/engine.py`)

| Clé API | Famille | Algorithme |
|---|---|---|
| `AutoETS` | Exp. Smoothing | Holt additive (trend, no seasonal) — optimisation MLE |
| `AutoTheta` | Theta | OLS trend + SES détrended, alpha=0.5, combiné à 50/50 |
| `AutoARIMA` | ARIMA | ARIMA(1,1,1) — intervalles analytiques via `get_forecast()` |
| `Prophet (SES)` | Exp. Smoothing | Simple Exponential Smoothing, alpha optimisé |
| `N-HiTS (HW)` | Holt-Winters | ETS additif trend + saisonnier période 7 |
| `TimesNet (SNaive)` | Seasonal Naive | Répétition de la dernière semaine observée |

### Walk-forward cross-validation

```
Série de 170 jours   →   5 folds   ×   horizon 14 jours

Fold 1 : train=[0..100]   test=[101..114]
Fold 2 : train=[0..114]   test=[115..128]
Fold 3 : train=[0..128]   test=[129..142]
Fold 4 : train=[0..142]   test=[143..156]
Fold 5 : train=[0..156]   test=[157..170]
```

Métriques calculées sur la concaténation des 5 folds :
- **MAE** — Mean Absolute Error (€)
- **RMSE** — Root Mean Squared Error (€)
- **MAPE** — Mean Absolute Percentage Error (%)
- **R²** — Coefficient de détermination

### Intervalles de confiance

Les IC sont calculés à partir de l'écart-type des résidus en supposant une distribution normale :

```
IC 80% : ŷ ± 1.282 × σ_résidus × √h
IC 95% : ŷ ± 1.960 × σ_résidus × √h
```

où `h` est l'horizon (nombre de pas dans le futur).

---

## Schémas de réponse

### `DailyPoint`
```
date      string   "YYYY-MM-DD"
cost      float    Coût brut journalier (€)
ma7       float    Moyenne mobile 7 jours (€)
ci_low    float    Borne basse IC 95% (clampée à 0)
ci_high   float    Borne haute IC 95%
```

### `ServiceShare`
```
service   string   Nom du service GCP
cost      float    Coût total sur la période (€)
pct       float    Part en % du total
cv        float    Coefficient de variation (%)
cum_pct   float    % cumulé Pareto
```

### `AnomalyPoint`
```
date        string   "YYYY-MM-DD"
cost        float    Coût (€)
zscore      float    (coût - μ) / σ
is_anomaly  bool     |zscore| > z_threshold
```

### `STLPoint`
```
date      string   "YYYY-MM-DD"
trend     float    Composante tendance (€)
seasonal  float    Composante saisonnière (€)
residual  float    Résidu (€)
```

### `ForecastPoint`
```
date      string          "YYYY-MM-DD"
forecast  float           Point central (€)
low80     float           Borne basse IC 80%
high80    float           Borne haute IC 80%
low95     float           Borne basse IC 95%
high95    float           Borne haute IC 95%
actual    float | null    Valeur réelle (null = futur)
```

### `ModelBenchmark`
```
rank    int     Classement (1 = meilleur)
model   string  Nom du modèle
family  string  Famille algorithmique
mae     float   €
rmse    float   €
mape    float   %
r2      float   Coefficient de détermination
score   float   mae / best_mae (1.0 = gagnant)
winner  bool    true si rank == 1
```

### `KPIData`
```
total_spend       float    Total € sur la période
daily_avg         float    Moyenne €/jour
trend_slope       float    Pente OLS (€/jour)
forecast_next_30  float    Prévision 30 jours (MA 14j × 30)
anomaly_count     int      Nombre de jours Z > 2
top_service       string   Service le plus coûteux
top_service_pct   float    Part du service dominant (%)
data_points       int      Nombre de jours analysés
period_start      string   "YYYY-MM-DD"
period_end        string   "YYYY-MM-DD"
```

---

## Configuration

Toutes les valeurs sont surchargeable par variable d'environnement (préfixe vide, case-insensitive) ou dans un fichier `.env` à la racine du dossier `back/`.

| Variable | Défaut | Description |
|---|---|---|
| `APP_NAME` | `FinOps Analyser` | Titre affiché dans le Swagger |
| `APP_VERSION` | `0.2.0` | Version de l'API |
| `ENV` | `dev` | `dev` · `staging` · `prod` |
| `DEBUG` | `false` | Logs verbeux |
| `HOST` | `0.0.0.0` | Adresse d'écoute |
| `PORT` | `8080` | Port d'écoute |
| `CORS_ORIGINS` | `*` | Origines autorisées (virgule-séparées en prod) |

Exemple `.env` pour la production :
```env
ENV=prod
CORS_ORIGINS=https://finops.demo.com,https://www.finops.demo.com
PORT=8080
```

---

## Logs & Observabilité

Chaque requête reçoit un identifiant de corrélation `X-Request-Id` (header entrant ou généré). Cet identifiant est propagé dans tous les logs JSON et retourné dans le header de réponse.

Format de log :
```json
{
  "ts": "2026-06-26T10:23:41",
  "level": "INFO",
  "logger": "analysis.timeseries",
  "msg": "STL decomposition computed",
  "request_id": "a3f891bc2d4e"
}
```

---

## Docker

### Build

```bash
cd back
docker build --platform linux/amd64 -t finops-backend:latest .
```

### Run

```bash
docker run --rm -p 8080:8080 finops-backend:latest
```

### Variables d'environnement au runtime

```bash
docker run --rm -p 8080:8080 \
  -e ENV=prod \
  -e CORS_ORIGINS=https://mon-front.com \
  finops-backend:latest
```

---

## Gestion des erreurs

Toutes les erreurs retournent un JSON structuré identique :

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

| Exception | Code HTTP | Code JSON |
|---|---|---|
| `BadRequest` | 400 | `BAD_REQUEST` |
| `Unauthorized` | 401 | `UNAUTHORIZED` |
| `Forbidden` | 403 | `FORBIDDEN` |
| `NotFound` | 404 | `NOT_FOUND` |
| `DependencyError` | 500 | `DEPENDENCY_ERROR` |
