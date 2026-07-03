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
  detectedColumns?: {
    date: string
    service: string
    cost: string
    description?: string
  }
  format: "csv" | "excel"
  sheetName?: string
}

// Header aliases — lowercased, punctuation-normalized (spaces/dashes/underscores collapsed to "_")
// Add freely; the matcher is fuzzy.
const DATE_ALIASES = new Set([
  "date", "day", "usage_date", "jour", "start_date", "billing_period_start",
  "period_start", "invoice_date", "invoice_period_start", "date_facturation",
  "date_de_facturation", "periode", "période", "mois", "month",
  "billing_date", "consumption_date", "reporting_date",
])

const SERVICE_ALIASES = new Set([
  "service", "service_name", "service_description", "sku",
  "product", "product_name", "product_code", "produit", "nom_produit",
  "line_item_product_code", "line_item_service", "resource_type",
  "meter_category", "meter_subcategory", "category", "categorie", "catégorie",
  "libelle", "libellé", "designation", "désignation", "prestation",
])

const COST_ALIASES = new Set([
  "cost", "amount", "montant", "total", "prix", "price", "value", "valeur",
  "cout", "coût", "cost_eur", "cost_usd", "cost_local", "cost_amount",
  "line_item_unblended_cost", "unblended_cost", "blended_cost",
  "pretaxcost", "pretax_cost", "pretaxamount", "netamount", "net_amount",
  "amount_ttc", "amount_ht", "montant_ht", "montant_ttc", "facture", "facturation",
  "usage_amount", "billed_amount",
])

const DESC_ALIASES = new Set([
  "description", "desc", "libelle", "libellé", "resource", "resource_name",
  "resource_id", "usage_type", "usage_description", "notes", "commentaire",
  "detail", "détail",
])

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function parseBillingFile(file: File): Promise<ParsedResult> {
  const name = file.name.toLowerCase()
  const isExcel = /\.(xlsx|xls|xlsm|xlsb|ods)$/i.test(name)
  try {
    if (isExcel) return await parseExcel(file)
    return await parseCSV(file)
  } catch (e) {
    return {
      events: [],
      errors: [
        {
          line: 0,
          message: `Impossible de lire le fichier : ${
            e instanceof Error ? e.message : "erreur inconnue"
          }`,
        },
      ],
      totalRows: 0,
      format: isExcel ? "excel" : "csv",
    }
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

async function parseCSV(file: File): Promise<ParsedResult> {
  const rawText = await file.text()
  const text = rawText.replace(/^﻿/, "") // strip UTF-8 BOM
  const allLines = text.split(/\r?\n/)

  if (allLines.every((l) => l.trim() === "")) {
    return {
      events: [],
      errors: [{ line: 0, message: "Le fichier est vide." }],
      totalRows: 0,
      format: "csv",
    }
  }

  const delimiter = detectCSVDelimiter(allLines)

  // Parse every non-empty line into cells
  const parsedLines: { lineNum: number; cells: string[] }[] = []
  allLines.forEach((line, i) => {
    if (line.trim() === "") return
    parsedLines.push({ lineNum: i + 1, cells: splitCSVLine(line, delimiter) })
  })

  if (parsedLines.length < 2) {
    return {
      events: [],
      errors: [{ line: 0, message: "Le fichier ne contient pas assez de lignes." }],
      totalRows: 0,
      format: "csv",
    }
  }

  // Scan the first ~10 rows to find the header row
  const headerHit = findHeaderRow(parsedLines.slice(0, Math.min(20, parsedLines.length)))
  if (!headerHit) {
    const headerCandidates = parsedLines.slice(0, 3).map((p) => p.cells.join(", ")).join("  |  ")
    return {
      events: [],
      errors: [
        {
          line: parsedLines[0].lineNum,
          message: `Colonnes requises manquantes. Attendues : date, service, cost. Premières lignes : ${headerCandidates}`,
        },
      ],
      totalRows: parsedLines.length - 1,
      format: "csv",
    }
  }

  const { headerIndex, mapping, header } = headerHit
  const dataRows = parsedLines.slice(headerIndex + 1)

  return normalizeRows(dataRows, header, mapping, "csv", undefined)
}

function detectCSVDelimiter(lines: string[]): string {
  // Look at up to 5 non-empty lines and pick the delimiter with the most consistent, highest count
  const candidates = [",", ";", "\t", "|"]
  const sample = lines.filter((l) => l.trim() !== "").slice(0, 5)
  let best = ","
  let bestScore = -1
  for (const d of candidates) {
    const counts = sample.map((l) => countOutsideQuotes(l, d))
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    if (min >= 1 && max - min <= 1 && min > bestScore) {
      bestScore = min
      best = d
    }
  }
  return best
}

function countOutsideQuotes(line: string, ch: string): number {
  let n = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (!inQuotes && c === ch) {
      n++
    }
  }
  return n
}

function splitCSVLine(line: string, delimiter: string): string[] {
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
  const wb = XLSX.read(buf, {
    cellDates: true,
    cellNF: false,
    cellText: false,
    dense: false,
  })

  // Try every sheet — pick the first one that yields a valid header + data
  let bestResult: ParsedResult | null = null
  let bestFallback: ParsedResult | null = null

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      raw: false,
      dateNF: "yyyy-mm-dd",
      defval: "",
    }) as unknown[][]

    if (rows.length < 2) continue

    const parsedLines = rows.map((r, i) => ({
      lineNum: i + 1,
      cells: r.map((v) => stringifyCell(v)),
    }))

    // Skip leading empty columns globally (e.g. spreadsheets that start at column B)
    const trimmed = trimEmptyLeadingColumns(parsedLines)

    const headerHit = findHeaderRow(
      trimmed.slice(0, Math.min(20, trimmed.length))
    )
    if (!headerHit) {
      // remember first sheet as fallback for error reporting
      if (!bestFallback) {
        bestFallback = {
          events: [],
          errors: [
            {
              line: 1,
              message: `Colonnes requises non trouvées dans la feuille "${sheetName}". Vérifiez que le fichier contient bien les colonnes date, service, cost (ou équivalents FR).`,
            },
          ],
          totalRows: trimmed.length,
          format: "excel",
          sheetName,
        }
      }
      continue
    }

    const { headerIndex, mapping, header } = headerHit
    const dataRows = trimmed.slice(headerIndex + 1)
    const result = normalizeRows(dataRows, header, mapping, "excel", sheetName)
    // Prefer sheet that yielded actual events
    if (result.events.length > 0) {
      return result
    }
    if (!bestResult) bestResult = result
  }

  if (bestResult) return bestResult
  if (bestFallback) return bestFallback
  return {
    events: [],
    errors: [{ line: 0, message: "Aucune feuille exploitable trouvée dans le classeur." }],
    totalRows: 0,
    format: "excel",
  }
}

