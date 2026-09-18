'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { differenceInDays, startOfDay, isSameDay, isToday } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'
import { Account, Budget, Int, toInt, Transaction, TransactionType } from '@/types'
import { computeDailyMetrics } from '@/lib/daily-metrics'
import type { LegacyImportData } from '@/lib/import-json'

// This would be replaced with actual KV database calls
const LOCAL_STORAGE_KEY = 'daily-budget-data'

// Default account IDs that cannot be deleted
const DEFAULT_ACCOUNT_IDS = ['daily', 'savings', 'investment']

/**
 * Hook to manage budget state.
 * @returns Object with budget state and functions to manage budget, accounts, and transactions.
 * @example
 * const { budget, accounts, transactions, setupBudget, addTransaction } = useBudget();
 */
export function useBudget() {
  const [isSetup, setIsSetup] = useState(false)
  const [budget, setBudget] = useState<Budget>({
    startAmount: 0 as Int,
    endDate: undefined,
    startDate: undefined,
    autoSave: true
  })
  const [accounts, setAccounts] = useState<Account[]>([
    { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 0 as Int, icon: 'wallet' },
    { id: 'savings', name: 'Savings', type: 'savings', balance: 0 as Int, icon: 'piggybank' }
  ])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [dailyAllowance, setDailyAllowance] = useState(0)
  const [remainingToday, setRemainingToday] = useState(0)
  const [progress, setProgress] = useState(100)
  const [lastCheckedDay, setLastCheckedDay] = useState<Date | null>(null)

  const today = useMemo(() => {
    return startOfDay(new Date())
  }, [])

  // Helper functions to check budget mode
  const isDailyMode = useCallback(() => {
    return budget.mode === 'daily' || budget.mode === undefined
  }, [budget.mode])

  const isTrackMode = useCallback(() => {
    return budget.mode === 'track'
  }, [budget.mode])

  // Load data from localStorage on initial render
   
  useEffect(() => {
    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (savedData) {
      const parsedData = JSON.parse(savedData)

      // Convert date strings back to Date objects
      if (parsedData.budget?.endDate) {
        parsedData.budget.endDate = new Date(parsedData.budget.endDate)
      }
      if (parsedData.budget?.startDate) {
        parsedData.budget.startDate = new Date(parsedData.budget.startDate)
      }
      if (parsedData.lastCheckedDay) {
        parsedData.lastCheckedDay = new Date(parsedData.lastCheckedDay)
      }

      // Add default mode if not present (backwards compatibility)
      if (parsedData.budget && !parsedData.budget.mode) {
        parsedData.budget.mode = parsedData.budget.endDate ? 'daily' : 'track'
      }

      setBudget(parsedData.budget || budget) // eslint-disable-line
      setAccounts(parsedData.accounts && parsedData.accounts.length > 0 ? parsedData.accounts : accounts)
      setTransactions(parsedData.transactions || transactions)
      setDailyAllowance(parsedData.dailyAllowance || 0)
      setRemainingToday(parsedData.remainingToday || 0)
      setProgress(parsedData.progress || 100)
      setLastCheckedDay(parsedData.lastCheckedDay || null)
      setIsSetup(parsedData.isSetup || false)
    }
  }, [])

  // Save data to localStorage whenever state changes
  useEffect(() => {
    if (isSetup) {
      localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({
          budget,
          accounts,
          transactions,
          dailyAllowance,
          remainingToday,
          progress,
          lastCheckedDay,
          isSetup
        })
      )
    }
  }, [
    budget,
    accounts,
    transactions,
    dailyAllowance,
    remainingToday,
    progress,
    lastCheckedDay,
    isSetup
  ])

  // Calculate daily allowance based on remaining amount and days
  const calculateDailyAllowance = useCallback(() => {
    // Track mode doesn't have daily allowance
    if (isTrackMode()) return

    if (!budget.endDate) return

    const daysRemaining = differenceInDays(budget.endDate, today) + 1

    if (daysRemaining <= 0) {
      setDailyAllowance(0)
      setRemainingToday(0)
      setProgress(0)
      return
    }

    // Get total balance from main account
    const mainAccount = accounts.find((a) => a.id === 'daily')
    const totalBalance = mainAccount ? mainAccount.balance : 0 as Int

    const newDailyAllowance = totalBalance / daysRemaining
    setDailyAllowance(newDailyAllowance)
    setRemainingToday(newDailyAllowance)
    // Calculate progress as percentage of daily allowance used
    const usedToday = transactions
      .filter((t) => t.account === 'daily' && isToday(t.date))
      .reduce((sum, t) => sum + Math.abs(t.amount), 0)

    const _progress = (remainingToday - usedToday) / newDailyAllowance * 100
    setProgress(_progress)
  }, [budget, accounts, today])

  // Check for day change and update budget
   
  useEffect(() => {
    if (!isSetup) return

    // If this is the first check or a new day has started
    if (!lastCheckedDay || !isSameDay(today, lastCheckedDay)) {
      // If there was a previous day, move remaining amount to savings (only in daily mode)
      if (lastCheckedDay && remainingToday > 0 && isDailyMode() && budget.autoSave) {
        // Add remaining amount to savings and discount from daily
        const updatedAccounts = accounts.map((account) => {
          if (account.id === 'savings') {
            const savingAcc = { ...account, balance: toInt(Math.floor(account.balance) + Math.floor(remainingToday)) ?? 0 as Int }
            return savingAcc
          }
          if (account.id === 'daily') {
            const dailyAcc = { ...account, balance: toInt(Math.floor(account.balance) - Math.floor(remainingToday)) ?? 0 as Int }
            return dailyAcc
          }
          return account
        })

        // Record the transaction
        const savingsTransaction: Transaction = {
          id: uuidv4(),
          type: 'transfer',
          date: today,
          amount: toInt(remainingToday) ?? 0 as Int,
          description: 'Daily budget savings',
          account: 'savings'
        }

        setAccounts(updatedAccounts) // eslint-disable-line
        setTransactions([savingsTransaction, ...transactions])
      }

      // Recalculate daily allowance
      calculateDailyAllowance()

      // Update last checked day
      if (today !== lastCheckedDay) setLastCheckedDay(today)
    }
  }, [isSetup, lastCheckedDay, accounts, calculateDailyAllowance, remainingToday, today, transactions])

  // Get remaining days until end date
  const getRemainingDays = () => {
    if (!budget.endDate) return 0

    return Math.max(0, differenceInDays(budget.endDate, today) + 1)
  }

  // Set up initial budget
  const setupBudget = ({
    startAmount,
    endDate,
    mode = 'daily'
  }: {
    startAmount: Int
    endDate?: Date
    mode?: 'daily' | 'track'
  }) => {

    // Create initial budget
    const newBudget: Budget = {
      startAmount,
      startDate: today,
      endDate,
      autoSave: true,
      mode
    }

    // Update daily account with starting amount
    // In track mode, don't include savings account
    let updatedAccounts = accounts.map((account) => {
      if (account.id === 'daily') {
        return { ...account, balance: startAmount }
      }
      return account
    })

    // Remove savings account in track mode
    if (mode === 'track') {
      updatedAccounts = updatedAccounts.filter(acc => acc.id !== 'savings')
    }

    // Record the initial deposit transaction
    const initialTransaction: Transaction = {
      id: uuidv4(),
      type: 'income',
      date: today,
      amount: startAmount,
      description: 'Initial deposit',
      account: 'daily'
    }

    setBudget(newBudget)
    setAccounts(updatedAccounts)
    setTransactions([initialTransaction])
    setLastCheckedDay(startOfDay(today))
    setIsSetup(true)

    // Calculate initial daily allowance only in daily mode with endDate
    if (mode === 'daily' && endDate) {
      const daysRemaining = differenceInDays(endDate, today) + 1
      const newDailyAllowance = startAmount / daysRemaining
      setDailyAllowance(newDailyAllowance)
      setRemainingToday(newDailyAllowance)
      setProgress(100)
    } else {
      // Track mode or no endDate
      setDailyAllowance(0)
      setRemainingToday(0)
      setProgress(100)
    }
  }

  // Add a new expense by default
  const addTransaction = ({
    type,
    amount,
    description,
    account, // accountId
    date = today
  }: {
    type: TransactionType
    amount: number
    description: string
    account: string
    date?: Date
  }) => {

    if (!isFinite(amount) || amount <= 0) {
      return;
    }

    if (type === 'expense') {

      // Create transaction record
      const transaction = {
        id: uuidv4(),
        type,
        date,
        amount: toInt(-amount) ?? 0 as Int, // Negative for expenses
        description,
        account
      }

      // Update accounts based on expense logic
      let updatedAccounts = [...accounts]

      if (account === 'daily') {
        // If expense is less than or equal to remaining daily amount
        if (amount <= remainingToday) {
          // Simply reduce the remaining amount for today
          setRemainingToday(remainingToday - amount)
          setProgress(((remainingToday - amount) / dailyAllowance) * 100)
          setTransactions([transaction, ...transactions])

          // Update daily account balance
          updatedAccounts = accounts.map((acc) => {
            if (acc.id === 'daily') {
              return { ...acc, balance: toInt(acc.balance - amount) ?? 0 as Int }
            }
            return acc
          })
        } else {
          // Update accounts
          updatedAccounts = accounts.map((acc) => {
            if (acc.id === 'daily') {
              return { ...acc, balance: toInt(acc.balance - amount) ?? 0 as Int }
            }
            return acc
          })

          setTransactions([transaction, ...transactions])
          // Recalculate daily allowance with remaining balance
          const dailyAccount = updatedAccounts.find((acc) => acc.id === 'daily')
          const daysRemaining = differenceInDays(budget.endDate!, today) + 1

          if (daysRemaining > 0 && dailyAccount) {
            const newDailyAllowance = dailyAccount.balance / daysRemaining
            setDailyAllowance(newDailyAllowance)
            setRemainingToday(0)
            setProgress(0)
          }
        }
      } else {
        // For non-daily accounts, simply update the balance
        updatedAccounts = accounts.map((acc) => {
          if (acc.id === account) {
            return { ...acc, balance: toInt(acc.balance - amount) ?? 0 as Int }
          }
          return acc
        })

        setTransactions([transaction, ...transactions])
      }

      setAccounts(updatedAccounts)
    }

    if (type === 'income') {
      // Create transaction record with POSITIVE amount
      const transaction = {
        id: uuidv4(),
        type,
        date,
        amount: toInt(amount) ?? 0 as Int, // Positive for income
        description,
        account
      }

      // Update account balance by adding the income amount
      const updatedAccounts = accounts.map((acc) => {
        if (acc.id === account) {
          return { ...acc, balance: toInt(acc.balance + amount) ?? 0 as Int }
        }
        return acc
      })

      // If daily account in budget mode, also update remainingToday and progress
      if (account === 'daily' && budget.endDate) {
        const daysRemaining = differenceInDays(budget.endDate, today) + 1
        if (daysRemaining > 0) {
          const newDailyAllowance = (accounts.find(a => a.id === 'daily')!.balance + amount) / daysRemaining
          setDailyAllowance(newDailyAllowance)
          setRemainingToday(newDailyAllowance)
          setProgress(100)
        }
      }

      setAccounts(updatedAccounts)
      setTransactions([transaction, ...transactions])
    }
  }

  // Remove an existing transaction
  const removeTransaction = (transactionId: string, refund: boolean = true) => {
    // Get transaction object
    const transaction = transactions.find((t) => t.id === transactionId)
    if (transaction) {
      if (refund) {
        const { account, amount } = transaction
        // Update accounts based on expense logic
        let updatedAccounts = [...accounts]

        updatedAccounts = accounts.map((acc) => {
          if (acc.id === account) {
            return { ...acc, balance: toInt(acc.balance - amount) ?? 0 as Int }
          }
          return acc
        })

        if (isToday(transaction.date)) {
          setRemainingToday(remainingToday - amount)
          setProgress(((remainingToday - amount) / dailyAllowance) * 100)
        }
        setAccounts(updatedAccounts)
      }
      setTransactions(transactions.filter((transaction) => transaction.id !== transactionId))
    }
  }

  const updateTransaction = (updatedTransaction: Transaction) => {
    // Find the original transaction
    const originalTransaction = transactions.find(t => t.id === updatedTransaction.id)
    if (!originalTransaction) return

    // Update the transaction in the list
    const updatedTransactions = transactions.map(t =>
      t.id === updatedTransaction.id ? updatedTransaction : t
    )

    // Recalculate account balances
    let updatedAccounts = [...accounts]

    // First, reverse the original transaction's effect
    updatedAccounts = updatedAccounts.map(acc => {
      if (acc.id === originalTransaction.account) {
        return { ...acc, balance: toInt(acc.balance - originalTransaction.amount) ?? 0 as Int }
      }
      return acc
    })

    // Then apply the updated transaction's effect
    updatedAccounts = updatedAccounts.map(acc => {
      if (acc.id === updatedTransaction.account) {
        return { ...acc, balance: toInt(acc.balance + updatedTransaction.amount) ?? 0 as Int }
      }
      return acc
    })

    setTransactions(updatedTransactions)
    setAccounts(updatedAccounts)

    // If this affects today's remaining amount, recalculate it
    if (isToday(updatedTransaction.date) && updatedTransaction.account === 'daily') {
      // This is a simplified recalculation - in a real app you'd want more sophisticated logic
      const todayExpenses = updatedTransactions
        .filter(t => t.account === 'daily' && t.amount < 0 && isToday(t.date))
        .reduce((sum, t) => sum + Math.abs(t.amount), 0)

      setRemainingToday(Math.max(0, dailyAllowance - todayExpenses))
      setProgress(Math.max(0, ((dailyAllowance - todayExpenses) / dailyAllowance) * 100))
    }
  }

  // Add a new account
  const addAccount = ({
    name,
    type,
    balance = 0 as Int,
    icon = 'wallet'
  }: {
    name: string
    type: string
    balance: Int
    icon: string
  }) => {
    const newAccount = {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      type,
      balance,
      icon
    }

    setAccounts([...accounts, newAccount])

    // If initial balance is provided, create a transaction
    if (balance > 0) {
      const transaction: Transaction = {
        id: uuidv4(),
        type: 'income',
        date: today,
        amount: balance,
        description: `Initial deposit to ${name}`,
        account: newAccount.id
      }

      setTransactions([transaction, ...transactions])
    }
  }

  // Update an existing account
  const updateAccount = (updatedAccount: Account) => {
    // Find the old account before updating
    const oldAccount = accounts.find((a) => a.id === updatedAccount.id)

    const updatedAccounts = accounts.map((account) => {
      if (account.id === updatedAccount.id) {
        return { ...account, ...updatedAccount }
      }
      return account
    })

    setAccounts(updatedAccounts)

    // Create adjustment transaction if the balance changed
    if (oldAccount && oldAccount.balance !== updatedAccount.balance) {
      const delta = toInt(updatedAccount.balance - oldAccount.balance) ?? 0 as Int
      if (delta !== 0) {
        const adjustmentTransaction: Transaction = {
          id: uuidv4(),
          type: 'adjustment',
          amount: delta,
          description: 'Balance adjustment',
          account: updatedAccount.id,
          date: today
        }
        setTransactions([adjustmentTransaction, ...transactions])
      }
    }
  }

  // Delete an account
  const deleteAccount = (accountId: string) => {
    // Don't allow deletion of default accounts
    if (DEFAULT_ACCOUNT_IDS.includes(accountId)) {
      return false
    }

    // Get the account to be deleted
    const accountToDelete = accounts.find((acc) => acc.id === accountId)
    if (!accountToDelete) return false

    // If account has balance, transfer it to savings
    // TODO: If account has balance, ask for save/discard and choose where to save
    if (accountToDelete.balance > 0) {
      // Create transfer transaction
      const transferTransaction: Transaction = {
        id: uuidv4(),
        type: 'income',
        date: today,
        amount: accountToDelete.balance,
        description: `Transfer from deleted account: ${accountToDelete.name}`,
        account: 'savings'
      }

      // Create deletion transaction
      const deletionTransaction: Transaction = {
        id: uuidv4(),
        type: 'transfer',
        date: today,
        amount: toInt(-accountToDelete.balance) ?? 0 as Int,
        description: `Account deleted: ${accountToDelete.name}`,
        account: accountId
      }

      // Update savings account balance
      const updatedAccounts = accounts
        .filter((acc) => acc.id !== accountId)
        .map((acc) => {
          if (acc.id === 'savings') {
            return { ...acc, balance: toInt(acc.balance + accountToDelete.balance) ?? 0 as Int }
          }
          return acc
        })

      setAccounts(updatedAccounts)
      setTransactions([transferTransaction, deletionTransaction, ...transactions])
    } else {
      // Just remove the account if no balance
      setAccounts(accounts.filter((acc) => acc.id !== accountId))
    }

    return true
  }

  // Transfer funds between accounts
  const transferFunds = ({
    amount,
    fromAccount,
    toAccount,
    description
  }: {
    amount: Int
    fromAccount: string
    toAccount: string
    description?: string
  }) => {
    // Create withdrawal transaction
    const withdrawalTransaction: Transaction = {
      id: uuidv4(),
      type: 'expense',
      date: today,
      amount: toInt(-amount) ?? 0 as Int,
      description:
        description || 'Transfer to ' + accounts.find((a) => a.id === toAccount)?.name,
      account: fromAccount
    }

    // Create deposit transaction
    const depositTransaction: Transaction = {
      id: uuidv4(),
      type: 'income',
      date: today,
      amount: amount,
      description:
        description ||
        'Transfer from ' + accounts.find((a) => a.id === fromAccount)?.name,
      account: toAccount
    }

    // Update account balances
    const updatedAccounts = accounts.map((account) => {
      if (account.id === fromAccount) {
        return { ...account, balance: toInt(account.balance - amount) ?? 0 as Int }
      }
      if (account.id === toAccount) {
        return { ...account, balance: toInt(account.balance + amount) ?? 0 as Int }
      }
      return account
    })

    setAccounts(updatedAccounts)
    setTransactions([depositTransaction, withdrawalTransaction, ...transactions])
  }

  // Clear data from localstorage
  const clearData = () => {
    setIsSetup(false)
    localStorage.removeItem(LOCAL_STORAGE_KEY)
  }

  // Toggle auto-save setting
  const toggleAutoSave = () => {
    setBudget((budget) => ({ ...budget, autoSave: !budget.autoSave }))
  }

  // Update budget configuration
  const updateConfig = ({
    startAmount,
    endDate,
    mode,
    autoSave
  }: {
    startAmount?: Int
    endDate?: Date | undefined
    mode?: 'daily' | 'track'
    autoSave?: boolean
  }) => {
    // Get current daily account balance
    const dailyAccount = accounts.find((a) => a.id === 'daily')
    const currentBalance = dailyAccount ? dailyAccount.balance : 0

    // Calculate difference to add or subtract (if startAmount changed)
    const balanceDifference = startAmount !== undefined
      ? toInt(startAmount - budget.startAmount) ?? 0 as Int
      : 0 as Int

    // Determine new mode: explicit or derive from endDate
    const newMode = mode ?? (endDate === undefined ? 'track' : 'daily')

    // Update budget
    const updatedBudget = {
      ...budget,
      startAmount: startAmount ?? budget.startAmount,
      endDate,
      mode: newMode,
      autoSave: autoSave ?? budget.autoSave
    }

    // Update accounts based on mode change
    let updatedAccounts = [...accounts]

    // If switching to track mode, remove savings account
    if (newMode === 'track' && accounts.some(acc => acc.id === 'savings')) {
      updatedAccounts = updatedAccounts.filter(acc => acc.id !== 'savings')
    }

    // If switching from track to daily, add savings account if missing
    if (newMode === 'daily' && !accounts.some(acc => acc.id === 'savings')) {
      updatedAccounts.push({ id: 'savings', name: 'Savings', type: 'savings', balance: 0 as Int, icon: 'piggybank' })
    }

    // Update daily account balance if startAmount changed
    if (balanceDifference !== 0) {
      updatedAccounts = updatedAccounts.map((account) => {
        if (account.id === 'daily') {
          return { ...account, balance: toInt(currentBalance + balanceDifference) ?? 0 as Int }
        }
        return account
      })

      // Create transaction
      const transaction: Transaction = {
        id: uuidv4(),
        type: 'transfer',
        date: today,
        amount: balanceDifference ?? 0 as Int,
        description: 'Budget adjustment',
        account: 'daily'
      }
      setTransactions([transaction, ...transactions])
    }

    setBudget(updatedBudget)
    setAccounts(updatedAccounts)

    // Recalculate daily allowance only in daily mode with endDate
    if (newMode === 'daily' && endDate) {
      const daysRemaining = differenceInDays(endDate, today) + 1
      if (daysRemaining > 0) {
        const newDailyAllowance = (currentBalance + balanceDifference) / daysRemaining
        setDailyAllowance(newDailyAllowance)
        setRemainingToday(newDailyAllowance)
        setProgress(100)
      }
    } else {
      // Track mode or no endDate
      setDailyAllowance(0)
      setRemainingToday(0)
      setProgress(100)
    }
  }

  // Import JSON legacy: reemplaza TODO el estado con los datos del archivo
  // (export de config-form / blob de `daily-budget-data`). Aditiva: no toca la
  // lógica de load/hydration ni el save effect. Normaliza fechas/ids, RECOMPUTA
  // los campos derivados vía helpers puros (no los traídos en el import),
  // persiste el blob EXACTO que el save effect escribiría y setea los estados
  // de React al instante (sin reload). isSetup: true — un import siempre
  // configura la app.
  const replaceAll = (data: LegacyImportData) => {
    const importedBudget = data.budget

    // Fechas: el archivo las trae como strings (JSON.stringify del hook); el
    // estado las necesita como Date y el save effect las vuelve a serializar.
    const parsedStartDate = importedBudget.startDate
      ? new Date(importedBudget.startDate)
      : undefined
    const parsedEndDate = importedBudget.endDate ? new Date(importedBudget.endDate) : undefined

    const nextBudget: Budget = {
      startAmount: toInt(importedBudget.startAmount) ?? 0 as Int,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      autoSave: importedBudget.autoSave ?? true,
      mode: importedBudget.mode,
    }

    // Cuentas: id/icon opcionales en el archivo → mismo default que addAccount.
    const nextAccounts: Account[] = data.accounts.map((acc) => ({
      id: acc.id || acc.name.toLowerCase().replace(/\s+/g, '-'),
      name: acc.name,
      type: acc.type,
      balance: toInt(acc.balance) ?? 0 as Int,
      icon: acc.icon || 'wallet',
      ...(acc.hidden !== undefined ? { hidden: acc.hidden } : {}),
    }))

    const nextTransactions: Transaction[] = data.transactions.map((tx) => {
      const rawDate = tx.date ? new Date(tx.date) : today
      return {
        id: tx.id || uuidv4(),
        type: tx.type as TransactionType,
        amount: toInt(tx.amount) ?? 0 as Int,
        description: tx.description ?? '',
        account: tx.account,
        date: Number.isNaN(rawDate.getTime()) ? today : rawDate,
      }
    })

    // Derivados RECOMPUTADOS desde los datos fuente, no desde el archivo.
    const derived = computeDailyMetrics({
      mode: nextBudget.mode,
      endDate: nextBudget.endDate,
      accounts: nextAccounts,
      transactions: nextTransactions,
      today,
    })

    // lastCheckedDay: se respeta el del archivo si existe y es válido; si no,
    // "hoy" (el day-check effect no debe re-calculcar ni rollover el import).
    const rawLastChecked = data.lastCheckedDay ? new Date(data.lastCheckedDay) : null
    const nextLastCheckedDay =
      rawLastChecked && !Number.isNaN(rawLastChecked.getTime()) ? rawLastChecked : today

    const next = {
      budget: nextBudget,
      accounts: nextAccounts,
      transactions: nextTransactions,
      dailyAllowance: derived.dailyAllowance,
      remainingToday: derived.remainingToday,
      progress: derived.progress,
      lastCheckedDay: nextLastCheckedDay,
      isSetup: true as const,
    }

    // Persistir primero (mismo shape que el save effect) y luego actualizar el
    // estado: el save effect re-escribe exactamente lo mismo.
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next))

    setBudget(nextBudget)
    setAccounts(nextAccounts)
    setTransactions(nextTransactions)
    setDailyAllowance(derived.dailyAllowance)
    setRemainingToday(derived.remainingToday)
    setProgress(derived.progress)
    setLastCheckedDay(nextLastCheckedDay)
    setIsSetup(true)
  }

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
    replaceAll,
    setupBudget,
    setLastCheckedDay,
    toggleAutoSave,
    transferFunds,
    updateAccount,
    updateConfig,
    updateTransaction
  }
}
