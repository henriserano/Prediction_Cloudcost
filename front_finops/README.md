# Frontend — FinOps GCP Dashboard

Dashboard interactif Next.js 16 pour la visualisation et l'analyse des coûts GCP demo. Construit avec App Router, Tailwind CSS 4, Recharts et shadcn/ui. Actuellement alimenté par des données mock déterministes — prêt à être branché sur l'API FastAPI via TanStack Query.

---

## Sommaire

1. [Stack technique](#stack-technique)
2. [Structure du projet](#structure-du-projet)
3. [Pages et fonctionnalités](#pages-et-fonctionnalités)
4. [Composants](#composants)
5. [Types TypeScript & contrat API](#types-typescript--contrat-api)
6. [Données mock](#données-mock)
7. [Intégration API (guide)](#intégration-api-guide)
8. [Démarrage](#démarrage)
9. [Build & déploiement](#build--déploiement)

---

## Stack technique

| Élément | Version | Rôle |
|---|---|---|
| Next.js | 16.2.9 | Framework React — App Router |
| React | 19.2.7 | UI rendering |
| TypeScript | 5 | Typage statique |
| Tailwind CSS | 4 | Styles utilitaires |
| Recharts | 2.15 | Graphiques SVG déclaratifs |
| shadcn/ui + Base UI | — | Composants UI accessibles |
| TanStack React Query | 5.101 | Data fetching / cache (prêt, non encore branché) |
| axios | 1.18 | Client HTTP |
| Lucide React | 1.21 | Icônes |
| Zod | 4.4 | Validation de schémas |

---

## Structure du projet

```
front_finops/
│
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Layout racine : Sidebar + corps
│   ├── page.tsx                  # Redirect /dashboard
│   ├── globals.css               # Variables CSS Tailwind + thème
│   ├── dashboard/
│   │   └── page.tsx              # Vue d'ensemble
│   ├── forecast/
│   │   └── page.tsx              # Prévision + benchmark modèles
│   ├── services/
│   │   └── page.tsx              # Pareto 80/20 par service
│   └── analytics/
│       └── page.tsx              # STL · stats · stationnarité
│
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx           # Navigation latérale 4 pages
│   │   └── PageShell.tsx         # Wrapper titre + description + main
│   └── ui/
│       ├── card.tsx              # Card, CardHeader, CardTitle, CardContent…
│       ├── button.tsx            # Button (variants, tailles)
│       ├── input.tsx             # Input texte
│       └── dialog.tsx            # Modal accessible
│
└── lib/
    ├── types.ts                  # Interfaces TypeScript (= contrat API)
    ├── mockData.ts               # Données déterministes pour dev sans API
    └── utils.ts                  # Helpers Tailwind (cn)
```

---

## Pages et fonctionnalités

### `/dashboard` — Vue d'ensemble

**Endpoint API utilisé :** `GET /api/kpi`, `GET /api/daily`, `GET /api/services`, `GET /api/anomalies`

**Contenu :**

```
┌────────┬────────┬────────┬────────┐
│ Total  │ Moy.   │ Prévi- │ Anoma- │
│ dépense│ /jour  │ sion30j│ lies   │
└────────┴────────┴────────┴────────┘
┌──────────────────────┬────────────┐
│ Tendance quotidienne │ Répartition│
│ Coût brut + MA7 +   │ par service│
│ bandes IC 95%        │ (barres %) │
│ (60 derniers jours)  │            │
└──────────────────────┴────────────┘
┌──────────────────┬────────────────┐
│ Anomalies        │ Volatilité     │
│ Liste des jours  │ Bar chart CV%  │
│ Z-score > 2      │ par service    │
└──────────────────┴────────────────┘
```

**Graphiques :**
- `AreaChart` (Recharts) — courbe coût brut + MA7 + bandes IC 95% en gradient bleu
- Barres horizontales custom CSS — répartition % par service (top 6, colorées)
- `BarChart` horizontal — coefficient de variation par service

---

### `/forecast` — Prévision

**Endpoint API utilisé :** `GET /api/forecast/`, `GET /api/forecast/summary`, `GET /api/forecast/models`

**Contenu :**

```
┌──────────────┬──────────────┬──────────────┐
│ Prévision 30j│ Meilleur     │ Modèles      │
│ (€ total)    │ modèle       │ évalués (6)  │
└──────────────┴──────────────┴──────────────┘
┌────────────────────────────────────────────┐
│  ComposedChart                             │
│  - Ligne grise   : valeurs réelles         │
│  - Ligne bleue   : prévision (pointillés)  │
│  - Zone IC 95%   : gradient bleu léger     │
│  - Zone IC 80%   : gradient bleu moyen     │
│  - ReferenceLine : ligne "Aujourd'hui"     │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│  Tableau benchmark 6 modèles               │
│  Rang · Modèle · Famille · MAE · RMSE      │
│  MAPE · R² · Score                         │
│  Médailles 🥇🥈🥉 · Ligne gagnant surlignée │
└────────────────────────────────────────────┘
```

---

### `/services` — Services GCP

**Endpoint API utilisé :** `GET /api/services`, `GET /api/kpi`

**Contenu :**

```
┌──────────────┬──────────────┬──────────────┐
│ Nb services  │ Service      │ Top 5 =      │
│ analysés (9) │ dominant     │ 87% total    │
└──────────────┴──────────────┴──────────────┘
┌────────────────────────────────────────────┐
│  ComposedChart Pareto 80/20                │
│  - Bar (axe gauche €)  : coût par service  │
│  - Line (axe droit %)  : % cumulé Pareto   │
│  - ReferenceLine rouge : seuil 80%         │
└────────────────────────────────────────────┘
┌────────────────────────────────────────────┐
│  Tableau détail par service                │
│  Service · Coût · Part % · % Cumulé        │
│  CV% · Badge profil (Stable/Modéré/Volatile│
└────────────────────────────────────────────┘
```

**Badge profil de volatilité :**
- `CV < 20%` → vert — **Stable**
- `20% ≤ CV < 60%` → orange — **Modéré**
- `CV ≥ 60%` → rouge — **Volatile**

---

### `/analytics` — Analytique avancée

**Endpoint API utilisé :** `GET /api/stl`, `GET /api/stl/strengths`, `GET /api/stats`, `GET /api/anomalies`, `GET /api/stationarity`

**Contenu :**

```
┌────────────────────┬───────────────────────┐
│ Stats descriptives │ Décomposition STL      │
│ 10 indicateurs     │ 3 sub-charts empilés   │
│ (tableau)          │ Tendance · Saisonnalité│
│                    │ Résidus                │
└────────────────────┴───────────────────────┘
┌────────────────────────────────────────────┐
│  Anomalies ±2σ                             │
│  AreaChart + points rouges sur anomalies   │
│  ReferenceLine μ, +2σ, -2σ                 │
└────────────────────────────────────────────┘
┌──────────────────┬─────────────────────────┐
│ Tests stationn.  │ Résumé STL              │
│ ADF p=0.016 ✓    │ Ft=0.44 (barres)        │
│ KPSS p=0.01 ⚠    │ Fs=0.36 (barres)        │
│ Verdict : trend- │ ACF/PACF lags 1, 7, 14  │
│ stationnaire     │                         │
└──────────────────┴─────────────────────────┘
```

---

## Composants

### `Sidebar` (`components/layout/Sidebar.tsx`)

Navigation latérale fixe. Utilise `usePathname()` pour le surlignage de la route active.

```tsx
const NAV = [
  { href: "/dashboard", label: "Vue d'ensemble", icon: BarChart2 },
  { href: "/forecast",  label: "Prévision",       icon: LineChart  },
  { href: "/services",  label: "Services",         icon: Layers     },
  { href: "/analytics", label: "Analytique",       icon: FlaskConical },
]
```

Footer : période des données + modèle actif (`AutoETS`).

### `PageShell` (`components/layout/PageShell.tsx`)

Wrapper standardisé pour chaque page. Accepte `title`, `description?` et `children`.

```tsx
<PageShell
  title="Vue d'ensemble"
  description="Coûts GCP · janvier – juin 2026"
>
  {/* contenu */}
</PageShell>
```

### `Card` et variantes (`components/ui/card.tsx`)

Système complet shadcn :
- `Card` — conteneur avec variants de taille
- `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter`
- `CardAction` — slot d'action droite dans le header

---

## Types TypeScript & contrat API

Le fichier `lib/types.ts` définit l'ensemble du contrat entre le front et le backend. Ces types correspondent exactement aux schémas Pydantic de l'API.

```typescript
// Série journalière
interface DailyPoint {
  date: string     // "YYYY-MM-DD"
  cost: number     // coût brut €
  ma7: number      // moyenne mobile 7j
  ciLow: number    // borne basse IC 95%
  ciHigh: number   // borne haute IC 95%
}

// Répartition service
interface ServiceShare {
  service: string  // nom GCP
  cost: number     // total €
  pct: number      // part %
  cv: number       // coeff. variation %
  cumPct: number   // % cumulé Pareto
}

// Anomalie
interface AnomalyPoint {
  date: string
  cost: number
  zscore: number
  isAnomaly: boolean
}

// STL
interface STLPoint {
  date: string
  trend: number
  seasonal: number
  residual: number
}

// Prévision
interface ForecastPoint {
  date: string
  forecast: number
  low80: number
  high80: number
  low95: number
  high95: number
  actual?: number   // null = futur
}

// Benchmark modèle
interface ModelBenchmark {
  rank: number
  model: string
  family: string
  mae: number
  rmse: number
  mape: number
  r2: number
  score: number
  winner: boolean
}

// KPIs globaux
interface KPIData {
  totalSpend: number
  dailyAvg: number
  trend: number
  forecastNext30: number
  anomalyCount: number
  topService: string
  topServicePct: number
  dataPoints: number
}

// Stats descriptives
interface DescriptiveStats {
  mean: number
  median: number
  std: number
  cv: number
  skewness: number
  kurtosis: number
  iqr: number
  mad: number
  min: number
  max: number
}
```

> **Note de nommage :** L'API Python utilise `snake_case` (`ci_low`, `is_anomaly`, `cum_pct`). Le front utilise `camelCase`. Lors de l'intégration API, appliquer une transformation ou configurer axios avec un intercepteur.

---

## Données mock

`lib/mockData.ts` exporte des constantes déterministes qui reproduisent fidèlement les résultats des notebooks Jupyter :

| Export | Correspond à | Lignes |
|---|---|---|
| `DAILY_DATA` | `GET /api/daily` | 170 points |
| `SERVICE_SHARES` | `GET /api/services` | 9 services |
| `ANOMALY_DATA` | `GET /api/anomalies` | 170 points, 4 anomalies |
| `STL_DATA` | `GET /api/stl` | 170 points |
| `FORECAST_DATA` | `GET /api/forecast/` | 30 hist + 60 prév. |
| `MODEL_BENCHMARKS` | `GET /api/forecast/models` | 6 modèles |
| `KPI_DATA` | `GET /api/kpi` | 1 objet |
| `DESCRIPTIVE_STATS` | `GET /api/stats` | 1 objet |

Les valeurs sont calculées avec des fonctions sinus/cosinus (pas de `Math.random()`) pour garantir la reproductibilité entre les rendus SSR et CSR.

---

## Intégration API (guide)

### 1. Configurer la variable d'environnement

```env
# front_finops/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8080
```

### 2. Créer un client axios typé

```typescript
// lib/api.ts
import axios from "axios"

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  // Convertir snake_case → camelCase si besoin
})
```

### 3. Exemple de hook TanStack Query

```typescript
// lib/hooks/useKPI.ts
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { KPIData } from "@/lib/types"

export function useKPI() {
  return useQuery<KPIData>({
    queryKey: ["kpi"],
    queryFn: () => api.get("/api/kpi").then(r => r.data),
    staleTime: 5 * 60 * 1000,  // 5 minutes
  })
}
```

### 4. Remplacer l'import mockData dans une page

```typescript
// Avant
import { KPI_DATA } from "@/lib/mockData"

// Après
import { useKPI } from "@/lib/hooks/useKPI"

export default function DashboardPage() {
  const { data: kpi, isLoading } = useKPI()
  if (isLoading) return <Skeleton />
  // ...utiliser kpi.totalSpend, kpi.dailyAvg, etc.
}
```

### 5. Wrapper QueryClient dans le layout

```tsx
// app/layout.tsx
import { QueryClientProvider, QueryClient } from "@tanstack/react-query"

const queryClient = new QueryClient()

export default function RootLayout({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
```

---

## Démarrage

```bash
# Depuis la racine du dépôt
cd front_finops
npm install
npm run dev
# → http://localhost:3000
```

| Commande | Description |
|---|---|
| `npm run dev` | Serveur de développement (hot reload) |
| `npm run build` | Build de production optimisé |
| `npm start` | Démarre le serveur de production (après build) |
| `npm run lint` | ESLint sur tout le projet |

---

## Build & déploiement

### Build statique (CDN / S3)

Ajouter dans `next.config.js` :
```js
const nextConfig = {
  output: "export",
  reactStrictMode: true,
}
```

Puis :
```bash
npm run build
# → dossier out/ prêt pour S3 / CloudFront
```

### Container Docker

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### Variables d'environnement en production

| Variable | Exemple | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.finops.demo.com` | URL de base de l'API FastAPI |
