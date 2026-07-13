"use client"

import { useMemo, useSyncExternalStore } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type {
  AzureBillingResponse,
  AzureSubscription,
  GCPBillingResponse,
  GCPProject,
} from "@/lib/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Provider = "gcp" | "aws" | "azure"

export interface PortfolioMember {
  provider: Provider
  id: string
  label?: string
}

export interface Portfolio {
  id: string
  name: string
  members: PortfolioMember[]
  createdAt: string
}

// Provider payloads that the collecte page already knows how to call. Kept
// here so PortefeuilleView doesn't need to reach into the /api/aws hooks that
// currently live inline in the collecte page.
interface AWSAccount {
  accountId: string
  name: string
  email: string | null
  status: string | null
  source: "organizations" | "sts"
}
interface AWSBillingResponse {
  accountId: string | null
  total: number
  currency: string
  byService: { service: string; cost: number; pct: number }[]
  byMonth: { month: string; cost: number }[]
}

// ---------------------------------------------------------------------------
// localStorage-backed store (SSR-safe via useSyncExternalStore)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "sia:portfolios:v1"

// Server snapshot must be stable across renders — a fresh [] each call would
// break useSyncExternalStore's reference-equality check under SSR.
const EMPTY: Portfolio[] = []

// Module-level snapshot cache. useSyncExternalStore requires getSnapshot to
// return the *same* reference when the underlying data hasn't changed —
// otherwise React throws "The result of getSnapshot should be cached to avoid
// an infinite loop". We cache the parsed value and only re-parse when the raw
// localStorage string changes.
let cachedRaw: string | null | undefined = undefined
let cachedSnapshot: Portfolio[] = EMPTY

function parseStore(raw: string | null): Portfolio[] {
  if (!raw) return EMPTY
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    // Shallow validation — reject anything that doesn't look like a Portfolio.
    const valid = parsed.filter(
      (p): p is Portfolio =>
        !!p &&
        typeof p === "object" &&
        typeof (p as Portfolio).id === "string" &&
        typeof (p as Portfolio).name === "string" &&
        Array.isArray((p as Portfolio).members),
    )
    return valid.length === 0 ? EMPTY : valid
  } catch {
    return EMPTY
  }
}

function readStore(): Portfolio[] {
  if (typeof window === "undefined") return EMPTY
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === cachedRaw) return cachedSnapshot
  cachedRaw = raw
  cachedSnapshot = parseStore(raw)
  return cachedSnapshot
}

function writeStore(next: Portfolio[]): void {
  if (typeof window === "undefined") return
  const serialized = JSON.stringify(next)
  window.localStorage.setItem(STORAGE_KEY, serialized)
  // Pre-seed the cache so the follow-up readStore() returns the same
  // reference as `next` (avoids a redundant parse on the next render).
  cachedRaw = serialized
  cachedSnapshot = next
  // Notify subscribers in the same tab. `storage` event only fires cross-tab.
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }))
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener()
  }
  window.addEventListener("storage", handler)
  return () => window.removeEventListener("storage", handler)
}

function getServerSnapshot(): Portfolio[] {
  return EMPTY
}

export interface PortfolioOps {
  create: (name: string, members?: PortfolioMember[]) => Portfolio
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  addMember: (portfolioId: string, member: PortfolioMember) => void
  removeMember: (portfolioId: string, provider: Provider, memberId: string) => void
}

/**
 * Read/write portfolios stored in localStorage. Uses useSyncExternalStore so
 * every consumer in the tree updates on any mutation without a context
 * provider.
 */
