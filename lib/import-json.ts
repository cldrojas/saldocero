// lib/import-json.ts
// Librería de importación de `data.json` (export de config-form o blob legacy de localStorage).
// Fase 2 de `import-data-json`: read/validate/preview/apply — sin UI (D7, D8, D10).
//
// Pipeline: readImportFile (tamaño + texto) → validateImportJson (JSON.parse + type guard
// estricto) → buildImportPreview (puro, sin DB) → applyJsonImport (getDb() singleton, sin setDb).

import type { Database } from 'sql.js'

import { exportDb, getDb } from '@/lib/db/client'
import { saveBackup, saveToIndexedDB } from '@/lib/db/persistence'
import { clearData } from '@/lib/db/repository'
import { insertLegacyData, isBudgetConfigured, MIGRATED_FLAG_KEY } from '@/lib/migrate-localstorage'
import type { LegacyImportData } from '@/lib/migrate-localstorage'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024 // 10 MB (D7)

export type ImportFileError = 'too-large' | 'invalid-json' | 'invalid-shape'

export type ImportParseResult =
  | { ok: true; data: LegacyImportData }
  | { ok: false; error: ImportFileError }

export type ImportPreview = {
  accounts: number
  transactions: number
  mode: string
  dateRange: { start: string | null; end: string | null }
  hasConfiguredBudget: boolean
}

const ACCOUNT_TYPES = ['daily', 'savings', 'investment', 'custom', 'expense'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Type guard estricto del shape mínimo (D7): budget (mode 'daily'|'track', startAmount number,
// isSetup boolean opcional — un blob legacy puede no traerlo, FR-2), accounts[] (name/type/
// balance/hidden, type dentro del enum del CHECK del schema), transactions[] (type/amount/
// account). Los campos derivados (dailyAllowance/remainingToday/progress/lastCheckedDay) se
// toleran pero se ignoran: se recomputan vía loadState (D7).
function isLegacyImportData(value: unknown): value is LegacyImportData {
  if (!isRecord(value)) return false

  const { budget, accounts, transactions } = value

  if (!isRecord(budget)) return false
  if (typeof budget.startAmount !== 'number') return false
  if (budget.mode !== 'daily' && budget.mode !== 'track') return false
  if (budget.isSetup !== undefined && typeof budget.isSetup !== 'boolean') return false

  if (!Array.isArray(accounts)) return false
  if (!Array.isArray(transactions)) return false

  for (const account of accounts) {
    if (!isRecord(account)) return false
    if (typeof account.name !== 'string') return false
    if (
      typeof account.type !== 'string' ||
      !(ACCOUNT_TYPES as readonly string[]).includes(account.type)
    ) {
      return false
    }
    if (typeof account.balance !== 'number') return false
    if (account.hidden !== undefined && typeof account.hidden !== 'boolean') return false
  }

  for (const transaction of transactions) {
    if (!isRecord(transaction)) return false
    if (typeof transaction.type !== 'string') return false
    if (typeof transaction.amount !== 'number') return false
    if (typeof transaction.account !== 'string') return false
  }

  return true
}

export function validateImportJson(text: string): ImportParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  if (!isLegacyImportData(parsed)) {
    return { ok: false, error: 'invalid-shape' }
  }
  return { ok: true, data: parsed }
}

export async function readImportFile(file: File): Promise<ImportParseResult & { size: number }> {
  // Chequeo de tamaño ANTES de leer el texto (D7).
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'too-large', size: file.size }
  }
  const text = await file.text()
  return { ...validateImportJson(text), size: file.size }
}

// Rango min/max de tx.date. Comparación lexicográfica válida para ISO (toISOString) y
// YYYY-MM-DD (blob legacy). Sin transacciones con fecha → { start: null, end: null }.
function dateRange(
  transactions: LegacyImportData['transactions']
): { start: string | null; end: string | null } {
  const dates = transactions
    .map((transaction) => transaction.date)
    .filter((date): date is string => typeof date === 'string' && date.length > 0)
  if (dates.length === 0) return { start: null, end: null }
  return {
    start: dates.reduce((min, date) => (date < min ? date : min)),
    end: dates.reduce((max, date) => (date > max ? date : max)),
  }
}

export function buildImportPreview(data: LegacyImportData): ImportPreview {
  return {
    accounts: data.accounts.length,
    transactions: data.transactions.length,
    mode: data.budget.mode,
    dateRange: dateRange(data.transactions),
    hasConfiguredBudget: isBudgetConfigured(data.budget),
  }
}

function countRows(db: Database, table: 'accounts' | 'transactions'): number {
  const stmt = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
  try {
    stmt.step()
    return (stmt.getAsObject() as { count: number }).count
  } finally {
    stmt.free()
  }
}

export async function applyJsonImport(
  text: string,
  opts: { replace: boolean }
): Promise<{ accounts: number; transactions: number }> {
  // 1. Validar antes de tocar la DB (D7): shape inválido → throw sin efecto sobre db.
  const res = validateImportJson(text)
  if (!res.ok) {
    throw { error: res.error }
  }

  // 2. Misma instancia singleton, sin setDb (D8): se muta en sitio y se elimina la
  //    carrera de autosave por swap que existía en applyQrImport.
  const db = await getDb()

  // 3. Path reemplazo: backup best-effort (espejo de `pre-claim-*`) + clearData.
  if (opts.replace) {
    try {
      await saveBackup(exportDb(db), `pre-import-${Date.now()}`)
    } catch {
      // best-effort: un backup que falla no aborta el import
    }
    clearData(db)
  }

  // 4-5. Mapeo + persistencia. insertLegacyData es idempotente (ON CONFLICT DO NOTHING):
  //      un doble import no duplica filas.
  insertLegacyData(db, res.data)
  await saveToIndexedDB(db)

  // FR-4.6: marca la flag para que la migración automática no sobre-escriba después.
  window.localStorage.setItem(MIGRATED_FLAG_KEY, 'true')

  // 6. Contadores de filas resultantes.
  return {
    accounts: countRows(db, 'accounts'),
    transactions: countRows(db, 'transactions'),
  }
}