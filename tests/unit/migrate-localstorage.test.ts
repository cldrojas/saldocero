import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Key del backup histórico que DEBE quedar intacto tras migrar.
const STORAGE_KEY = 'daily-budget-data'
const MIGRATED_FLAG_KEY = 'daily-budget-data-migrated'

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

describe('migrateFromLocalStorage (client sql.js → IndexedDB)', () => {
  let migrateModule: typeof import('@/lib/migrate-localstorage')
  let clientModule: typeof import('@/lib/db/client')

  beforeEach(async () => {
    // Aislamiento: resetear módulo cacheado (singletons de sql.js + IndexedDB
    // se recrean por prueba), el localStorage de jsdom y re-seedear el legacy.
    vi.resetModules()
    window.localStorage.clear()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacySeed()))
    migrateModule = await import('@/lib/migrate-localstorage')
    clientModule = await import('@/lib/db/client')
    // getDb() construye una DB sql.js fresca con el schema actual.
    clientModule.resetDb()
  })

  afterEach(async () => {
    // Dejar el proceso limpio para la próxima prueba: borra el snapshot de
    // IndexedDB y el singleton sql.js.
    const { clearIndexedDB } = await import('@/lib/db/persistence')
    await clearIndexedDB().catch(() => undefined)
    clientModule.resetDb()
  })

  const selectCount = async (table: string): Promise<number> => {
    const db = await clientModule.getDb()
    const stmt = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    stmt.step()
    const row = stmt.getAsObject() as { count: number }
    stmt.free()
    return row.count
  }

  it('migra accounts, transactions y budget singleton al primer run', async () => {
    const migrated = await migrateModule.migrateFromLocalStorage()

    expect(migrated).toBe(true)
    expect(await selectCount('accounts')).toBe(3)
    expect(await selectCount('transactions')).toBe(4)
    expect(await selectCount('budgets')).toBe(1)
    expect(await selectCount('recurring_events')).toBe(0)
  })

  it('re-mapea transactions.account (slug) → account_id con UUIDs estables', async () => {
    await migrateModule.migrateFromLocalStorage()

    const db = await clientModule.getDb()
    const dailyStmt = db.prepare(`SELECT id FROM accounts WHERE name = 'Diario'`)
    dailyStmt.step()
    const daily = dailyStmt.getAsObject() as { id: string }
    dailyStmt.free()

    const mappedStmt = db.prepare(`SELECT account_id FROM transactions WHERE id = 'tx-1'`)
    mappedStmt.step()
    const mapped = mappedStmt.getAsObject() as { account_id: string }
    mappedStmt.free()

    // El slug 'daily' se conserva como id (mapeo por type a la cuenta existente).
    expect(daily.id).toBe('daily')
    expect(mapped.account_id).toBe('daily')

    const customStmt = db.prepare(`SELECT id FROM accounts WHERE name = 'Viajes'`)
    customStmt.step()
    const custom = customStmt.getAsObject() as { id: string }
    customStmt.free()
    const customTxStmt = db.prepare(`SELECT account_id FROM transactions WHERE id = 'tx-3'`)
    customTxStmt.step()
    const customTx = customTxStmt.getAsObject() as { account_id: string }
    customTxStmt.free()
    expect(customTx.account_id).toBe(custom.id)
  })

  it('preserva cuentas custom con name/type/icon/hidden y montos exactos', async () => {
    await migrateModule.migrateFromLocalStorage()

    const db = await clientModule.getDb()
    const customStmt = db.prepare(`SELECT name, type, icon, hidden FROM accounts WHERE name = 'Viajes'`)
    customStmt.step()
    const custom = customStmt.getAsObject() as { name: string; type: string; icon: string; hidden: number }
    customStmt.free()

    expect(custom).toEqual({ name: 'Viajes', type: 'custom', icon: 'plane', hidden: 1 })

    const amountsStmt = db.prepare(
      `SELECT amount, date FROM transactions WHERE id = 'tx-2'`
    )
    amountsStmt.step()
    const tx = amountsStmt.getAsObject() as { amount: number; date: string }
    amountsStmt.free()
    expect(tx.amount).toBe(-4000)
    expect(tx.date).toBe('2026-08-03')
  })

  it('inserta el budget como singleton con ON CONFLICT', async () => {
    await migrateModule.migrateFromLocalStorage()

    const db = await clientModule.getDb()
    const stmt = db.prepare(`SELECT id, start_amount, mode, auto_save, is_setup FROM budgets`)
    stmt.step()
    const budget = stmt.getAsObject() as { id: string; start_amount: number; mode: string; auto_save: number; is_setup: number }
    stmt.free()

    expect(budget).toEqual({
      id: 'default',
      start_amount: 50000,
      mode: 'daily',
      auto_save: 1,
      is_setup: 1,
    })
  })

  it('es idempotente: re-ejecutar no duplica filas', async () => {
    await migrateModule.migrateFromLocalStorage()
    const afterFirst = {
      accounts: await selectCount('accounts'),
      transactions: await selectCount('transactions'),
      budgets: await selectCount('budgets'),
    }

    // Re-ejecutar dentro del mismo ciclo de vida (misma DB client).
    const again = await migrateModule.migrateFromLocalStorage()

    expect(again).toBe(true)
    expect(await selectCount('accounts')).toBe(afterFirst.accounts)
    expect(await selectCount('transactions')).toBe(afterFirst.transactions)
    expect(await selectCount('budgets')).toBe(afterFirst.budgets)
  })

  it('no migra si localStorage no tiene datos', async () => {
    window.localStorage.removeItem(STORAGE_KEY)
    const migrated = await migrateModule.migrateFromLocalStorage()
    expect(migrated).toBe(false)
    expect(await selectCount('accounts')).toBe(0)
  })

  it('no migra si los datos de localStorage están corruptos', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not valid json')
    const migrated = await migrateModule.migrateFromLocalStorage()
    expect(migrated).toBe(false)
    expect(await selectCount('accounts')).toBe(0)
  })

  it('no migra si la DB ya tiene accounts (guard 2: ya migrado)', async () => {
    await migrateModule.migrateFromLocalStorage()

    // Simular un estado de DB con datos, localStorage con otro seed distinto:
    // la migración NO debe tocar nada porque accounts ya tiene filas.
    const txBefore = await selectCount('transactions')
    const seed2 = legacySeed()
    seed2.accounts.push({ id: 'custom-2', name: 'Otra', type: 'custom', icon: 'wallet', hidden: false, balance: 1 })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed2))

    const migrated = await migrateModule.migrateFromLocalStorage()
    expect(migrated).toBe(true)
    expect(await selectCount('accounts')).toBe(3) // no se agregó custom-2
    expect(await selectCount('transactions')).toBe(txBefore)
  })

  it('no migra si el flag migrated ya está seteado (guard 3)', async () => {
    window.localStorage.setItem(MIGRATED_FLAG_KEY, 'true')

    const migrated = await migrateModule.migrateFromLocalStorage()
    expect(migrated).toBe(true)
    // La DB sigue vacía: el guard corta antes de insertar.
    expect(await selectCount('accounts')).toBe(0)
    expect(await selectCount('transactions')).toBe(0)
  })

  it('conserva el backup histórico y marca migrated tras migrar', async () => {
    const backupBefore = window.localStorage.getItem(STORAGE_KEY)
    expect(backupBefore).not.toBeNull()

    await migrateModule.migrateFromLocalStorage()

    const backupAfter = window.localStorage.getItem(STORAGE_KEY)
    expect(backupAfter).toBe(backupBefore)
    expect(window.localStorage.getItem(MIGRATED_FLAG_KEY)).toBe('true')
  })

  it('persiste el snapshot a IndexedDB tras migrar', async () => {
    const { loadFromIndexedDB } = await import('@/lib/db/persistence')
    expect(await loadFromIndexedDB()).toBeNull()

    await migrateModule.migrateFromLocalStorage()

    const snapshot = await loadFromIndexedDB()
    expect(snapshot).not.toBeNull()
    expect(snapshot!.length).toBeGreaterThan(0)
  })
})