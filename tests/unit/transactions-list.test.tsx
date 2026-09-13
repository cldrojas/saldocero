import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { TransactionList } from '@/components/transactions-list'
import { LanguageProvider } from '@/contexts/language-context'
import { CurrencyProvider } from '@/contexts/currency-context'
import { Transaction } from '@/types'

// Mock useBudget to provide accounts without localStorage side effects
vi.mock('@/hooks/use-budget', () => ({
  useBudget: () => ({
    accounts: [
      { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 1000, icon: 'wallet' },
      { id: 'savings', name: 'Savings', type: 'savings', balance: 500, icon: 'piggybank' }
    ]
  })
}))

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <CurrencyProvider>{ui}</CurrencyProvider>
    </LanguageProvider>
  )
}

describe('TransactionList', () => {
  const defaultAccounts = [
    { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 1000, icon: 'wallet' }
  ]

  it('renders expense transactions', () => {
    const transactions: Transaction[] = [
      {
        id: '1',
        type: 'expense',
        amount: -1500,
        description: 'Groceries',
        account: 'daily',
        date: new Date('2024-01-15')
      }
    ]

    renderWithProviders(
      <TransactionList
        transactions={transactions}
        onDelete={vi.fn()}
        openTransactionModal={vi.fn()}
      />
    )

    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  it('excludes adjustment transactions from the expenses list', () => {
    const expenseTransaction: Transaction = {
      id: 'exp-1',
      type: 'expense',
      amount: -1000,
      description: 'Groceries',
      account: 'daily',
      date: new Date('2024-01-15')
    }

    const adjustmentTransaction: Transaction = {
      id: 'adj-1',
      type: 'adjustment',
      amount: -500,
      description: 'Balance adjustment',
      account: 'daily',
      date: new Date('2024-01-15')
    }

    renderWithProviders(
      <TransactionList
        transactions={[expenseTransaction, adjustmentTransaction]}
        onDelete={vi.fn()}
        openTransactionModal={vi.fn()}
      />
    )

    // The expense transaction should be visible
    expect(screen.getByText('Groceries')).toBeInTheDocument()

    // The adjustment transaction should NOT be visible in the expenses list
    expect(screen.queryByText('Balance adjustment')).not.toBeInTheDocument()
  })

  it('excludes income transactions from the expenses list', () => {
    const incomeTransaction: Transaction = {
      id: 'inc-1',
      type: 'income',
      amount: 5000,
      description: 'Paycheck',
      account: 'daily',
      date: new Date('2024-01-15')
    }

    const expenseTransaction: Transaction = {
      id: 'exp-1',
      type: 'expense',
      amount: -2000,
      description: 'Dinner',
      account: 'daily',
      date: new Date('2024-01-15')
    }

    renderWithProviders(
      <TransactionList
        transactions={[incomeTransaction, expenseTransaction]}
        onDelete={vi.fn()}
        openTransactionModal={vi.fn()}
      />
    )

    // The expense transaction should be visible
    expect(screen.getByText('Dinner')).toBeInTheDocument()

    // The income transaction should NOT be visible
    expect(screen.queryByText('Paycheck')).not.toBeInTheDocument()
  })

  it('shows empty state when there are no expenses', () => {
    const transactions: Transaction[] = [
      {
        id: 'adj-1',
        type: 'adjustment',
        amount: -500,
        description: 'Balance adjustment',
        account: 'daily',
        date: new Date('2024-01-15')
      }
    ]

    renderWithProviders(
      <TransactionList
        transactions={transactions}
        onDelete={vi.fn()}
        openTransactionModal={vi.fn()}
      />
    )

    // With only an adjustment transaction (not an expense), the empty state should show
    expect(screen.getByText('No expenses yet')).toBeInTheDocument()
  })
})
