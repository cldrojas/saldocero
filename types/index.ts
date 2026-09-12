// ─── Verification Layer ───────────────────────────────────────────────
// Core types use plain `number` for JSON serializability (Server Actions, SQLite).
// `toInt` and `ensureInt` provide verification at boundaries (form input, DB reads).

/**
 * Converts a string or number to an integer, flooring decimals if present.
 * Returns null if the input is not a valid number.
 * @example toInt(42) // 42
 * @example toInt("3.7") // 3
 * @example toInt("abc") // null
 */
export function toInt(input: string | number): number | null {
  if (input == null) return null

  let num: number

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed || !/^\s*-?\d+(\.\d+)?\s*$/.test(trimmed)) return null
    num = parseInt(trimmed, 10)
    if (isNaN(num)) return null
  } else {
    num = Math.floor(input)
    if (isNaN(num)) return null
  }

  return num
}

/**
 * Like `toInt` but throws on invalid input. Use at boundaries where failure is unacceptable.
 * @example const amount = ensureInt(userInput) // number or throws
 */
export function ensureInt(input: string | number): number {
  const result = toInt(input)
  if (result === null) throw new TypeError(`Invalid integer: ${JSON.stringify(input)}`)
  return result
}

/**
 * Type guard — checks if a number is a safe integer.
 */
export function isInt(n: number): n is number {
  return Number.isInteger(n)
}

// ─── Core Types ───────────────────────────────────────────────────────
// All numeric fields are plain `number`. Verification happens at the boundary,
// not at the type level. This keeps Server Actions and SQLite rows serializable.

export type TransactionType = 'expense' | 'transfer' | 'income' | 'adjustment'

export type Transaction = {
  id: string
  type: TransactionType
  amount: number
  description: string
  account: string
  date: Date
}

export type Budget = {
  startAmount: number
  startDate: Date | undefined
  endDate: Date | undefined
  autoSave: boolean
  mode?: 'daily' | 'track'
}

export type Account = {
  id: string
  name: string
  type: string
  balance: number
  icon: string
  hidden?: boolean
}
