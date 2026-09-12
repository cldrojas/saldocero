// tests/ui/e2e-db.ts
// DB dedicada para E2E, aislada de la DB real del usuario.
// El webServer de Playwright arranca con SQLITE_DB_PATH apuntando aquí,
// y los helpers de test escriben directamente con better-sqlite3.
import Database from 'better-sqlite3'
import { addDays, format } from 'date-fns'
import fs from 'fs'
import os from 'os'
import path from 'path'

export const E2E_DB_PATH = process.env.E2E_DB_PATH ||
  path.join(os.tmpdir(), 'saldo-cero-e2e.db')

const SCHEMA_PATH = path.join(process.cwd(), 'lib', 'db', 'schema.sql')

export interface E2EBudgetConfig {
  startAmount: number
  endDate?: Date
  autoSave?: boolean
}

export interface E2EAccountConfig {
  id: string
  name: string
  type: string
  balance: number
  icon: string
}

export interface E2ETransactionConfig {
  id: string
  type: string
  amount: number
  description: string
  account: string
  date: Date
}

export interface E2EAppState {
  budget: E2EBudgetConfig
  accounts: E2EAccountConfig[]
  transactions?: E2ETransactionConfig[]
  isSetup: boolean
}

// Tipos de cuenta permitidos por el CHECK constraint del schema real.
const VALID_TYPES = ['daily', 'savings', 'investment', 'custom']

function toDateIso(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function openDb(): Database.Database {
  const dir = path.dirname(E2E_DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const db = new Database(E2E_DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'))
  return db
}

/**
 * Vacía las tablas y elimina cualquier dato previo en la DB de test.
 * También limpia budgets para que la app arranque en estado setup.
 */
export function clearDb(): void {
  const db = openDb()
  try {
    db.exec('BEGIN')
    db.prepare('DELETE FROM transactions').run()
    db.prepare('DELETE FROM accounts').run()
    db.prepare('DELETE FROM budgets').run()
    db.exec('COMMIT')
  } finally {
    db.close()
  }
}

/**
 * Siembra la DB de test replicando la forma en que las server actions
 * persisten: budget en fila única, accounts como filas, y el balance de cada
 * cuenta materializado como transacción income inicial (el balance SIEMPRE
 * es derivado de SUM(transactions), nunca una columna).
 */
export function seedDb(state: E2EAppState): void {
  clearDb()
  const db = openDb()
  try {
    db.exec('BEGIN')

    const budget = state.budget
    const today = new Date()
    db.prepare(
      `INSERT INTO budgets (id, start_amount, start_date, end_date, auto_save, mode, is_setup, updated_at)
       VALUES ('default', ?, ?, ?, ?, 'daily', ?, ?)`
    ).run(
      Math.floor(budget.startAmount),
      toDateIso(today),
      budget.endDate ? toDateIso(budget.endDate) : null,
      budget.autoSave !== false ? 1 : 0,
      state.isSetup ? 1 : 0,
      new Date().toISOString()
    )

    const insertAccount = db.prepare(
      `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )

    const insertTx = db.prepare(
      `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const account of state.accounts) {
      const type = VALID_TYPES.includes(account.type) ? account.type : 'custom'
      insertAccount.run(
        account.id,
        account.name,
        type,
        account.icon,
        new Date().toISOString(),
        new Date().toISOString()
      )

      // Balance inicial: transacción income que hace SUM(amount) = balance.
      const explicitSum = (state.transactions ?? [])
        .filter((t) => t.account === account.id)
        .reduce((sum, t) => sum + Math.floor(t.amount), 0)
      const initial = Math.floor(account.balance) - explicitSum

      if (initial !== 0) {
        insertTx.run(
          `seed-${account.id}-initial`,
          'income',
          initial,
          `Saldo inicial ${account.name}`,
          account.id,
          toDateIso(today),
          new Date().toISOString(),
          new Date().toISOString()
        )
      }
    }

    for (const tx of state.transactions ?? []) {
      insertTx.run(
        tx.id,
        tx.type,
        Math.floor(tx.amount),
        tx.description,
        tx.account,
        toDateIso(tx.date),
        new Date().toISOString(),
        new Date().toISOString()
      )
    }

    db.exec('COMMIT')
  } finally {
    db.close()
  }
}

/**
 * Estado semilla por defecto — equivalente al DEFAULT_TEST_CONFIG histórico
 * (ahora materializado en SQLite).
 */
export const DEFAULT_E2E_STATE: E2EAppState = {
  budget: {
    startAmount: 1000,
    endDate: addDays(new Date(), 30),
    autoSave: true,
  },
  accounts: [
    { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 1000, icon: 'wallet' },
    { id: 'savings', name: 'Savings', type: 'savings', balance: 500, icon: 'piggybank' },
    { id: 'investment', name: 'Investment', type: 'investment', balance: 2000, icon: 'trending-up' },
  ],
  isSetup: true,
}