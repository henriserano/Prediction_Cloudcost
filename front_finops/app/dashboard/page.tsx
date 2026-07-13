import { redirect } from "next/navigation"

// Legacy path — kept as a permanent redirect after the January 2026 IA refresh
// consolidated dashboard/services/analytics/diagnostics under a single
// /analyse hub with sub-tabs.
export default function DashboardRedirect() {
  redirect("/analyse?tab=tableau-de-bord")
}
