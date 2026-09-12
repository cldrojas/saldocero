import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// Env para DB temporal — debe existir ANTES de importar los módulos
// (lib/db/index.ts calcula DB_PATH en tiempo de import).
const TMP_DB_PATH = path.join(os.tmpdir(), `saldo-loadstate-${process.pid}-${Date.now()}.db`)
process.env.SQLITE_DB_PATH = TMP_DB_PATH

describe('loadState (5.3 — balance derivado de SUM transactions)', () => {
  let budgetModule: typeof import('@/app/actions/budget')
  let dbModule: typeof import('@/lib/db')

  beforeEach(async () => {
    // Aislamiento: resetear módulo cacheado y el singleton de conexión.
    vi.resetModules()
    delete (globalThis as { __db?: unknown }).__db
    budgetModule = await import('@/app/actions/budget')
    dbModule = await import('@/lib/db')

    // Seed directo: presupuesto + 2 cuentas + transacciones cuyos montos
    // NO coinciden con ningún campo guardado (balance debe salir del SUM).
    const db = dbModule.getDb()
    db.prepare(
      `INSERT INTO budgets (id, start_amount, start_date, end_date, auto_save, mode, is_setup, updated_at)
       VALUES ('default', 10000, '2026-09-01', '2026-09-30', 1, 'daily', 1, ?)`
    ).run(new Date().toISOString())

    db.prepare(
      `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
       VALUES ('daily', 'Diario', 'daily', 'wallet', 0, ?, ?)`
    ).run(new Date().toISOString(), new Date().toISOString())

    db.prepare(
      `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
       VALUES ('savings', 'Ahorro', 'savings', 'piggybank', 0, ?, ?)`
    ).run(new Date().toISOString(), new Date().toISOString())

    const insertTx = db.prepare(
      `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    // daily: +50000 (income) y -3000 (expense) → balance 47000
    insertTx.run('tx-1', 'income', 50000, 'Sueldo', 'daily', '2026-09-02', new Date().toISOString(), new Date().toISOString())
    insertTx.run('tx-2', 'expense', -3000, 'Mercado', 'daily', '2026-09-03', new Date().toISOString(), new Date().toISOString())
    // savings: +15000 transfer → balance 15000
    insertTx.run('tx-3', 'income', 15000, 'Transferencia', 'savings', '2026-09-04', new Date().toISOString(), new Date().toISOString())
  })

  afterEach(() => {
    const db = (globalThis as { __db?: { close: () => void } }).__db
    if (db) db.close()
    delete (globalThis as { __db?: unknown }).__db
    if (fs.existsSync(TMP_DB_PATH)) fs.unlinkSync(TMP_DB_PATH)
    if (fs.existsSync(`${TMP_DB_PATH}-wal`)) fs.unlinkSync(`${TMP_DB_PATH}-wal`)
    if (fs.existsSync(`${TMP_DB_PATH}-shm`)) fs.unlinkSync(`${TMP_DB_PATH}-shm`)
  })

  it('deriva el balance de cada cuenta desde SUM(transactions)', async () => {
    const state = await budgetModule.loadState()

    expect(state.accounts).toHaveLength(2)
    const daily = state.accounts.find((a: { id: string }) => a.id === 'daily')
    const savings = state.accounts.find((a: { id: string }) => a.id === 'savings')
    expect(daily?.balance).toBe(47000)
    expect(savings?.balance).toBe(15000)
  })

  it('devuelve budget con is_setup y fechas', async () => {
    const state = await budgetModule.loadState()

    expect(state.budget.is_setup).toBe(1)
    expect(state.budget.start_amount).toBe(10000)
    expect(state.budget.start_date).toBe('2026-09-01')
    expect(state.budget.end_date).toBe('2026-09-30')
  })

  it('mapea transactions con account_id hacia account y fecha Date', async () => {
    const state = await budgetModule.loadState()

    expect(state.transactions).toHaveLength(3)
    const tx1 = state.transactions.find((t: { id: string }) => t.id === 'tx-1')
    expect(tx1?.account).toBe('daily')
    expect(tx1?.amount).toBe(50000)
    expect(tx1?.date).toBeInstanceOf(Date)
  })

  it('devuelve balance 0 para cuentas sin transacciones', async () => {
    const db = dbModule.getDb()
    db.prepare(
      `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
       VALUES ('custom-1', 'Vacaciones', 'custom', 'plane', 0, ?, ?)`
    ).run(new Date().toISOString(), new Date().toISOString())

    const state = await budgetModule.loadState()
    const custom = state.accounts.find((a: { id: string }) => a.id === 'custom-1')
    expect(custom?.balance).toBe(0)
  })
})