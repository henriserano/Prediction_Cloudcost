import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import Sidebar from "@/components/layout/Sidebar"
import Providers from "@/app/providers"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
})

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://finops.sia.app"

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Sia · FinOps Cloud Cost Analytics",
    template: "%s · Sia FinOps",
  },
  description:
    "Plateforme Sia FinOps — analyse et prévision des coûts cloud multi-fournisseurs. Détection d'anomalies, décomposition STL, benchmark de 6 modèles de prévision.",
  applicationName: "Sia FinOps",
  keywords: [
    "FinOps",
    "cloud cost",
    "GCP",
    "AWS",
    "prévision coûts",
    "forecasting",
    "anomaly detection",
    "Sia",
    "cost optimization",
  ],
  authors: [{ name: "Sia" }],
  creator: "Sia",
  publisher: "Sia",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: APP_URL,
    siteName: "Sia FinOps",
    title: "Sia · FinOps Cloud Cost Analytics",
    description:
      "Analyse et prévision des coûts cloud. Anomalies, STL, benchmark de 6 modèles.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sia · FinOps Cloud Cost Analytics",
    description:
      "Analyse et prévision des coûts cloud. Anomalies, STL, benchmark de 6 modèles.",
  },
  robots: {
    index: false, // internal tool — flip to true when public
    follow: false,
    googleBot: { index: false, follow: false },
  },
  icons: {
    icon: "/favicon.ico",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1F3A" },
  ],
  colorScheme: "light dark",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full flex bg-background text-foreground">
        <Providers>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-3 focus:py-2 focus:text-sm focus:text-brand-foreground focus:shadow-lg"
          >
            Aller au contenu principal
          </a>
          <Sidebar />
          <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  )
}
