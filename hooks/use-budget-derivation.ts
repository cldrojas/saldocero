import { differenceInDays, isSameDay, startOfDay } from 'date-fns'
import { Account, Budget, Transaction } from '@/types'

// Default account types that cannot be deleted.
// NOTE: resolved by `type`, never by a hardcoded slug id (D8).
export const DEFAULT_ACCOUNT_TYPES = ['daily', 'savings', 'investment'] as const

export type DefaultAccountType = (typeof DEFAULT_ACCOUNT_TYPES)[number]

export function isDefaultAccountType(type: string): boolean {
  return (DEFAULT_ACCOUNT_TYPES as readonly string[]).includes(type)
}

export function getToday(): Date {
  return startOfDay(new Date())
}

/**
 * Days remaining until the budget end date (inclusive of today).
 * Returns 0 when no end date is set.
 */
export function getDaysRemaining(budget: Budget, today: Date = getToday()): number {
  if (!budget.endDate) return 0
  return Math.max(0, differenceInDays(budget.endDate, today) + 1)
}

/**
 * Find the single daily (main) account. Resolved by `type`, not by id slug.
 */
export function findDailyAccount(accounts: Account[]): Account | undefined {
  return accounts.find((a) => a.type === 'daily')
}

/**
 * Total amount spent today on the daily account, as a positive number.
 * Only negative-amount transactions (expense/transfer/adjustment out) count.
 */
export function computeUsedToday(
  accounts: Account[],
  transactions: Transaction[],
  today: Date = getToday()
): number {
  const dailyAccount = findDailyAccount(accounts)
  if (!dailyAccount) return 0
  return transactions
    .filter((t) => t.account === dailyAccount.id && t.amount < 0 && isSameDay(t.date, today))
    .reduce((sum, t) => sum + Math.abs(t.amount), 0)
}

/**
 * Daily spending allowance = balance of the daily account spread over the days
 * remaining. Always 0 in track mode or without an end date.
 */
export function computeDailyAllowance(
  budget: Budget,
  accounts: Account[],
  today: Date = getToday()
): number {
  if (budget.mode === 'track') return 0
  if (!budget.endDate) return 0
  const daysRemaining = getDaysRemaining(budget, today)
  if (daysRemaining <= 0) return 0
  const totalBalance = findDailyAccount(accounts)?.balance ?? 0
  return totalBalance / daysRemaining
}

/**
 * Amount left to spend today. Clamped at 0 for over-spend.
 */
export function computeRemainingToday(dailyAllowance: number, usedToday: number): number {
  if (dailyAllowance <= 0) return 0
  return Math.max(0, dailyAllowance - usedToday)
}

/**
 * Percentage of today's allowance still unused, clamped to [0, 100].
 */
export function computeProgress(dailyAllowance: number, remainingToday: number): number {
  if (dailyAllowance <= 0) return remainingToday <= 0 ? 100 : 0
  return Math.max(0, Math.min(100, (remainingToday / dailyAllowance) * 100))
}

// ─── Type mapping between Server Action rows and hook types ────────────

export interface ServerBudget {
  start_amount: number
  start_date: string | null
  end_date: string | null
  auto_save: number
  mode: string
  is_setup: number
}

export function toHookBudget(serverBudget: ServerBudget): Budget {
  return {
    startAmount: serverBudget.start_amount,
    startDate: serverBudget.start_date ? new Date(serverBudget.start_date + 'T00:00:00') : undefined,
    endDate: serverBudget.end_date ? new Date(serverBudget.end_date + 'T00:00:00') : undefined,
    autoSave: (serverBudget.auto_save ?? 1) === 1,
    mode: serverBudget.mode === 'track' ? 'track' : 'daily',
  }
}

export function toHookAccount(
  serverAccount: { id: string; name: string; type: string; balance: number; icon?: string; hidden?: number }
): Account {
  return {
    id: serverAccount.id,
    name: serverAccount.name,
    type: serverAccount.type,
    balance: serverAccount.balance,
    icon: serverAccount.icon ?? 'wallet',
    hidden: (serverAccount.hidden ?? 0) === 1,
  }
}

export function toDateIso(date: Date): string {
  // Local YYYY-MM-DD, matching how the rest of the app stores dates.
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
