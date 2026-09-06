'use server'

import { getDb } from '@/lib/db'

export type Transaction = {
  id: string
  type: 'expense' | 'transfer' | 'income' | 'adjustment'
  amount: number
  description: string
  account_id: string
  date: string
  created_at: string
  updated_at: string
}

/**
 * addTransaction - Inserta una nueva transacción.
 * Retorna el ID de la transacción insertada.
 */
export async function addTransaction({
  type,
  amount,
  description,
  account_id,
  date
}: {
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
    // Primero obtener la transacción para replicarla si es necesario
    const tx = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Transaction | undefined
    if (!tx) return { success: false, error: 'Transaction not found' }

    // Borrar la transacción
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
export async function updateTransaction({
  id,
  type,
  amount,
  description,
  account_id,
  date
}: {
  id: string
  type: 'expense' | 'transfer' | 'income' | 'adjustment'
  amount: number
  description: string
  account_id: string
  date: string
}) {
  const db = getDb()

  return db.transaction(() => {
    // Verificar que existe
    const existing = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id)
    if (!existing) return { success: false, error: 'Transaction not found' }

    // Actualizar la transacción
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
export async function transferFunds({
  amount,
  from_account_id,
  to_account_id,
  description
}: {
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
    db.prepare(`
      INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(expenseId, 'expense', -amount, description || 'Transfer', from_account_id, today, new Date().toISOString(), new Date().toISOString())

    // 2. INSERT income (to account)
    const incomeId = crypto.randomUUID()
    db.prepare(`
      INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(incomeId, 'income', amount, description || 'Transfer', to_account_id, today, new Date().toISOString(), new Date().toISOString())

    return { success: true, expenseId, incomeId }
  })()
}