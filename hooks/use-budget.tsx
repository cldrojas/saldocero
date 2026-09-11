'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, isSameDay, startOfDay } from 'date-fns'
import { Account, Budget, Transaction, TransactionType } from '@/types'
import { migrateFromLocalStorage } from '@/lib/migrate-localstorage'
import { loadState } from './use-budget-commits'
import {
  computeDailyAllowance,
  computeProgress,
  computeRemainingToday,
  computeUsedToday,
  findDailyAccount,
  getDaysRemaining,
  getToday,
  isDefaultAccountType,
  toDateIso,
  toHookAccount,
  toHookBudget,
} from './use-budget-derivation'
import {
  addAccount as optimisticAddAccount,
  addTransaction as optimisticAddTransaction,
  clearData as optimisticClearData,
  deleteAccount as optimisticDeleteAccount,
  removeTransaction as optimisticRemoveTransaction,
  setupBudget as optimisticSetupBudget,
  transferFunds as optimisticTransferFunds,
  updateAccount as optimisticUpdateAccount,
  updateConfig as optimisticUpdateConfig,
  updateTransaction as optimisticUpdateTransaction,
} from './use-budget-actions'
import * as commits from './use-budget-commits'

const FALLBACK_BUDGET: Budget = {
  startAmount: 0,
  startDate: undefined,
  endDate: undefined,
  autoSave: true,
  mode: 'daily',
}

interface StateSnapshot {
  budget: Budget
  accounts: Account[]
  transactions: Transaction[]
}

/**
 * Hook to manage budget state backed by SQLite server actions.
 *
 * Bootstrap order (task 2.2): migrateFromLocalStorage() runs ONCE before the
 * first loadState(), so legacy localStorage data is present when the DB state
 * is read. All mutations follow the D10 optimistic pattern: local mirror first,
 * server commit second, authoritative reload (loadState) on settle.
 *
 * @returns Object with budget state and functions to manage budget, accounts, and transactions.
 */
