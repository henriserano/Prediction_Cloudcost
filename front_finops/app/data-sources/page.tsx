import { redirect } from "next/navigation"

// Legacy path — kept as a permanent redirect so bookmarks, deep-links and
// existing docs (README, deploy.sh comments) keep working after the January
// 2026 IA refresh renamed this step to "Collecte".
export default function DataSourcesRedirect() {
  redirect("/collecte")
}
