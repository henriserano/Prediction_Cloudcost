import { redirect } from "next/navigation"

// Legacy path — see /dashboard for context. Redirects to the "Anomalies"
// sub-tab of the consolidated Analyse hub.
export default function DiagnosticsRedirect() {
  redirect("/analyse?tab=anomalies")
}
