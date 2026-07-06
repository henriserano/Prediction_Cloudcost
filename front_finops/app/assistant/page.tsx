import PageShell from "@/components/layout/PageShell"
import { ChatInterface } from "@/components/assistant/ChatInterface"

export default function AssistantPage() {
  return (
    <PageShell
      eyebrow="Analytical assistant"
      title="Assistant FinOps"
      description="Interroge la plateforme en langage naturel. L'assistant consulte les endpoints d'analyse pour appuyer chaque réponse sur les données réelles."
    >
      <ChatInterface />
    </PageShell>
  )
}
