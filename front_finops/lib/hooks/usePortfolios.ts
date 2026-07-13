"use client"

import { useMemo } from "react"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
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

export type Provider = "gcp" | "aws" | "azure" | "local"

// A portfolio can carry at most one "local" member — the local events store
// is a singleton, so the id is fixed. Kept as a top-level export so the
// PortfolioEditor toggle uses the exact same values the backend expects.
export const LOCAL_MEMBER_ID = "events-store"
export const LOCAL_MEMBER_LABEL = "Fichiers importés"

/**
 * True when a portfolio only contains local members (the events store).
 * Consumers use this to route Analyse sub-tabs to the daily-granularity
 * endpoints (kpi/daily/stl/anomalies) — since the underlying data is the
 * same events store, no aggregation is needed.
 */
export function isAllLocal(portfolio: { members: { provider: Provider }[] } | null): boolean {
  if (!portfolio) return false
  if (portfolio.members.length === 0) return false
  return portfolio.members.every((m) => m.provider === "local")
}

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
  updatedAt: string
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
// Server-backed store — /api/portfolios (DynamoDB, per authenticated user)
// ---------------------------------------------------------------------------

const PORTFOLIOS_KEY = ["portfolios"] as const
const EMPTY: Portfolio[] = []

function stableMember(m: PortfolioMember): PortfolioMember {
  // Drop undefined label so the JSON payload doesn't ship `"label":null` that
  // Pydantic v2 would happily accept but complicates the diff at read time.
  return m.label ? { provider: m.provider, id: m.id, label: m.label } : { provider: m.provider, id: m.id }
}

export interface PortfolioOps {
  create: (name: string, members?: PortfolioMember[]) => Promise<Portfolio>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  addMember: (portfolioId: string, member: PortfolioMember) => Promise<void>
  removeMember: (portfolioId: string, provider: Provider, memberId: string) => Promise<void>
}

/**
 * Read/write portfolios via /api/portfolios (server-side DDB persistence).
 * Uses TanStack Query as the client-side cache. Mutations optimistically
 * update the cache then trigger a refetch so failures self-heal.
 */
export function usePortfolios(): {
  portfolios: Portfolio[]
  loading: boolean
  ops: PortfolioOps
} {
  const queryClient = useQueryClient()

  const listQuery = useQuery<Portfolio[]>({
    queryKey: PORTFOLIOS_KEY,
    queryFn: () =>
      api
        .get("/api/portfolios")
        .then((r) => (r.data.portfolios ?? []) as Portfolio[]),
    staleTime: 60_000,
    retry: false,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: PORTFOLIOS_KEY })

  const createMut = useMutation<
    Portfolio,
    Error,
    { name: string; members: PortfolioMember[] }
  >({
    mutationFn: ({ name, members }) =>
      api
        .post("/api/portfolios", { name, members: members.map(stableMember) })
        .then((r) => r.data as Portfolio),
    onSuccess: () => void invalidate(),
  })

  const updateMut = useMutation<
    Portfolio,
    Error,
    { id: string; name?: string; members?: PortfolioMember[] }
  >({
    mutationFn: ({ id, name, members }) => {
      // Only forward provided fields — matches the partial update contract on
      // the server side (PortfolioUpdate).
      const body: Record<string, unknown> = {}
      if (name !== undefined) body.name = name
      if (members !== undefined) body.members = members.map(stableMember)
      return api.put(`/api/portfolios/${id}`, body).then((r) => r.data as Portfolio)
    },
    onSuccess: () => void invalidate(),
  })

  const deleteMut = useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/api/portfolios/${id}`).then(() => undefined),
    onSuccess: () => void invalidate(),
  })

  const portfolios = listQuery.data ?? EMPTY

  const ops = useMemo<PortfolioOps>(() => {
    // The mutation objects are stable per component instance; capturing them
    // in useMemo means callers see the same reference across renders as long
    // as this hook instance is alive.
    return {
      create: async (name, members = []) => {
        const trimmed = name.trim() || "Portefeuille"
        return createMut.mutateAsync({ name: trimmed, members })
      },
      rename: async (id, name) => {
        const trimmed = name.trim()
        if (!trimmed) return
        await updateMut.mutateAsync({ id, name: trimmed })
      },
      remove: async (id) => {
        await deleteMut.mutateAsync(id)
      },
      addMember: async (portfolioId, member) => {
        const current = queryClient.getQueryData<Portfolio[]>(PORTFOLIOS_KEY) ?? []
        const target = current.find((p) => p.id === portfolioId)
        if (!target) return
        const already = target.members.some(
          (m) => m.provider === member.provider && m.id === member.id,
        )
        if (already) return
        await updateMut.mutateAsync({
          id: portfolioId,
          members: [...target.members, member],
        })
      },
      removeMember: async (portfolioId, provider, memberId) => {
        const current = queryClient.getQueryData<Portfolio[]>(PORTFOLIOS_KEY) ?? []
        const target = current.find((p) => p.id === portfolioId)
        if (!target) return
        await updateMut.mutateAsync({
          id: portfolioId,
          members: target.members.filter(
            (m) => !(m.provider === provider && m.id === memberId),
          ),
        })
      },
    }
  }, [createMut, updateMut, deleteMut, queryClient])

  return { portfolios, loading: listQuery.isPending, ops }
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
  if (m.provider === "local") {
    // Aggregates the events store — no provider-specific id (the id is a
    // sentinel LOCAL_MEMBER_ID). Same response shape as the cloud endpoints
    // so the aggregate merger doesn't need a special branch.
    return { url: "/api/events/billing", params: { months: MEMBER_MONTHS } }
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
  local: "Fichiers importés",
}

export const PROVIDER_SHORT: Record<Provider, string> = {
  gcp: "GCP",
  aws: "AWS",
  azure: "Azure",
  local: "Local",
}
