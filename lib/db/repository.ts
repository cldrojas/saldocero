// lib/db/repository.ts
// Client-side CRUD repository using sql.js (synchronous WASM).
// Mirrors the Server Actions API shape exactly. Every function accepts a
// `Database` parameter for testability.
import type { Database } from 'sql.js'

const DEVICE_ID = 'local'

// ─── Helpers ──────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

function today(): string {
  return now().split('T')[0]
}

function uuid(): string {
  return crypto.randomUUID()
}

/** Run multiple statements inside a BEGIN/COMMIT block. Rolls back on error. */
function inTx<T>(db: Database, fn: () => T): T {
  db.run('BEGIN')
  try {
    const result = fn()
    db.run('COMMIT')
    return result
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
}

function queryRows(db: Database, sql: string, params?: (string | number | null)[]): Record<string, unknown>[] {
  const result = db.exec(sql, params)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => { obj[col] = row[i] })
    return obj
  })
}

function queryOne(db: Database, sql: string, params?: (string | number | null)[]): Record<string, unknown> | undefined {
  return queryRows(db, sql, params)[0]
}

// ─── Budget + loadState ───────────────────────────────────────────────

type BudgetRow = {
  start_amount: number
  start_date: string | null
  end_date: string | null
  auto_save: number
  mode: string
  is_setup: number
  updated_at: string
}

type AccountRow = {
  id: string
  name: string
  type: string
  icon: string
  hidden: number
  balance: number
}

type TransactionRow = {
  id: string
  type: string
  amount: number
  description: string
  account_id: string
  date: string
}

const DEFAULT_BUDGET: BudgetRow = {
  start_amount: 0,
  start_date: null,
  end_date: null,
  auto_save: 1,
  mode: 'daily',
  is_setup: 0,
  updated_at: new Date().toISOString(),
}

export function loadState(db: Database) {
  // Budget
  const budgetRow = queryOne(db, "SELECT * FROM budgets WHERE id = 'default'") as BudgetRow | undefined
  const budget = budgetRow
    ? { ...budgetRow }
    : { ...DEFAULT_BUDGET }

  // Accounts with derived balance
  const accountRows = queryRows(
    db,
    `SELECT a.*, COALESCE(SUM(t.amount), 0) AS balance
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
     WHERE a.deleted_at IS NULL
     GROUP BY a.id
     ORDER BY a.type`
  ) as AccountRow[]
  const accounts = accountRows.map((acc) => ({
    id: acc.id,
    name: acc.name,
    type: acc.type,
    balance: Math.floor(acc.balance ?? 0),
    icon: acc.icon,
  }))

  // Transactions (most recent first)
  const txRows = queryRows(
    db,
    'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY date DESC'
  ) as TransactionRow[]
  const transactions = txRows.map((tx) => ({
    id: tx.id,
    type: tx.type,
    amount: tx.amount,
    description: tx.description,
    account: tx.account_id,
    date: tx.date ? new Date(tx.date) : new Date(),
  }))

  return { budget, accounts, transactions }
}

// ─── Setup ────────────────────────────────────────────────────────────

export function setupBudget(
  { startAmount, endDate, mode = 'daily' }: {
    startAmount: number
    endDate?: string
    mode?: 'daily' | 'track'
  },
  db: Database
) {
  return inTx(db, () => {
    const ts = now()
    const date = today()
    const end = endDate ? new Date(endDate).toISOString().split('T')[0] : null

    // Upsert budget
    db.run(
      `INSERT INTO budgets (id, start_amount, start_date, end_date, auto_save, mode, is_setup, updated_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         start_amount = excluded.start_amount,
         start_date = excluded.start_date,
         end_date = excluded.end_date,
         mode = excluded.mode,
         auto_save = excluded.auto_save,
         updated_at = excluded.updated_at,
         device_id = excluded.device_id`,
      ['default', startAmount, date, end, 1, mode, 1, ts, DEVICE_ID]
    )

    // Initial income transaction
    db.run(
      `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), 'income', startAmount, 'Initial deposit', 'daily', date, ts, ts, DEVICE_ID]
    )

    // Upsert daily account
    db.run(
      `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         icon = excluded.icon,
         hidden = excluded.hidden,
         updated_at = excluded.updated_at,
         device_id = excluded.device_id`,
      ['daily', 'Daily Budget', 'daily', 'wallet', 0, ts, ts, DEVICE_ID]
    )

    return { success: true as const }
  })
}

// ─── Config ───────────────────────────────────────────────────────────

export function updateConfig(
  { startAmount, endDate, mode, autoSave }: {
    startAmount?: number
    endDate?: string
    mode?: 'daily' | 'track'
    autoSave?: number
  },
  db: Database
) {
  return inTx(db, () => {
    const ts = now()
    const budgetStartDate = endDate ? new Date(endDate).toISOString().split('T')[0] : undefined

    db.run(
      `UPDATE budgets SET
         start_amount = COALESCE(?, start_amount),
         end_date = CASE WHEN ? IS NOT NULL THEN ? ELSE end_date END,
         mode = COALESCE(?, mode),
         auto_save = COALESCE(?, auto_save),
         updated_at = ?,
         device_id = ?
       WHERE id = 'default'`,
      [
        startAmount ?? null,
        endDate !== undefined ? 1 : null,
        budgetStartDate ?? null,
        mode ?? null,
        autoSave ?? null,
        ts,
        DEVICE_ID,
      ]
    )

    // Track mode: remove savings
    if (mode === 'track') {
      db.run("DELETE FROM accounts WHERE id = 'savings'")
    }

    // Daily mode: recreate savings if missing
    if (mode === 'daily') {
      const exists = queryOne(db, "SELECT id FROM accounts WHERE id = 'savings'")
      if (!exists) {
        db.run(
          `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at, device_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ['savings', 'Savings', 'savings', 'piggybank', 0, ts, ts, DEVICE_ID]
        )
      }
    }

    return { success: true as const }
  })
}

