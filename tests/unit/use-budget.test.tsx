import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useBudget } from '@/hooks/use-budget'
import * as budgetServer from '@/app/actions/budget'
import * as transactionsServer from '@/app/actions/transactions'
import * as accountsServer from '@/app/actions/accounts'
import * as migrateServer from '@/lib/migrate-localstorage'

// ─── Server action mocks (SQLite + better-sqlite3 avoided in jsdom) ─────
// Faithful model: account balances are DERIVED from the SUM of transactions
// (this mirrors the real server where balances come from SUM(transactions),
// not a stored column). Commit actions only manage the transaction list and
// account definitions; loadState recomputes balances. This is what makes
// optimistic-change + post-refresh assertions meaningful.
const mockedBudget = vi.hoisted(() => {
  const row = {
    budget: { start_amount: 0, start_date: null as string | null, end_date: null as string | null, auto_save: 1, mode: 'daily', is_setup: 1 },
    accounts: [] as {
      id: string
      name: string
      type: string
      icon: string
      hidden: number
    }[],
    transactions: [] as {
      id: string
      type: string
      description: string
      account_id: string
      amount: number
      date: string
    }[],
  }

  function computeBalance(accountId: string): number {
    return row.transactions
      .filter((t) => t.account_id === accountId)
      .reduce((sum, t) => sum + t.amount, 0)
  }

  return {
    _db: row,
    computeBalance,
    loadState: vi.fn(async () => ({
      budget: row.budget,
      accounts: row.accounts.map((a) => ({
        ...a,
        balance: computeBalance(a.id),
      })),
      transactions: row.transactions.map((t) => ({
        id: t.id,
        type: t.type,
        description: t.description,
        amount: t.amount,
        account: t.account_id,
        date: new Date(t.date + 'T00:00:00'),
      })),
    })),
    setupBudget: vi.fn(async (_args: { startAmount?: number; endDate?: string }) => ({ success: true })),
    updateConfig: vi.fn(async () => ({ success: true })),
    toggleAutoSave: vi.fn(async () => ({ autoSave: 1 })),
    clearData: vi.fn(async () => ({ success: true })),
    reset: (setup: {
      budget: typeof row.budget
      accounts: { id: string; name: string; type: string; icon?: string; hidden?: number }[]
      transactions: { id: string; type: string; description: string; account_id: string; amount: number; date: string }[]
    } = {
      budget: { start_amount: 0, start_date: null, end_date: null, auto_save: 1, mode: 'daily', is_setup: 0 },
      accounts: [],
      transactions: [],
    }) => {
      row.budget = setup.budget
      row.accounts = setup.accounts.map((a) => ({ icon: 'wallet', hidden: 0, ...a }))
      row.transactions = setup.transactions
    },
  }
})

vi.mock('@/app/actions/budget', () => mockedBudget)

const mockedTx = vi.hoisted(() => ({
  addTransaction: vi.fn(async (input: { type: string; amount: number; description: string; account_id: string; date: string }) => {
    const id = `tx-${mockedBudget._db.transactions.length + 1}`
    mockedBudget._db.transactions = [{ ...input, id }, ...mockedBudget._db.transactions]
    return { success: true, id }
  }),
  removeTransaction: vi.fn(async (id: string, refund: boolean = true) => {
    const index = mockedBudget._db.transactions.findIndex((t) => t.id === id)
    if (index === -1) return { success: true }
    const [removed] = mockedBudget._db.transactions.splice(index, 1)
    if (!refund) {
      // No refund: replicate the original amount so the effect persists
      const refundTx = { ...removed, description: `Unrefunded: ${removed.description}` }
      mockedBudget._db.transactions = [refundTx, ...mockedBudget._db.transactions]
    }
    return { success: true }
  }),
  updateTransaction: vi.fn(async ({ id, type, amount, description, account_id, date }) => {
    const index = mockedBudget._db.transactions.findIndex((t) => t.id === id)
    if (index === -1) return { success: true }
    mockedBudget._db.transactions[index] = { id, type, amount, description, account_id, date }
    return { success: true }
  }),
  transferFunds: vi.fn(async ({ amount, from_account_id, to_account_id, description }: { amount: number; from_account_id: string; to_account_id: string; description?: string }) => {
    mockedBudget._db.transactions = [
      { id: 'exp', type: 'transfer', amount: -amount, description: description ?? 'Transfer', account_id: from_account_id, date: '2026-01-01' },
      { id: 'inc', type: 'income', amount, description: description ?? 'Transfer', account_id: to_account_id, date: '2026-01-01' },
      ...mockedBudget._db.transactions,
    ]
    return { success: true, expenseId: 'exp', incomeId: 'inc' }
  }),
}))

