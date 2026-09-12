'use server'

import { getDb } from '@/lib/db'

export type Account = {
  id: string
  name: string
  type: 'daily' | 'savings' | 'investment' | 'custom' | 'expense'
  icon: string
  hidden: number
  balance: number  // derivado derivado de SUM(transactions)
  created_at: string
  updated_at: string
}

/**
 * addAccount - Agrega una nueva cuenta.
 */
export async function addAccount({
  name,
  type,
  icon = 'wallet'
}: {
  name: string
  type: 'daily' | 'savings' | 'investment' | 'custom' | 'expense'
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
export async function updateAccount({
  id,
  name,
  type,
  icon,
  hidden
}: {
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
    const account = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined
    if (!account) return { success: false, error: 'Account not found' }

    // 2. Si tiene balance, transferir a savings primero
    if (account.balance > 0) {
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