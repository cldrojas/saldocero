import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Database, SqlJsStatic } from 'sql.js'
import { getSql } from '@/lib/db/client'
import { SCHEMA } from '@/lib/db/schema'
import {
  addAccount,
  addRecurringEvent,
  addTransaction,
  clearData,
  deleteAccount,
  deleteRecurringEvent,
  loadRecurringEvents,
  loadState,
  removeTransaction,
  setupBudget,
  toggleAutoSave,
  transferFunds,
  updateAccount,
  updateConfig,
  updateRecurringEvent,
  updateTransaction,
} from '@/lib/db/repository'

let SQL: SqlJsStatic
const dbs: Database[] = []

function createDb(): Database {
  const db = new SQL.Database()
  db.exec(SCHEMA)
  dbs.push(db)
  return db
}

/** Flatten an sql.js query into an array of row objects. */
function queryAll(db: Database, sql: string): Record<string, unknown>[] {
  const result = db.exec(sql)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => { obj[col] = row[i] })
    return obj
  })
}

afterEach(() => {
  while (dbs.length) {
    dbs.pop()?.close()
  }
})

beforeAll(async () => {
  SQL = await getSql()
})

describe('repository: budget + loadState', () => {
  it('loadState returns empty budget, empty accounts, empty transactions on a fresh DB', () => {
    const db = createDb()

    const state = loadState(db)

    expect(state.budget).toMatchObject({
      start_amount: 0,
      start_date: null,
      end_date: null,
      auto_save: 1,
      mode: 'daily',
      is_setup: 0,
    })
    expect(typeof state.budget.updated_at).toBe('string')
    expect(state.accounts).toEqual([])
    expect(state.transactions).toEqual([])
  })

  it('setupBudget creates budget, daily account, and initial income transaction', () => {
    const db = createDb()

    const result = setupBudget({ startAmount: 10000, endDate: '2026-09-30', mode: 'daily' }, db)

    expect(result).toEqual({ success: true })

    const state = loadState(db)
    expect(state.budget).toMatchObject({
      start_amount: 10000,
      start_date: new Date().toISOString().split('T')[0],
      end_date: '2026-09-30',
      auto_save: 1,
      mode: 'daily',
      is_setup: 1,
    })

    const daily = state.accounts.find((a: { id: string }) => a.id === 'daily')
    expect(daily).toBeDefined()
    expect(daily?.name).toBe('Daily Budget')
    expect(daily?.balance).toBe(10000)

    expect(state.transactions).toHaveLength(1)
    expect(state.transactions[0]).toMatchObject({
      type: 'income',
      amount: 10000,
      description: 'Initial deposit',
      account: 'daily',
    })
    expect(state.transactions[0].date).toBeInstanceOf(Date)
  })

  it('setupBudget is idempotent (upserts budget + daily account)', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000, mode: 'daily' }, db)
    setupBudget({ startAmount: 20000, mode: 'daily' }, db)

    const state = loadState(db)
    expect(state.budget.start_amount).toBe(20000)
    expect(state.accounts).toHaveLength(1)
    // Initial deposit exists twice (one per setupBudget call), mirrors the
    // server action which inserts a fresh income each time.
    expect(state.transactions).toHaveLength(2)
  })

  it('writes the default device_id on inserts', () => {
    const db = createDb()
    setupBudget({ startAmount: 5000 }, db)

    const rows = db.exec(
      "SELECT device_id FROM accounts WHERE id = 'daily'"
    )[0]?.values
    expect(rows?.[0]?.[0]).toBe('local')

    const txDevice = db.exec(
      'SELECT device_id FROM transactions LIMIT 1'
    )[0]?.values
    expect(txDevice?.[0]?.[0]).toBe('local')
  })

  it('updateConfig updates budget fields and removes savings in track mode', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000, endDate: '2026-09-30', mode: 'daily' }, db)

    const result = updateConfig({ startAmount: 15000, mode: 'track', autoSave: 0 }, db)

    expect(result).toEqual({ success: true })

    let state = loadState(db)
    expect(state.budget).toMatchObject({
      start_amount: 15000,
      mode: 'track',
      auto_save: 0,
      end_date: '2026-09-30',
    })
    expect(state.accounts.find((a: { type: string }) => a.type === 'savings')).toBeUndefined()
  })

  it('updateConfig recreates the savings account when switching back to daily', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000, mode: 'daily' }, db)
    updateConfig({ mode: 'track' }, db)

    updateConfig({ mode: 'daily' }, db)

    const state = loadState(db)
    const savings = state.accounts.find((a: { type: string }) => a.type === 'savings')
    expect(savings).toBeDefined()
    expect(savings?.id).toBe('savings')
  })

  it('updateConfig sets end_date when provided', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000 }, db)

    updateConfig({ endDate: '2026-10-31' }, db)

    const state = loadState(db)
    expect(state.budget.end_date).toBe('2026-10-31')
  })

  it('toggleAutoSave toggles 1 -> 0 -> 1', () => {
    const db = createDb()
    setupBudget({ startAmount: 5000 }, db)

    expect(toggleAutoSave(db)).toEqual({ autoSave: 0 })
    expect(loadState(db).budget.auto_save).toBe(0)

    expect(toggleAutoSave(db)).toEqual({ autoSave: 1 })
    expect(loadState(db).budget.auto_save).toBe(1)
  })

  it('clearData empties transactions, accounts, and budgets', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000, mode: 'daily' }, db)
    addTransaction({ type: 'expense', amount: -500, description: 'Cafe', account_id: 'daily', date: '2026-09-10' }, db)

    const result = clearData(db)
    expect(result).toEqual({ success: true })

    const state = loadState(db)
    expect(state.accounts).toEqual([])
    expect(state.transactions).toEqual([])
    expect(state.budget.is_setup).toBe(0)

    // sql.js returns no result set rows for empty tables
    expect(queryAll(db, 'SELECT * FROM transactions')).toHaveLength(0)
    expect(queryAll(db, 'SELECT * FROM accounts')).toHaveLength(0)
    expect(queryAll(db, 'SELECT * FROM budgets')).toHaveLength(0)
  })
})

