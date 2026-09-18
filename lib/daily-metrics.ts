/**
 * daily-metrics.ts
 *
 * Helpers puros para recomputar los campos derivados del blob de
 * `daily-budget-data` (dailyAllowance/remainingToday/progress) a partir de los
 * datos fuente (budget + accounts + transactions). El import JSON NO confía en
 * los derivados del archivo: los recalcula con estas mismas fórmulas que usa la
 * app (setupBudget/calculateDailyAllowance), sin depender del estado del hook.
 */

import { differenceInDays, isSameDay } from 'date-fns'

export interface DailyMetrics {
  dailyAllowance: number
  remainingToday: number
  progress: number
}

export function computeDailyMetrics(params: {
  mode?: 'daily' | 'track'
  endDate?: Date
  accounts: Array<{ id: string; balance: number }>
  transactions: Array<{ account: string; amount: number; date: Date }>
  today: Date
}): DailyMetrics {
  const { mode, endDate, accounts, transactions, today } = params

  // Track mode (o daily sin endDate) no tiene asignación diaria: mismo default
  // que setupBudget.
  if (mode === 'track' || !endDate) {
    return { dailyAllowance: 0, remainingToday: 0, progress: 100 }
  }

  const daysRemaining = differenceInDays(endDate, today) + 1
  if (daysRemaining <= 0) {
    // Presupuesto vencido: mismo default que calculateDailyAllowance.
    return { dailyAllowance: 0, remainingToday: 0, progress: 0 }
  }

  const mainAccount = accounts.find((a) => a.id === 'daily')
  const totalBalance = mainAccount ? mainAccount.balance : 0
  const dailyAllowance = totalBalance / daysRemaining

  // Gasto acumulado de hoy en la cuenta principal: las expenses se guardan
  // negativas, así que la suma usa el valor absoluto (mismo criterio que
  // calculateDailyAllowance/addTransaction).
  const usedToday = transactions
    .filter((t) => t.account === 'daily' && isSameDay(t.date, today))
    .reduce((sum, t) => sum + Math.abs(t.amount), 0)

  const remainingToday = Math.max(0, dailyAllowance - usedToday)
  const progress = dailyAllowance > 0 ? Math.max(0, (remainingToday / dailyAllowance) * 100) : 0

  return { dailyAllowance, remainingToday, progress }
}