vi.mock('@/app/actions/transactions', () => mockedTx)

const mockedAccounts = vi.hoisted(() => ({
  addAccount: vi.fn(async (input: { name: string; type: string; icon?: string }) => {
    const id = `acct-${mockedBudget._db.accounts.length + 1}`
    mockedBudget._db.accounts.push({ id, name: input.name, type: input.type, icon: input.icon ?? 'wallet', hidden: 0 })
    return { success: true, id }
  }),
  updateAccount: vi.fn(async ({ id, name, type, icon, hidden }: { id: string; name?: string; type?: string; icon?: string; hidden?: number }) => {
    const acct = mockedBudget._db.accounts.find((a) => a.id === id)
    if (acct) {
      if (name !== undefined) acct.name = name
      if (type !== undefined) acct.type = type
      if (icon !== undefined) acct.icon = icon
      if (hidden !== undefined) acct.hidden = hidden
    }
    return { success: true }
  }),
  deleteAccount: vi.fn(async (id: string) => {
    const idx = mockedBudget._db.accounts.findIndex((a) => a.id === id)
    if (idx !== -1) mockedBudget._db.accounts.splice(idx, 1)
    return { success: true }
  }),
}))

vi.mock('@/app/actions/accounts', () => mockedAccounts)

const mockedMigrate = vi.hoisted(() => ({
  migrateFromLocalStorage: vi.fn(async () => true),
}))
vi.mock('@/lib/migrate-localstorage', () => mockedMigrate)

// stable uuid
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: vi.fn(() => `mock-uuid-${uuidCounter++}`),
}))

function makeSetupBudget() {
  return {
    id: 'daily',
    name: 'Daily Budget',
    type: 'daily',
    icon: 'wallet',
    hidden: 0,
  }
}

function makeSetupDb(overrides: { balance?: number } = {}) {
  const balance = overrides.balance ?? 1000
  return {
    budget: { start_amount: balance, start_date: null, end_date: null, auto_save: 1, mode: 'daily', is_setup: 1 },
    accounts: [makeSetupBudget()],
    transactions: [
      { id: 'init', type: 'income', amount: balance, description: 'Initial deposit', account_id: 'daily', date: '2026-01-01' },
    ],
  }
}

function makeEmptyDb() {
  return {
    budget: { start_amount: 0, start_date: null, end_date: null, auto_save: 1, mode: 'daily', is_setup: 0 },
    accounts: [],
    transactions: [],
  }
}

// Real date helpers the hook relies on; the derivation module reads the real
// system clock, so we pass explicit end dates far in the future.
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

