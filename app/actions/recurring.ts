'use server'

import { getDb } from '@/lib/db'

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

/**
 * loadRecurringEvents - Carga todos los eventos recurrentes activos.
 */
export async function loadRecurringEvents(): Promise<RecurringEvent[]> {
  const db = getDb()

  const events = db.prepare(`
    SELECT * FROM recurring_events WHERE active = 1 ORDER BY created_at DESC
  `).all() as RecurringEvent[]

  return events
}

/**
 * addRecurringEvent - Agrega un nuevo evento recurrente.
 */
export async function addRecurringEvent({
  description,
  type,
  amount,
  frequency,
  day_of_month,
  day_of_week,
  start_date,
  end_date,
  active = 1
}: {
  description: string
  type: 'income' | 'expense'
  amount: number
  frequency: 'monthly' | 'weekly' | 'bimonthly' | 'once'
  day_of_month?: number
  day_of_week?: number
  start_date?: string
  end_date?: string
  active?: number
}) {
  const db = getDb()
  const today = new Date().toISOString().split('T')[0]
  const id = crypto.randomUUID()

  const insert = db.prepare(`
    INSERT INTO recurring_events (id, description, type, amount, frequency, day_of_month, day_of_week, start_date, end_date, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run(id, description, type, amount, frequency, day_of_month, day_of_week, start_date, end_date, active, today, new Date().toISOString())

  return { id }
}

/**
 * updateRecurringEvent - Actualiza un evento recurrente existente.
 */
export async function updateRecurringEvent({
  id,
  description,
  type,
  amount,
  frequency,
  day_of_month,
  day_of_week,
  start_date,
  end_date,
  active
}: {
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
}) {
  const db = getDb()

  const update = db.prepare(`
    UPDATE recurring_events SET
      description = COALESCE(?, description),
      type = COALESCE(?, type),
      amount = COALESCE(?, amount),
      frequency = COALESCE(?, frequency),
      day_of_month = COALESCE(?, day_of_month),
      day_of_week = COALESCE(?, day_of_week),
      start_date = COALESCE(?, start_date),
      end_date = COALESCE(?, end_date),
      active = COALESCE(?, active),
      updated_at = ?
    WHERE id = ?
  `)
  update.run(
    description,
    type,
    amount,
    frequency,
    day_of_month,
    day_of_week,
    start_date,
    end_date,
    active,
    new Date().toISOString(),
    id
  )
}

/**
 * deleteRecurringEvent - Elimina un evento recurrente.
 */
export async function deleteRecurringEvent(id: string) {
  const db = getDb()

  return db.transaction(() => {
    const deleteStmt = db.prepare(`DELETE FROM recurring_events WHERE id = ?`)
    deleteStmt.run(id)
    return { success: true }
  })()
}