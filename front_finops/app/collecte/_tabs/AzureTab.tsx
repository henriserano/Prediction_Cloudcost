"use client"

import {
  CredentialsTab,
  type CredentialsProviderDescriptor,
} from "@/components/credentials/CredentialsTab"

// GUID validator — trust-but-verify at the client so we don't waste a
// round-trip on obviously malformed IDs. The backend runs the same regex.
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const isGuid = (v: string) => (GUID_RE.test(v) ? null : "Format GUID attendu (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).")

// Regions the SP usually lives on. Keep the list short — the backend accepts
// any Azure region, this is only UX guidance.
const AZURE_LOCATIONS = [
  "westeurope",
  "northeurope",
  "francecentral",
  "eastus",
  "eastus2",
  "westus2",
  "southeastasia",
] as const

const AZURE_DESCRIPTOR: CredentialsProviderDescriptor = {
  id: "azure",
  label: "Microsoft Azure",
  hint: "Service Principal (App registration) en lecture seule sur la souscription — récupère la facturation via Cost Management.",
  statusEndpoint: "/api/azure/status",
  credentialsEndpoint: "/api/credentials/azure",
  fields: [
    {
      name: "tenantId",
      label: "Tenant ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      validate: isGuid,
    },
    {
      name: "subscriptionId",
      label: "Subscription ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      validate: isGuid,
    },
    {
      name: "clientId",
      label: "Client ID (Application ID)",
      placeholder: "00000000-0000-0000-0000-000000000000",
      validate: isGuid,
    },
    {
      name: "clientSecret",
      label: "Client Secret",
      placeholder: "••••••••••••••••••••••••",
      type: "password",
      validate: (v) => (v.length >= 8 ? null : "Client secret trop court."),
    },
    {
      name: "location",
      label: "Région par défaut",
      type: "select",
      options: AZURE_LOCATIONS,
    },
  ],
  toPayload: (v) => ({
    tenant_id: v.tenantId,
    client_id: v.clientId,
    client_secret: v.clientSecret,
    subscription_id: v.subscriptionId,
    location: v.location || "westeurope",
  }),
  toLabel: (v) => `${v.subscriptionId} · ${v.location || "westeurope"}`,
  explanation: (
    <>
      Créez un Service Principal via{" "}
      <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">az ad sp create-for-rbac</code>{" "}
      et assignez-lui le rôle{" "}
      <code className="rounded bg-muted px-1 py-0.5 text-[10.5px]">Cost Management Reader</code> sur
      la souscription cible. Les identifiants transitent via le proxy applicatif et sont chiffrés
      AES-GCM avec une clé dérivée de votre PIN — jamais stockés en clair.
    </>
  ),
  parseStatus: (raw) => {
    const r = (raw ?? {}) as {
      authenticated?: boolean
      subscriptionId?: string | null
      detail?: string | null
    }
    return {
      authenticated: !!r.authenticated,
      primaryIdentifier: r.subscriptionId ?? null,
      detail: r.detail ?? null,
    }
  },
}

export function AzureTab() {
  return <CredentialsTab descriptor={AZURE_DESCRIPTOR} />
}
