"use client"

import * as React from "react"
import { Cloud as CloudIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SectionCard } from "@/components/ui/section-card"
import { PinPrompt } from "@/components/auth/PinPrompt"
import { api } from "@/lib/api"
import {
  ErrorBanner,
  SuccessBanner,
  WarnBanner,
} from "@/app/data-sources/_tabs/shared"

// ---------------------------------------------------------------------------
// Generic credentials tab used by every cloud connect flow.
//
// AzureTab and AWSTab were 240–390 lines of near-identical scaffolding
// (status card, form, validation, PinPrompt, error banners). Every new
// provider added another copy. This component captures the shared shape and
// lets each provider declare only its differences via a descriptor.
//
// A provider descriptor lists:
//   • the query params (endpoints, staleTime),
//   • the form fields (label, placeholder, type, optional validator + options),
//   • how to translate the form into the credentials-store payload,
//   • the human explanation shown under the form.
//
// The runtime component owns state, PIN prompt orchestration, query cache
// invalidation and the visual chrome. Providers stay declarative.
// ---------------------------------------------------------------------------

export type FieldType = "text" | "password" | "select"

export interface FieldSpec {
  name: string
  label: string
  placeholder?: string
  type?: FieldType
  autoComplete?: string
  options?: readonly string[]
  /** Return null if valid, or an error message if not. Runs on submit only. */
  validate?: (value: string) => string | null
}

export interface ProviderStatus {
  authenticated: boolean
  primaryIdentifier?: string | null
  detail?: string | null
}

