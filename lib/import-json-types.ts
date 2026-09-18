// lib/import-json-types.ts
// Shape del blob legacy de localStorage (`daily-budget-data`): el archivo JSON
// de export tiene EXACTAMENTE este shape (mismo contrato que LocalStorageData
// de migrate-localstorage en e6f944a). Los campos derivados (dailyAllowance/
// remainingToday/progress/lastCheckedDay) y los ids opcionales se toleran al
// validar pero se normalizan/recomputan en el apply.

export type LegacyImportAccount = {
  id?: string // slug como 'daily', 'savings', 'investment' o custom
  name: string
  type: string
  icon?: string
  hidden?: boolean
  balance: number
}

export type LegacyImportBudget = {
  startAmount: number
  endDate?: string | null
  startDate?: string | null
  mode: 'daily' | 'track'
  autoSave?: boolean
  isSetup?: boolean
}

export type LegacyImportTransaction = {
  id?: string
  type: string
  amount: number
  description?: string
  account: string
  date?: string
}

export type LegacyImportData = {
  budget: LegacyImportBudget
  accounts: LegacyImportAccount[]
  transactions: LegacyImportTransaction[]
  dailyAllowance?: number
  remainingToday?: number
  progress?: number
  lastCheckedDay?: string | null
  isSetup?: boolean
}