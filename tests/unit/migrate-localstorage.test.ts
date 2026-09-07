import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// Key del backup histórico que DEBE quedar intacto tras migrar.
const STORAGE_KEY = 'daily-budget-data'
const MIGRATED_FLAG_KEY = 'daily-budget-data-migrated'

// Env para DB temporal — debe existir ANTES de importar los módulos
// (lib/db/index.ts calcula DB_PATH en tiempo de import).
const TMP_DB_PATH = path.join(os.tmpdir(), `saldo-migrate-${process.pid}-${Date.now()}.db`)
process.env.SQLITE_DB_PATH = TMP_DB_PATH

// Seed con el formato legacy (pre-pivote) tal como vivía en localStorage.
function legacySeed() {
  return {
    budget: {
      startAmount: 50000,
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
      mode: 'daily',
      autoSave: true,
      isSetup: true,
    },
    accounts: [
      { id: 'daily', name: 'Diario', type: 'daily', icon: 'wallet', hidden: false, balance: 34000 },
      { id: 'savings', name: 'Ahorro', type: 'savings', icon: 'piggy-bank', hidden: false, balance: 120000 },
      { id: 'custom-1', name: 'Viajes', type: 'custom', icon: 'plane', hidden: true, balance: 8000 },
    ],
    transactions: [
      { id: 'tx-1', type: 'income', amount: 50000, description: 'Sueldo', account: 'daily', date: '2026-08-01' },
      { id: 'tx-2', type: 'expense', amount: -4000, description: 'Supermercado', account: 'daily', date: '2026-08-03' },
      { id: 'tx-3', type: 'expense', amount: -6000, description: 'Vuelo', account: 'custom-1', date: '2026-08-05' },
      { id: 'tx-4', type: 'transfer', amount: -10000, description: 'Transferencia', account: 'savings', date: '2026-08-10' },
    ],
    dailyAllowance: 2000,
    remainingToday: 1100,
    progress: 0.45,
    lastCheckedDay: '2026-09-05',
    isSetup: true,
  }
}