export interface CredentialsProviderDescriptor {
  /** Slug used for query keys, backend paths and copy. */
  id: string
  label: string
  /** Short hint under the status card ("Service Principal", "IAM user"…). */
  hint: string
  /** Fields rendered in the form, in order. */
  fields: readonly FieldSpec[]
  /** Backend status endpoint (e.g. "/api/azure/status"). */
  statusEndpoint: string
  /** Backend upsert endpoint (usually "/api/credentials/<provider>"). */
  credentialsEndpoint: string
  /** Turn the form values + PIN into the backend payload. */
  toPayload: (values: Record<string, string>) => Record<string, unknown>
  /** Human label prefix ("i.e. `az ad sp create-for-rbac`…"). */
  explanation: React.ReactNode
  /** How to derive the status-card summary from the API response. */
  parseStatus: (raw: unknown) => ProviderStatus
  /** Optional: label built from values ("<subscription> · <location>"). */
  toLabel?: (values: Record<string, string>) => string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CredentialsTab({ descriptor }: { descriptor: CredentialsProviderDescriptor }) {
  const queryClient = useQueryClient()
  const [values, setValues] = React.useState<Record<string, string>>(
    () => Object.fromEntries(descriptor.fields.map((f) => [f.name, ""])),
  )
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string | null>>({})
  const [showSecret, setShowSecret] = React.useState<Record<string, boolean>>({})
  const [pinOpen, setPinOpen] = React.useState(false)

  const statusQuery = useQuery<ProviderStatus>({
    queryKey: [`${descriptor.id}-status`],
    queryFn: () =>
      api.get(descriptor.statusEndpoint).then((r) => descriptor.parseStatus(r.data)),
    staleTime: 30_000,
    retry: false,
  })

  const connect = useMutation<{ provider: string }, Error, { pin: string }>({
    mutationFn: ({ pin }) => {
      const payload = descriptor.toPayload(values)
      const label = descriptor.toLabel ? descriptor.toLabel(values) : undefined
      return api
        .put(descriptor.credentialsEndpoint, {
          provider: descriptor.id,
          pin,
          label,
          payload,
        })
        .then((r) => r.data)
    },
  })

  const authenticated = statusQuery.data?.authenticated === true
  const backendMissing = !!statusQuery.error

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }))
    setFieldErrors((prev) => ({ ...prev, [name]: null }))
    connect.reset()
  }

  function validateAll(): boolean {
    const errors: Record<string, string | null> = {}
    let ok = true
    for (const f of descriptor.fields) {
      const err = f.validate ? f.validate(values[f.name] ?? "") : null
      errors[f.name] = err
      if (err) ok = false
    }
    setFieldErrors(errors)
    return ok
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateAll() || connect.isPending) return
    connect.reset()
    setPinOpen(true)
  }

  async function handlePinConfirm(pin: string) {
    return new Promise<void>((resolve, reject) => {
      connect.mutate(
        { pin },
        {
          onSuccess: () => {
            // Reset secret fields so a stale value isn't left in memory.
            setValues((prev) => {
              const next = { ...prev }
              for (const f of descriptor.fields) {
                if (f.type === "password") next[f.name] = ""
              }
              return next
            })
            setPinOpen(false)
            void statusQuery.refetch()
            void queryClient.invalidateQueries({ queryKey: [`${descriptor.id}-status`] })
            resolve()
          },
          onError: (err) => reject(err),
        },
      )
    })
  }

  return (
    <SectionCard
      title={`Connexion ${descriptor.label}`}
      description={descriptor.hint}
      accent="green"
      contentClassName="space-y-4"
    >
      <div className="rounded-xl border border-border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-card border border-border">
              <CloudIcon className="h-4 w-4 text-[color:var(--accent-green)]" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{descriptor.label}</p>
              <p className="text-xs text-muted-foreground truncate">
                {statusQuery.isLoading
                  ? "Vérification…"
                  : authenticated
                    ? `Connecté · ${statusQuery.data?.primaryIdentifier ?? ""}`
                    : "Non connecté"}
              </p>
            </div>
          </div>
          {!statusQuery.isLoading &&
            (authenticated ? (
              <Badge variant="success">Actif</Badge>
            ) : (
              <Badge variant="muted">Inactif</Badge>
            ))}
        </div>
      </div>

      {backendMissing && (
        <WarnBanner
          message={`L'endpoint ${descriptor.statusEndpoint} n'est pas encore joignable. Le formulaire reste utilisable — l'appel échouera tant que le backend n'est pas déployé.`}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {descriptor.fields.map((f) => (
          <FieldRow
            key={f.name}
            field={f}
            value={values[f.name] ?? ""}
            error={fieldErrors[f.name] ?? null}
            reveal={!!showSecret[f.name]}
            onChange={(v) => setField(f.name, v)}
            onToggleReveal={() =>
              setShowSecret((prev) => ({ ...prev, [f.name]: !prev[f.name] }))
            }
          />
        ))}

        <div className="text-[11px] text-muted-foreground leading-relaxed">
          {descriptor.explanation}
        </div>

        {connect.isSuccess && (
          <SuccessBanner message={`Connexion ${descriptor.label} établie avec succès.`} />
        )}
        {connect.error && (
          <ErrorBanner message="Impossible d'établir la connexion. Vérifiez les identifiants et les permissions associées." />
        )}

        <Button type="submit" disabled={connect.isPending}>
          {connect.isPending
            ? "Connexion en cours…"
            : authenticated
              ? "Mettre à jour les identifiants"
              : `Se connecter à ${descriptor.label}`}
        </Button>
      </form>

      <PinPrompt
        open={pinOpen}
        title={`Confirme ton PIN pour chiffrer les identifiants ${descriptor.label}`}
        description="Les identifiants sont chiffrés AES-GCM avec une clé dérivée de ton PIN. Sans lui, personne (pas même nous) ne peut les déchiffrer."
        submitLabel="Chiffrer et activer"
        onCancel={() => setPinOpen(false)}
        onConfirm={handlePinConfirm}
      />
    </SectionCard>
  )
}

function FieldRow({
  field,
  value,
  error,
  reveal,
  onChange,
  onToggleReveal,
}: {
  field: FieldSpec
  value: string
  error: string | null
  reveal: boolean
  onChange: (v: string) => void
  onToggleReveal: () => void
}) {
  const inputId = `cred-${field.name}`
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
      >
        {field.label}
      </label>
      {field.type === "select" ? (
        <select
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "password" ? (
        <div className="relative">
          <input
            id={inputId}
            type={reveal ? "text" : "password"}
            autoComplete={field.autoComplete ?? "off"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 pr-20 text-sm font-mono"
          />
          <button
            type="button"
            onClick={onToggleReveal}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {reveal ? "Masquer" : "Afficher"}
          </button>
        </div>
      ) : (
        <input
          id={inputId}
          type="text"
          autoComplete={field.autoComplete ?? "off"}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={field.placeholder}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono"
        />
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}
