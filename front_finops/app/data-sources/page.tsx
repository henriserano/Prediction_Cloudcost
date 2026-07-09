"use client"

import { useState, useRef, useMemo } from "react"
import Link from "next/link"
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUpRight,
  Trash2,
  Cloud as CloudIcon,
  Loader2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Wrench,
  ShieldAlert,
} from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useGCPStatus, useGCPProjects, useGCPSync, useIngestEvents } from "@/lib/hooks/useApi"
import { api } from "@/lib/api"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { parseBillingFile, type ParsedResult } from "@/lib/parsers/billing-file"
import type {
  BillingEvent,
  EventsIngestResponse,
  EventsUploadResponse,
  GCPBillingResponse,
} from "@/lib/types"
import { PinPrompt } from "@/components/auth/PinPrompt"

// ---------------------------------------------------------------------------
// Tab definition
// ---------------------------------------------------------------------------

const TABS = [
  { id: "file",       label: "Fichier",             icon: FileSpreadsheet, hint: "CSV / Excel" },
  { id: "gcp",        label: "Google Cloud",        icon: CloudIcon,       hint: "OAuth" },
  { id: "aws",        label: "Amazon Web Services", icon: CloudIcon,       hint: "IAM" },
  { id: "simulation", label: "Cadrage agentique",   icon: Sparkles,        hint: "POC · pricing" },
] as const

type TabId = (typeof TABS)[number]["id"]

// ---------------------------------------------------------------------------
// Shared banners
// ---------------------------------------------------------------------------

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/6 px-3.5 py-3 text-sm text-destructive">
      <XCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-lg border border-[color:var(--success)]/20 bg-[color:var(--success)]/10 px-3.5 py-3 text-sm text-[color:var(--success)]">
      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