export function toggleAutoSave(db: Database) {
  return inTx(db, () => {
    const row = queryOne(db, "SELECT auto_save FROM budgets WHERE id = 'default'") as { auto_save: number } | undefined
    const newAutoSave = row && row.auto_save === 1 ? 0 : 1
    db.run(
      `UPDATE budgets SET auto_save = ?, updated_at = ?, device_id = ? WHERE id = 'default'`,
      [newAutoSave, now(), DEVICE_ID]
    )
    return { autoSave: newAutoSave }
  })
}

export function clearData(db: Database) {
  return inTx(db, () => {
    db.run('DELETE FROM transactions')
    db.run('DELETE FROM accounts')
    db.run('DELETE FROM budgets')
    return { success: true as const }
  })
}

// ─── Transactions ─────────────────────────────────────────────────────

export function addTransaction(
  { type, amount, description, account_id, date }: {
    type: 'expense' | 'transfer' | 'income' | 'adjustment'
    amount: number
    description: string
    account_id: string
    date: string
  },
  db: Database
) {
  const ts = now()
  const id = uuid()
  db.run(
    `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, amount, description, account_id, date, ts, ts, DEVICE_ID]
  )
  return { id }
}

export function removeTransaction(id: string, refund: boolean = true, db: Database) {
  return inTx(db, () => {
    const ts = now()
    const tx = queryOne(db, 'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL', [id]) as TransactionRow | undefined
    if (!tx) return { success: false as const, error: 'Transaction not found' }

    // Soft delete — set deleted_at so the tombstone survives sync merges
    db.run(
      'UPDATE transactions SET deleted_at = ?, updated_at = ?, device_id = ? WHERE id = ?',
      [ts, ts, DEVICE_ID, id]
    )

    // Without refund: insert replica so the accounting effect persists
    if (!refund) {
      db.run(
        `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), tx.type, tx.amount, `Unrefunded: ${tx.description}`, tx.account_id, tx.date, ts, ts, DEVICE_ID]
      )
    }

    return { success: true as const }
  })
}

export function updateTransaction(
  { id, type, amount, description, account_id, date }: {
    id: string
    type: 'expense' | 'transfer' | 'income' | 'adjustment'
    amount: number
    description: string
    account_id: string
    date: string
  },
  db: Database
) {
  return inTx(db, () => {
    const existing = queryOne(db, 'SELECT id FROM transactions WHERE id = ? AND deleted_at IS NULL', [id])
    if (!existing) return { success: false as const, error: 'Transaction not found' }

    db.run(
      `UPDATE transactions SET
         type = COALESCE(?, type),
         amount = ?,
         description = COALESCE(?, description),
         account_id = COALESCE(?, account_id),
         date = ?,
         updated_at = ?,
         device_id = ?
       WHERE id = ?`,
      [type, amount, description, account_id, date, now(), DEVICE_ID, id]
    )

    return { success: true as const }
  })
}

export function transferFunds(
  { amount, from_account_id, to_account_id, description }: {
    amount: number
    from_account_id: string
    to_account_id: string
    description?: string
  },
  db: Database
) {
  return inTx(db, () => {
    const ts = now()
    const date = today()
    const desc = description || 'Transfer'

    // Expense from source account
    const expenseId = uuid()
    db.run(
      `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [expenseId, 'expense', -amount, desc, from_account_id, date, ts, ts, DEVICE_ID]
    )

    // Income to target account
    const incomeId = uuid()
    db.run(
      `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [incomeId, 'income', amount, desc, to_account_id, date, ts, ts, DEVICE_ID]
    )

    return { success: true as const, expenseId, incomeId }
  })
}

// ─── Accounts ─────────────────────────────────────────────────────────