function trimEmptyLeadingColumns(
  rows: { lineNum: number; cells: string[] }[]
): { lineNum: number; cells: string[] }[] {
  let leading = 0
  const max = Math.max(...rows.map((r) => r.cells.length))
  outer: for (leading = 0; leading < max; leading++) {
    for (const r of rows) {
      if ((r.cells[leading] ?? "").trim() !== "") break outer
    }
  }
  if (leading === 0) return rows
  return rows.map((r) => ({ ...r, cells: r.cells.slice(leading) }))
}

function stringifyCell(v: unknown): string {
  if (v == null) return ""
  if (v instanceof Date) return isoDate(v)
  if (typeof v === "number") return String(v)
  if (typeof v === "boolean") return v ? "true" : "false"
  return String(v).trim()
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// ---------------------------------------------------------------------------
// Header detection & normalization
// ---------------------------------------------------------------------------

interface ColumnMapping {
  date: number
  service: number
  cost: number
  desc: number
}

/**
 * Normalize a header cell so aliases match regardless of case, accents,
 * separators or trailing punctuation. Example: "Coût total (€)" → "cout_total".
 */
function normalizeHeader(h: string): string {
  return (h ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip diacritics
    .replace(/["']/g, "")
    .replace(/\([^)]*\)/g, "")         // drop "(EUR)", "(USD)", …
    .replace(/[^a-z0-9]+/g, "_")       // collapse everything else to "_"
    .replace(/^_+|_+$/g, "")
    .trim()
}

/**
 * Fuzzy alias match. Accepts an exact hit or a token-subset match
 * (e.g. "cost_amount" matches "amount"; "service_description" matches "service").
 */
function aliasMatch(normalized: string, aliases: Set<string>): boolean {
  if (aliases.has(normalized)) return true
  const tokens = normalized.split("_").filter(Boolean)
  for (const a of aliases) {
    if (tokens.includes(a)) return true
  }
  // Substring fallback for compound headers like "line_item_unblended_cost"
  for (const a of aliases) {
    if (normalized.includes(a)) return true
  }
  return false
}

function detectColumnsFromRow(row: string[]): ColumnMapping | null {
  const norm = row.map(normalizeHeader)
  const date = norm.findIndex((h) => aliasMatch(h, DATE_ALIASES))
  const service = norm.findIndex((h) => aliasMatch(h, SERVICE_ALIASES))
  const cost = norm.findIndex((h) => aliasMatch(h, COST_ALIASES))
  const desc = norm.findIndex((h) => aliasMatch(h, DESC_ALIASES))
  if (date < 0 || service < 0 || cost < 0) return null
  return { date, service, cost, desc }
}

function findHeaderRow(
  candidates: { lineNum: number; cells: string[] }[]
): { headerIndex: number; mapping: ColumnMapping; header: string[] } | null {
  for (let i = 0; i < candidates.length; i++) {
    const cells = candidates[i].cells
    if (cells.every((c) => c === "")) continue
    const mapping = detectColumnsFromRow(cells)
    if (mapping) return { headerIndex: i, mapping, header: cells }
  }
  return null
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

function normalizeRows(
  rows: { lineNum: number; cells: string[] }[],
  header: string[],
  mapping: ColumnMapping,
  format: "csv" | "excel",
  sheetName?: string,
): ParsedResult {
  const events: BillingEvent[] = []
  const errors: ParseError[] = []

  for (const row of rows) {
    const cols = row.cells
    if (!cols || cols.every((c) => !c)) continue // skip empty rows silently

    const rawDate = cols[mapping.date] ?? ""
    const rawCost = cols[mapping.cost] ?? ""
    const service = cols[mapping.service] ?? ""
    const description =
      mapping.desc >= 0 ? cols[mapping.desc] || undefined : undefined

    if (!rawDate.trim() || !service.trim() || !String(rawCost).trim()) {
      errors.push({ line: row.lineNum, message: "Valeur manquante" })
      continue
    }
    const date = normalizeDate(rawDate)
    if (!date) {
      errors.push({
        line: row.lineNum,
        message: `Date invalide "${rawDate}"`,
      })
      continue
    }
    const cost = normalizeCost(rawCost)
    if (cost == null) {
      errors.push({
        line: row.lineNum,
        message: `Coût invalide "${rawCost}"`,
      })
      continue
    }
    events.push({
      date,
      service: service.trim(),
      cost,
      ...(description ? { description } : {}),
    })
  }

  return {
    events,
    errors,
    totalRows: rows.length,
    format,
    sheetName,
    detectedColumns: {
      date: header[mapping.date],
      service: header[mapping.service],
      cost: header[mapping.cost],
      description: mapping.desc >= 0 ? header[mapping.desc] : undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

const MONTH_FR: Record<string, number> = {
  janv: 1, jan: 1,
  fev: 2, feb: 2,
  mars: 3, mar: 3,
  avr: 4, apr: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6,
  juil: 7, jul: 7,
  aout: 8, aug: 8,
  sept: 9, sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // ISO 8601 (2024-01-15, 2024/01/15, 2024.01.15) — optionally with time
  const iso = trimmed.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // EU (15/01/2024, 15-01-2024, 15.01.2024)
  const eu = trimmed.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})/)
  if (eu) return `${eu[3]}-${eu[2]}-${eu[1]}`

  // Month only: "2024-01" or "01/2024" → default day 01
  const monthIso = trimmed.match(/^(\d{4})[-/.](\d{2})$/)
  if (monthIso) return `${monthIso[1]}-${monthIso[2]}-01`
  const monthEu = trimmed.match(/^(\d{2})[-/.](\d{4})$/)
  if (monthEu) return `${monthEu[2]}-${monthEu[1]}-01`

  // French textual: "15 janv 2024" or "janv 2024"
  const textFr = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .match(/(?:(\d{1,2})\s+)?([a-z]+)[.\s-]+(\d{4})/)
  if (textFr) {
    const day = textFr[1] ? textFr[1].padStart(2, "0") : "01"
    const monthKey = textFr[2].slice(0, 4)
    const monthNum = MONTH_FR[monthKey] ?? MONTH_FR[textFr[2].slice(0, 3)]
    if (monthNum) {
      return `${textFr[3]}-${String(monthNum).padStart(2, "0")}-${day}`
    }
  }

  // Native Date parse (RFC 2822, ISO with time, etc.)
  const d = new Date(trimmed)
  if (!Number.isNaN(d.getTime())) return isoDate(d)

  return null
}

function normalizeCost(raw: string | number): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null
  }
  const s = String(raw).trim()
  if (!s) return null

  // Strip whitespace (incl. non-breaking), currency symbols, percent signs, and letters
  let cleaned = s
    .replace(/[\s  ]/g, "")
    .replace(/[€$£¥₹₽₩]/g, "")
    .replace(/[a-zA-Z]/g, "")

  // Handle parentheses = negative accounting notation "(123.45)" → -123.45
  const isNegative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith("-")
  cleaned = cleaned.replace(/[()]/g, "").replace(/^-/, "")

  // European "1.234,56" → "1234.56"
  // Anglo "1,234.56" → "1234.56"
  const lastComma = cleaned.lastIndexOf(",")
  const lastDot = cleaned.lastIndexOf(".")
  if (lastComma > lastDot) {
    // decimal is comma
    cleaned = cleaned.replace(/\./g, "").replace(",", ".")
  } else if (lastDot > lastComma) {
    // decimal is dot
    cleaned = cleaned.replace(/,/g, "")
  } else if (lastComma !== -1 && lastDot === -1) {
    // only commas → treat as decimal if there's exactly one, else thousands
    if ((cleaned.match(/,/g) || []).length === 1) {
      cleaned = cleaned.replace(",", ".")
    } else {
      cleaned = cleaned.replace(/,/g, "")
    }
  }

  const n = parseFloat(cleaned)
  if (!Number.isFinite(n)) return null
  return isNegative ? -n : n
}