function WarnBanner({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/12 px-3.5 py-3 text-sm text-[color:var(--warning-foreground)]">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AWS hooks (placeholder endpoints)
// ---------------------------------------------------------------------------

interface AWSAuthStatus {
  authenticated: boolean
  accountId: string | null
  arn: string | null
  region: string | null
  detail: string | null
}

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

interface AWSSyncResponse {
  ingested: number
  accountId: string | null
  periodStart: string
  periodEnd: string
  servicesCount: number
  totalCost: number
  currency: string
  replaced: boolean
}

function useAWSSync() {
  return useMutation<
    AWSSyncResponse,
    Error,
    { accountId: string | null; months: number; replace: boolean }
  >({
    mutationFn: (body) =>
      api
        .post("/api/aws/sync", {
          account_id: body.accountId,
          months: body.months,
          replace: body.replace,
        })
        .then((r) => r.data),
  })
}

function useAWSStatus() {
  return useQuery<AWSAuthStatus>({
    queryKey: ["aws-status"],
    queryFn: () => api.get("/api/aws/status").then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  })
}

function useAWSAccounts(enabled: boolean) {
  return useQuery<AWSAccount[]>({
    queryKey: ["aws-accounts"],
    queryFn: () => api.get("/api/aws/accounts").then((r) => r.data),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

function useAWSBilling(enabled: boolean, accountId: string | null) {
  return useQuery<AWSBillingResponse>({
    queryKey: ["aws-billing", accountId ?? "self"],
    queryFn: () =>
      api
        .get("/api/aws/billing", {
          params: {
            months: 3,
            granularity: "MONTHLY",
            ...(accountId ? { account_id: accountId } : {}),
          },
        })
        .then((r) => r.data),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

interface AWSCredentialsPayload {
  accessKeyId: string
  secretAccessKey: string
  region: string
  pin: string
}

// Store + activate the AWS credentials in one round-trip. The backend saves
// them AES-GCM-encrypted (KEK unwrapped with the PIN) and immediately builds
// a boto3.Session cached in memory for /api/aws/* — no separate unlock step.
function useConnectAWS() {
  return useMutation<{ provider: string }, Error, AWSCredentialsPayload>({
    mutationFn: (body) =>
      api
        .put("/api/credentials/aws", {
          provider: "aws",
          pin: body.pin,
          label: `${body.region}`,
          payload: {
            access_key_id: body.accessKeyId,
            secret_access_key: body.secretAccessKey,
            region: body.region,
          },
        })
        .then((r) => r.data),
  })
}

// ---------------------------------------------------------------------------
// Tab 1 — File upload (multi-file, CSV + Excel)
// ---------------------------------------------------------------------------

interface FileEntry {
  id: string
  file: File
  status: "parsing" | "ready" | "error"
  parsed?: ParsedResult
}

let entryIdCounter = 0
const nextId = () => `f_${++entryIdCounter}_${Date.now()}`

interface SubmitBatchInput {
  csvEvents: BillingEvent[]
  excelFiles: File[]
  replace: boolean
}

interface SubmitBatchResult {
  ingested: number
  dateRange: { start: string; end: string }
}

// Excel files are re-sent RAW to POST /api/events/upload (multipart) so the
// backend ingests every row — the client-side preview only holds a sample.
// CSV files are fully parsed client-side and posted as events to /api/events.
function useSubmitBatch() {
  return useMutation<SubmitBatchResult, Error, SubmitBatchInput>({
    mutationFn: async ({ csvEvents, excelFiles, replace }) => {
      let ingested = 0
      let dateRange = { start: "", end: "" }
      // The first request carries the user's replace choice; the second one
      // always appends, otherwise it would wipe what the first just stored.
      let effectiveReplace = replace

      if (excelFiles.length > 0) {
        const form = new FormData()
        excelFiles.forEach((f) => form.append("files", f))
        form.append("replace", String(effectiveReplace))
        const res = await api.post<EventsUploadResponse>("/api/events/upload", form, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        ingested += res.data.ingested
        dateRange = res.data.dateRange
        effectiveReplace = false
      }

      if (csvEvents.length > 0) {
        const res = await api.post<EventsIngestResponse>("/api/events", {
          events: csvEvents,
          replace: effectiveReplace,
        })
        ingested += res.data.ingested
        // dateRange reflects the whole store after ingestion — the last
        // response is therefore the most complete one.
        dateRange = res.data.dateRange
      }

      return { ingested, dateRange }
    },
  })
}

function FileTab() {
  const queryClient = useQueryClient()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragActive, setDragActive] = useState(false)
  const [replace, setReplace] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { mutate: ingest, isPending, isSuccess, data, error, reset } = useSubmitBatch()

  async function ingestFiles(files: File[]) {
    if (files.length === 0) return
    reset()

    // Register all files immediately in "parsing" state
    const staged: FileEntry[] = files.map((f) => ({
      id: nextId(),
      file: f,
      status: "parsing",
    }))
    setEntries((prev) => [...prev, ...staged])

    // Parse each in parallel; a single failure never blocks the others
    await Promise.all(
      staged.map(async (entry) => {
        try {
          const parsed = await parseBillingFile(entry.file)
          const hasEvents = parsed.events.length > 0
          const hasBlockingError = !hasEvents && parsed.errors.length > 0
          setEntries((prev) =>
            prev.map((e) =>
              e.id === entry.id
                ? {
                    ...e,
                    parsed,
                    status: hasBlockingError ? "error" : "ready",
                  }
                : e
            )
          )
        } catch {
          setEntries((prev) =>
            prev.map((e) => (e.id === entry.id ? { ...e, status: "error" } : e))
          )
        }
      })
    )
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) void ingestFiles(files)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) void ingestFiles(files)
    if (inputRef.current) inputRef.current.value = ""
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
    setExpanded((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  function resetAll() {
    setEntries([])
    setExpanded(new Set())
    reset()
    if (inputRef.current) inputRef.current.value = ""
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Aggregate stats + payload.
  // CSV entries → fully parsed events, posted as JSON to /api/events.
  // Excel entries → raw File sent multipart to /api/events/upload (the parsed
  // events are only a preview sample, never re-posted).
  const aggregate = useMemo(() => {
    const ready = entries.filter((e) => e.status === "ready" && e.parsed)
    const csvEvents = ready
      .filter((e) => e.parsed!.format === "csv")
      .flatMap((e) => e.parsed!.events)
    const excelFiles = ready
      .filter((e) => e.parsed!.format === "excel" && e.parsed!.validRows > 0)
      .map((e) => e.file)
    const validRows = ready.reduce((s, e) => s + e.parsed!.validRows, 0)
    const totalRows = entries.reduce((s, e) => s + (e.parsed?.totalRows ?? 0), 0)
    const totalErrors = entries.reduce((s, e) => s + (e.parsed?.errors.length ?? 0), 0)
    const filesOk = entries.filter((e) => e.status === "ready").length
    const filesErr = entries.filter((e) => e.status === "error").length
    const filesParsing = entries.filter((e) => e.status === "parsing").length
    return { csvEvents, excelFiles, validRows, totalRows, totalErrors, filesOk, filesErr, filesParsing }
  }, [entries])

  const canSubmit =
    aggregate.validRows > 0 && aggregate.filesParsing === 0 && !isPending && !isSuccess

  function handleSubmit() {
    if (!canSubmit) return
    ingest(
      { csvEvents: aggregate.csvEvents, excelFiles: aggregate.excelFiles, replace },
      {
        // Same idea as the AWS "Utiliser" flow: nuke every cached query so the
        // Dashboard, Forecast, Services, Analytics, Diagnostics and Assistant
        // all refetch against the freshly ingested events store. Passing no
        // predicate = invalidate everything under this QueryClient.
        onSuccess: () => {
          void queryClient.invalidateQueries()
        },
      },
    )
  }

  return (
    <SectionCard
      title="Importer un ou plusieurs fichiers de facturation"
      description={
        <>
          Formats acceptés : <strong>CSV</strong>, <strong>Excel</strong> (.xlsx, .xls, .xlsm).
          Colonnes requises : <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">date</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">service</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">cost</code>. Optionnel{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">description</code>. Dates ISO, EU (JJ/MM/AAAA) ou format Excel — tout est reconnu automatiquement.
        </>
      }
      contentClassName="space-y-4"
    >
      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Zone de dépôt de fichiers"
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-all",
          dragActive
            ? "border-[color:var(--accent-coral)] bg-[color:var(--accent-coral)]/5 scale-[1.005]"
            : "border-border bg-muted/20 hover:border-[color:var(--accent-coral)]/50 hover:bg-muted/30"
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card border border-border shadow-sm">
          <UploadCloud className="h-6 w-6 text-[color:var(--accent-coral)]" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            Glissez-déposez vos fichiers ici
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            ou cliquez pour parcourir · plusieurs fichiers autorisés
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* File list */}
      {entries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Fichiers · {entries.length}
            </p>
            <button
              onClick={resetAll}
              className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              Tout retirer
            </button>
          </div>

          <ul className="space-y-1.5">
            {entries.map((entry) => {
              const isExpanded = expanded.has(entry.id)
              const parsed = entry.parsed
              const hasErrors = (parsed?.errors.length ?? 0) > 0
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "rounded-lg border transition-colors",
                    entry.status === "error"
                      ? "border-destructive/25 bg-destructive/5"
                      : entry.status === "ready" && hasErrors
                        ? "border-[color:var(--warning)]/30 bg-[color:var(--warning)]/8"
                        : "border-border bg-muted/20"
                  )}
                >
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <FileEntryIcon status={entry.status} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{entry.file.name}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                        <span>{formatSize(entry.file.size)}</span>
                        {parsed && (
                          <>
                            <span aria-hidden>·</span>
                            <span>
                              {parsed.validRows}/{parsed.totalRows} ligne{parsed.totalRows > 1 ? "s" : ""} valide{parsed.validRows > 1 ? "s" : ""}
                            </span>
                            <Badge variant="muted" size="sm">
                              {parsed.format.toUpperCase()}
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                    {entry.status === "parsing" ? (
                      <Badge variant="muted" size="sm">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        Analyse…
                      </Badge>
                    ) : entry.status === "error" ? (
                      <Badge variant="destructive" size="sm">Erreur</Badge>
                    ) : hasErrors ? (
                      <Badge variant="warning" size="sm">
                        {parsed?.errors.length} avertissement{(parsed?.errors.length ?? 0) > 1 ? "s" : ""}
                      </Badge>
                    ) : (
                      <Badge variant="success" size="sm">OK</Badge>
                    )}
                    {parsed && (parsed.errors.length > 0 || parsed.events.length > 0) && (
                      <button
                        onClick={() => toggleExpanded(entry.id)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        aria-label={isExpanded ? "Réduire les détails" : "Afficher les détails"}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => removeEntry(entry.id)}
                      className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={`Retirer ${entry.file.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Details */}
                  {isExpanded && parsed && (
                    <div className="border-t border-border/60 px-3 py-2.5 space-y-2 bg-card/50">
                      {parsed.detectedColumns && (
                        <p className="text-[11px] text-muted-foreground">
                          Colonnes détectées :{" "}
                          <span className="text-foreground font-medium">{parsed.detectedColumns.date}</span> · {" "}
                          <span className="text-foreground font-medium">{parsed.detectedColumns.service}</span> · {" "}
                          <span className="text-foreground font-medium">{parsed.detectedColumns.cost}</span>
                          {parsed.detectedColumns.description && (
                            <> · <span className="text-foreground font-medium">{parsed.detectedColumns.description}</span></>
                          )}
                        </p>
                      )}
                      {parsed.errors.length > 0 && (
                        <div className="max-h-32 overflow-y-auto rounded-md bg-muted/40 border border-border/60 p-2 space-y-0.5">
                          {parsed.errors.slice(0, 20).map((err, i) => (
                            <p key={i} className="text-[11px] text-muted-foreground">
                              {err.line > 0 ? `Ligne ${err.line} · ` : ""}
                              {err.message}
                            </p>
                          ))}
                          {parsed.errors.length > 20 && (
                            <p className="text-[11px] text-muted-foreground italic">
                              + {parsed.errors.length - 20} autre{parsed.errors.length - 20 > 1 ? "s" : ""}…
                            </p>
                          )}
                        </div>
                      )}
                      {parsed.events.length > 0 && (
                        <div className="rounded-md border border-border/60 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/60 text-muted-foreground">
                              <tr>
                                <th className="text-left px-2.5 py-1.5 font-medium">Date</th>
                                <th className="text-left px-2.5 py-1.5 font-medium">Service</th>
                                <th className="text-right px-2.5 py-1.5 font-medium">Coût</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {parsed.events.slice(0, 5).map((ev, i) => (
                                <tr key={i}>
                                  <td className="px-2.5 py-1.5 tabular-nums">{ev.date}</td>
                                  <td className="px-2.5 py-1.5 truncate max-w-[220px]">{ev.service}</td>
                                  <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">
                                    {ev.cost.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Aggregate summary */}
      {entries.length > 0 && aggregate.filesParsing === 0 && (
        <div className="rounded-xl border border-border bg-card p-3.5 grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Fichiers OK
            </p>
            <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums text-[color:var(--success)]">
              {aggregate.filesOk}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Événements valides
            </p>
            <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums text-foreground">
              {aggregate.validRows.toLocaleString("fr-FR")}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Avertissements
            </p>
            <p
              className={cn(
                "mt-0.5 font-heading text-lg font-semibold tabular-nums",
                aggregate.totalErrors > 0 ? "text-[color:var(--warning-foreground)]" : "text-muted-foreground"
              )}
            >
              {aggregate.totalErrors}
            </p>
          </div>
        </div>
      )}

      {/* Replace toggle */}
      {aggregate.validRows > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-[color:var(--accent-coral)]"
          />
          <span className="text-muted-foreground">
            Remplacer les données existantes{" "}
            <span className="text-foreground/60">(sinon, ajout à l&apos;existant)</span>
          </span>
        </label>
      )}

      {/* Global banners */}
      {isSuccess && data && (
        <SuccessBanner
          message={`${data.ingested.toLocaleString("fr-FR")} événement${data.ingested > 1 ? "s" : ""} importé${data.ingested > 1 ? "s" : ""} · période ${data.dateRange.start} → ${data.dateRange.end}. Toutes les pages sont à jour.`}
        />
      )}
      {error && (
        <ErrorBanner message="Échec de l'import côté serveur. Vérifiez le backend et réessayez." />
      )}
      {aggregate.filesErr > 0 && !isSuccess && (
        <WarnBanner
          message={`${aggregate.filesErr} fichier${aggregate.filesErr > 1 ? "s" : ""} illisible${aggregate.filesErr > 1 ? "s" : ""} — ignoré${aggregate.filesErr > 1 ? "s" : ""} dans le batch.`}
        />
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {isPending
            ? "Import en cours…"
            : isSuccess
              ? "Importé"
              : `Envoyer au modèle${aggregate.validRows > 0 ? ` · ${aggregate.validRows.toLocaleString("fr-FR")}` : ""}`}
        </Button>
        {isSuccess && (
          <Button variant="outline" onClick={resetAll}>
            Importer d&apos;autres fichiers
          </Button>
        )}
      </div>
    </SectionCard>
  )
}

function FileEntryIcon({ status }: { status: FileEntry["status"] }) {
  if (status === "parsing") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </span>
    )
  }
  if (status === "error") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/12 text-destructive shrink-0">
        <XCircle className="h-4 w-4" aria-hidden />
      </span>
    )
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
      <FileSpreadsheet className="h-4 w-4" aria-hidden />
    </span>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`
}

// ---------------------------------------------------------------------------
// Tab 2 — GCP
// ---------------------------------------------------------------------------

function GCPTab() {
  const { data: status, isLoading } = useGCPStatus()
  const authenticated = status?.authenticated === true

  return (
    <SectionCard
      title="Connexion Google Cloud"
      description="Récupération automatique de la facturation, des journaux et des services activés"
      contentClassName="space-y-4"
    >
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-card border border-border">
              <CloudIcon className="h-4 w-4 text-[color:var(--brand)]" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Google Cloud Platform</p>
              <p className="text-xs text-muted-foreground truncate">
                {isLoading
                  ? "Vérification…"
                  : authenticated
                    ? `Connecté · ${status?.email ?? ""}`
                    : "Non connecté"}
              </p>
            </div>
          </div>
          {!isLoading && (
            authenticated ? <Badge variant="success">Actif</Badge> : <Badge variant="muted">Inactif</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Accès en lecture seule à la facturation, aux journaux d&apos;audit et à la liste de vos projets.
        </p>
      </div>

      {!authenticated && (
        <>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Facturation</p>
              <p className="text-foreground font-medium text-xs">Coût par service</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Journaux</p>
              <p className="text-foreground font-medium text-xs">Audit trail</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2.5 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Services</p>
              <p className="text-foreground font-medium text-xs">APIs activées</p>
            </div>
          </div>

          <Link href="/gcp-connect" className="inline-flex">
            <Button className="gap-2">
              Se connecter à Google Cloud
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </>
      )}

      {authenticated && <GCPProjectsPanel />}
    </SectionCard>
  )
}

// Mirror of AWSAccountsPanel for GCP. Once OAuth is complete, list projects and
// let the user pick one to feed the FinOps model. "Utiliser" runs the two-tier
// flow (BigQuery Billing Export first, aggregated /billing → /api/events
// fallback) then invalidates every cached query so the whole dashboard
// refetches — same visible behaviour as the AWS "Utiliser" button.
function GCPProjectsPanel() {
  const queryClient = useQueryClient()
  const { data: projects, isLoading, error } = useGCPProjects()
  const { mutateAsync: syncGCP, isPending: syncing, reset: resetSync } = useGCPSync()
  const { mutateAsync: ingest, isPending: ingesting, reset: resetIngest } = useIngestEvents()
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    status: "idle" | "success" | "error"
    message: string
    mode: "sync" | "ingest" | null
  }>({ status: "idle", message: "", mode: null })

  async function handleUseProject(projectId: string) {
    setActiveProject(projectId)
    setFeedback({ status: "idle", message: "", mode: null })
    resetSync()
    resetIngest()

    try {
      const res = await syncGCP({ projectId, months: 6 })
      void queryClient.invalidateQueries()
      setFeedback({
        status: "success",
        mode: "sync",
        message: `${res.ingestedRows.toLocaleString("fr-FR")} lignes ingérées depuis BigQuery pour ${projectId} · ${res.servicesSeen} services · période ${res.period.start} → ${res.period.end}. Toutes les pages sont à jour.`,
      })
      return
    } catch (err) {
      const status = extractStatus(err)
      if (status !== 500 && status !== 404) {
        setFeedback({
          status: "error",
          mode: "sync",
          message: extractMessage(err) ?? "Sync BigQuery refusé.",
        })
        setActiveProject(null)
        return
      }
    }

    // Fallback: reconstruct events from the /billing aggregate for this project.
    try {
      const billing = await api
        .get<GCPBillingResponse>("/api/gcp/billing", { params: { project_id: projectId, months: 6 } })
        .then((r) => r.data)
      const events = billing.byMonth.flatMap((monthRow) =>
        billing.byService.map((svc) => ({
          date: monthRow.month + "-01",
          service: svc.service,
          cost: parseFloat(((monthRow.cost * svc.pct) / 100).toFixed(4)),
          description: `Import GCP ${billing.projectId}`,
        })),
      )
      if (events.length === 0) {
        setFeedback({
          status: "error",
          mode: "ingest",
          message: "Aucune donnée de facturation disponible pour ce projet.",
        })
        setActiveProject(null)
        return
      }
      const res = await ingest({ events, replace: true })
      void queryClient.invalidateQueries()
      setFeedback({
        status: "success",
        mode: "ingest",
        message: `${res.ingested.toLocaleString("fr-FR")} événements agrégés injectés (BigQuery Export non configuré) · période ${res.dateRange.start} → ${res.dateRange.end}. Toutes les pages sont à jour.`,
      })
    } catch (err) {
      setFeedback({
        status: "error",
        mode: "ingest",
        message: extractMessage(err) ?? "Import GCP refusé.",
      })
      setActiveProject(null)
    }
  }

  const busy = syncing || ingesting

  return (
    <div className="space-y-4 rounded-xl border border-border bg-muted/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Vos projets Google Cloud
        </p>
        <Link href="/gcp-connect" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline">
          Ouvrir GCP Connect
        </Link>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Chargement…</p>}
      {error && (
        <ErrorBanner message="Impossible de lister les projets. Vérifie que ton token OAuth n'a pas expiré." />
      )}

      {projects && projects.length === 0 && (
        <WarnBanner message="Aucun projet accessible avec ce compte Google." />
      )}

      {projects && projects.length > 0 && (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {projects.map((p) => {
            const isActive = activeProject === p.projectId && busy
            return (
              <li key={p.projectId}>
                <div className="flex items-stretch rounded-lg border border-border bg-card hover:border-[color:var(--brand)]/40 overflow-hidden transition-colors">
                  <div className="flex-1 px-3 py-2.5 min-w-0">
                    <p className="truncate text-sm font-medium">{p.name || p.projectId}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                      {p.projectId}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUseProject(p.projectId)}
                    disabled={busy}
                    className={cn(
                      "shrink-0 border-l border-border px-3 text-[11px] font-medium transition-colors",
                      "hover:bg-[color:var(--brand)]/10 hover:text-[color:var(--brand)]",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                    title="Ingérer 6 mois de facturation GCP et alimenter tout le dashboard"
                  >
                    {isActive ? (syncing ? "Sync…" : "Injection…") : "Utiliser"}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {feedback.status === "success" && <SuccessBanner message={feedback.message} />}
      {feedback.status === "error" && <ErrorBanner message={feedback.message} />}
    </div>
  )
}

function extractStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "response" in err) {
    const r = (err as { response?: { status?: number } }).response
    return r?.status ?? null
  }
  return null
}

function extractMessage(err: unknown): string | null {
  if (err && typeof err === "object" && "response" in err) {
    const data = (err as { response?: { data?: { error?: { message?: string }; detail?: string } } })
      .response?.data
    return data?.error?.message ?? data?.detail ?? null
  }
  if (err instanceof Error) return err.message
  return null
}

// ---------------------------------------------------------------------------
// Tab 3 — AWS
// ---------------------------------------------------------------------------

const AWS_REGIONS = [
  "eu-west-1", "eu-west-3", "eu-central-1",
  "us-east-1", "us-east-2", "us-west-2",
  "ap-southeast-1",
]

function AWSTab() {
  const queryClient = useQueryClient()
  const { data: status, isLoading, refetch, error: statusError } = useAWSStatus()
  const [accessKeyId, setAccessKeyId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")
  const [region, setRegion] = useState("eu-west-1")
  const [showSecret, setShowSecret] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const {
    mutate: connect,
    isPending,
    isSuccess,
    error: connectError,
    reset,
  } = useConnectAWS()

  const authenticated = status?.authenticated === true
  const backendMissing = !!statusError

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!accessKeyId || !secretAccessKey || !region) return
    reset()
    setPinOpen(true)
  }

  async function handlePinConfirm(pin: string) {
    return new Promise<void>((resolve, reject) => {
      connect(
        { accessKeyId, secretAccessKey, region, pin },
        {
          onSuccess: () => {
            setSecretAccessKey("")
            setPinOpen(false)
            void refetch()
            void queryClient.invalidateQueries({ queryKey: ["aws-accounts"] })
            void queryClient.invalidateQueries({ queryKey: ["aws-billing"] })
            resolve()
          },
          onError: (err) => {
            reject(err)
          },
        },
      )
    })
  }

  return (
    <SectionCard
      title="Connexion Amazon Web Services"
      description="Fournissez une clé IAM en lecture seule pour récupérer votre facturation AWS"
      accent="coral"
      contentClassName="space-y-4"
    >
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-card border border-border">
              <CloudIcon className="h-4 w-4 text-[color:var(--accent-coral)]" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Amazon Web Services</p>
              <p className="text-xs text-muted-foreground truncate">
                {isLoading
                  ? "Vérification…"
                  : authenticated
                    ? `Connecté · ${status?.accountId ?? ""}`
                    : "Non connecté"}
              </p>
            </div>
          </div>
          {!isLoading && (
            authenticated ? <Badge variant="success">Actif</Badge> : <Badge variant="muted">Inactif</Badge>
          )}
        </div>
      </div>

      {backendMissing && (
        <WarnBanner message="L'endpoint AWS n'est pas encore disponible côté backend. Le formulaire ci-dessous est fonctionnel mais l'appel échouera tant que /api/aws/connect n'est pas implémenté." />
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="aws-key" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Access Key ID
          </label>
          <input
            id="aws-key"
            type="text"
            autoComplete="off"
            value={accessKeyId}
            onChange={(e) => { setAccessKeyId(e.target.value); reset() }}
            placeholder="AKIA…"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-coral)]/40 focus:border-[color:var(--accent-coral)]/50 transition-shadow"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="aws-secret" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Secret Access Key
          </label>
          <div className="relative">
            <input
              id="aws-secret"
              type={showSecret ? "text" : "password"}
              autoComplete="off"
              value={secretAccessKey}
              onChange={(e) => { setSecretAccessKey(e.target.value); reset() }}
              placeholder="••••••••••••••••••••••••"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 pr-20 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-coral)]/40 focus:border-[color:var(--accent-coral)]/50 transition-shadow"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
            >
              {showSecret ? "Masquer" : "Afficher"}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="aws-region" className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Région par défaut
          </label>
          <select
            id="aws-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-coral)]/40 focus:border-[color:var(--accent-coral)]/50 transition-shadow"
          >
            {AWS_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Les identifiants sont transmis à votre backend via le proxy de l&apos;application et ne sont pas stockés dans le navigateur.
          La sécurité du transport dépend de la configuration de votre déploiement (HTTPS recommandé).
          Utilisez un utilisateur IAM disposant uniquement des droits{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">ce:Get*</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">ce:List*</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">cur:Describe*</code> et{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">tag:Get*</code>.
        </p>

        {isSuccess && <SuccessBanner message="Connexion AWS établie avec succès." />}
        {connectError && (
          <ErrorBanner message="Impossible d'établir la connexion. Vérifiez vos identifiants et permissions IAM." />
        )}

        <Button type="submit" disabled={!accessKeyId || !secretAccessKey || isPending}>
          {isPending
            ? "Connexion en cours…"
            : authenticated
              ? "Mettre à jour les identifiants"
              : "Se connecter à AWS"}
        </Button>
      </form>

      <PinPrompt
        open={pinOpen}
        title="Confirme ton PIN pour chiffrer les clés AWS"
        description="Les clés sont chiffrées AES-GCM avec une clé dérivée de ton PIN. Sans lui, personne (pas même nous) ne peut les déchiffrer."
        submitLabel="Chiffrer et activer"
        onCancel={() => setPinOpen(false)}
        onConfirm={handlePinConfirm}
      />

      {authenticated && <AWSAccountsPanel />}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Accounts + billing summary — shown once AWS is unlocked for this session
// ---------------------------------------------------------------------------

function AWSAccountsPanel() {
  const queryClient = useQueryClient()
  const { data: accounts, isLoading: accountsLoading, error: accountsError } =
    useAWSAccounts(true)
  const [selected, setSelected] = useState<string | null>(null)
  const { data: billing, isLoading: billingLoading, error: billingError } =
    useAWSBilling(true, selected)
  const {
    mutate: sync,
    isPending: syncing,
    isSuccess: synced,
    data: syncData,
    error: syncError,
    reset: resetSync,
  } = useAWSSync()

  const total = billing?.total ?? 0
  const currency = billing?.currency ?? "USD"

  function handleUseAsSource(accountId: string | null) {
    resetSync()
    sync(
      { accountId, months: 6, replace: true },
      {
        onSuccess: () => {
          // Nuke every cached query so Dashboard, Forecast, Services,
          // Analytics, Diagnostics and Assistant all refetch from the freshly
          // AWS-populated events store. Passing no predicate = invalidate
          // everything under this QueryClient.
          void queryClient.invalidateQueries()
        },
      },
    )
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-muted/10 p-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Vos comptes AWS
        </p>
        {accountsLoading && (
          <p className="mt-2 text-xs text-muted-foreground">Chargement…</p>
        )}
        {accountsError && (
          <ErrorBanner message="Impossible de lister les comptes. Vérifie que ton user a organizations:ListAccounts, ou que tu as bien débloqué ta session." />
        )}
        {accounts && accounts.length > 0 && (
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {accounts.map((acc) => {
              const active = selected === acc.accountId
              return (
                <li key={acc.accountId}>
                  <div
                    className={cn(
                      "flex items-stretch rounded-lg border transition-colors overflow-hidden",
                      active
                        ? "border-[color:var(--accent-coral)] bg-[color:var(--accent-coral)]/5"
                        : "border-border bg-card hover:border-[color:var(--accent-coral)]/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((s) => (s === acc.accountId ? null : acc.accountId))
                      }
                      className="flex-1 px-3 py-2.5 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{acc.name}</p>
                        <Badge
                          variant={acc.source === "organizations" ? "success" : "muted"}
                          size="sm"
                        >
                          {acc.source === "organizations" ? "Org" : "Solo"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {acc.accountId}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUseAsSource(acc.accountId)}
                      disabled={syncing}
                      className={cn(
                        "shrink-0 border-l border-border px-3 text-[11px] font-medium transition-colors",
                        "hover:bg-[color:var(--accent-coral)]/10 hover:text-[color:var(--accent-coral)]",
                        "disabled:pointer-events-none disabled:opacity-50",
                      )}
                      title="Ingérer 6 mois de Cost Explorer et alimenter tout le dashboard"
                    >
                      {syncing ? "Sync…" : "Utiliser"}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {(synced || syncError) && (
          <div className="mt-3">
            {synced && syncData && (
              <SuccessBanner
                message={`${syncData.ingested.toLocaleString("fr-FR")} événements AWS ingérés · ${syncData.servicesCount} services · période ${syncData.periodStart} → ${syncData.periodEnd}. Tout le dashboard bascule sur ces données.`}
              />
            )}
            {syncError && (
              <ErrorBanner message="La synchronisation Cost Explorer a échoué. Vérifie la permission ce:GetCostAndUsage et que Cost Explorer est activé (délai 24h après activation)." />
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Facturation {selected ? `(compte ${selected})` : "(tous comptes agrégés)"}
          </p>
          <p className="text-[10px] text-muted-foreground">3 derniers mois</p>
        </div>
        {billingLoading && (
          <p className="mt-2 text-xs text-muted-foreground">Chargement Cost Explorer…</p>
        )}
        {billingError && (
          <ErrorBanner message="Cost Explorer a refusé la requête. Vérifie la permission ce:GetCostAndUsage sur ton IAM user." />
        )}
        {billing && (
          <div className="mt-2 space-y-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Total période
              </p>
              <p className="mt-0.5 font-heading text-xl font-semibold tabular-nums text-foreground">
                {total.toLocaleString("fr-FR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                <span className="text-sm font-normal text-muted-foreground">{currency}</span>
              </p>
            </div>

            {billing.byService.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Service</th>
                      <th className="px-3 py-1.5 text-right font-medium">Coût</th>
                      <th className="px-3 py-1.5 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {billing.byService.slice(0, 10).map((row) => (
                      <tr key={row.service}>
                        <td className="truncate px-3 py-1.5">{row.service}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                          {row.cost.toLocaleString("fr-FR", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {row.pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 4 — Agentic scoping simulator
// ---------------------------------------------------------------------------

interface LLMEntry {
  id: string
  label: string
  vendor: string
  provider: string
  inputPerMillion: number
  outputPerMillion: number
  contextWindow: number
  notes?: string
}
interface ToolEntry { id: string; label: string; unitCost: number; description: string }
interface DeploymentEntry { id: string; label: string; base_infra_usd?: number }

interface ReferenceCatalog {
  llms: LLMEntry[]
  tools: ToolEntry[]
  deploymentTargets: DeploymentEntry[]
}

interface SimResult {
  cost: {
    llmInput: number
    llmOutput: number
    tools: number
    infrastructure: number
    totalMonthly: number
    currency: string
  }
  baseline: {
    monthlyAvg: number
    periodStart: string | null
    periodEnd: string | null
    topService: string | null
    source: string
  }
  projectedMonthlyEvents: { date: string; service: string; cost: number; description: string }[]
  deltaVsBaselinePct: number
  architecture: { component: string; reason: string }[]
  risks: { severity: string; category: string; title: string; detail: string }[]
  analysisAxes: string[]
}

interface SimInputs {
  projectName: string
  monthlyActiveUsers: number
  interactionsPerUserPerMonth: number
  agentsCount: number
  avgTurnsPerInteraction: number
  llmId: string
  toolIds: string[]
  avgInputTokensPerTurn: number
  avgOutputTokensPerTurn: number
  deployment: string
  hasGuardrails: boolean
  hasCaching: boolean
}

function toSnake(inputs: SimInputs) {
  return {
    project_name: inputs.projectName,
    monthly_active_users: inputs.monthlyActiveUsers,
    interactions_per_user_per_month: inputs.interactionsPerUserPerMonth,
    agents_count: inputs.agentsCount,
    avg_turns_per_interaction: inputs.avgTurnsPerInteraction,
    llm_id: inputs.llmId,
    tool_ids: inputs.toolIds,
    avg_input_tokens_per_turn: inputs.avgInputTokensPerTurn,
    avg_output_tokens_per_turn: inputs.avgOutputTokensPerTurn,
    deployment: inputs.deployment,
    has_guardrails: inputs.hasGuardrails,
    has_caching: inputs.hasCaching,
  }
}

function useSimReference() {
  return useQuery<ReferenceCatalog>({
    queryKey: ["sim-reference"],
    queryFn: () => api.get("/api/simulation/reference").then((r) => r.data),
    staleTime: Infinity,
  })
}

function useSimEstimate() {
  return useMutation<SimResult, Error, SimInputs>({
    mutationFn: (inputs) =>
      api.post("/api/simulation/estimate", toSnake(inputs)).then((r) => r.data),
  })
}

function useSimPush() {
  return useMutation<
    { ingested: number; projectName: string; periodStart: string; periodEnd: string },
    Error,
    { events: SimResult["projectedMonthlyEvents"]; projectName: string }
  >({
    mutationFn: ({ events, projectName }) =>
      api
        .post("/api/simulation/push", {
          events: events.map((e) => ({
            date: e.date,
            service: e.service,
            cost: e.cost,
            description: e.description,
          })),
          project_name: projectName,
        })
        .then((r) => r.data),
  })
}

const SEVERITY_STYLES: Record<string, { badge: "muted" | "warning" | "destructive" | "default"; ring: string }> = {
  info:     { badge: "muted",       ring: "border-border" },
  low:      { badge: "muted",       ring: "border-border" },
  medium:   { badge: "warning",     ring: "border-[color:var(--warning)]/40" },
  high:     { badge: "destructive", ring: "border-destructive/40" },
  critical: { badge: "destructive", ring: "border-destructive/60" },
}

function SimulationTab() {
  const { data: catalog } = useSimReference()
  const { mutate: estimate, data: result, isPending: estimating, error: estimateError } = useSimEstimate()
  const { mutate: push, isPending: pushing, isSuccess: pushed, data: pushData, error: pushError, reset: resetPush } = useSimPush()

  const [inputs, setInputs] = useState<SimInputs>({
    projectName: "POC agent",
    monthlyActiveUsers: 500,
    interactionsPerUserPerMonth: 10,
    agentsCount: 2,
    avgTurnsPerInteraction: 3,
    llmId: "claude-sonnet-4-6",
    toolIds: ["rag_retrieval"],
    avgInputTokensPerTurn: 2000,
    avgOutputTokensPerTurn: 400,
    deployment: "bedrock",
    hasGuardrails: false,
    hasCaching: false,
  })

  function update<K extends keyof SimInputs>(key: K, value: SimInputs[K]) {
    setInputs((s) => ({ ...s, [key]: value }))
    resetPush()
  }

  function toggleTool(id: string) {
    setInputs((s) => ({
      ...s,
      toolIds: s.toolIds.includes(id) ? s.toolIds.filter((t) => t !== id) : [...s.toolIds, id],
    }))
    resetPush()
  }

  function handleEstimate() {
    if (!catalog) return
    estimate(inputs)
  }

  function handlePush() {
    if (!result) return
    push({ events: result.projectedMonthlyEvents, projectName: inputs.projectName })
  }

  return (
    <SectionCard
      title="Cadrage d'un projet agentique"
      description="Réponds aux questions de scoping et compare la projection au baseline FinOps. Le résultat peut être poussé dans le modèle pour alimenter la prévision."
      accent="coral"
      contentClassName="space-y-5"
    >
      {/* --- Form: scoping questions ------------------------------------ */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Nom du projet
          </label>
          <input
            type="text"
            value={inputs.projectName}
            onChange={(e) => update("projectName", e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Modèle LLM
          </label>
          <select
            value={inputs.llmId}
            onChange={(e) => update("llmId", e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {catalog?.llms.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label} — {l.vendor} · ${l.inputPerMillion}/${l.outputPerMillion} par 1M
              </option>
            ))}
          </select>
        </div>

        <NumberField
          label="Utilisateurs actifs / mois"
          value={inputs.monthlyActiveUsers}
          onChange={(v) => update("monthlyActiveUsers", v)}
          min={1}
          max={10_000_000}
          step={100}
        />
        <NumberField
          label="Interactions / user / mois"
          value={inputs.interactionsPerUserPerMonth}
          onChange={(v) => update("interactionsPerUserPerMonth", v)}
          min={1}
          max={100_000}
          step={1}
        />
        <NumberField
          label="Nombre d'agents spécialisés"
          value={inputs.agentsCount}
          onChange={(v) => update("agentsCount", v)}
          min={1}
          max={100}
          step={1}
        />
        <NumberField
          label="Tours moyens / interaction"
          value={inputs.avgTurnsPerInteraction}
          onChange={(v) => update("avgTurnsPerInteraction", v)}
          min={1}
          max={50}
          step={0.5}
          decimals={1}
        />
        <NumberField
          label="Input tokens / tour (contexte moyen)"
          value={inputs.avgInputTokensPerTurn}
          onChange={(v) => update("avgInputTokensPerTurn", v)}
          min={100}
          max={200_000}
          step={100}
        />
        <NumberField
          label="Output tokens / tour"
          value={inputs.avgOutputTokensPerTurn}
          onChange={(v) => update("avgOutputTokensPerTurn", v)}
          min={10}
          max={100_000}
          step={50}
        />

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cible de déploiement
          </label>
          <select
            value={inputs.deployment}
            onChange={(e) => update("deployment", e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {catalog?.deploymentTargets.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-4 items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inputs.hasGuardrails}
              onChange={(e) => update("hasGuardrails", e.target.checked)}
              className="h-4 w-4 rounded border-border accent-[color:var(--accent-coral)]"
            />
            <span>Guardrails PII / prompt-injection</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inputs.hasCaching}
              onChange={(e) => update("hasCaching", e.target.checked)}
              className="h-4 w-4 rounded border-border accent-[color:var(--accent-coral)]"
            />
            <span>Prompt caching (Bedrock/OpenAI)</span>
          </label>
        </div>
      </div>

      {/* Tools */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tools activés
        </label>
        <div className="flex flex-wrap gap-2">
          {catalog?.tools.map((t) => {
            const active = inputs.toolIds.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTool(t.id)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-[color:var(--accent-coral)] bg-[color:var(--accent-coral)]/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-[color:var(--accent-coral)]/40",
                )}
                title={t.description}
              >
                <span className="font-medium">{t.label}</span>
                <span className="ml-2 text-[10px] opacity-70">${t.unitCost}/call</span>
              </button>
            )
          })}
        </div>
      </div>

      <Button onClick={handleEstimate} disabled={estimating || !catalog}>
        {estimating ? "Estimation…" : "Lancer l'estimation"}
      </Button>
      {estimateError && <ErrorBanner message="L'estimation a échoué. Vérifie que le backend est démarré." />}

      {/* --- Result ----------------------------------------------------- */}
      {result && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Coût mensuel projeté"
              value={`$${result.cost.totalMonthly.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`}
              hint={`sur 12 mois: $${(result.cost.totalMonthly * 12).toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`}
              accent
            />
            <StatCard
              label="Baseline actuel"
              value={
                result.baseline.source === "ingested_data"
                  ? `$${result.baseline.monthlyAvg.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`
                  : "—"
              }
              hint={result.baseline.source === "ingested_data" ? "Moyenne mensuelle" : "Pas de données ingérées"}
            />
            <StatCard
              label="Impact sur la facture"
              value={
                result.baseline.monthlyAvg > 0
                  ? `${result.deltaVsBaselinePct > 0 ? "+" : ""}${result.deltaVsBaselinePct.toFixed(1)}%`
                  : "N/A"
              }
              hint={result.baseline.monthlyAvg > 0 ? "vs baseline" : "—"}
            />
            <StatCard
              label="Répartition"
              value={`LLM ${((result.cost.llmInput + result.cost.llmOutput) / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}%`}
              hint={`Tools ${(result.cost.tools / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}% · Infra ${(result.cost.infrastructure / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}%`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Wrench className="h-3.5 w-3.5" aria-hidden />
                Architecture cible ({result.architecture.length} composants)
              </p>
              <ul className="space-y-2">
                {result.architecture.map((a, i) => (
                  <li key={i} className="rounded-lg border border-border bg-muted/20 p-2.5">
                    <p className="text-sm font-medium">{a.component}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.reason}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                Risques identifiés ({result.risks.length})
              </p>
              <ul className="space-y-2">
                {result.risks.map((r, i) => {
                  const style = SEVERITY_STYLES[r.severity] ?? SEVERITY_STYLES.info
                  return (
                    <li
                      key={i}
                      className={cn("rounded-lg border p-2.5", style.ring, "bg-muted/10")}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant={style.badge} size="sm">{r.severity}</Badge>
                        <span className="text-sm font-medium">{r.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{r.detail}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Axes d&apos;analyse à explorer
            </p>
            <ul className="space-y-1 text-sm">
              {result.analysisAxes.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[color:var(--accent-coral)]">•</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Push to FinOps */}
          <div className="rounded-xl border border-[color:var(--accent-coral)]/30 bg-[color:var(--accent-coral)]/5 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Injecter la projection dans le modèle FinOps</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ajoute {result.projectedMonthlyEvents.length} événements (12 mois × {new Set(result.projectedMonthlyEvents.map((e) => e.service)).size} composants) au store actuel (mode append).
              </p>
            </div>
            {pushed && pushData && (
              <SuccessBanner message={`${pushData.ingested.toLocaleString("fr-FR")} événements ingérés. Période mise à jour: ${pushData.periodStart} → ${pushData.periodEnd}.`} />
            )}
            {pushError && <ErrorBanner message="Push refusé. Vérifie l'API key sur /api/events." />}
            <Button onClick={handlePush} disabled={pushing || pushed}>
              {pushing ? "Injection…" : pushed ? "Injecté" : "Pousser vers le modèle FinOps"}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  decimals?: number
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = decimals ? parseFloat(e.target.value) : parseInt(e.target.value, 10)
          if (!Number.isNaN(n)) onChange(n)
        }}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm tabular-nums font-mono"
      />
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        accent ? "border-[color:var(--accent-coral)]/40 bg-[color:var(--accent-coral)]/5" : "border-border bg-card",
      )}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DataSourcesPage() {
  const [tab, setTab] = useState<TabId>("file")

  return (
    <PageShell
      eyebrow="Model input"
      title="Sources de données"
      description="Alimentez le modèle FinOps : import de fichier, ou connexion directe à un fournisseur cloud"
    >
      {/* Segmented tab control */}
      <nav
        aria-label="Type de source"
        className="inline-flex rounded-xl border border-border bg-card p-1 gap-1 flex-wrap shadow-sm"
      >
        {TABS.map(({ id, label, icon: Icon, hint }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={active}
              className={cn(
                "group inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all",
                active
                  ? "bg-brand text-brand-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  active ? "text-[color:var(--accent-coral)]" : "text-muted-foreground"
                )}
                aria-hidden
              />
              <span>{label}</span>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  active ? "text-white/60" : "text-muted-foreground/60"
                )}
              >
                {hint}
              </span>
            </button>
          )
        })}
      </nav>

      {tab === "file" && <FileTab />}
      {tab === "gcp" && <GCPTab />}
      {tab === "aws" && <AWSTab />}
      {tab === "simulation" && <SimulationTab />}
    </PageShell>
  )
}