export function addAccount(
  { name, type, icon = 'wallet' }: {
    name: string
    type: 'daily' | 'savings' | 'investment' | 'custom'
    icon?: string
  },
  db: Database
) {
  const ts = now()
  const id = uuid()
  db.run(
    `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, type, icon, 0, ts, ts, DEVICE_ID]
  )
  return { id }
}

export function updateAccount(
  { id, name, type, icon, hidden }: {
    id: string
    name: string
    type: 'daily' | 'savings' | 'investment' | 'custom'
    icon?: string
    hidden?: number
  },
  db: Database
) {
  db.run(
    `UPDATE accounts SET
       name = COALESCE(?, name),
       type = COALESCE(?, type),
       icon = COALESCE(?, icon),
       hidden = COALESCE(?, hidden),
       updated_at = ?,
       device_id = ?
     WHERE id = ?`,
    [name, type, icon ?? null, hidden ?? null, now(), DEVICE_ID, id]
  )
}

export function deleteAccount(id: string, db: Database) {
  return inTx(db, () => {
    const ts = now()
    const account = queryOne(
      db,
      'SELECT a.*, COALESCE(SUM(t.amount), 0) AS balance FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL WHERE a.id = ? AND a.deleted_at IS NULL GROUP BY a.id',
      [id]
    ) as { id: string; name: string; balance: number } | undefined
    if (!account) return { success: false as const, error: 'Account not found' }

    // Drain positive balance to savings
    if (account.balance > 0) {
      const savingsExists = queryOne(db, "SELECT id FROM accounts WHERE id = 'savings' AND deleted_at IS NULL")
      if (!savingsExists) {
        db.run(
          `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at, device_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ['savings', 'Savings', 'savings', 'piggybank', 0, ts, ts, DEVICE_ID]
        )
      }
      db.run(
        `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid(), 'income', account.balance, `Transfer from deleted account: ${account.name}`, 'savings', today(), ts, ts, DEVICE_ID]
      )
    }

    // Soft delete — tombstone the account and cascade its transactions
    db.run(
      'UPDATE accounts SET deleted_at = ?, updated_at = ?, device_id = ? WHERE id = ? AND deleted_at IS NULL',
      [ts, ts, DEVICE_ID, id]
    )
    db.run(
      'UPDATE transactions SET deleted_at = ?, updated_at = ?, device_id = ? WHERE account_id = ? AND deleted_at IS NULL',
      [ts, ts, DEVICE_ID, id]
    )

    return { success: true as const }
  })
}

// ─── Recurring Events ─────────────────────────────────────────────────

export type RecurringEvent = {
  id: string
  description: string
  type: 'income' | 'expense'
  amount: number
  frequency: 'monthly' | 'weekly' | 'bimonthly' | 'once'
  day_of_month: number | null
  day_of_week: number | null
  start_date: string | null
  end_date: string | null
  active: number
  created_at: string
  updated_at: string
}

export function loadRecurringEvents(db: Database): RecurringEvent[] {
  return queryRows(db, 'SELECT * FROM recurring_events WHERE active = 1 AND deleted_at IS NULL ORDER BY created_at DESC') as unknown as RecurringEvent[]
}

export function addRecurringEvent(
  { description, type, amount, frequency, day_of_month, day_of_week, start_date, end_date, active = 1 }: {
    description: string
    type: 'income' | 'expense'
    amount: number
    frequency: 'monthly' | 'weekly' | 'bimonthly' | 'once'
    day_of_month?: number
    day_of_week?: number
    start_date?: string
    end_date?: string
    active?: number
  },
  db: Database
) {
  const ts = now()
  const id = uuid()
  db.run(
    `INSERT INTO recurring_events (id, description, type, amount, frequency, day_of_month, day_of_week, start_date, end_date, active, created_at, updated_at, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, description, type, amount, frequency, day_of_month ?? null, day_of_week ?? null, start_date ?? null, end_date ?? null, active, ts, ts, DEVICE_ID]
  )
  return { id }
}

export function updateRecurringEvent(
  { id, description, type, amount, frequency, day_of_month, day_of_week, start_date, end_date, active }: {
    id: string
    description?: string
    type?: 'income' | 'expense'
    amount?: number
    frequency?: 'monthly' | 'weekly' | 'bimonthly' | 'once'
    day_of_month?: number
    day_of_week?: number
    start_date?: string
    end_date?: string
    active?: number
  },
  db: Database
) {
  db.run(
    `UPDATE recurring_events SET
       description = COALESCE(?, description),
       type = COALESCE(?, type),
       amount = COALESCE(?, amount),
       frequency = COALESCE(?, frequency),
       day_of_month = COALESCE(?, day_of_month),
       day_of_week = COALESCE(?, day_of_week),
       start_date = COALESCE(?, start_date),
       end_date = COALESCE(?, end_date),
       active = COALESCE(?, active),
       updated_at = ?,
       device_id = ?
     WHERE id = ?`,
    [
      description ?? null,
      type ?? null,
      amount ?? null,
      frequency ?? null,
      day_of_month ?? null,
      day_of_week ?? null,
      start_date ?? null,
      end_date ?? null,
      active ?? null,
      now(),
      DEVICE_ID,
      id,
    ]
  )
}

export function deleteRecurringEvent(id: string, db: Database) {
  // Soft delete — set deleted_at so the row is filtered out of reads
  db.run(
    'UPDATE recurring_events SET deleted_at = ?, updated_at = ?, device_id = ? WHERE id = ?',
    [now(), now(), DEVICE_ID, id]
  )
  return { success: true as const }
}
