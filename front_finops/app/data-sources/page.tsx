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
} from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useIngestEvents, useGCPStatus } from "@/lib/hooks/useApi"
import { api } from "@/lib/api"
import { useQuery, useMutation } from "@tanstack/react-query"
import type { BillingEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

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
// CSV parsing
// ---------------------------------------------------------------------------

interface ParsedResult {
  events: BillingEvent[]
  errors: string[]
  totalRows: number
}

function parseCSV(text: string): ParsedResult {
  const errors: string[] = []
  const lines = text
    .replace(/﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)

  if (lines.length < 2) {
    return { events: [], errors: ["Le fichier ne contient pas de données."], totalRows: 0 }
  }

  const firstLine = lines[0]
  const delimiter = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ","

  const header = firstLine
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""))

  const idxDate = header.findIndex((h) => ["date", "day", "usage_date", "jour"].includes(h))
  const idxService = header.findIndex((h) =>
    ["service", "service_name", "service_description", "sku"].includes(h)
  )
  const idxCost = header.findIndex((h) =>
    ["cost", "amount", "montant", "coût", "cout", "total"].includes(h)
  )
  const idxDesc = header.findIndex((h) => ["description", "desc", "libelle", "libellé"].includes(h))

  if (idxDate < 0 || idxService < 0 || idxCost < 0) {
    return {
      events: [],
      errors: [
        `Colonnes requises manquantes. Attendues : date, service, cost. Trouvées : ${header.join(", ")}`,
      ],
      totalRows: lines.length - 1,
    }
  }

  const events: BillingEvent[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""))
    const rawDate = cols[idxDate]
    const rawCost = cols[idxCost]?.replace(/\s/g, "").replace(",", ".")
    const service = cols[idxService]
    const description = idxDesc >= 0 ? cols[idxDesc] : undefined

    if (!rawDate || !service || !rawCost) {
      errors.push(`Ligne ${i + 1} : valeur manquante`)
      continue
    }
    const cost = parseFloat(rawCost)
    if (Number.isNaN(cost)) {
      errors.push(`Ligne ${i + 1} : coût invalide "${cols[idxCost]}"`)
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
      errors.push(`Ligne ${i + 1} : date invalide "${rawDate}" (attendu YYYY-MM-DD)`)
      continue
    }
    events.push({
      date: rawDate.slice(0, 10),
      service,
      cost,
      ...(description ? { description } : {}),
    })
  }

  return { events, errors, totalRows: lines.length - 1 }
}

// ---------------------------------------------------------------------------
// AWS hooks (placeholder endpoints)
// ---------------------------------------------------------------------------

interface AWSAuthStatus {
  authenticated: boolean
  accountId: string | null
  arn: string | null
}

function useAWSStatus() {
  return useQuery<AWSAuthStatus>({
    queryKey: ["aws-status"],
    queryFn: () => api.get("/api/aws/status").then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  })
}

interface AWSCredentialsPayload {
  accessKeyId: string
  secretAccessKey: string
  region: string
}

function useConnectAWS() {
  return useMutation<AWSAuthStatus, Error, AWSCredentialsPayload>({
    mutationFn: (body) =>
      api
        .post("/api/aws/connect", {
          access_key_id: body.accessKeyId,
          secret_access_key: body.secretAccessKey,
          region: body.region,
        })
        .then((r) => r.data),
  })
}

// ---------------------------------------------------------------------------
// Tab 1 — File upload
// ---------------------------------------------------------------------------

function FileTab() {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedResult | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [replace, setReplace] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { mutate: ingest, isPending, isSuccess, data, error, reset } = useIngestEvents()

  async function handleFile(f: File) {
    setFile(f)
    reset()
    if (f.name.toLowerCase().endsWith(".xlsx") || f.name.toLowerCase().endsWith(".xls")) {
      setParsed({
        events: [],
        errors: ["Le format Excel n'est pas encore pris en charge côté client. Merci d'exporter votre fichier au format CSV (UTF-8) et de le re-déposer."],
        totalRows: 0,
      })
      return
    }
    try {
      const text = await f.text()
      setParsed(parseCSV(text))
    } catch {
      setParsed({ events: [], errors: ["Impossible de lire le fichier."], totalRows: 0 })
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void handleFile(f)
  }

  function handleReset() {
    setFile(null)
    setParsed(null)
    reset()
    if (inputRef.current) inputRef.current.value = ""
  }

  function handleSubmit() {
    if (!parsed || parsed.events.length === 0) return
    ingest({ events: parsed.events, replace })
  }

  const preview = useMemo(() => parsed?.events.slice(0, 5) ?? [], [parsed])
  const canSubmit = parsed && parsed.events.length > 0 && !isPending && !isSuccess

  return (
    <SectionCard
      title="Importer un fichier de facturation"
      description={
        <>
          Format attendu : colonnes <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">date</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">service</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">cost</code> (optionnel{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">description</code>). Dates au format ISO YYYY-MM-DD.
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
        aria-label="Zone de dépôt de fichier"
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
          <p className="text-sm font-semibold text-foreground">Glissez-déposez votre fichier ici</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            ou cliquez pour parcourir · CSV (UTF-8) recommandé
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
      </div>

      {file && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
            <span className="truncate font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
              {(file.size / 1024).toFixed(1)} Ko
            </span>
          </div>
          <button
            onClick={handleReset}
            className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors"
            aria-label="Retirer le fichier"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {parsed && parsed.errors.length > 0 && parsed.events.length === 0 && (
        <ErrorBanner message={parsed.errors[0]} />
      )}
      {parsed && parsed.errors.length > 0 && parsed.events.length > 0 && (
        <WarnBanner
          message={`${parsed.errors.length} ligne${parsed.errors.length > 1 ? "s" : ""} ignorée${parsed.errors.length > 1 ? "s" : ""} sur ${parsed.totalRows}.`}
        />
      )}

      {parsed && parsed.events.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Aperçu · {parsed.events.length} ligne{parsed.events.length > 1 ? "s" : ""} valide{parsed.events.length > 1 ? "s" : ""}
            </p>
            <Badge variant="outline">
              {parsed.events.length}/{parsed.totalRows}
            </Badge>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Service</th>
                  <th className="text-right px-3 py-2 font-medium">Coût</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.map((ev, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 tabular-nums">{ev.date}</td>
                    <td className="px-3 py-2 truncate max-w-[240px]">{ev.service}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">
                      {ev.cost.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {parsed && parsed.events.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-[color:var(--accent-coral)]"
          />
          <span className="text-muted-foreground">
            Remplacer les données existantes <span className="text-foreground/60">(sinon, ajout à l&apos;existant)</span>
          </span>
        </label>
      )}

      {isSuccess && data && (
        <SuccessBanner
          message={`${data.ingested} événement${data.ingested > 1 ? "s" : ""} importé${data.ingested > 1 ? "s" : ""} · période ${data.dateRange.start} → ${data.dateRange.end}.`}
        />
      )}
      {error && <ErrorBanner message="Échec de l'import. Vérifiez le format du fichier et réessayez." />}

      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {isPending ? "Import en cours…" : isSuccess ? "Importé" : "Envoyer au modèle"}
        </Button>
        {isSuccess && (
          <Button variant="outline" onClick={handleReset}>
            Importer un autre fichier
          </Button>
        )}
      </div>
    </SectionCard>
  )
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
          Les identifiants transitent en HTTPS vers votre backend et ne sont pas stockés dans le navigateur.
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
