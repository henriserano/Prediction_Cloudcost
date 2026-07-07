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
} from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useGCPStatus } from "@/lib/hooks/useApi"
import { api } from "@/lib/api"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { parseBillingFile, type ParsedResult } from "@/lib/parsers/billing-file"
import type { BillingEvent, EventsIngestResponse, EventsUploadResponse } from "@/lib/types"
import { PinPrompt } from "@/components/auth/PinPrompt"

// ---------------------------------------------------------------------------
// Tab definition
// ---------------------------------------------------------------------------

const TABS = [
  { id: "file", label: "Fichier",             icon: FileSpreadsheet, hint: "CSV / Excel" },
  { id: "gcp",  label: "Google Cloud",        icon: CloudIcon,       hint: "OAuth" },
  { id: "aws",  label: "Amazon Web Services", icon: CloudIcon,       hint: "IAM" },
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
    ingest({ csvEvents: aggregate.csvEvents, excelFiles: aggregate.excelFiles, replace })
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
          message={`${data.ingested.toLocaleString("fr-FR")} événement${data.ingested > 1 ? "s" : ""} importé${data.ingested > 1 ? "s" : ""} · période ${data.dateRange.start} → ${data.dateRange.end}.`}
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
          {authenticated ? "Gérer la connexion GCP" : "Se connecter à Google Cloud"}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      </Link>
    </SectionCard>
  )
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
  const { data: status, isLoading, refetch, error: statusError } = useAWSStatus()
  const [accessKeyId, setAccessKeyId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")
  const [region, setRegion] = useState("eu-west-1")
  const [showSecret, setShowSecret] = useState(false)
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
    connect(
      { accessKeyId, secretAccessKey, region },
      {
        onSuccess: () => {
          setSecretAccessKey("")
          void refetch()
        },
      }
    )
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
    </SectionCard>
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
    </PageShell>
  )
}
