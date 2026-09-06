'use client'

import { v4 as uuidv4 } from 'uuid'
import { Account, Budget, Transaction } from '@/types'
import {
  addTransaction as addTransactionServer,
  removeTransaction as removeTransactionServer,
  updateTransaction as updateTransactionServer,
  transferFunds as transferFundsServer,
} from '@/app/actions/transactions'
import {
  addAccount as addAccountServer,
  updateAccount as updateAccountServer,
  deleteAccount as deleteAccountServer,
} from '@/app/actions/accounts'
import {
  setupBudget as setupBudgetServer,
  updateConfig as updateConfigServer,
  toggleAutoSave as toggleAutoSaveServer,
  clearData as clearDataServer,
} from '@/app/actions/budget'
import { toDateIso } from './use-budget-derivation'

// The full client-side state slice needed by the optimistic transitions.
export interface BudgetState {
  budget: Budget
  accounts: Account[]
  transactions: Transaction[]
}

type Patch = (state: BudgetState) => BudgetState

function patchBalance(accountId: string, delta: number): Patch {
  return (state) => ({
    ...state,
    accounts: state.accounts.map((a) =>
      a.id === accountId ? { ...a, balance: a.balance + delta } : a
    ),
  })
}

function addTransactionLocal(
  state: BudgetState,
  input: Omit<Transaction, 'id'>
): { state: BudgetState; id: string } {
  const id = uuidv4()
  const tx: Transaction = { ...input, id }
  return { state: { ...state, transactions: [tx, ...state.transactions] }, id }
}

/** Optimistic result of adding a transaction (single-account: expense/income/adjustment). */
export function addTransaction(
  state: BudgetState,
  input: Omit<Transaction, 'id'>
): BudgetState {
  const { state: next } = addTransactionLocal(state, input)
  return patchBalance(input.account, input.amount)(next)
}

/** Optimistic result of updating an existing transaction (revert old, apply new). */
export function updateTransaction(
  state: BudgetState,
  updated: Transaction
): BudgetState {
  const existing = state.transactions.find((t) => t.id === updated.id)
  if (!existing) return state

  let next: BudgetState = {
    ...state,
    transactions: state.transactions.map((t) =>
      t.id === updated.id ? updated : t
    ),
  }
  next = patchBalance(existing.account, -existing.amount)(next)
  next = patchBalance(updated.account, updated.amount)(next)
  return next
}

/** Optimistic result of removing a transaction (optionally with a refund). */
export function removeTransaction(
  state: BudgetState,
  id: string,
  refund: boolean
): BudgetState {
  const existing = state.transactions.find((t) => t.id === id)
  if (!existing) return state

  // Removing the record already reverses its effect on the derived balance
  // (refund=true: money comes back, balance restored).
  let next: BudgetState = {
    ...state,
    transactions: state.transactions.filter((t) => t.id !== id),
  }
  next = patchBalance(existing.account, -existing.amount)(next)

  if (!refund) {
    // No refund: the money is gone. Replicate the original amount so the
    // accounting effect persists (mirror of the server's unrefunded replica).
    const replicaTx: Transaction = {
      ...existing,
      id: uuidv4(),
      description: `Unrefunded: ${existing.description}`,
    }
    next = {
      ...next,
      transactions: [replicaTx, ...next.transactions],
    }
    next = patchBalance(existing.account, existing.amount)(next)
  }
  return next
}

/** Optimistic result of a transfer between two accounts. */
export function transferFunds(
  state: BudgetState,
  transfer: {
    amount: number
    fromAccount: string
    toAccount: string
    description?: string
  }
): BudgetState {
  const today = new Date()
  const description = transfer.description || 'Transfer'
  const expense: Transaction = {
    id: uuidv4(),
    type: 'expense',
    amount: -transfer.amount,
    description,
    account: transfer.fromAccount,
    date: today,
  }
  const income: Transaction = {
    id: uuidv4(),
    type: 'income',
    amount: transfer.amount,
    description,
    account: transfer.toAccount,
    date: today,
  }
  let next: BudgetState = {
    ...state,
    transactions: [expense, income, ...state.transactions],
  }
  next = patchBalance(transfer.fromAccount, -transfer.amount)(next)
  next = patchBalance(transfer.toAccount, transfer.amount)(next)
  return next
}

