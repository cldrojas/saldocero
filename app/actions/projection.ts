'use server'

import { getDb } from '@/lib/db'
import type { Database } from 'better-sqlite3'

export type CashflowDayResult = {
  date: string
  movements: string[]
  netChange: number
  balance: number
}

interface RecurringEventRow {
  id: string
  description: string
  type: 'income' | 'expense'
  amount: number
  frequency: string
  start_date: string | null
  end_date: string | null
  day_of_month: number | null
  day_of_week: number | null
  active: number
}

/**
 * computeProjection - Computa la proyección de flujo de caja.
 * Lee saldo actual, eventos recurrentes y genera la proyección por días.
 * @param horizonDays Número de días a proyectar (default: 30)
 * @returns CashflowDayResult[] con la proyección
 */
export async function computeProjection(horizonDays: number = 30): Promise<CashflowDayResult[]> {
  const db = getDb()
  const today = new Date()
  const results: CashflowDayResult[] = []
  const initialBalance = await getInitialBalance(db)

  // 2. Leer eventos recurrentes activos
  const events = db.prepare(`
    SELECT * FROM recurring_events WHERE active = 1
  `).all() as RecurringEventRow[]

  // 3. Generar días del horizonte
  for (let i = 0; i < horizonDays; i++) {
    const date = new Date(today)
    date.setDate(today.getDate() + i)
    const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD
    const dayOfMonth = date.getDate()
    const dayOfWeek = date.getDay() // 0=domingo

    // Filtrar eventos que aplican a este día
    const applicableEvents = events.filter((event) => {
      // Filtro por rango de fechas
      if (event.start_date && dateStr < event.start_date) return false
      if (event.end_date && dateStr > event.end_date) return false

      // Filtro por frecuencia
      const applies = applyFrequency(event.frequency, dayOfMonth, dayOfWeek, event.day_of_month, event.day_of_week)
      if (!applies) return false

      return true
    })

    // Calcular movimientos del día
    const movements: string[] = []
    let ingreso = 0
    let egreso = 0

    applicableEvents.forEach((event) => {
      const label = `${event.description} (${event.type})`
      if (event.type === 'income') {
        ingreso += event.amount
        movements.push(label)
      } else {
        egreso += event.amount
        movements.push(`-${label}`)
      }
    })

    const netChange = ingreso - egreso
    // Balance acumulado: saldo inicial + suma de netChanges anteriores
    const prevBalance = i > 0 ? results[i - 1].balance : initialBalance
    const balance = prevBalance + netChange

    results.push({
      date: dateStr,
      movements,
      netChange,
      balance,
    })
  }

  return results
}

/**
 * getInitialBalance - Obtiene el saldo inicial de la cuenta daily.
 */
async function getInitialBalance(db: Database): Promise<number> {
  const dailyAccounts = db.prepare(`SELECT * FROM accounts WHERE type = 'daily'`).all() as { id: string }[]
  if (dailyAccounts.length > 0) {
    const acc = dailyAccounts[0]
    const balanceRow = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount WHEN type = 'expense' THEN -amount ELSE 0 END), 0) as total FROM transactions WHERE account_id = ?`
    ).get(acc.id) as { total: number }
    return Math.floor(balanceRow.total)
  }
  return 0
}

/**
 * applyFrequency - Verifica si un evento recurrente aplica a un día dado.
 */
function applyFrequency(
  frequency: string,
  dayOfMonth: number,
  dayOfWeek: number,
  eventDayOfMonth: number | null,
  eventDayOfWeek: number | null
): boolean {
  switch (frequency) {
    case 'once':
      // En la implementación Server Action la fecha se pasa aparte; retornamos true
      // y la UI/hoc filtra por la fecha exacta.
      return true
    case 'monthly':
      return eventDayOfMonth !== null && dayOfMonth === eventDayOfMonth
    case 'bimonthly':
      // Simplificado: ocurre en meses impares (1, 3, 5, ...) o cada 2 meses
      // Para ser implementado con precisión en Phase 3
      return dayOfMonth % 2 === 1
    case 'weekly':
      return eventDayOfWeek !== null && dayOfWeek === eventDayOfWeek
    default:
      return false
  }
}