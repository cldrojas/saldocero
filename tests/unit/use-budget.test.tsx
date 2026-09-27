import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBudget } from '@/hooks/use-budget'
import type { LegacyImportData } from '@/lib/import-json-types'
import type { Int } from '@/types'

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

  describe('transfers: linked legs and atomic removal', () => {
    // Sets up a 1000 daily budget and moves 300 to savings. Returns the two
    // legs of the resulting transfer, resolved by account instead of by position
    // so the assertions do not depend on insert order.
    function transfer300() {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.setupBudget({
          startAmount: 1000 as any,
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        })
      })

      act(() => {
        result.current.transferFunds({
          amount: 300 as any,
          fromAccount: 'daily',
          toAccount: 'savings'
        })
      })

      const legs = result.current.transactions.filter((t) => t.transferId !== undefined)
      return {
        result,
        legs,
        out: legs.find((t) => t.account === 'daily')!,
        into: legs.find((t) => t.account === 'savings')!
      }
    }

    it('writes the same transferId on both legs', () => {
      const { result, legs, out, into } = transfer300()

      expect(legs).toHaveLength(2)
      expect(out.transferId).toBeDefined()
      expect(into.transferId).toBe(out.transferId)
      // The legs stay two distinct records; only the pairing is shared.
      expect(out.id).not.toBe(into.id)
      expect(out.amount).toBe(-300)
      expect(into.amount).toBe(300)
      // The initial deposit is not part of any transfer.
      expect(result.current.transactions).toHaveLength(3)
      expect(result.current.transactions[2].transferId).toBeUndefined()
    })

    it('removeTransfer drops both legs in a single call', () => {
      const { result, out, into } = transfer300()
      const transferId = out.transferId!

      act(() => {
        result.current.removeTransfer(transferId)
      })

      expect(result.current.transactions.some((t) => t.id === out.id)).toBe(false)
      expect(result.current.transactions.some((t) => t.id === into.id)).toBe(false)
      // Only the initial deposit survives.
      expect(result.current.transactions).toHaveLength(1)
    })

    it('regression: two removeTransaction calls in one tick resurrect the first leg', () => {
      // This is the bug that makes `removeTransfer` necessary. Both calls read
      // `transactions` from the SAME render closure, so the second
      // `setTransactions` is computed from the pre-delete array and overwrites
      // the first one wholesale: the leg deleted by the FIRST call comes back.
      const { result, out, into } = transfer300()

      act(() => {
        result.current.removeTransaction(into.id)
        result.current.removeTransaction(out.id)
      })

      expect(result.current.transactions.some((t) => t.id === into.id)).toBe(true)
      expect(result.current.transactions.some((t) => t.id === out.id)).toBe(false)
    })

    it('removeTransfer with refund restores both account balances', () => {
      const { result, out } = transfer300()
      const transferId = out.transferId!

      expect(result.current.accounts.find((a) => a.id === 'daily')!.balance).toBe(700)
      expect(result.current.accounts.find((a) => a.id === 'savings')!.balance).toBe(300)
      const remainingBefore = result.current.remainingToday

      act(() => {
        result.current.removeTransfer(transferId, true)
      })

      expect(result.current.accounts.find((a) => a.id === 'daily')!.balance).toBe(1000)
      expect(result.current.accounts.find((a) => a.id === 'savings')!.balance).toBe(0)
      // The legs cancel: moving money between your own accounts is not spending,
      // so the daily allowance must not move either.
      expect(result.current.remainingToday).toBe(remainingBefore)
    })

    it('removeTransfer without refund keeps the balances but still drops both legs', () => {
      const { result, out } = transfer300()
      const transferId = out.transferId!

      act(() => {
        result.current.removeTransfer(transferId, false)
      })

      expect(result.current.accounts.find((a) => a.id === 'daily')!.balance).toBe(700)
      expect(result.current.accounts.find((a) => a.id === 'savings')!.balance).toBe(300)
      expect(result.current.transactions).toHaveLength(1)
    })

    it('removeTransfer with an unknown id changes nothing', () => {
      const { result } = transfer300()

      act(() => {
        result.current.removeTransfer('not-a-transfer')
      })

      expect(result.current.transactions).toHaveLength(3)
      expect(result.current.accounts.find((a) => a.id === 'daily')!.balance).toBe(700)
      expect(result.current.accounts.find((a) => a.id === 'savings')!.balance).toBe(300)
    })
  })

  describe('removeTransfer never moves the daily allowance', () => {
    // Import (backup / QR sync) is the only path that can produce a transfer
    // whose legs carry different dates: `transferFunds` stamps BOTH legs with
    // `today`, while `replaceAll` keeps whatever date each leg had in the file.
    //
    // The removed code netted the legs dated today and moved
    // `remainingToday`/`progress` whenever that net was non-zero, so deleting
    // such a group credited back an amount that was never debited anywhere. The
    // numbers below are picked so the old result is unmistakable: daily mode
    // turned 0/0 into 300 and 342.86%, and track mode divided by a zero
    // `dailyAllowance` and stored `Infinity`.
    const todayIso = () => new Date().toISOString()
    const yesterdayIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    /**
     * A budget whose day starts fully spent (`remainingToday` 0, `progress` 0:
     * `dailyAllowance` 87.5 = 700 over 8 days, and 87.5 spent today), plus a
     * transfer whose legs disagree about the day — the OUTGOING leg is today,
     * the incoming one yesterday, so the net of "today's legs" is a lone -300.
     */
    function divergentLegDatesImport(mode: 'daily' | 'track') {
      return {
        budget: {
          startAmount: 1000,
          mode,
          // `null`, not a missing key: track mode is the budget with no end date.
          endDate: mode === 'daily' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
        },
        accounts: [
          { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 700, icon: 'wallet' },
          { id: 'savings', name: 'Savings', type: 'savings', balance: 0, icon: 'piggybank' }
        ],
        transactions: [
          {
            id: 'spent',
            type: 'expense',
            amount: 87.5,
            description: 'Groceries',
            account: 'daily',
            date: todayIso()
          },
          {
            id: 'leg-out',
            type: 'expense',
            amount: -300,
            description: 'Transfer to Savings',
            account: 'daily',
            date: todayIso(),
            transferId: 'tx-div'
          },
          {
            id: 'leg-in',
            type: 'income',
            amount: 300,
            description: 'Transfer from Daily Budget',
            account: 'savings',
            date: yesterdayIso(),
            transferId: 'tx-div'
          }
        ]
      } satisfies LegacyImportData
    }

    // The blob the save effect last wrote, read back the way a reload would.
    function persistedBlob() {
      const calls = localStorageMock.setItem.mock.calls
      const [key, value] = calls[calls.length - 1]
      expect(key).toBe('daily-budget-data')
      return JSON.parse(value as string) as {
        remainingToday: number
        progress: number | null
      }
    }

    it('leaves remainingToday and progress untouched in daily mode', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.replaceAll(divergentLegDatesImport('daily'))
      })

      const remainingBefore = result.current.remainingToday
      const progressBefore = result.current.progress
      expect(remainingBefore).toBe(0)
      expect(progressBefore).toBe(0)

      act(() => {
        result.current.removeTransfer('tx-div', true)
      })

      // Control: the group really was deleted and the refund really ran, so this
      // is not a vacuous pass. The daily account is the meaningful side: it was
      // debited 300 by the outgoing leg and the refund gave it back.
      expect(result.current.transactions.some((t) => t.transferId === 'tx-div')).toBe(false)
      expect(result.current.accounts.find((a) => a.id === 'daily')!.balance).toBe(1000 as Int)

      expect(result.current.remainingToday).toBe(remainingBefore)
      expect(result.current.progress).toBe(progressBefore)
      // The old code credited the net of today's legs back: 0 + 300.
      expect(result.current.remainingToday).not.toBe(300)
      expect(result.current.progress).not.toBeCloseTo(342.86, 2)

      const blob = persistedBlob()
      expect(blob.remainingToday).toBe(remainingBefore)
      expect(blob.progress).toBe(progressBefore)
    })

    it('never persists a non-finite progress in track mode', () => {
      const { result } = renderHook(() => useBudget())

      act(() => {
        result.current.replaceAll(divergentLegDatesImport('track'))
      })

      const remainingBefore = result.current.remainingToday
      const progressBefore = result.current.progress
      // Track mode has no daily allowance, which is what made the old
      // division-by-zero reachable.
      expect(result.current.dailyAllowance).toBe(0)
      expect(progressBefore).toBe(100)

      act(() => {
        result.current.removeTransfer('tx-div', true)
      })

      // Control: the group really was deleted.
      expect(result.current.transactions.some((t) => t.transferId === 'tx-div')).toBe(false)

      expect(result.current.remainingToday).toBe(remainingBefore)
      expect(result.current.progress).toBe(progressBefore)
      expect(Number.isFinite(result.current.progress)).toBe(true)
      expect(Number.isNaN(result.current.progress)).toBe(false)

      const blob = persistedBlob()
      expect(blob.remainingToday).toBe(remainingBefore)
      // `Infinity` serializes to `null`, and this blob is exactly what the QR
      // sync panel ships to the other device, so the persisted value is the one
      // that matters.
      expect(blob.progress).not.toBeNull()
      expect(blob.progress).toBe(progressBefore)
      expect(Number.isFinite(blob.progress)).toBe(true)
    })
  })
})
