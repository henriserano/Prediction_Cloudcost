import { redirect } from "next/navigation"

// Legacy path — see /dashboard for context. Redirects to the "Répartition"
// sub-tab of the consolidated Analyse hub.
export default function ServicesRedirect() {
  redirect("/analyse?tab=repartition")
}
