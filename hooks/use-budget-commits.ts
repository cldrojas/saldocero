'use client'

// hooks/use-budget-commits.ts
// Redirect layer: maps the same commit() API shape used by use-budget.tsx
// to the client-side repository instead of Server Actions.
// The pure optimistic transitions in use-budget-actions.ts are untouched.

import { Account, Transaction } from '@/types'
import { getDb } from '@/lib/db/client'
import * as repo from '@/lib/db/repository'
import { toDateIso } from './use-budget-derivation'

// ─── Load ─────────────────────────────────────────────────────────────

export async function loadState() {
  const db = await getDb()
  return repo.loadState(db)
}

// ─── Transactions ─────────────────────────────────────────────────────

export interface TransactionInput {
  type: Transaction['type']
  amount: number
  description: string
  account: string
  date: Date
}

export async function commitAddTransaction(input: TransactionInput): Promise<void> {
  const db = await getDb()
  repo.addTransaction(
    {
      type: input.type,
      amount: input.amount,
      description: input.description,
      account_id: input.account,
      date: toDateIso(input.date),
    },
    db,
  )
}

export async function commitUpdateTransaction(updated: Transaction): Promise<void> {
  const db = await getDb()
  repo.updateTransaction(
    {
      id: updated.id,
      type: updated.type,
      amount: updated.amount,
      description: updated.description,
      account_id: updated.account,
      date: toDateIso(updated.date),
    },
    db,
  )
}

export async function commitRemoveTransaction(id: string, refund: boolean): Promise<void> {
  const db = await getDb()
  repo.removeTransaction(id, refund, db)
}

export async function commitTransferFunds(transfer: {
  amount: number
  fromAccount: string
  toAccount: string
  description?: string
}): Promise<void> {
  const db = await getDb()
  repo.transferFunds(
    {
      amount: transfer.amount,
      from_account_id: transfer.fromAccount,
      to_account_id: transfer.toAccount,
      description: transfer.description,
    },
    db,
  )
}

// ─── Accounts ─────────────────────────────────────────────────────────

export async function commitAddAccount(input: Omit<Account, 'id'>): Promise<void> {
  const db = await getDb()
  repo.addAccount(
    {
      name: input.name,
      type: input.type as 'daily' | 'savings' | 'investment' | 'custom',
      icon: input.icon,
    },
    db,
  )
}

export async function commitUpdateAccount(account: Account): Promise<void> {
  const db = await getDb()
  repo.updateAccount(
    {
      id: account.id,
      name: account.name,
      type: account.type as 'daily' | 'savings' | 'investment' | 'custom',
      icon: account.icon,
      hidden: account.hidden ? 1 : 0,
    },
    db,
  )
}

export async function commitDeleteAccount(id: string): Promise<void> {
  const db = await getDb()
  repo.deleteAccount(id, db)
}

// ─── Budget / config ──────────────────────────────────────────────────

export async function commitSetupBudget(args: {
  startAmount: number
  endDate?: string
  mode?: 'daily' | 'track'
}): Promise<void> {
  const db = await getDb()
  repo.setupBudget(
    {
      startAmount: args.startAmount,
      endDate: args.endDate,
      mode: args.mode,
    },
    db,
  )
}

export async function commitUpdateConfig(args: {
  startAmount?: number
  endDate?: string
  mode?: 'daily' | 'track'
  autoSave?: boolean
}): Promise<void> {
  const db = await getDb()
  repo.updateConfig(
    {
      startAmount: args.startAmount,
      endDate: args.endDate,
      mode: args.mode,
      autoSave: args.autoSave === undefined ? undefined : args.autoSave ? 1 : 0,
    },
    db,
  )
}

export async function commitToggleAutoSave(): Promise<number> {
  const db = await getDb()
  return repo.toggleAutoSave(db).autoSave
}

export async function commitClearData(): Promise<void> {
  const db = await getDb()
  repo.clearData(db)
}
