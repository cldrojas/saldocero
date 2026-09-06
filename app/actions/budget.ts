'use server'

import { getDb } from '@/lib/db'

// Tipos de filas SQLite (mejor-sqlite3 tipa .get()/.all() como unknown/{})
interface BudgetRow {
  start_amount: number
  start_date: string | null
  end_date: string | null
  auto_save: number
  mode: string
  is_setup: number
  updated_at: string
}

interface AccountRow {
  id: string
  name: string
  type: string
  icon: string
  hidden: number
  balance?: number
}

interface TransactionRow {
  id: string
  type: string
  amount: number
  description: string
  account_id: string
  date: string
}

// Types that the hook expects (from types/index.ts)
// Note: Server Actions use plain 'number' for JSON serializability,
// verification happens at the hook boundary (toInt/ensureInt).

/**
 * loadState - Carga el estado actual desde SQLite.
 * Retorna budget, accounts (con balance derivado de SUM transactions),
 * y transactions.
 */
export async function loadState() {
  const db = getDb()

  // Cargar budget
  const budgetRow = db.prepare(
    `SELECT * FROM budgets WHERE id = ?`
  ).get('default') as BudgetRow | undefined

  const budget = budgetRow ? {
    start_amount: budgetRow.start_amount,
    start_date: budgetRow.start_date,
    end_date: budgetRow.end_date,
    auto_save: budgetRow.auto_save,
    mode: budgetRow.mode,
    is_setup: budgetRow.is_setup,
    updated_at: budgetRow.updated_at
  } : {
    start_amount: 0,
    start_date: null,
    end_date: null,
    auto_save: 1,
    mode: 'daily',
    is_setup: 0,
    updated_at: new Date().toISOString()
  }

  // Cargar accounts
  const accountsRows = db.prepare(
    `SELECT * FROM accounts ORDER BY type`
  ).all() as AccountRow[]

  const accounts = accountsRows.map((acc) => ({
    id: acc.id,
    name: acc.name,
    type: acc.type,
    // Balance derivado de SUM transactions - convertir a number
    balance: Math.floor(acc.balance ?? 0),
    icon: acc.icon,
  }))

  // Cargar transactions
  const txRows = db.prepare(
    `SELECT * FROM transactions ORDER BY date DESC`
  ).all() as TransactionRow[]

  const transactions = txRows.map((tx) => ({
    id: tx.id,
    type: tx.type,
    amount: tx.amount,
    description: tx.description,
    account: tx.account_id,
    date: tx.date ? new Date(tx.date) : new Date(),
  }))

  return {
    budget,
    accounts,
    transactions
  }
}

/**
 * setupBudget - Configura el presupuesto inicial.
 * Inserta el budget, crea una transacción income inicial y upsert la cuenta daily.
 */