describe('repository: transactions', () => {
  it('addTransaction inserts a transaction and returns its id', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000 }, db)

    const { id } = addTransaction(
      { type: 'expense', amount: -500, description: 'Cafe', account_id: 'daily', date: '2026-09-10' },
      db
    )

    expect(id).toBeTypeOf('string')
    const state = loadState(db)
    const tx = state.transactions.find((t: { id: string }) => t.id === id)
    expect(tx).toMatchObject({
      type: 'expense',
      amount: -500,
      description: 'Cafe',
      account: 'daily',
    })
    expect(tx?.date).toBeInstanceOf(Date)
    expect(state.accounts.find((a: { id: string }) => a.id === 'daily')?.balance).toBe(9500)
  })

  it('removeTransaction removes the row with refund=true (no replica)', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000 }, db)
    const { id } = addTransaction(
      { type: 'expense', amount: -500, description: 'Cafe', account_id: 'daily', date: '2026-09-10' },
      db
    )

    const result = removeTransaction(id, true, db)

    expect(result).toEqual({ success: true })
    const state = loadState(db)
    expect(state.transactions.find((t: { id: string }) => t.id === id)).toBeUndefined()
    expect(state.transactions.some((t: { description: string }) => t.description.startsWith('Unrefunded:'))).toBe(false)
    expect(state.accounts.find((a: { id: string }) => a.id === 'daily')?.balance).toBe(10000)
  })

  it('removeTransaction with refund=false inserts an Unrefunded replica', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000 }, db)
    const { id } = addTransaction(
      { type: 'expense', amount: -500, description: 'Cafe', account_id: 'daily', date: '2026-09-10' },
      db
    )

    const result = removeTransaction(id, false, db)

    expect(result).toEqual({ success: true })
    const state = loadState(db)
    expect(state.transactions.find((t: { id: string }) => t.id === id)).toBeUndefined()
    const replica = state.transactions.find((t: { description: string }) => t.description === 'Unrefunded: Cafe')
    expect(replica).toMatchObject({ type: 'expense', amount: -500, account: 'daily' })
    // The replica keeps the money out of the balance.
    expect(state.accounts.find((a: { id: string }) => a.id === 'daily')?.balance).toBe(9500)
  })

  it('removeTransaction returns not-found for a missing transaction', () => {
    const db = createDb()
    const result = removeTransaction('does-not-exist', true, db)
    expect(result).toEqual({ success: false, error: 'Transaction not found' })
  })

  it('soft-deleted transactions do not count toward account balance', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000 }, db)
    const { id } = addTransaction(
      { type: 'expense', amount: -500, description: 'Cafe', account_id: 'daily', date: '2026-09-10' },
      db
    )
    removeTransaction(id, true, db)

    expect(loadState(db).accounts.find((a: { id: string }) => a.id === 'daily')?.balance).toBe(10000)
  })

  it('updateTransaction updates fields', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000 }, db)
    const { id } = addTransaction(
      { type: 'expense', amount: -500, description: 'Cafe', account_id: 'daily', date: '2026-09-10' },
      db
    )

    const result = updateTransaction(
      { id, type: 'expense', amount: -700, description: 'Lunch', account_id: 'daily', date: '2026-09-11' },
      db
    )

    expect(result).toEqual({ success: true })
    const state = loadState(db)
    expect(state.transactions.find((t: { id: string }) => t.id === id)).toMatchObject({
      amount: -700,
      description: 'Lunch',
      account: 'daily',
    })
    expect(state.accounts.find((a: { id: string }) => a.id === 'daily')?.balance).toBe(9300)
  })

  it('updateTransaction returns not-found for a missing transaction', () => {
    const db = createDb()
    const result = updateTransaction(
      { id: 'nope', type: 'expense', amount: -1, description: 'x', account_id: 'daily', date: '2026-09-01' },
      db
    )
    expect(result).toEqual({ success: false, error: 'Transaction not found' })
  })

  it('transferFunds creates an expense + income pair', () => {
    const db = createDb()
    setupBudget({ startAmount: 10000, endDate: '2026-09-30', mode: 'daily' }, db)
    updateConfig({ mode: 'daily' }, db) // ensure savings slug exists

    const result = transferFunds(
      { amount: 1000, from_account_id: 'daily', to_account_id: 'savings', description: 'Ahorro' },
      db
    )

    expect(result).toMatchObject({ success: true })
    expect(result.expenseId).toBeTypeOf('string')
    expect(result.incomeId).toBeTypeOf('string')

    const state = loadState(db)
    const expense = state.transactions.find((t: { id: string }) => t.id === result.expenseId)
    const income = state.transactions.find((t: { id: string }) => t.id === result.incomeId)
    expect(expense).toMatchObject({ type: 'expense', amount: -1000, description: 'Ahorro', account: 'daily' })
    expect(income).toMatchObject({ type: 'income', amount: 1000, description: 'Ahorro', account: 'savings' })
    expect(state.accounts.find((a: { id: string }) => a.id === 'daily')?.balance).toBe(9000)
    expect(state.accounts.find((a: { id: string }) => a.id === 'savings')?.balance).toBe(1000)
  })
})

