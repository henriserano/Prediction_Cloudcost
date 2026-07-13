import { redirect } from "next/navigation"

// Legacy path — see /dashboard for context. Redirects to the "Tendances"
// sub-tab of the consolidated Analyse hub.
export default function AnalyticsRedirect() {
  redirect("/analyse?tab=tendances")
}
