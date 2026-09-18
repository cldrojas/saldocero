import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBudget } from '@/hooks/use-budget'

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

// Mock date-fns
vi.mock('date-fns', () => ({
  differenceInDays: vi.fn((date1, date2) => Math.floor((date1 - date2) / (1000 * 60 * 60 * 24))),
  startOfDay: vi.fn((date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())),
  isSameDay: vi.fn((date1, date2) => date1.toDateString() === date2.toDateString()),
  isToday: vi.fn((date) => new Date().toDateString() === date.toDateString()),
}))

// Mock uuid with unique IDs
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    const id = `mock-uuid-${uuidCounter}`
    uuidCounter++
    return id
  }),
}))

describe('useBudget hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
    uuidCounter = 0
  })

  it('initializes with default accounts and empty transactions', () => {
    const { result } = renderHook(() => useBudget())

    expect(result.current.accounts).toBeDefined()
    expect(Array.isArray(result.current.accounts)).toBe(true)
    expect(result.current.accounts).toHaveLength(2) // daily and savings
    expect(result.current.transactions).toBeDefined()
    expect(Array.isArray(result.current.transactions)).toBe(true)
    expect(result.current.transactions).toHaveLength(0)
  })

  it('handles invalid initial budget values - negative', () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.setupBudget({
        startAmount: -100 as any,
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    })

    // Should still set up but with negative amount (though in practice validation should prevent this)
    expect(result.current.isSetup).toBe(true)
    expect(result.current.budget.startAmount).toBe(-100)
  })

  it('handles invalid initial budget values - non-numeric', () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.setupBudget({
        startAmount: 'invalid' as any,
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    })

    // TypeScript would prevent this, but runtime should handle
    expect(result.current.isSetup).toBe(true)
  })

  it('handles empty accounts array', () => {
    // Mock localStorage with empty accounts
    localStorageMock.getItem.mockReturnValue(JSON.stringify({
      accounts: [],
      budget: { startAmount: 1000, endDate: new Date().toISOString() },
      transactions: [],
      isSetup: true
    }))

    const { result } = renderHook(() => useBudget())

    // Should fall back to default accounts
    expect(result.current.accounts).toHaveLength(2)
  })

  it('handles large numbers', () => {
    const { result } = renderHook(() => useBudget())

    const largeAmount = 1000000000 // 1 billion

    act(() => {
      result.current.setupBudget({
        startAmount: largeAmount as any,
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    })

    expect(result.current.budget.startAmount).toBe(largeAmount)
    expect(result.current.dailyAllowance).toBe(largeAmount / 8) // 8 days including today
  })

  it('handles error in addTransaction with invalid amount', () => {
    const { result } = renderHook(() => useBudget())

    // Set up budget first
    act(() => {
      result.current.setupBudget({
        startAmount: 1000 as any,
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    })

    // Try to add transaction with invalid amount
    act(() => {
      result.current.addTransaction({
        type: 'expense',
        amount: NaN,
        description: 'Invalid expense',
        account: 'daily'
      })
    })

    // Should not crash, transactions should remain empty or handle gracefully
    expect(result.current.transactions).toHaveLength(1) // Only the initial deposit
  })

  it('handles addTransaction with amount exceeding balance', () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.setupBudget({
        startAmount: 100 as any,
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    })

    // Add expense larger than daily allowance
    act(() => {
      result.current.addTransaction({
        type: 'expense',
        amount: 200, // More than daily allowance
        description: 'Large expense',
        account: 'daily'
      })
    })

    expect(result.current.transactions).toHaveLength(2) // Initial + expense
    expect(result.current.remainingToday).toBe(0)
  })

  it('handles transferFunds with insufficient funds', () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.setupBudget({
        startAmount: 100 as any,
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    })

    // Try to transfer more than available
    act(() => {
      result.current.transferFunds({
        amount: 200 as any,
        fromAccount: 'daily',
        toAccount: 'savings',
        description: 'Large transfer'
      })
    })

    // Should still execute, resulting in negative balance
    const dailyAccount = result.current.accounts.find(a => a.id === 'daily')
    expect(dailyAccount?.balance).toBeLessThan(0)
  })

  it('handles deleteAccount with balance', () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.setupBudget({
        startAmount: 1000 as any,
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })
    })

    // Add an account with balance
    act(() => {
      result.current.addAccount({
        name: 'Test Account',
        type: 'investment',
        balance: 500 as any,
        icon: 'wallet'
      })
    })

    const testAccount = result.current.accounts.find(a => a.name === 'Test Account')
    expect(testAccount).toBeDefined()

    // Delete the account
    act(() => {
      result.current.deleteAccount(testAccount!.id)
    })

    // Should transfer balance to savings
    const savingsAccount = result.current.accounts.find(a => a.id === 'savings')
    expect(savingsAccount?.balance).toBe(500)
  })

  it('prevents deletion of default accounts', () => {
    const { result } = renderHook(() => useBudget())

    // Try to delete daily account
    const deleted = result.current.deleteAccount('daily')
    expect(deleted).toBe(false)

    // Account should still exist
    expect(result.current.accounts.find(a => a.id === 'daily')).toBeDefined()
  })

  describe('T-2: updateAccount creates adjustment transaction', () => {
    it('creates adjustment transaction when balance increases', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      const dailyAccount = result.current.accounts.find(a => a.id === 'daily')!

      act(() => {
        result.current.updateAccount({ ...dailyAccount, balance: 1500 as any })
      })

      // Initial deposit + adjustment transaction
      expect(result.current.transactions).toHaveLength(2)

      const adjustmentTx = result.current.transactions[0]
      expect(adjustmentTx.type).toBe('adjustment')
      expect(adjustmentTx.amount).toBe(500) // 1500 - 1000
      expect(adjustmentTx.description).toBe('Balance adjustment')
      expect(adjustmentTx.account).toBe('daily')
    })

    it('creates adjustment transaction when balance decreases', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      const dailyAccount = result.current.accounts.find(a => a.id === 'daily')!

      act(() => {
        result.current.updateAccount({ ...dailyAccount, balance: 300 as any })
      })

      expect(result.current.transactions).toHaveLength(2)

      const adjustmentTx = result.current.transactions[0]
      expect(adjustmentTx.type).toBe('adjustment')
      expect(adjustmentTx.amount).toBe(-700) // 300 - 1000 = -700
    })

    it('does not create adjustment transaction when balance unchanged', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      const dailyAccount = result.current.accounts.find(a => a.id === 'daily')!

      act(() => {
        result.current.updateAccount({ ...dailyAccount, balance: 1000 as any })
      })

      // Still only the initial deposit
      expect(result.current.transactions).toHaveLength(1)
    })
  })

  describe('T-5: removeTransaction with refund param', () => {
    it('refunds balance when refund=true (default)', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      act(() => {
        result.current.addTransaction({
          type: 'expense',
          amount: 200,
          description: 'Test expense',
          account: 'daily'
        })
      })

      const dailyAccount = result.current.accounts.find(a => a.id === 'daily')!
      expect(dailyAccount.balance).toBe(800) // 1000 - 200

      // addTransaction inserts at the beginning, so expense is at index 0
      const expenseTx = result.current.transactions[0]
      expect(expenseTx.type).toBe('expense')

      act(() => {
        result.current.removeTransaction(expenseTx.id)
      })

      const dailyAccountAfter = result.current.accounts.find(a => a.id === 'daily')!
      expect(dailyAccountAfter.balance).toBe(1000) // balance restored
      expect(result.current.transactions).toHaveLength(1) // only initial deposit
    })

    it('does not refund balance when refund=false', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      act(() => {
        result.current.addTransaction({
          type: 'expense',
          amount: 200,
          description: 'Test expense',
          account: 'daily'
        })
      })

      const dailyAccount = result.current.accounts.find(a => a.id === 'daily')!
      expect(dailyAccount.balance).toBe(800)

      // addTransaction inserts at the beginning, so expense is at index 0
      const expenseTx = result.current.transactions[0]
      expect(expenseTx.type).toBe('expense')

      act(() => {
        result.current.removeTransaction(expenseTx.id, false)
      })

      const dailyAccountAfter = result.current.accounts.find(a => a.id === 'daily')!
      expect(dailyAccountAfter.balance).toBe(800) // balance NOT restored
      expect(result.current.transactions).toHaveLength(1) // transaction removed
    })

    it('deleting positive adjustment with refund=true reverses the effect (Scenario 3e)', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      const daily = result.current.accounts.find(a => a.id === 'daily')!
      expect(daily.balance).toBe(1000)

      // Increase balance to 1500 → creates +500 adjustment
      act(() => {
        result.current.updateAccount({ ...daily, balance: 1500 as any })
      })

      expect(result.current.accounts.find(a => a.id === 'daily')!.balance).toBe(1500)

      const adjustmentTx = result.current.transactions[0]
      expect(adjustmentTx.type).toBe('adjustment')
      expect(adjustmentTx.amount).toBe(500)

      // Delete adjustment with refund → balance should return to 1000
      act(() => {
        result.current.removeTransaction(adjustmentTx.id, true)
      })

      expect(result.current.accounts.find(a => a.id === 'daily')!.balance).toBe(1000)
    })

    it('deleting negative adjustment with refund=true reverses the effect', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      const daily = result.current.accounts.find(a => a.id === 'daily')!

      // Decrease balance to 300 → creates -700 adjustment
      act(() => {
        result.current.updateAccount({ ...daily, balance: 300 as any })
      })

      expect(result.current.accounts.find(a => a.id === 'daily')!.balance).toBe(300)

      const adjustmentTx = result.current.transactions[0]
      expect(adjustmentTx.type).toBe('adjustment')
      expect(adjustmentTx.amount).toBe(-700)

      // Delete adjustment with refund → balance returns to 1000
      act(() => {
        result.current.removeTransaction(adjustmentTx.id, true)
      })

      expect(result.current.accounts.find(a => a.id === 'daily')!.balance).toBe(1000)
    })

    it('safely handles non-existent transaction id', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      expect(() => {
        act(() => {
          result.current.removeTransaction('non-existent-id')
        })
      }).not.toThrow()

      expect(() => {
        act(() => {
          result.current.removeTransaction('non-existent-id', false)
        })
      }).not.toThrow()
    })
  })
})