export async function setupBudget({ startAmount, endDate, mode = 'daily' }: {
  startAmount: number
  endDate?: string
  mode?: 'daily' | 'track'
}) {
  const db = getDb()
  const today = new Date().toISOString().split('T')[0]

  return db.transaction(() => {
    // 1. Upsert budget
    const upsertBudget = db.prepare(`
      INSERT INTO budgets (id, start_amount, start_date, end_date, auto_save, mode, is_setup, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        start_amount = excluded.start_amount,
        end_date = excluded.end_date,
        mode = excluded.mode,
        auto_save = excluded.auto_save,
        updated_at = excluded.updated_at
    `)
    const budgetStartDate = endDate ? new Date(endDate).toISOString().split('T')[0] : null
    upsertBudget.run('default', startAmount, today, budgetStartDate, 1, mode, 1, new Date().toISOString())

    // 2. Crear transacción income inicial
    const insertTransaction = db.prepare(`
      INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const txId = crypto.randomUUID()
    insertTransaction.run(txId, 'income', startAmount, 'Initial deposit', 'daily', today, new Date().toISOString(), new Date().toISOString())

    // 3. Upsert cuenta daily (si no existe)
    const upsertAccount = db.prepare(`
      INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        icon = excluded.icon,
        hidden = excluded.hidden,
        updated_at = excluded.updated_at
    `)
    upsertAccount.run('daily', 'Daily Budget', 'daily', 'wallet', 0, today, new Date().toISOString())

    return { success: true }
  })()
}

/**
 * updateConfig - Actualiza la configuración del presupuesto.
 */
export async function updateConfig({ startAmount, endDate, mode, autoSave }: {
  startAmount?: number
  endDate?: string
  mode?: 'daily' | 'track'
  autoSave?: number
}) {
  const db = getDb()

  return db.transaction(() => {
    // 1. Actualizar budget
    const updateBudget = db.prepare(`
      UPDATE budgets SET
        start_amount = COALESCE(?, start_amount),
        end_date = CASE WHEN ? IS NOT NULL THEN ? ELSE end_date END,
        mode = COALESCE(?, mode),
        auto_save = COALESCE(?, auto_save),
        updated_at = ?
      WHERE id = 'default'
    `)
    const budgetStartDate = endDate ? new Date(endDate).toISOString().split('T')[0] : undefined
    updateBudget.run(
      startAmount,
      endDate !== undefined,
      budgetStartDate,
      mode,
      autoSave,
      new Date().toISOString()
    )

    // 2. Si cambiamos a track mode, remover cuenta savings
    if (mode === 'track') {
      db.prepare(`DELETE FROM accounts WHERE id = 'savings'`).run()
    }

    // 3. Si cambiamos a daily mode y no existe savings, crearla
    if (mode === 'daily') {
      const savingsExists = db.prepare(`SELECT id FROM accounts WHERE id = 'savings'`).get()
      if (!savingsExists) {
        db.prepare(`
          INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('savings', 'Savings', 'savings', 'piggybank', 0, new Date().toISOString(), new Date().toISOString())
      }
    }

    return { success: true }
  })()
}

/**
 * toggleAutoSave - Alterna el auto-save on/off.
 */
export async function toggleAutoSave() {
  const db = getDb()

  return db.transaction(() => {
    const row = db.prepare(`SELECT auto_save FROM budgets WHERE id = 'default'`).get() as BudgetRow | undefined
    const newAutoSave = row && row.auto_save === 1 ? 0 : 1
    db.prepare(
      `UPDATE budgets SET auto_save = ?, updated_at = ? WHERE id = 'default'`
    ).run(newAutoSave, new Date().toISOString())
    return { autoSave: newAutoSave }
  })()
}

/**
 * clearData - Limpia todos los datos (TRUNCATE 3 tablas).
 * Útil para reset completo.
 */
export async function clearData() {
  const db = getDb()

  return db.transaction(() => {
    db.prepare(`DELETE FROM transactions`).run()
    db.prepare(`DELETE FROM accounts`).run()
    db.prepare(`DELETE FROM budgets`).run()
    return { success: true }
  })()
}

/**
 * addTransaction - Inserta una nueva transacción.
 * Retorna el ID de la transacción insertada.
 */
export async function addTransaction({ type, amount, description, account_id, date }: {
  type: 'expense' | 'transfer' | 'income' | 'adjustment'
  amount: number
  description: string
  account_id: string
  date: string
}) {
  const db = getDb()

  const insert = db.prepare(`
    INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const id = crypto.randomUUID()
  insert.run(id, type, amount, description, account_id, date, new Date().toISOString(), new Date().toISOString())

  return { id }
}

/**
 * removeTransaction - Remueve una transacción.
 * El balance se deriva de SUM(transactions), así que borrar el registro ya
 * revierte su efecto contable (refund=true). Con refund=false se inserta una
 * réplica del monto para que el gasto/ingreso siga contando (dinero perdido).
 */
export async function removeTransaction(id: string, refund: boolean = true) {
  const db = getDb()

  return db.transaction(() => {
    const tx = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as TransactionRow | undefined
    if (!tx) return { success: false, error: 'Transaction not found' }

    const remove = db.prepare(`DELETE FROM transactions WHERE id = ?`)
    remove.run(id)

    // Sin reembolso: replicar el monto para que el efecto contable permanezca
    // (el balance deriva de SUM, así que sin réplica el dinero "volvería solo").
    if (!refund && tx) {
      const replica = db.prepare(`
        INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const replicaId = crypto.randomUUID()
      replica.run(replicaId, tx.type, tx.amount, `Unrefunded: ${tx.description}`, tx.account_id, tx.date, new Date().toISOString(), new Date().toISOString())
    }

    return { success: true }
  })()
}

/**
 * updateTransaction - Actualiza una transacción existente.
 */
