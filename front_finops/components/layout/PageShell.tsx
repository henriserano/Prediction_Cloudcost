import React from "react"

interface PageShellProps {
  title: string
  description?: string
  children: React.ReactNode
}

export default function PageShell({ title, description, children }: PageShellProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto">
      <header className="px-8 py-6 border-b shrink-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </header>
      <main className="flex-1 px-8 py-6 space-y-6">{children}</main>
    </div>
  )
}
