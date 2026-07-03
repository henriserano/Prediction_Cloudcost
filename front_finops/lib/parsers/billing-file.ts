import * as XLSX from "xlsx"
import type { BillingEvent } from "@/lib/types"

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseError {
  line: number
  message: string
}

export interface ParsedResult {
  events: BillingEvent[]
  errors: ParseError[]
  totalRows: number
  detectedColumns?: { date: string; service: string; cost: string; description?: string }
  format: "csv" | "excel"
}

const DATE_ALIASES     = ["date", "day", "usage_date", "usage date", "jour", "start_date", "billing_period_start"]
const SERVICE_ALIASES  = ["service", "service_name", "service description", "service_description", "sku", "product", "product_name"]
const COST_ALIASES     = ["cost", "amount", "montant", "coût", "cout", "total", "cost_eur", "cost_usd", "line_item_unblended_cost", "unblended_cost"]
const DESC_ALIASES     = ["description", "desc", "libelle", "libellé", "resource", "resource_name"]

export async function parseBillingFile(file: File): Promise<ParsedResult> {
  const name = file.name.toLowerCase()
  const isExcel = /\.(xlsx|xls|xlsm)$/i.test(name)
  try {
    if (isExcel) return await parseExcel(file)
    return await parseCSV(file)
  } catch (e) {
    return {
      events: [],
      errors: [{ line: 0, message: `Impossible de lire le fichier : ${e instanceof Error ? e.message : "erreur inconnue"}` }],
      totalRows: 0,
      format: isExcel ? "excel" : "csv",
    }
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

async function parseCSV(file: File): Promise<ParsedResult> {
  const text = await file.text()
  const cleaned = text.replace(/^﻿/, "") // strip BOM
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0)

  if (lines.length < 2) {
    return {
      events: [],
      errors: [{ line: 0, message: "Le fichier ne contient pas de données." }],
      totalRows: 0,
      format: "csv",
    }
  }

  const firstLine = lines[0]
  const commaCount = (firstLine.match(/,/g) || []).length
  const semiCount = (firstLine.match(/;/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length
  const delimiter =
    tabCount > Math.max(commaCount, semiCount)
      ? "\t"
      : semiCount > commaCount
        ? ";"
        : ","

  const header = splitCSVLine(firstLine, delimiter).map(normalizeHeader)
  const mapping = detectColumns(header)
  if (!mapping) {
    return {
      events: [],
      errors: [{ line: 1, message: `Colonnes requises manquantes. Attendues : date, service, cost. Trouvées : ${header.join(", ")}` }],
      totalRows: lines.length - 1,
      format: "csv",
    }
  }

  const rowsRaw = lines.slice(1).map((l) => splitCSVLine(l, delimiter))
  return normalizeRows(rowsRaw, header, mapping, "csv")
}

function splitCSVLine(line: string, delimiter: string): string[] {
  // Minimal quoted-field aware splitter
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\""
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (c === delimiter && !inQuotes) {
      out.push(cur)
      cur = ""
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

async function parseExcel(file: File): Promise<ParsedResult> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { cellDates: true, cellNF: false, cellText: false })

  // Pick the first non-empty sheet
  let sheetName = wb.SheetNames[0]
  let bestRowCount = 0
  for (const s of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, blankrows: false }) as unknown[][]
    if (rows.length > bestRowCount) {
      bestRowCount = rows.length
      sheetName = s
    }
  }

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    raw: false,   // format according to cell format (dates → ISO-ish strings)
    dateNF: "yyyy-mm-dd",
  }) as unknown[][]

  if (rows.length < 2) {
    return {
      events: [],
      errors: [{ line: 0, message: `La feuille "${sheetName}" ne contient pas de données.` }],
      totalRows: 0,
      format: "excel",
    }
  }

  const header = (rows[0] as unknown[]).map((v) => normalizeHeader(String(v ?? "")))
  const mapping = detectColumns(header)
  if (!mapping) {
    return {
      events: [],
      errors: [{ line: 1, message: `Colonnes requises manquantes dans la feuille "${sheetName}". Attendues : date, service, cost. Trouvées : ${header.join(", ")}` }],
      totalRows: rows.length - 1,
      format: "excel",
    }
  }

  const rowsRaw = rows.slice(1).map((r) => (r as unknown[]).map((v) => stringifyCell(v)))
  return normalizeRows(rowsRaw, header, mapping, "excel")
}

function stringifyCell(v: unknown): string {
  if (v == null) return ""
  if (v instanceof Date) return isoDate(v)
  if (typeof v === "number") return String(v)
  return String(v).trim()
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// Shared normalization
// ---------------------------------------------------------------------------

interface ColumnMapping {
  date: number
  service: number
  cost: number
  desc: number
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/^"|"$/g, "").trim()
}

function detectColumns(header: string[]): ColumnMapping | null {
  const find = (aliases: string[]) => header.findIndex((h) => aliases.includes(h))
  const date = find(DATE_ALIASES)
  const service = find(SERVICE_ALIASES)
  const cost = find(COST_ALIASES)
  const desc = find(DESC_ALIASES)
  if (date < 0 || service < 0 || cost < 0) return null
  return { date, service, cost, desc }
}

function normalizeRows(
  rows: string[][],
  header: string[],
  mapping: ColumnMapping,
  format: "csv" | "excel",
): ParsedResult {
  const events: BillingEvent[] = []
  const errors: ParseError[] = []

  rows.forEach((cols, i) => {
    const lineNum = i + 2 // 1-based, +1 for header
    if (cols.every((c) => !c)) return // silently skip empty rows

    const rawDate = cols[mapping.date]
    const rawCost = cols[mapping.cost]
    const service = cols[mapping.service]
    const description = mapping.desc >= 0 ? cols[mapping.desc] : undefined

    if (!rawDate || !service || rawCost == null || rawCost === "") {
      errors.push({ line: lineNum, message: "Valeur manquante" })
      return
    }
    const date = normalizeDate(rawDate)
    if (!date) {
      errors.push({ line: lineNum, message: `Date invalide "${rawDate}" (attendu YYYY-MM-DD)` })
      return
    }
    const cost = normalizeCost(rawCost)
    if (cost == null) {
      errors.push({ line: lineNum, message: `Coût invalide "${rawCost}"` })
      return
    }
    events.push({ date, service, cost, ...(description ? { description } : {}) })
  })

  return {
    events,
    errors,
    totalRows: rows.length,
    format,
    detectedColumns: {
      date: header[mapping.date],
      service: header[mapping.service],
      cost: header[mapping.cost],
      description: mapping.desc >= 0 ? header[mapping.desc] : undefined,
    },
  }
}

function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim()
  // Common formats: 2024-01-15, 2024/01/15, 15/01/2024, 15-01-2024
  const iso = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const eu = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/)
  if (eu) return `${eu[3]}-${eu[2]}-${eu[1]}`
  // Try native Date parse as last resort
  const d = new Date(trimmed)
  if (!Number.isNaN(d.getTime())) return isoDate(d)
  return null
}

function normalizeCost(raw: string): number | null {
  // Strip spaces, thousands separators, currency symbols
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/[€$£¥]/g, "")
    .replace(/,/g, ".")
    // Handle "1.234.56" → "1234.56" by keeping only last dot
  const lastDot = cleaned.lastIndexOf(".")
  const normalized =
    lastDot >= 0
      ? cleaned.slice(0, lastDot).replace(/\./g, "") + "." + cleaned.slice(lastDot + 1)
      : cleaned
  const n = parseFloat(normalized)
  return Number.isFinite(n) ? n : null
}