export function usePortfolios(): { portfolios: Portfolio[]; ops: PortfolioOps } {
  const portfolios = useSyncExternalStore(subscribe, readStore, getServerSnapshot)

  const ops = useMemo<PortfolioOps>(() => {
    return {
      create: (name, members = []) => {
        const p: Portfolio = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `pf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: name.trim() || "Portefeuille",
          members,
          createdAt: new Date().toISOString(),
        }
        writeStore([...readStore(), p])
        return p
      },
      rename: (id, name) => {
        writeStore(
          readStore().map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)),
        )
      },
      remove: (id) => {
        writeStore(readStore().filter((p) => p.id !== id))
      },
      addMember: (portfolioId, member) => {
        writeStore(
          readStore().map((p) => {
            if (p.id !== portfolioId) return p
            const already = p.members.some(
              (m) => m.provider === member.provider && m.id === member.id,
            )
            if (already) return p
            return { ...p, members: [...p.members, member] }
          }),
        )
      },
      removeMember: (portfolioId, provider, memberId) => {
        writeStore(
          readStore().map((p) => {
            if (p.id !== portfolioId) return p
            return {
              ...p,
              members: p.members.filter(
                (m) => !(m.provider === provider && m.id === memberId),
              ),
            }
          }),
        )
      },
    }
  }, [])

  return { portfolios, ops }
}

// ---------------------------------------------------------------------------
// Cross-provider account catalog — union of GCP projects, AWS accounts, Azure
// subs, only when the provider is authenticated.
// ---------------------------------------------------------------------------

export interface AvailableAccount {
  provider: Provider
  id: string
  label: string
}

export function useAvailableAccounts(): {
  accounts: AvailableAccount[]
  loading: boolean
} {
  // Local status probes — kept small so this hook is safe to import in any
  // client component.
  const gcpStatus = useQuery<{ authenticated: boolean }>({
    queryKey: ["gcp-status"],
    queryFn: () => api.get("/api/gcp/status").then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  })
  const awsStatus = useQuery<{ authenticated: boolean }>({
    queryKey: ["aws-status"],
    queryFn: () => api.get("/api/aws/status").then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  })
  const azureStatus = useQuery<{ authenticated: boolean }>({
    queryKey: ["azure-status"],
    queryFn: () => api.get("/api/azure/status").then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  })

  const gcpAuthed = gcpStatus.data?.authenticated === true
  const awsAuthed = awsStatus.data?.authenticated === true
  const azureAuthed = azureStatus.data?.authenticated === true

  const gcp = useQuery<GCPProject[]>({
    queryKey: ["gcp-projects"],
    queryFn: () => api.get("/api/gcp/projects").then((r) => r.data),
    enabled: gcpAuthed,
    staleTime: 60_000,
    retry: false,
  })
  const aws = useQuery<AWSAccount[]>({
    queryKey: ["aws-accounts"],
    queryFn: () => api.get("/api/aws/accounts").then((r) => r.data),
    enabled: awsAuthed,
    staleTime: 60_000,
    retry: false,
  })
  const azure = useQuery<AzureSubscription[]>({
    queryKey: ["azure-subscriptions"],
    queryFn: () => api.get("/api/azure/subscriptions").then((r) => r.data),
    enabled: azureAuthed,
    staleTime: 60_000,
    retry: false,
  })

  const accounts = useMemo<AvailableAccount[]>(() => {
    const out: AvailableAccount[] = []
    for (const p of gcp.data ?? []) {
      out.push({ provider: "gcp", id: p.projectId, label: p.name || p.projectId })
    }
    for (const a of aws.data ?? []) {
      out.push({ provider: "aws", id: a.accountId, label: a.name || a.accountId })
    }
    for (const s of azure.data ?? []) {
      out.push({
        provider: "azure",
        id: s.subscriptionId,
        label: s.name || s.subscriptionId,
      })
    }
    return out
  }, [gcp.data, aws.data, azure.data])

  return {
    accounts,
    loading:
      gcpStatus.isPending ||
      awsStatus.isPending ||
      azureStatus.isPending ||
      (gcpAuthed && gcp.isPending) ||
      (awsAuthed && aws.isPending) ||
      (azureAuthed && azure.isPending),
  }
}

// ---------------------------------------------------------------------------
// Aggregation — fan out to /billing per member and merge results
// ---------------------------------------------------------------------------

interface MemberBilling {
  provider: Provider
  id: string
  label: string
  total: number
  currency: string
  byService: { service: string; cost: number }[]
  byMonth: { month: string; cost: number }[]
  error: unknown
  loading: boolean
}

export interface PortfolioAggregate {
  loading: boolean
  hasAnyData: boolean
  hasAnyError: boolean
  currency: string
  totalCost: number
  members: MemberBilling[]
  byProvider: { provider: Provider; cost: number; pct: number }[]
  byMember: { provider: Provider; id: string; label: string; cost: number; pct: number }[]
  topServices: { service: string; cost: number; pct: number; cumPct: number }[]
  monthly: { month: string; cost: number }[]
}

const MEMBER_STALE = 60_000
const MEMBER_MONTHS = 6

function endpointFor(m: PortfolioMember): {
  url: string
  params: Record<string, string | number>
} {
  if (m.provider === "gcp") {
    return { url: "/api/gcp/billing", params: { project_id: m.id, months: MEMBER_MONTHS } }
  }
  if (m.provider === "aws") {
    return {
      url: "/api/aws/billing",
      params: { account_id: m.id, months: MEMBER_MONTHS, granularity: "MONTHLY" },
    }
  }
  return {
    url: "/api/azure/billing",
    params: { subscription_id: m.id, months: MEMBER_MONTHS, granularity: "MONTHLY" },
  }
}

/**
 * Fans out one /billing call per portfolio member and returns a unified,
 * client-side-aggregated view. No back store is touched — this is a read-only
 * view for the collecte page. Merges same-service costs across providers using
 * a case-insensitive service name key.
 */
export function usePortfolioAggregate(
  portfolio: Portfolio | null,
): PortfolioAggregate {
  // `portfolio.members` is a fresh array reference every render; memoise so
  // the dependency array of the useMemo downstream is stable.
  const members = useMemo<PortfolioMember[]>(() => portfolio?.members ?? [], [portfolio])

  const results = useQueries({
    queries: members.map((m) => {
      const { url, params } = endpointFor(m)
      return {
        queryKey: ["portfolio-billing", m.provider, m.id],
        queryFn: () => api.get(url, { params }).then((r) => r.data),
        staleTime: MEMBER_STALE,
        retry: false,
      }
    }),
  })

  return useMemo<PortfolioAggregate>(() => {
    const memberBillings: MemberBilling[] = members.map((m, i) => {
      const q = results[i]
      const data = q?.data as
        | GCPBillingResponse
        | AWSBillingResponse
        | AzureBillingResponse
        | undefined
      const rawServices = (data?.byService ?? []) as {
        service: string
        cost: number
      }[]
      const byService = rawServices.map((s) => ({ service: s.service, cost: s.cost }))
      const byMonth = (data?.byMonth ?? []) as { month: string; cost: number }[]
      return {
        provider: m.provider,
        id: m.id,
        label: m.label || m.id,
        total: data?.total ?? 0,
        currency: data?.currency ?? "EUR",
        byService,
        byMonth,
        error: q?.error,
        loading: q?.isPending ?? true,
      }
    })

    const loading = memberBillings.some((m) => m.loading)
    const hasAnyData = memberBillings.some((m) => m.total > 0)
    const hasAnyError = memberBillings.some((m) => m.error)
    // Prefer the first non-EUR currency if all members agree, otherwise fall
    // back to EUR — mixed currencies are surfaced in the UI as a warning.
    const currency = memberBillings[0]?.currency ?? "EUR"
    const totalCost = memberBillings.reduce((s, m) => s + m.total, 0)

    // Aggregate by provider
    const providerCosts = new Map<Provider, number>()
    for (const m of memberBillings) {
      providerCosts.set(m.provider, (providerCosts.get(m.provider) ?? 0) + m.total)
    }
    const byProvider = Array.from(providerCosts.entries())
      .map(([provider, cost]) => ({
        provider,
        cost,
        pct: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)

    // Aggregate by member
    const byMember = memberBillings
      .map((m) => ({
        provider: m.provider,
        id: m.id,
        label: m.label,
        cost: m.total,
        pct: totalCost > 0 ? (m.total / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)

    // Cross-cloud services — merged by case-insensitive service name
    const serviceCosts = new Map<string, { display: string; cost: number }>()
    for (const m of memberBillings) {
      for (const s of m.byService) {
        const key = s.service.toLowerCase()
        const existing = serviceCosts.get(key)
        if (existing) existing.cost += s.cost
        else serviceCosts.set(key, { display: s.service, cost: s.cost })
      }
    }
    const sortedServices = Array.from(serviceCosts.values()).sort(
      (a, b) => b.cost - a.cost,
    )
    // Cumulative percentage computed via reduce so we don't rely on a
    // mutating `let` inside the map callback (react-hooks/immutability).
    const topServices = sortedServices.reduce<
      { service: string; cost: number; pct: number; cumPct: number }[]
    >((acc, s) => {
      const pct = totalCost > 0 ? (s.cost / totalCost) * 100 : 0
      const prevCum = acc.length > 0 ? acc[acc.length - 1].cumPct : 0
      acc.push({ service: s.display, cost: s.cost, pct, cumPct: prevCum + pct })
      return acc
    }, [])

    // Monthly totals — union of every provider's byMonth
    const monthCosts = new Map<string, number>()
    for (const m of memberBillings) {
      for (const row of m.byMonth) {
        monthCosts.set(row.month, (monthCosts.get(row.month) ?? 0) + row.cost)
      }
    }
    const monthly = Array.from(monthCosts.entries())
      .map(([month, cost]) => ({ month, cost }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return {
      loading,
      hasAnyData,
      hasAnyError,
      currency,
      totalCost,
      members: memberBillings,
      byProvider,
      byMember,
      topServices,
      monthly,
    }
  }, [members, results])
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const PROVIDER_LABEL: Record<Provider, string> = {
  gcp: "Google Cloud",
  aws: "Amazon Web Services",
  azure: "Microsoft Azure",
}

export const PROVIDER_SHORT: Record<Provider, string> = {
  gcp: "GCP",
  aws: "AWS",
  azure: "Azure",
}