describe('migrateFromLocalStorage (2.5)', () => {
  let migrateModule: typeof import('@/lib/migrate-localstorage')
  let dbModule: typeof import('@/lib/db')

  beforeEach(async () => {
    // Aislamiento: resetear módulo cacheado (DB_PATH se calcula al importar),
    // el singleton global de la conexión y el localStorage de jsdom.
    vi.resetModules()
    delete (globalThis as { __db?: unknown }).__db
    window.localStorage.clear()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacySeed()))
    migrateModule = await import('@/lib/migrate-localstorage')
    dbModule = await import('@/lib/db')
  })

  afterEach(() => {
    const db = (globalThis as { __db?: { close: () => void } }).__db
    if (db) db.close()
    delete (globalThis as { __db?: unknown }).__db
    if (fs.existsSync(TMP_DB_PATH)) fs.unlinkSync(TMP_DB_PATH)
    if (fs.existsSync(`${TMP_DB_PATH}-wal`)) fs.unlinkSync(`${TMP_DB_PATH}-wal`)
    if (fs.existsSync(`${TMP_DB_PATH}-shm`)) fs.unlinkSync(`${TMP_DB_PATH}-shm`)
  })

  const selectCount = (table: string): number => {
    const row = dbModule
      .getDb()
      .prepare(`SELECT COUNT(*) as count FROM ${table}`)
      .get() as { count: number }
    return row.count
  }

  it('migra accounts, transactions y budget al primer run', async () => {
    const migrated = await migrateModule.migrateFromLocalStorage()

    expect(migrated).toBe(true)
    expect(selectCount('accounts')).toBe(3)
    expect(selectCount('transactions')).toBe(4)
    expect(selectCount('budgets')).toBe(1)
    expect(selectCount('recurring_events')).toBe(0)
  })

  it('re-mapea transactions.account (slug) → account_id (UUID en SQLite)', async () => {
    await migrateModule.migrateFromLocalStorage()

    const daily = dbModule
      .getDb()
      .prepare(`SELECT id FROM accounts WHERE name = 'Diario'`)
      .get() as { id: string }

    const mapped = dbModule
      .getDb()
      .prepare(`SELECT account_id FROM transactions WHERE id = 'tx-1'`)
      .get() as { account_id: string }

    expect(daily.id).toBe('daily') // UUID v5 estable: mismo id del slug original
    expect(mapped.account_id).toBe('daily')

    const custom = dbModule
      .getDb()
      .prepare(`SELECT id FROM accounts WHERE name = 'Viajes'`)
      .get() as { id: string }
    const customTx = dbModule
      .getDb()
      .prepare(`SELECT account_id FROM transactions WHERE id = 'tx-3'`)
      .get() as { account_id: string }
    expect(customTx.account_id).toBe(custom.id)
  })

  it('preserva cuentas custom con name/type/icon/hidden', async () => {
    await migrateModule.migrateFromLocalStorage()

    const custom = dbModule
      .getDb()
      .prepare(`SELECT name, type, icon, hidden FROM accounts WHERE name = 'Viajes'`)
      .get() as { name: string; type: string; icon: string; hidden: number }

    expect(custom).toEqual({ name: 'Viajes', type: 'custom', icon: 'plane', hidden: 1 })
  })

  it('es idempotente: re-ejecutar no duplica filas', async () => {
    await migrateModule.migrateFromLocalStorage()
    const afterFirst = {
      accounts: selectCount('accounts'),
      transactions: selectCount('transactions'),
      budgets: selectCount('budgets'),
    }

    // Re-ejecutar dentro del mismo ciclo de vida (misma DB).
    const again = await migrateModule.migrateFromLocalStorage()

    expect(again).toBe(true)
    expect(selectCount('accounts')).toBe(afterFirst.accounts)
    expect(selectCount('transactions')).toBe(afterFirst.transactions)
    expect(selectCount('budgets')).toBe(afterFirst.budgets)
  })

  it('no migra si localStorage no tiene datos', async () => {
    window.localStorage.removeItem(STORAGE_KEY)
    const migrated = await migrateModule.migrateFromLocalStorage()
    expect(migrated).toBe(false)
    expect(selectCount('accounts')).toBe(0)
  })

  it('no migra si la DB ya tiene accounts (guard 2: ya migrado)', async () => {
    await migrateModule.migrateFromLocalStorage()

    // Simular un estado de DB con datos, localStorage con otro seed distinto:
    // la migración NO debe tocar nada porque accounts ya tiene filas.
    const txBefore = selectCount('transactions')
    const seed2 = legacySeed()
    seed2.accounts.push({ id: 'custom-2', name: 'Otra', type: 'custom', icon: 'wallet', hidden: false, balance: 1 })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed2))

    const migrated = await migrateModule.migrateFromLocalStorage()
    expect(migrated).toBe(true)
    expect(selectCount('accounts')).toBe(3) // no se agregó custom-2
    expect(selectCount('transactions')).toBe(txBefore)
  })

  it('conserva el backup histórico (NO borra daily-budget-data)', async () => {
    const backupBefore = window.localStorage.getItem(STORAGE_KEY)
    expect(backupBefore).not.toBeNull()

    await migrateModule.migrateFromLocalStorage()

    const backupAfter = window.localStorage.getItem(STORAGE_KEY)
    expect(backupAfter).toBe(backupBefore)
    expect(window.localStorage.getItem(MIGRATED_FLAG_KEY)).toBe('true')
  })

  it('convierte montos a enteros y preserva fechas', async () => {
    await migrateModule.migrateFromLocalStorage()

    const tx = dbModule
      .getDb()
      .prepare(`SELECT amount, date FROM transactions WHERE id = 'tx-2'`)
      .get() as { amount: number; date: string }

    expect(tx.amount).toBe(-4000)
    expect(tx.date).toBe('2026-08-03')
  })

  it('inserta el budget como singleton con ON CONFLICT', async () => {
    await migrateModule.migrateFromLocalStorage()

    const budget = dbModule
      .getDb()
      .prepare(`SELECT id, start_amount, mode, auto_save, is_setup FROM budgets`)
      .get() as { id: string; start_amount: number; mode: string; auto_save: number; is_setup: number }

    expect(budget).toEqual({
      id: 'default',
      start_amount: 50000,
      mode: 'daily',
      auto_save: 1,
      is_setup: 1,
    })
  })
})