/** Optimistic result of adding an account (with optional initial balance). */
export function addAccount(
  state: BudgetState,
  input: Omit<Account, 'id'>
): { state: BudgetState; id: string } {
  const id = uuidv4()
  const account: Account = { ...input, id }
  let next: BudgetState = {
    ...state,
    accounts: [...state.accounts, account],
  }
  if (input.balance > 0) {
    const initial: Transaction = {
      id: uuidv4(),
      type: 'income',
      amount: input.balance,
      description: 'Saldo inicial',
      account: id,
      date: new Date(),
    }
    next = { ...next, transactions: [initial, ...next.transactions] }
  }
  return { state: next, id }
}

/** Optimistic result of updating an account (patching balance delta as adjustment). */
export function updateAccount(
  state: BudgetState,
  account: Account
): BudgetState {
  const existing = state.accounts.find((a) => a.id === account.id)
  if (!existing) return state

  const delta = account.balance - existing.balance
  let next: BudgetState = {
    ...state,
    accounts: state.accounts.map((a) =>
      a.id === account.id ? { ...a, ...account } : a
    ),
  }

  if (delta !== 0) {
    const adjustment: Transaction = {
      id: uuidv4(),
      type: 'adjustment',
      amount: delta,
      description: 'Ajuste de saldo',
      account: account.id,
      date: new Date(),
    }
    next = { ...next, transactions: [adjustment, ...next.transactions] }
  }
  return next
}

/** Optimistic result of deleting an account. */
export function deleteAccount(state: BudgetState, id: string): BudgetState {
  return {
    ...state,
    accounts: state.accounts.filter((a) => a.id !== id),
    transactions: state.transactions.filter((t) => t.account !== id),
  }
}

/** Optimistic result of setting up the initial budget (mirrors server setupBudget). */
export function setupBudget(
  state: BudgetState,
  args: { startAmount: number; endDate?: Date; mode?: 'daily' | 'track' }
): BudgetState {
  const today = new Date()
  const intAmount = Math.floor(args.startAmount)
  const mode = args.mode ?? 'daily'

  const budget: Budget = {
    ...state.budget,
    startAmount: intAmount,
    startDate: today,
    endDate: mode === 'daily' ? args.endDate : undefined,
    mode,
    autoSave: true,
  }

  let accounts = [...state.accounts]
  const existingDaily = accounts.find((a) => a.type === 'daily')
  if (existingDaily) {
    accounts = accounts.map((a) =>
      a.type === 'daily' ? { ...a, balance: intAmount } : a
    )
  } else {
    accounts.push({
      id: 'daily',
      name: 'Daily Budget',
      type: 'daily',
      balance: intAmount,
      icon: 'wallet',
    })
  }
  if (mode === 'daily' && !accounts.some((a) => a.type === 'savings')) {
    accounts.push({
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 0,
      icon: 'piggybank',
    })
  }

  const initialTransaction: Transaction = {
    id: uuidv4(),
    type: 'income',
    amount: intAmount,
    description: 'Initial deposit',
    account: 'daily',
    date: today,
  }

  return {
    budget,
    accounts,
    transactions: [initialTransaction, ...state.transactions],
  }
}