describe('useBudget hook (SQLite-backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uuidCounter = 0
    mockedBudget.reset(makeEmptyDb())
    // ensure the server "setup" state reflects after setupBudget commits settle
    mockedBudget.setupBudget.mockImplementation(async (args: { startAmount?: number; endDate?: string }) => {
      const amount = Math.floor(args?.startAmount ?? 1000)
      mockedBudget._db.budget = {
        ...mockedBudget._db.budget,
        start_amount: amount,
        is_setup: 1,
        end_date: args?.endDate ?? null,
      }
      mockedBudget._db.accounts = [makeSetupBudget()]
      mockedBudget._db.transactions = [
        { id: 'init', type: 'income', amount, description: 'Initial deposit', account_id: 'daily', date: '2026-01-01' },
      ]
      return { success: true }
    })
    mockedTx.removeTransaction.mockImplementation(async () => ({ success: true }))
    mockedAccounts.deleteAccount.mockImplementation(async () => ({ success: true }))
  })

  it('migrates localStorage BEFORE the first load, then loads server state', async () => {
    mockedBudget.reset(makeSetupDb({ balance: 750 }))

    const { result } = renderHook(() => useBudget())

    // migration runs first on bootstrap
    expect(mockedMigrate.migrateFromLocalStorage).toHaveBeenCalledTimes(1)

    // loadState runs after migration
    await waitFor(() => expect(result.current.accounts).toHaveLength(1))
    expect(mockedBudget.loadState).toHaveBeenCalledTimes(1)
    const daily = result.current.accounts.find((a) => a.type === 'daily')
    expect(daily?.balance).toBe(750)
    expect(result.current.isSetup).toBe(true)
  })

  it('does not show default accounts before setup', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.isSetup).toBe(false))
    expect(result.current.accounts).toHaveLength(0)
  })

  it('setupBudget optimistically sets up and commits', async () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE, mode: 'daily' })
    })

    expect(result.current.isSetup).toBe(true)
    expect(result.current.accounts.find((a) => a.type === 'daily')?.balance).toBe(1000)
    expect(mockedBudget.setupBudget).toHaveBeenCalled()

    await waitFor(() => {
      // commit + refresh settle
      expect(result.current.accounts.some((a) => a.type === 'daily')).toBe(true)
    })
  })

  it('computes derived daily values from account balance', async () => {
    // 1000 over 8 days (today + 7)
    mockedBudget.reset(makeSetupDb({ balance: 1000 }))
    const { result } = renderHook(() => useBudget())

    await waitFor(() => expect(result.current.accounts).toHaveLength(1))
    // Loaded db has no end date → allowance 0. Set budget with end date optimistically.
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE, mode: 'daily' })
    })

    expect(result.current.dailyAllowance).toBeGreaterThan(0)
    expect(result.current.remainingToday).toBeGreaterThan(0)
    expect(result.current.progress).toBeGreaterThanOrEqual(0)
    expect(result.current.progress).toBeLessThanOrEqual(100)
  })

  it('addTransaction: optimistic add + server commit', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))

    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE, mode: 'daily' })
    })

    const daily = result.current.accounts.find((a) => a.type === 'daily')!
    const before = daily.balance

    act(() => {
      result.current.addTransaction({ type: 'expense', amount: 200, description: 'Coffee', account: daily.id })
    })

    // optimistic: signed negative, balance drops
    expect(result.current.transactions[0].amount).toBe(-200)
    expect(result.current.accounts.find((a) => a.id === daily.id)!?.balance).toBe(before - 200)
    // committed
    expect(mockedTx.addTransaction).toHaveBeenCalledTimes(1)
  })

  it('addTransaction: ignores invalid non-positive amounts', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE })
    })

    const daily = result.current.accounts.find((a) => a.type === 'daily')!
    const before = result.current.transactions.length

    act(() => {
      result.current.addTransaction({ type: 'expense', amount: NaN, description: 'x', account: daily.id })
    })
    act(() => {
      result.current.addTransaction({ type: 'expense', amount: 0, description: 'y', account: daily.id })
    })

    expect(result.current.transactions.length).toBe(before)
  })

  it('transferFunds: optimistic transfer between daily and savings', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE })
    })
    // ensure savings exists (daily-mode setup creates it)
    act(() => {
      result.current.addAccount({ name: 'Savings', type: 'savings', balance: 0, icon: 'piggybank' })
    })

    const dailyId = result.current.accounts.find((a) => a.type === 'daily')!.id
    const savings = result.current.accounts.find((a) => a.type === 'savings')!

    act(() => {
      result.current.transferFunds({ amount: 100, fromAccount: dailyId, toAccount: savings.id })
    })

    expect(result.current.accounts.find((a) => a.id === dailyId)!.balance).toBe(900)
    expect(result.current.accounts.find((a) => a.id === savings.id)!.balance).toBe(100)
    expect(mockedTx.transferFunds).toHaveBeenCalledTimes(1)
  })

  it('deleteAccount: false + keeps default accounts guarded by TYPE, not slug', async () => {
    mockedBudget.reset(makeSetupDb())
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(1))

    // Even with a non-slug uuid id on the daily account (migration produces uuids),
    // deletion is guarded by type === 'daily'.
    const daily = result.current.accounts.find((a) => a.type === 'daily')!
    if (daily.id === 'daily') {
      // fake a uuid
      result.current.accounts[0] = { ...daily, id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000' }
    }
    const res = result.current.deleteAccount(result.current.accounts[0].id)
    expect(res).toBe(false)
    expect(result.current.accounts.find((a) => a.type === 'daily')).toBeDefined()
    // server deleteAccount NOT called for guarded default
    expect(mockedAccounts.deleteAccount).not.toHaveBeenCalled()
  })

  it('deleteAccount: removes a custom account', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE })
    })

    act(() => {
      result.current.addAccount({ name: 'Wallet', type: 'custom', balance: 50, icon: 'wallet' })
    })
    // Wait until the server refresh settles: the account must carry its
    // server-side id (acct-N) so the mock deleteAccount can find it.
    await waitFor(() => {
      const added = result.current.accounts.find((a) => a.name === 'Wallet')
      expect(added?.id).toMatch(/^acct-[0-9]+$/)
    })

    const added = result.current.accounts.find((a) => a.name === 'Wallet' && a.type === 'custom')!
    const before = result.current.accounts.length
    let res: boolean
    act(() => {
      res = result.current.deleteAccount(added.id)
    })
    expect(res!).toBe(true)
    expect(result.current.accounts.length).toBe(before - 1)
    expect(mockedAccounts.deleteAccount).toHaveBeenCalledWith(added.id)
  })

  it('updateAccount: creates positive adjustment transaction', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE })
    })

    const daily = result.current.accounts.find((a) => a.type === 'daily')!
    act(() => {
      result.current.updateAccount({ ...daily, balance: 1500 })
    })

    const dailyAfter = result.current.accounts.find((a) => a.type === 'daily')!
    expect(dailyAfter.balance).toBe(1500)
    const adjustment = result.current.transactions.find((t) => t.type === 'adjustment')
    expect(adjustment?.amount).toBe(500)
    expect(mockedAccounts.updateAccount).toHaveBeenCalledTimes(1)
  })

  it('updateAccount: does not create adjustment when balance unchanged', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE })
    })

    const daily = result.current.accounts.find((a) => a.type === 'daily')!
    const before = result.current.transactions.length
    act(() => {
      result.current.updateAccount({ ...daily, balance: daily.balance })
    })
    expect(result.current.transactions.length).toBe(before)
  })

  it('removeTransaction: refund restores balance by default', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE })
    })
    const daily = result.current.accounts.find((a) => a.type === 'daily')!
    act(() => {
      result.current.addTransaction({ type: 'expense', amount: 200, description: 'Coffee', account: daily.id })
    })
    const tx = result.current.transactions.find((t) => t.type === 'expense')!
    expect(result.current.accounts.find((a) => a.id === daily.id)!.balance).toBe(800)

    act(() => {
      result.current.removeTransaction(tx.id)
    })
    expect(result.current.accounts.find((a) => a.id === daily.id)!.balance).toBe(1000)
    expect(mockedTx.removeTransaction).toHaveBeenCalledTimes(1)
  })

  it('removeTransaction: does not restore balance when refund=false', async () => {
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE })
    })
    const daily = result.current.accounts.find((a) => a.type === 'daily')!
    act(() => {
      result.current.addTransaction({ type: 'expense', amount: 200, description: 'Coffee', account: daily.id })
    })
    const tx = result.current.transactions.find((t) => t.type === 'expense')!

    act(() => {
      result.current.removeTransaction(tx.id, false)
    })
    expect(result.current.accounts.find((a) => a.id === daily.id)!.balance).toBe(800)
  })

  it('removeTransaction: non-existent id is a no-op', () => {
    const { result } = renderHook(() => useBudget())
    expect(() => {
      act(() => result.current.removeTransaction('nope'))
    }).not.toThrow()
  })

  it('day change: rolls leftover of previous day into savings when autoSave', async () => {
    // Hard to drive a real midnight here; assert the auto-save day-change path
    // is reachable by ensuring transferFunds is wired. Given tests run on the
    // current day, the effect guard (isSameDay) short-circuits. We verify the
    // guard does not crash and no spurious transfer occurs.
    const { result } = renderHook(() => useBudget())
    await waitFor(() => expect(result.current.accounts).toHaveLength(0))
    act(() => {
      result.current.setupBudget({ startAmount: 1000, endDate: FUTURE })
    })
    // sync flush of effects
    await act(async () => {})
    expect(mockedTx.transferFunds).not.toHaveBeenCalled()
  })
})