export function useBudget() {
  const [budget, setBudget] = useState<Budget>(FALLBACK_BUDGET)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isSetup, setIsSetup] = useState(false)
  const [lastCheckedDay, setLastCheckedDay] = useState<Date>(getToday())

  // Latest committed state visible to stable callbacks (debounce, effects).
  const stateRef = useRef<StateSnapshot>({ budget, accounts, transactions })

  const debounceRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null
    pending: Transaction | null
  }>({ timer: null, pending: null })

  const applyState = useCallback((next: StateSnapshot) => {
    setBudget(next.budget)
    setAccounts(next.accounts)
    setTransactions(next.transactions)
  }, [])

  const refresh = useCallback(async () => {
    const data = await loadState()
    setBudget(toHookBudget(data.budget as Parameters<typeof toHookBudget>[0]))
    setAccounts(data.accounts.map(toHookAccount))
    setTransactions(
      data.transactions.map((t) => ({ ...t, type: t.type as TransactionType }))
    )
    setIsSetup((data.budget as { is_setup?: number }).is_setup === 1)
  }, [])

  // Keep the mutable snapshot in sync after every commit (refs must not be
  // written during render). Declared before the day-change effect so it runs
  // first on every render.
  useEffect(() => {
    stateRef.current = { budget, accounts, transactions }
  })

  // Run a server commit, then reconcile with authoritative server state.
  // On error the optimistic change is discarded (rollback), because loadState
  // reflects the untouched server data.
  const runServer = useCallback(
    async (commit: () => Promise<unknown>) => {
      try {
        await commit()
      } catch (error) {
        console.error('[useBudget] server action failed, reverting', error)
      }
      await refresh()
    },
    [refresh]
  )

  const transferFunds = useCallback(
    ({
      amount,
      fromAccount,
      toAccount,
      description,
    }: {
      amount: number
      fromAccount: string
      toAccount: string
      description?: string
    }) => {
      if (!Number.isFinite(amount) || amount <= 0) return
      const intAmount = Math.floor(amount)
      applyState(
        optimisticTransferFunds(stateRef.current, {
          amount: intAmount,
          fromAccount,
          toAccount,
          description,
        })
      )
      void runServer(() =>
        commits.commitTransferFunds({
          amount: intAmount,
          fromAccount,
          toAccount,
          description,
        })
      )
    },
    [applyState, runServer]
  )

  // ─── Bootstrap: migrate localStorage → SQLite, then load (task 2.2) ────
  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        await migrateFromLocalStorage()
        if (cancelled) return
        await refresh()
      } catch (error) {
        console.error('[useBudget] bootstrap failed', error)
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [refresh])

  // ─── Day change: roll leftover of the previous day into savings ────────
  const dayChangeKey = getToday().getTime()
  useEffect(() => {
    const snapshot = stateRef.current
    if (!isSetup || !lastCheckedDay) return
    const today = startOfDay(new Date())
    if (isSameDay(today, lastCheckedDay)) return

    if (snapshot.budget.autoSave && snapshot.budget.mode !== 'track') {
      const daily = findDailyAccount(snapshot.accounts)
      const savings = snapshot.accounts.find((a) => a.type === 'savings')
      if (!daily || !savings) return

      const yesterday = addDays(today, -1)
      const usedYesterday = snapshot.transactions
        .filter(
          (t) =>
            t.account === daily.id &&
            t.amount < 0 &&
            isSameDay(t.date, yesterday)
        )
        .reduce((sum, t) => sum + Math.abs(t.amount), 0)
      const allowanceYesterday = computeDailyAllowance(
        snapshot.budget,
        snapshot.accounts,
        yesterday
      )
      const leftover = Math.floor(
        Math.max(0, allowanceYesterday - usedYesterday)
      )

      if (leftover > 0) {
        void transferFunds({
          amount: leftover,
          fromAccount: daily.id,
          toAccount: savings.id,
          description: 'Daily budget savings',
        })
      }
    }

    setLastCheckedDay(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayChangeKey])

  // Flush any pending debounced update on unmount.
  useEffect(() => {
    const debounce = debounceRef.current
    return () => {
      if (debounce.timer) {
        clearTimeout(debounce.timer)
      }
      const pending = debounce.pending
      if (pending) {
        void commits.commitUpdateTransaction(pending).catch(() => {
          /* best-effort flush */
        })
      }
    }
  }, [])

  // ─── Derived values ────────────────────────────────────────────────────
  const usedToday = useMemo(
    () => computeUsedToday(accounts, transactions),
    [accounts, transactions]
  )
  const dailyAllowance = useMemo(
    () => computeDailyAllowance(budget, accounts),
    [budget, accounts]
  )
  const remainingToday = useMemo(
    () => computeRemainingToday(dailyAllowance, usedToday),
    [dailyAllowance, usedToday]
  )
  const progress = useMemo(
    () => computeProgress(dailyAllowance, remainingToday),
    [dailyAllowance, remainingToday]
  )

  const getRemainingDays = useCallback(() => {
    return getDaysRemaining(stateRef.current.budget, getToday())
  }, [])

  // ─── Setup / config ────────────────────────────────────────────────────
  const setupBudget = useCallback(
    ({
      startAmount,
      endDate,
      mode = 'daily',
    }: {
      startAmount: number
      endDate?: Date
      mode?: 'daily' | 'track'
    }) => {
      const next = optimisticSetupBudget(stateRef.current, {
        startAmount,
        endDate,
        mode,
      })
      applyState(next)
      setIsSetup(true)
      setLastCheckedDay(getToday())
      void commits.commitSetupBudget({
        startAmount,
        endDate: endDate ? toDateIso(endDate) : undefined,
        mode,
      }).then(refresh)
    },
    [applyState, refresh]
  )

  const updateConfig = useCallback(
    ({
      startAmount,
      endDate,
      mode,
      autoSave,
    }: {
      startAmount?: number
      endDate?: Date
      mode?: 'daily' | 'track'
      autoSave?: boolean
    }) => {
      const next = optimisticUpdateConfig(stateRef.current, {
        startAmount,
        endDate,
        mode,
        autoSave,
      })
      applyState(next)
      void runServer(() =>
        commits.commitUpdateConfig({
          startAmount,
          endDate: endDate !== undefined ? toDateIso(endDate) : undefined,
          mode,
          autoSave,
        })
      )
    },
    [applyState, runServer]
  )

  const toggleAutoSave = useCallback(() => {
    const snapshot = stateRef.current
    applyState({
      ...snapshot,
      budget: { ...snapshot.budget, autoSave: !snapshot.budget.autoSave },
    })
    void runServer(commits.commitToggleAutoSave)
  }, [applyState, runServer])

  const clearData = useCallback(() => {
    applyState(optimisticClearData())
    setIsSetup(false)
    void runServer(commits.commitClearData)
  }, [applyState, runServer])

  // ─── Transactions ──────────────────────────────────────────────────────
  const addTransaction = useCallback(
    ({
      type,
      amount,
      description,
      account,
      date = new Date(),
    }: {
      type: TransactionType
      amount: number
      description: string
      account: string
      date?: Date
    }) => {
      if (!Number.isFinite(amount) || amount <= 0) return
      const intAmount = Math.floor(amount)
      // The modal passes unsigned positive amounts; sign by type (expense → -).
      const signedAmount = type === 'expense' ? -intAmount : intAmount
      const tx = { type, amount: signedAmount, description, account, date }

      applyState(optimisticAddTransaction(stateRef.current, tx))
      void commits.commitAddTransaction(tx)
    },
    [applyState]
  )

  const removeTransaction = useCallback(
    (transactionId: string, refund: boolean = true) => {
      const snapshot = stateRef.current
      if (!snapshot.transactions.some((t) => t.id === transactionId)) return
      applyState(
        optimisticRemoveTransaction(snapshot, transactionId, refund)
      )
      void runServer(() =>
        commits.commitRemoveTransaction(transactionId, refund)
      )
    },
    [applyState, runServer]
  )

  const updateTransaction = useCallback(
    (updatedTransaction: Transaction) => {
      const snapshot = stateRef.current
      if (!snapshot.transactions.some((t) => t.id === updatedTransaction.id)) {
        return
      }
      // Optimistic mirror immediately; server flush is debounced (D10).
      applyState(optimisticUpdateTransaction(snapshot, updatedTransaction))

      const debounce = debounceRef.current
      if (debounce.timer) clearTimeout(debounce.timer)
      debounce.pending = updatedTransaction
      debounce.timer = setTimeout(() => {
        debounce.pending = null
        void commits
          .commitUpdateTransaction(updatedTransaction)
          .catch((error) => {
            console.error('[useBudget] updateTransaction failed', error)
            void refresh()
          })
      }, 300)
    },
    [applyState, refresh]
  )

  // ─── Accounts ──────────────────────────────────────────────────────────
  const addAccount = useCallback(
    (input: Omit<Account, 'id'>) => {
      const { state: next } = optimisticAddAccount(stateRef.current, input)
      applyState(next)
      void commits.commitAddAccount(input).then(refresh)
    },
    [applyState, refresh]
  )

  const updateAccount = useCallback(
    (account: Account) => {
      applyState(optimisticUpdateAccount(stateRef.current, account))
      void runServer(() => commits.commitUpdateAccount(account))
    },
    [applyState, runServer]
  )

  const deleteAccount = useCallback(
    (accountId: string): boolean => {
      const snapshot = stateRef.current
      const target = snapshot.accounts.find((a) => a.id === accountId)
      if (!target || isDefaultAccountType(target.type)) return false

      applyState(optimisticDeleteAccount(snapshot, accountId))
      void runServer(() => commits.commitDeleteAccount(accountId))
      return true
    },
    [applyState, runServer]
  )

  return {
    // Values
    accounts,
    budget,
    dailyAllowance,
    isSetup,
    progress,
    remainingToday,
    transactions,

    // Functions
    addAccount,
    addTransaction,
    clearData,
    deleteAccount,
    getRemainingDays,
    removeTransaction,
    setupBudget,
    setLastCheckedDay,
    toggleAutoSave,
    transferFunds,
    updateAccount,
    updateConfig,
    updateTransaction,
  }
}

export default useBudget