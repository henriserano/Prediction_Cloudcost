# Frontend · FinOps GCP Dashboard

Dashboard interactif Next.js 16 pour la visualisation et l'analyse des coûts multi-cloud (GCP + AWS) d'un compte de facturation d'entreprise (données de démonstration). **100% branché sur l'API FastAPI** — plus de mockData. Sept pages, 31 hooks TanStack Query, un parseur CSV/Excel bilingue, un flux OAuth GCP complet.

> ⚠️ **Next.js 16 : breaking changes vs 15.x.** APIs, conventions et layout de fichiers peuvent différer des ressources d'entraînement. Consulter `AGENTS.md` puis `node_modules/next/dist/docs/` avant modification. Respecter les avis de dépréciation.

---

## Sommaire

1. [Stack technique](#stack-technique)
2. [Structure du projet](#structure-du-projet)
3. [Pages](#pages)
4. [Composants](#composants)
5. [Hooks API (TanStack Query)](#hooks-api-tanstack-query)
6. [Lib · parsers, context, utils](#lib--parsers-context-utils)
7. [Types TypeScript & contrat API](#types-typescript--contrat-api)
8. [Configuration (`next.config.js`)](#configuration-nextconfigjs)
9. [Démarrage](#démarrage)
10. [Build & déploiement](#build--déploiement)
11. [Design system Sia](#design-system-sia)

---

## Stack technique

| Élément | Version | Rôle |
|---|---|---|
| Next.js | 16.2.9 | Framework React · App Router · rewrites API |
| React | 19.2.7 | UI (Server + Client components) |
| TypeScript | 5 | Typage strict |
| Tailwind CSS | 4 | Utility-first styles |
| Recharts | 2.15 | Graphiques SVG déclaratifs |
| TanStack Query | 5.101 | Data fetching + cache + retries |
| axios | 1.18 | Client HTTP + intercepteur snake_case→camelCase |
| shadcn/ui + Base UI | — | Primitives accessibles |
| Lucide React | 0.511 | Icônes |
| Zod | 4.4 | Validation schémas |
| clsx + tailwind-merge | — | Merge classes Tailwind (`cn` helper) |
| tw-animate-css | 1.4 | Animations Tailwind |

---

## Structure du projet

```
front_finops/
│
├── app/                                    # Next.js App Router
│   ├── layout.tsx                          # Root : Metadata, Viewport, Sidebar, providers
│   ├── page.tsx                            # Redirect → /dashboard
│   ├── providers.tsx                       # QueryClientProvider + SidebarProvider
│   ├── globals.css                         # Tailwind + variables Sia (oklch)
│   ├── robots.ts sitemap.ts                # SEO
│   │
│   ├── dashboard/                          # KPIs, tendance, services, anomalies
│   ├── forecast/                           # Prévision + benchmark 6 modèles
│   ├── services/                           # Pareto 80/20 · dual-source local/GCP
│   ├── analytics/                          # STL, stats, stationnarité, ACF
│   │
│   ├── diagnostics/                        # 7 onglets ML/stats
│   │   ├── page.tsx                        # Tab nav
│   │   └── _components/
│   │       ├── OutliersTab.tsx
│   │       ├── DriftTab.tsx
│   │       ├── DistributionTab.tsx
│   │       ├── ScalingTab.tsx
│   │       ├── MissingTab.tsx
│   │       ├── DimReductionTab.tsx
│   │       ├── EnsembleTab.tsx
│   │       └── shared.ts                   # Palette + formatters
│   │
│   ├── data-sources/                       # Upload CSV/Excel + connect GCP + AWS
│   │   └── page.tsx                        # FileTab · GCPTab · AWSTab
│   │
│   └── gcp-connect/                        # OAuth flow + projets/billing/logs/services
│       └── page.tsx
│
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx                     # Navigation fixe · responsive · Sia logo
│   │   └── PageShell.tsx                   # Wrapper eyebrow/title/description
│   └── ui/
│       ├── card.tsx                        # Card + Header/Title/Description/Content/Footer/Action
│       ├── kpi-card.tsx                    # Carte KPI avec tone/delta/info
│       ├── section-card.tsx                # Container Section avec accent bar
│       ├── badge.tsx                       # Variants (default, coral, success, warning, destructive, muted)
│       ├── button.tsx input.tsx dialog.tsx # shadcn primitives
│       ├── empty-state.tsx                 # Placeholder centré
│       ├── skeleton.tsx                    # Pulse loading
│       ├── explain.tsx                     # Popover pédagogique + <Verdict>
│       └── logo.tsx                        # Logo Sia
│
└── lib/
    ├── types.ts                            # ~30 interfaces = contrat API (camelCase)
    ├── api.ts                              # axios instance + intercepteur snake→camel
    ├── utils.ts                            # cn() helper
    ├── mockData.ts                         # (LEGACY — plus utilisé, conservé pour historique)
    ├── hooks/
    │   ├── useApi.ts                       # 31 hooks TanStack Query
    │   └── useSelectedGCPProject.ts        # localStorage-backed via useSyncExternalStore
    ├── context/
    │   └── sidebar-context.tsx             # useSidebar() pour mobile drawer
    └── parsers/
        └── billing-file.ts                 # Parse CSV/Excel, alias fuzzy, format detection
```

---

## Pages

### `/dashboard` — Vue d'ensemble

**Hooks** : `useKPI`, `useDaily(60)`, `useServices`, `useAnomalies(2.0)`

Layout :

```
┌────────┬────────┬────────┬────────┐
│ Total  │ Moy.   │ Prévi- │ Anoma- │  KPICard × 4 (tone brand/coral/success/muted)
│ dépense│ /jour  │ sion30j│ lies   │
└────────┴────────┴────────┴────────┘
┌──────────────────────┬────────────┐
│ Tendance quotidienne │ Répartition│  AreaChart (60 derniers jours)
│ Coût + MA7 + IC95%   │ par service│  · Barres CSS · Top 6 services
└──────────────────────┴────────────┘
┌──────────────────┬────────────────┐
│ Anomalies récentes│ Volatilité par │  Liste des jours Z>2 · BarChart CV%
│ (Z-score > 2)     │ service (CV%)  │
└──────────────────┴────────────────┘
```

### `/forecast` — Prévision

**Hooks** : `useForecast(horizon, model)`, `useForecastSummary(horizon, model)`, `useModelBenchmarks`  
**State** : `horizon` (7–180), `model` (dropdown 6 modèles)

- 3 KPICards en haut : Total prévu, Meilleur modèle, Nb modèles évalués
- `ComposedChart` : actuals (gris) + forecast (bleu, pointillés) + bandes IC80%/95% en gradient + `ReferenceLine "Aujourd'hui"`
- Tableau benchmark 6 modèles : rang, famille, MAE, RMSE, MAPE, R², score, médailles 🥇🥈🥉 · ligne gagnant surlignée

### `/services` — Services GCP (dual-source)

**Hooks** : `useServices` (local), `useGCPStatus`, `useGCPBilling`, `useSelectedGCPProject`  
**State** : `source` (`"local"` | `"gcp"`) via `useSourceState`

**Feature-clé** : sélecteur de source. En mode `gcp`, requiert OAuth + projet sélectionné. Adapter `UnifiedRow` normalise les deux formats vers une structure commune pour le tableau.

- ComposedChart Pareto : `Bar` (€) + `Line` (% cumulé) + `ReferenceLine` rouge à 80%
- Tableau desktop + cartes mobile (responsive)
- Badges volatilité : `CV<20%` → success (Stable), `20–60%` → warning (Modéré), `≥60%` → destructive (Volatile)

### `/analytics` — Analytique avancée

**Hooks** : `useSTL`, `useSTLStrengths`, `useStats`, `useAnomalies`, `useStationarity`

- Tableau 10 stats descriptives (mean, median, std, CV, skew, kurt, IQR, MAD, min, max)
- 3 sub-charts empilés : Tendance · Saisonnalité · Résidus (STL)
- AreaChart anomalies avec `ReferenceLine` μ, +2σ, −2σ
- Résumé stationnarité (ADF/KPSS) et STL strengths (Ft/Fs sous forme de barres)

### `/diagnostics` — 7 onglets ML/stats

**State** : `tab` (`"outliers"` | `"drift"` | `"distribution"` | `"scaling"` | `"missing"` | `"dim"` | `"ensemble"`)

Chaque onglet est un sous-composant `_components/*Tab.tsx` avec son propre hook :

| Onglet | Hook | Contenu principal |
|---|---|---|
| Outliers | `useOutliers(z, iqr)` | Consensus 5 méthodes (Z, MAD, IQR, IForest, LOF) + Mahalanobis 2D |
| Drift | `useDrift(refFrac, bins)` | KS statistic + PSI par bin + Page-Hinkley changepoints |
| Distribution | `useDistribution` | Skew, kurtosis, Box-Cox λ, 3 tests de normalité, QQ-plot |
| Scaling | `useScaling` | Série originale + StandardScaler + MinMax + Robust en surimpression |
| Missing | `useMissing` | Gaps calendaires · % NaN par service · hint MCAR/MAR/MNAR |
| DimReduction | `useDimReduction(n, tsne)` | PCA (variance ratios + top loadings) + t-SNE 2D optionnel |
| Ensemble | `useEnsembleForecast(horizon)` | Poids inverse-MAE + décomposition bias²/variance |

Chaque onglet utilise le composant `<Explain>` pour expliquer la méthode et `<Verdict>` pour donner une interprétation lisible du résultat.

### `/data-sources` — Sources de données

Trois onglets internes : **File** · **GCP** · **AWS**.

**File** (`FileTab`) :
- Drag & drop multi-fichiers (`entries: FileEntry[]`)
- Parsing client-side via `parseBillingFile()` — détection format + colonnes + preview immédiate
- Toggle `replace` (remplacer vs concaténer les événements existants)
- Envoi via `useIngestEvents` (POST `/api/events`)
- ErrorBanner / SuccessBanner / WarnBanner selon résultat

**GCP** (`GCPTab`) :
- Statut OAuth via `useGCPStatus`
- Bouton "Connect Google" → redirect `/api/gcp/auth`
- Après consentement, sélection de projet, affichage du dernier sync

**AWS** (`AWSTab`) :
- Placeholder pour saisie de credentials AWS (non implémenté côté backend pour l'instant — utilise la chaîne AWS standard)
- Utilise `useQuery` sur `/api/aws/status`

### `/gcp-connect` — Console GCP

**Hooks** : `useGCPStatus`, `useGCPProjects`, `useGCPBilling`, `useGCPLogs`, `useGCPServices`  
**State** : `selectedProject` via `useSelectedGCPProject` (persisté en localStorage)

- ConnectCard (si non authentifié) → OAuth
- AuthStatusCard (email, project actif)
- ProjectDropdown avec la liste des projets accessibles
- BillingChart (`GET /api/gcp/billing`) par service + par mois
- LogViewer (`GET /api/gcp/logs`) avec filtre par severity
- ServicesList (`GET /api/gcp/services`) catégorisée

---

## Composants

### Layout

| Composant | Rôle | Props |
|---|---|---|
| `Sidebar` | Navigation fixe, responsive mobile (hamburger + drawer), Sia logo, active route via `usePathname()` | — |
| `PageShell` | Wrapper de page standardisé | `title`, `description?`, `eyebrow?`, `actions?`, `children` |

Menu de navigation :

```tsx
const NAV = [
  { href: "/dashboard",     label: "Vue d'ensemble", icon: BarChart2 },
  { href: "/forecast",      label: "Prévision",      icon: LineChart },
  { href: "/services",      label: "Services",       icon: Layers },
  { href: "/analytics",     label: "Analytique",     icon: FlaskConical },
  { href: "/diagnostics",   label: "Diagnostics",    icon: Activity },
  { href: "/data-sources",  label: "Sources",        icon: Database },
  { href: "/gcp-connect",   label: "GCP",            icon: Cloud },
]
```

### UI

| Composant | Description |
|---|---|
| `Card` + variantes | Conteneur shadcn (Header, Title, Description, Content, Footer, Action) |
| `KPICard` | Carte KPI avec `label`, `value`, `sub?`, `icon?`, `tone` (`default`\|`coral`\|`destructive`\|`success`), `delta?`, `info?`. Hover-lift + accent bar en gradient. |
| `SectionCard` | Container de section avec `accent` (`brand`\|`coral`\|`none`) et slots `title/description/action/info` |
| `Badge` | 7 variants (`default`, `outline`, `coral`, `success`, `warning`, `destructive`, `muted`), 2 tailles |
| `Button` `Input` `Dialog` | Primitives shadcn/Base UI |
| `EmptyState` | Placeholder `icon` + `title` + `description` + `action?` |
| `Skeleton` | Pulse loading placeholder |
| `Explain` (227 lignes) | Popover pédagogique. Portal-rendered, viewport clamping, client-only. Sub-composant `<Verdict tone="positive\|neutral\|negative">` pour verdict lisible |
| `Logo` | Logo Sia SVG |

---

## Hooks API (TanStack Query)

Tous les hooks sont dans `lib/hooks/useApi.ts` (277 lignes). Base URL relative (`/api/*`) — le rewrite Next.js proxifie vers `NEXT_PUBLIC_API_URL`. `staleTime` par défaut : 5 min.

### Analytics (basiques)

| Hook | Signature | Endpoint |
|---|---|---|
| `useKPI()` | — | `/api/kpi` |
| `useDaily(lastN?)` | `(n?: number)` | `/api/daily?last_n=…` |
| `useServices()` | — | `/api/services` |
| `useAnomalies(zThreshold?)` | `(z?: number)` | `/api/anomalies?z_threshold=…` |
| `useStats()` | — | `/api/stats` |
| `useStationarity()` | — | `/api/stationarity` |
| `useSTL()` | — | `/api/stl` |
| `useSTLStrengths()` | — | `/api/stl/strengths` |
| `useACF(nlags?)` | `(n?: number)` | `/api/acf?nlags=…` |

### Forecast

| Hook | Signature | Endpoint |
|---|---|---|
| `useForecast(horizon?, model?)` | `(h?: number, m?: string)` | `/api/forecast?horizon=…&model=…` |
| `useForecastSummary(horizon?, model?)` | idem | `/api/forecast/summary` |
| `useModelBenchmarks()` | — | `/api/forecast/models` |

### Advanced

| Hook | Endpoint |
|---|---|
| `useOutliers(z, iqr)` | `/api/analysis/outliers` |
| `useDrift(refFrac, bins)` | `/api/analysis/drift` |
| `useDistribution()` | `/api/analysis/distribution` |
| `useScaling()` | `/api/analysis/scaling` |
| `useMissing()` | `/api/analysis/missing` |
| `useDimReduction(n, tsne)` | `/api/analysis/dim-reduction` |
| `useEnsembleForecast(horizon)` | `/api/analysis/ensemble-forecast` |

### GCP

| Hook | Endpoint | Notes |
|---|---|---|
| `useGCPStatus()` | `/api/gcp/status` | `staleTime: 30s` (rafraîchit vite après OAuth) |
| `useGCPProjects()` | `/api/gcp/projects` | Enabled si `authenticated` |
| `useGCPBillingAccounts()` | `/api/gcp/billing-accounts` | idem |
| `useGCPBilling(projectId, months)` | `/api/gcp/billing` | Enabled si projectId défini |
| `useGCPLogs(projectId, limit, severity)` | `/api/gcp/logs` | idem |
| `useGCPServices(projectId)` | `/api/gcp/services` | idem |

### AWS

| Hook | Endpoint |
|---|---|
| `useAWSStatus()` | `/api/aws/status` |
| `useAWSBilling(start, end, months, granularity)` | `/api/aws/billing` |
| `useAWSServices(months)` | `/api/aws/services` |

### Data status

| Hook | Endpoint |
|---|---|
| `useDataStatus()` | `/api/data/status` |

### Mutations

| Hook | Endpoint |
|---|---|
| `useIngestEvents()` | `POST /api/events` — invalide toutes les analytics queries en success |
| `useUploadEvents()` | `POST /api/events/upload` (FormData) |
| `usePreviewEvents()` | `POST /api/events/preview` |
| `useGCPSync()` | `POST /api/gcp/sync` |
| `useClearCache()` | `POST /admin/cache/clear` |

Toutes les mutations invalident les query keys pertinentes en `onSuccess` pour rafraîchir automatiquement les vues.

---

## Lib · parsers, context, utils

### `lib/api.ts`

```ts
export const api = axios.create({
  baseURL: "",              // relatif — rewrite Next.js s'occupe du proxy
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
})
```

Intercepteur de réponse : transformation récursive `snake_case` → `camelCase` sur tous les objets/arrays. Résultat : les hooks TanStack Query typés `<KPIData>` reçoivent directement des objets conformes au contrat TypeScript, sans code manuel de mapping.

### `lib/hooks/useSelectedGCPProject.ts` (56 lignes)

Hook basé sur `useSyncExternalStore` (React 18+) pour un state partagé cross-composant persisté en `localStorage` avec la clé `sia-finops.gcpSelectedProject`. Écoute l'événement `storage` → sync cross-tab.

### `lib/context/sidebar-context.tsx`

`SidebarContext` + `useSidebar()` — ouverture/fermeture du drawer mobile depuis n'importe où (utilisé par le hamburger dans `Sidebar` et par le layout root pour fermer sur navigation).

### `lib/parsers/billing-file.ts`

Fonction pure `parseBillingFile(file: File): Promise<ParsedResult>` — parsing client-side. Utilisé dans `/data-sources` pour prévisualiser un fichier avant upload backend.

```ts
type ParsedResult = {
  events: BillingEvent[]         // lignes normalisées
  errors: string[]               // erreurs par ligne
  totalRows: number
  detectedColumns: {             // colonnes matched par alias
    date: string
    service: string
    cost: string
    description?: string
  }
  format: "csv" | "xlsx" | "xlsb" | "xls" | "ods"
  sheetName?: string             // pour Excel multi-sheet
}
```

Aliases fuzzy (case-insensitive, whitespace-tolerant) :

- **date** : `Mois`, `Date`, `Usage Start Date`, `usage_start_time`, `day`, `ds`
- **service** : `Description du service`, `Service`, `service`, `service.description`
- **cost** : `Sous-total (€)`, `Sous-total non arrondi (€)`, `Coût catalogue (€)`, `Cost`, `cost`, `Coût`

Parse EU-locale : `1 234,56` → `1234.56` · `224,59 €` → `224.59`. Dates : `YYYY-MM-DD` ou `YYYY-MM` (→ 1er du mois).

### `lib/utils.ts`

```ts
export function cn(...inputs: ClassValue[]): string
```

Merge Tailwind via `clsx` + `tailwind-merge` (résout les conflits de classes utilitaires).

### `lib/mockData.ts` — LEGACY

Fichier historique conservé pour référence. **Aucun composant ne l'importe actuellement** — l'app est 100 % branchée sur l'API. Peut être supprimé après confirmation qu'aucun stakeholder ne s'y réfère.

---

## Types TypeScript & contrat API

`lib/types.ts` (272 lignes) définit ~30 interfaces qui reflètent l'API en `camelCase`. L'intercepteur axios convertit automatiquement le `snake_case` du backend.

**Bloc analytics :**

```ts
interface DailyPoint     { date: string; cost: number; ma7: number; ciLow: number; ciHigh: number }
interface ServiceShare   { service: string; cost: number; pct: number; cv: number; cumPct: number }
interface AnomalyPoint   { date: string; cost: number; zscore: number; isAnomaly: boolean }
interface STLPoint       { date: string; trend: number; seasonal: number; residual: number }
interface STLStrengths   { ft: number; fs: number; period: number }
interface KPIData        { totalSpend, dailyAvg, trendSlope, forecastNext30, anomalyCount, topService, topServicePct, dataPoints, periodStart, periodEnd }
interface DescriptiveStats { mean, median, std, cv, skewness, kurtosis, iqr, mad, min, max }
interface StationarityResult { adf: {statistic, pValue, isStationary, lagsUsed}; kpss: {...} }
```

**Bloc forecast :**

```ts
interface ForecastPoint  { date; forecast; low80; high80; low95; high95; actual?: number }
interface ModelBenchmark { rank; model; family; mae; rmse; mape; r2; score; winner }
interface ForecastSummary { horizonDays; totalForecast; bestModel; bestModelMae; bestModelMape; modelsEvaluated }
```

**Bloc advanced :**

```ts
interface OutliersResponse       { rows; summary; mahalanobis }
interface DriftResponse          { ks; psi; pageHinkley; nChangepointsDetected }
interface DistributionResponse   { skewness; kurtosis; boxcoxLambda; normalityTests; qqPoints }
interface ScalingResponse        { points; stats }
interface MissingResponse        { calendarDaysExpected; actualDays; missingDays; gaps; perServiceMissingPct; mechanismHint }
interface DimReductionResponse   { pcaComponents; tsne2d; nServices; nDays; totalVarianceExplained }
interface EnsembleForecastResponse { baseModels; weights; points; biasVariance }
```

**Bloc GCP :**

```ts
interface GCPAuthStatus, GCPProject, GCPBillingAccount, GCPBillingResponse, GCPLogEntry, GCPServiceInfo
interface EventsIngestRequest, EventsIngestResponse, BillingEvent
```

**Bloc AWS :**

```ts
interface AWSAuthStatus, AWSBillingResponse, AWSService
```

> **Convention** : `snake_case` backend ↔ `camelCase` frontend. Ne **jamais** exposer de `snake_case` dans les composants React — la transformation se fait dans l'intercepteur axios.

---

## Configuration (`next.config.js`)

```js
const nextConfig = {
  reactStrictMode: true,

  async headers() {
    // Sécurité : X-Frame-Options DENY, X-Content-Type-Options nosniff,
    // Referrer-Policy strict-origin, X-XSS-Protection, Permissions-Policy
    // + HSTS 2 ans en production (matches back/main.py)
  },

  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL
    if (!backendUrl && process.env.NODE_ENV === "production") {
      throw new Error("NEXT_PUBLIC_API_URL must be set in production")
    }
    const resolvedBackendUrl = backendUrl || "http://localhost:8080"
    return [
      { source: "/api/:path*", destination: `${resolvedBackendUrl}/api/:path*` },
    ]
  },
}
```

**Points d'attention** :

- ⚠️ **Pas compatible avec `output: "export"`** — les rewrites nécessitent un serveur Next.js. Pour un export statique, il faudrait remplacer par un `NEXT_PUBLIC_API_URL` inline dans `api.ts` et gérer le CORS côté backend.
- HSTS 2 ans (`63072000`) — aligné avec l'entête HSTS du backend (`back/main.py`). Nécessaire pour l'éligibilité HSTS preload.
- L'app est 100 % client-side render (CSR) — pas de SSG ni ISR utilisés. Toutes les données sont récupérées via TanStack Query côté client.

Variables d'environnement :

| Variable | Défaut | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` (dev), **required** en prod | Base URL du backend FastAPI |
| `BACKEND_API_KEY` | (vide) | **Secret côté serveur** (pas de préfixe `NEXT_PUBLIC`). Clé envoyée en header `X-API-Key` par les Route Handlers Next (`app/api/events`, `app/api/events/upload`, `app/api/aws/connect`) vers les endpoints mutateurs du backend. Vide en dev (le backend laisse passer). **À définir sur Vercel** en production. |
| `BACKEND_API_URL` | (vide → fallback `NEXT_PUBLIC_API_URL`) | Optionnel : URL interne du backend utilisée par les Route Handlers si elle diffère de l'URL publique |
| `NODE_ENV` | (auto) | `development` / `production` — pilote l'ajout de HSTS |

> **Proxy des endpoints mutateurs** : les rewrites Next ne peuvent pas ajouter de headers. Les POST `/api/events`, `/api/events/upload` et `/api/aws/connect` passent donc par des Route Handlers App Router (`app/api/**/route.ts`, prioritaires sur les rewrites) qui forwardent body/query/cookies et ajoutent `X-API-Key`. Les GET restent sur les rewrites ; les endpoints GCP utilisent un cookie de session, pas la clé.

---

## Démarrage

```bash
cd front_finops
npm install
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
# → http://localhost:3000 (redirection automatique vers /dashboard)
```

Scripts :

| Commande | Description |
|---|---|
| `npm run dev` | Serveur de dev avec hot reload (Next.js dev) |
| `npm run build` | Build de production optimisé |
| `npm start` | Serve la build de prod |
| `npm run lint` | ESLint 9 flat config |
| `npx tsc --noEmit` | Type-check strict sans emission |

---

## Build & déploiement

### Vercel (recommandé)

L'app est déjà déployée à `https://finopsgcp.vercel.app/` (URL référencée par le backend via `FRONTEND_URL`).

```bash
vercel --prod
```

Variables à définir dans Vercel :

- `NEXT_PUBLIC_API_URL` = URL publique du backend (ex : `https://finops-dev-alb-…elb.amazonaws.com`)
- `BACKEND_API_KEY` = clé API du backend (header `X-API-Key` des endpoints mutateurs) — secret runtime côté serveur, jamais exposé au client

### Docker (self-hosted)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

⚠️ `NEXT_PUBLIC_API_URL` doit être injectée **au build**, pas au runtime (Next.js inline les variables `NEXT_PUBLIC_*` dans le bundle client).

---

## Design system Sia

- Palette **oklch** définie dans `app/globals.css` (variables CSS pour compatibilité light/dark)
- Accent primaire : brand (bleu Sia), accent secondaire : coral
- Motion : `tw-animate-css` pour transitions douces (fade, slide, scale)
- Iconographie : Lucide React (`lucide-react`) — cohérente, monoline, stroke 2
- Responsive : mobile-first, breakpoints Tailwind par défaut (sm 640, md 768, lg 1024, xl 1280)
- A11y : Base UI + shadcn = primitives ARIA-conformes ; `Explain` popover clamped au viewport