/** Optimistic result of updating budget configuration (mirrors server updateConfig). */
export function updateConfig(
  state: BudgetState,
  args: {
    startAmount?: number
    endDate?: Date
    mode?: 'daily' | 'track'
    autoSave?: boolean
  }
): BudgetState {
  const currentDaily = state.accounts.find((a) => a.type === 'daily')
  const startingBalance = currentDaily?.balance ?? 0
  const delta = args.startAmount !== undefined
    ? args.startAmount - state.budget.startAmount
    : 0
  const newMode = args.mode ?? (args.endDate === undefined ? 'track' : 'daily')

  const budget: Budget = {
    ...state.budget,
    startAmount: args.startAmount ?? state.budget.startAmount,
    endDate: args.endDate,
    mode: newMode,
    autoSave: args.autoSave ?? state.budget.autoSave,
  }

  let accounts = state.accounts.map((a) =>
    a.type === 'daily' ? { ...a, balance: startingBalance + delta } : a
  )
  if (newMode === 'track') {
    accounts = accounts.filter((a) => a.type !== 'savings')
  } else if (newMode === 'daily' && !accounts.some((a) => a.type === 'savings')) {
    accounts.push({
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 0,
      icon: 'piggybank',
    })
  }

  let transactions = state.transactions
  if (delta !== 0 && currentDaily) {
    const adjustment: Transaction = {
      id: uuidv4(),
      type: 'adjustment',
      amount: delta,
      description: 'Budget adjustment',
      account: currentDaily.id,
      date: new Date(),
    }
    transactions = [adjustment, ...transactions]
  }

  return { budget, accounts, transactions }
}

/** Optimistic result of clearing all data. */
export function clearData(): BudgetState {
  return {
    budget: {
      startAmount: 0,
      startDate: undefined,
      endDate: undefined,
      autoSave: true,
      mode: 'daily',
    },
    accounts: [],
    transactions: [],
  }
}

// ─── Server-side invocations (the "commit" half of the optimistic pattern) ──

export interface TransactionInput {
  type: Transaction['type']
  amount: number
  description: string
  account: string
  date: Date
}

export async function commitAddTransaction(input: TransactionInput): Promise<void> {
  await addTransactionServer({
    type: input.type,
    amount: input.amount,
    description: input.description,
    account_id: input.account,
    date: toDateIso(input.date),
  })
}

export async function commitUpdateTransaction(
  updated: Transaction
): Promise<void> {
  await updateTransactionServer({
    id: updated.id,
    type: updated.type,
    amount: updated.amount,
    description: updated.description,
    account_id: updated.account,
    date: toDateIso(updated.date),
  })
}

export async function commitRemoveTransaction(
  id: string,
  refund: boolean
): Promise<void> {
  await removeTransactionServer(id, refund)
}

export async function commitTransferFunds(transfer: {
  amount: number
  fromAccount: string
  toAccount: string
  description?: string
}): Promise<void> {
  await transferFundsServer({
    amount: transfer.amount,
    from_account_id: transfer.fromAccount,
    to_account_id: transfer.toAccount,
    description: transfer.description,
  })
}

export async function commitAddAccount(input: Omit<Account, 'id'>): Promise<void> {
  await addAccountServer({
    name: input.name,
    type: input.type as 'daily' | 'savings' | 'investment' | 'custom',
    icon: input.icon,
  })
}

export async function commitUpdateAccount(account: Account): Promise<void> {
  await updateAccountServer({
    id: account.id,
    name: account.name,
    type: account.type as 'daily' | 'savings' | 'investment' | 'custom',
    icon: account.icon,
    hidden: account.hidden ? 1 : 0,
  })
}

export async function commitDeleteAccount(id: string): Promise<void> {
  await deleteAccountServer(id)
}

export async function commitSetupBudget(args: {
  startAmount: number
  endDate?: string
  mode?: 'daily' | 'track'
}): Promise<void> {
  await setupBudgetServer({
    startAmount: args.startAmount,
    endDate: args.endDate,
    mode: args.mode,
  })
}

export async function commitUpdateConfig(args: {
  startAmount?: number
  endDate?: string
  mode?: 'daily' | 'track'
  autoSave?: boolean
}): Promise<void> {
  await updateConfigServer({
    startAmount: args.startAmount,
    endDate: args.endDate,
    mode: args.mode,
    autoSave: args.autoSave === undefined ? undefined : args.autoSave ? 1 : 0,
  })
}

export async function commitToggleAutoSave(): Promise<number> {
  const result = await toggleAutoSaveServer()
  return result.autoSave
}

export async function commitClearData(): Promise<void> {
  await clearDataServer()
}