describe('repository: accounts', () => {
  it('addAccount inserts and returns the id', () => {
    const db = createDb()
    setupBudget({ startAmount: 5000 }, db)

    const result = addAccount({ name: 'Vacaciones', type: 'custom', icon: 'plane' }, db)

    expect(result.id).toBeTypeOf('string')
    const state = loadState(db)
    const account = state.accounts.find((a: { id: string }) => a.id === result.id)
    expect(account).toMatchObject({ name: 'Vacaciones', type: 'custom', icon: 'plane', balance: 0 })
  })

  it('updateAccount updates fields and keeps balance', () => {
    const db = createDb()
    setupBudget({ startAmount: 5000 }, db)
    const { id } = addAccount({ name: 'Vacaciones', type: 'custom', icon: 'plane' }, db)
    addTransaction({ type: 'income', amount: 2000, description: 'Fondo', account_id: id, date: '2026-09-01' }, db)

    updateAccount({ id, name: 'Viajes', type: 'custom', icon: 'car', hidden: 1 }, db)

    const state = loadState(db)
    const account = state.accounts.find((a: { id: string }) => a.id === id)
    expect(account).toMatchObject({ name: 'Viajes', type: 'custom', icon: 'car', balance: 2000 })
  })

  it('deleteAccount removes the account and its transactions', () => {
    const db = createDb()
    setupBudget({ startAmount: 5000 }, db)
    const { id } = addAccount({ name: 'Vacaciones', type: 'custom' }, db)
    addTransaction({ type: 'income', amount: 2000, description: 'Fondo', account_id: id, date: '2026-09-01' }, db)

    const result = deleteAccount(id, db)

    expect(result).toEqual({ success: true })
    const state = loadState(db)
    expect(state.accounts.find((a: { id: string }) => a.id === id)).toBeUndefined()
    expect(state.transactions.some((t: { account: string }) => t.account === id)).toBe(false)
  })

  it('deleteAccount returns not-found for a missing account', () => {
    const db = createDb()
    const result = deleteAccount('does-not-exist', db)
    expect(result).toEqual({ success: false, error: 'Account not found' })
  })

  it('deleteAccount drains a positive balance to savings before deleting', () => {
    const db = createDb()
    setupBudget({ startAmount: 5000 }, db)
    const { id } = addAccount({ name: 'Viajes', type: 'custom', icon: 'plane' }, db)
    addTransaction({ type: 'income', amount: 3000, description: 'Fondo', account_id: id, date: '2026-09-01' }, db)

    const result = deleteAccount(id, db)

    expect(result).toEqual({ success: true })
    const state = loadState(db)
    expect(state.accounts.find((a: { id: string }) => a.id === id)).toBeUndefined()

    const savings = state.accounts.find((a: { id: string }) => a.id === 'savings')
    expect(savings).toBeDefined()
    expect(savings?.balance).toBe(3000)

    const drain = state.transactions.find(
      (t: { description: string }) => t.description === 'Transfer from deleted account: Viajes'
    )
    expect(drain).toMatchObject({ type: 'income', amount: 3000, account: 'savings' })
  })

  it('deleteAccount with zero balance does not create savings', () => {
    const db = createDb()
    setupBudget({ startAmount: 5000 }, db)
    const { id } = addAccount({ name: 'Vacaciones', type: 'custom' }, db)

    deleteAccount(id, db)

    const state = loadState(db)
    expect(state.accounts.some((a: { type: string }) => a.type === 'savings')).toBe(false)
  })
})

