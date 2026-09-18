// 1. Define a branded Int type
export type Int = number & { __int__: true }

// 2. Factory function to create Ints safely
/**
 * Converts a string or number to an Int type, flooring decimals if present.
 * @param input - The value to convert (string or number).
 * @returns The Int representation if valid, otherwise null.
 * @example
 * toInt(42) // returns 42 as Int
 * toInt("42") // returns 42 as Int
 * toInt("42.5") // returns 42 as Int (floored)
 * toInt("abc") // returns null
 */
export function toInt(input: string | number): Int | null {
  // Handle invalid types early
  if (input == null) {
    return null
  }

  let num: number

  if (typeof input === 'string') {
    // Trim whitespace and validate format (allow optional decimals, but not scientific notation)
    const trimmed = input.trim()
    if (!trimmed || !/^\s*-?\d+(\.\d+)?\s*$/.test(trimmed)) {
      return null
    }
    // parseInt floors decimals automatically
    num = parseInt(trimmed, 10)

    // Check if parseInt failed (returns NaN for invalid strings)
    if (isNaN(num) || !Number.isInteger(num)) {
      return null
    }
  } else {
    // For numbers, floor to nearest integer
    num = Math.floor(input)

    // Check if the result is a valid integer
    if (isNaN(num) || !Number.isInteger(num)) {
      return null
    }
  }

  return num as Int
}

// 3. Type guard (optional but useful)
export function isInt(n: number): n is Int {
  return Number.isInteger(n)
}

export type Transaction = {
  id: string
  type: TransactionType
  amount: Int
  description: string
  account: string
  date: Date
}

export type TransactionType = 'expense' | 'transfer' | 'income' | 'adjustment'

export type Budget = {
  startAmount: Int
  startDate: Date | undefined
  endDate: Date | undefined
  autoSave: boolean
  mode?: 'daily' | 'track'
}

export type Account = {
  id: string
  name: string
  type: string
  balance: Int
  icon: string
  hidden?: boolean
}