export async function updateTransaction({ id, type, amount, description, account_id, date }: {
  id: string
  type: 'expense' | 'transfer' | 'income' | 'adjustment'
  amount: number
  description: string
  account_id: string
  date: string
}) {
  const db = getDb()

  return db.transaction(() => {
    const existing = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id)
    if (!existing) return { success: false, error: 'Transaction not found' }

    const update = db.prepare(`
      UPDATE transactions SET
        type = COALESCE(?, type),
        amount = ?,
        description = COALESCE(?, description),
        account_id = COALESCE(?, account_id),
        date = ?,
        updated_at = ?
      WHERE id = ?
    `)
    update.run(type, amount, description, account_id, date, new Date().toISOString(), id)

    return { success: true }
  })()
}

/**
 * transferFunds - Transfiere fondos entre cuentas.
 * ACID: INSERT expense (from) + INSERT income (to) en una transacción SQLite.
 */
export async function transferFunds({ amount, from_account_id, to_account_id, description }: {
  amount: number
  from_account_id: string
  to_account_id: string
  description?: string
}) {
  const db = getDb()

  return db.transaction(() => {
    const today = new Date().toISOString().split('T')[0]

    // 1. INSERT expense (from account)
    const expenseId = crypto.randomUUID()
    db.prepare(
      `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(expenseId, 'expense', -amount, description || 'Transfer', from_account_id, today, new Date().toISOString(), new Date().toISOString())

    // 2. INSERT income (to account)
    const incomeId = crypto.randomUUID()
    db.prepare(
      `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(incomeId, 'income', amount, description || 'Transfer', to_account_id, today, new Date().toISOString(), new Date().toISOString())

    return { success: true, expenseId, incomeId }
  })()
}

/**
 * addAccount - Agrega una nueva cuenta.
 */
export async function addAccount({ name, type, icon = 'wallet' }: {
  name: string
  type: 'daily' | 'savings' | 'investment' | 'custom'
  icon?: string
}) {
  const db = getDb()
  const today = new Date().toISOString().split('T')[0]
  const id = crypto.randomUUID()

  const insert = db.prepare(`
    INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run(id, name, type, icon, 0, today, new Date().toISOString())

  return { id }
}

/**
 * updateAccount - Actualiza una cuenta existente.
 */
export async function updateAccount({ id, name, type, icon, hidden }: {
  id: string
  name: string
  type: 'daily' | 'savings' | 'investment' | 'custom'
  icon?: string
  hidden?: number
}) {
  const db = getDb()

  const update = db.prepare(`
    UPDATE accounts SET
      name = COALESCE(?, name),
      type = COALESCE(?, type),
      icon = COALESCE(?, icon),
      hidden = COALESCE(?, hidden),
      updated_at = ?
    WHERE id = ?
  `)
  update.run(name, type, icon, hidden, new Date().toISOString(), id)
}

/**
 * deleteAccount - Elimina una cuenta.
 * Si el account tiene balance > 0, drena a savings antes de borrar.
 */
export async function deleteAccount(id: string) {
  const db = getDb()

  return db.transaction(() => {
    // 1. Obtener el account y su balance actual
    const account = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as AccountRow | undefined
    if (!account) return { success: false, error: 'Account not found' }

    // 2. Si tiene balance, transferir a savings primero
    if ((account.balance ?? 0) > 0) {
      const today = new Date().toISOString().split('T')[0]

      // Verificar si savings existe, si no, crearla
      const savingsExists = db.prepare(`SELECT id FROM accounts WHERE id = 'savings'`).get()
      if (!savingsExists) {
        db.prepare(`
          INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('savings', 'Savings', 'savings', 'piggybank', 0, new Date().toISOString(), new Date().toISOString())
      }

      // Transferir balance a savings
      const transferId = crypto.randomUUID()
      db.prepare(`
        INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(transferId, 'income', account.balance, `Transfer from deleted account: ${account.name}`, 'savings', today, new Date().toISOString(), new Date().toISOString())
    }

    // 3. Borrar la cuenta
    const deleteStmt = db.prepare(`DELETE FROM accounts WHERE id = ?`)
    deleteStmt.run(id)

    // 4. Borrar transacciones asociadas a esta cuenta
    db.prepare(`DELETE FROM transactions WHERE account_id = ?`).run(id)

    return { success: true }
  })()
}