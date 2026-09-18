// lib/import-json.ts
// Librería de importación del export legacy de `daily-budget-data` (config-form).
// Port a la era localStorage de e6f944a: SOLO read/validate/preview/apply — sin
// la capa sql.js/IndexedDB del reference. El apply valida y delega el volcado a
// `useBudget().replaceAll`, que persiste el blob en localStorage y actualiza el
// estado de React al instante (sin reload).
//
// Pipeline: readImportFile (tamaño + texto) → validateImportJson (JSON.parse +
// type guard estricto) → buildImportPreview (puro, sin estado) → applyJsonImport.

import type { LegacyImportData } from './import-json-types'

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024 // 10 MB

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

// Type guard estricto del shape mínimo: budget (mode 'daily'|'track',
// startAmount number, isSetup boolean opcional — un blob legacy puede no
// traerlo), accounts[] (name/type/balance/hidden, type dentro del enum),
// transactions[] (type/amount/account). Los campos derivados
// (dailyAllowance/remainingToday/progress/lastCheckedDay) y los ids (account.id,
// transaction.id, icon, description, date) se toleran pero se ignoran acá: se
// normalizan/recomputan en replaceAll (use-budget).
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
  // Chequeo de tamaño ANTES de leer el texto.
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'too-large', size: file.size }
  }
  const text = await file.text()
  return { ...validateImportJson(text), size: file.size }
}

/**
 * Deriva si un budget legacy pasó por setup. Un blob sin `isSetup` pero con
 * `startAmount > 0` claramente fue configurado; startAmount 0/falsy → device
 * fresco. Si `isSetup` está presente, se respeta su valor explícito.
 */
export function isBudgetConfigured(budget: {
  isSetup?: boolean
  startAmount: number
}): boolean {
  return budget.isSetup ?? (budget.startAmount > 0)
}

// Rango min/max de tx.date. Comparación lexicográfica válida para ISO
// (toISOString) y YYYY-MM-DD (blob legacy). Sin transacciones con fecha →
// { start: null, end: null }.
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

/**
 * Valida ANTES de tocar el estado (shape inválido → throw sin efecto) y luego
 * delega el volcado al callback `replace` (useBudget().replaceAll): persiste el
 * blob en localStorage y actualiza el estado de React al instante. Devuelve los
 * contadores del data importado (espejo del `{ accounts, transactions }` que el
 * reference devolvía con row counts de la DB).
 */
export function applyJsonImport(
  text: string,
  replace: (data: LegacyImportData) => void
): { accounts: number; transactions: number } {
  const res = validateImportJson(text)
  if (!res.ok) {
    // Mismo contrato de error que el reference: objeto { error } que el modal
    // mapea a i18n. Sin efecto sobre el estado actual.
    throw { error: res.error }
  }

  replace(res.data)

  return {
    accounts: res.data.accounts.length,
    transactions: res.data.transactions.length,
  }
}

// Re-export para que el modal y use-budget compartan el contrato de entrada.
export type { LegacyImportData } from './import-json-types'