describe('repository: recurring events', () => {
  it('loadRecurringEvents returns only active events', () => {
    const db = createDb()
    addRecurringEvent(
      { description: 'Sueldo', type: 'income', amount: 100000, frequency: 'monthly', day_of_month: 1 },
      db
    )
    addRecurringEvent(
      { description: 'Netflix', type: 'expense', amount: -1500, frequency: 'monthly', day_of_month: 15, active: 0 },
      db
    )

    const events = loadRecurringEvents(db)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ description: 'Sueldo', type: 'income', amount: 100000 })
  })

  it('addRecurringEvent inserts and returns the id', () => {
    const db = createDb()

    const result = addRecurringEvent(
      { description: 'Gym', type: 'expense', amount: -3000, frequency: 'monthly', day_of_month: 5 },
      db
    )

    expect(result.id).toBeTypeOf('string')
    const events = loadRecurringEvents(db)
    expect(events.find((e: { id: string }) => e.id === result.id)).toMatchObject({
      description: 'Gym',
      type: 'expense',
      amount: -3000,
      active: 1,
    })
  })

  it('updateRecurringEvent updates fields', () => {
    const db = createDb()
    const { id } = addRecurringEvent(
      { description: 'Gym', type: 'expense', amount: -3000, frequency: 'monthly', day_of_month: 5 },
      db
    )

    updateRecurringEvent({ id, description: 'Gym Premium', amount: -4500, active: 0 }, db)

    const events = loadRecurringEvents(db)
    expect(events.find((e: { id: string }) => e.id === id)).toBeUndefined()

    const all = db.exec(
      "SELECT description, amount, active FROM recurring_events WHERE id = '" + id + "'"
    )[0]?.values
    expect(all?.[0]).toEqual(['Gym Premium', -4500, 0])
  })

  it('deleteRecurringEvent removes the event', () => {
    const db = createDb()
    const { id } = addRecurringEvent(
      { description: 'Gym', type: 'expense', amount: -3000, frequency: 'monthly', day_of_month: 5 },
      db
    )

    const result = deleteRecurringEvent(id, db)

    expect(result).toEqual({ success: true })
    expect(loadRecurringEvents(db).some((e: { id: string }) => e.id === id)).toBe(false)
    // Soft delete: the row remains but filtered out.
    const rows = db.exec(
      "SELECT deleted_at FROM recurring_events WHERE id = '" + id + "'"
    )[0]?.values
    expect(rows?.[0]?.[0]).not.toBeNull()
  })
})