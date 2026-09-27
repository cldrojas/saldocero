import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TransactionHistory } from '@/components/transaction-history'
import { LanguageProvider } from '@/contexts/language-context'
import { CurrencyProvider } from '@/contexts/currency-context'
import { Account, Int, Transaction } from '@/types'

const accounts: Account[] = [
  { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 1000 as Int, icon: 'wallet' },
  { id: 'savings', name: 'Savings', type: 'savings', balance: 500 as Int, icon: 'piggybank', hidden: true },
  { id: 'investment', name: 'Investment', type: 'investment', balance: 2000 as Int, icon: 'trending' }
]

// One description per transaction so presence/absence is unambiguous.
const transactions: Transaction[] = [
  { id: 't-rent', type: 'expense', amount: -1200 as Int, description: 'Rent', account: 'daily', date: new Date('2026-01-10') },
  { id: 't-grocery', type: 'expense', amount: -85 as Int, description: 'Groceries', account: 'daily', date: new Date('2026-01-09') },
  { id: 't-dividend', type: 'income', amount: 300 as Int, description: 'Dividend', account: 'investment', date: new Date('2026-01-08') }
]

function renderHistory(overrides: { accounts?: Account[]; transactions?: Transaction[] } = {}) {
  const removeTransaction = vi.fn()
  const result = render(
    <LanguageProvider>
      <CurrencyProvider>
        <TransactionHistory
          accounts={overrides.accounts ?? accounts}
          transactions={overrides.transactions ?? transactions}
          removeTransaction={removeTransaction}
        />
      </CurrencyProvider>
    </LanguageProvider>
  )
  return { ...result, removeTransaction }
}

// The component renders the desktop table and the mobile cards at the same time
// (one is hidden with Tailwind, which jsdom does not apply), so every row's
// description is present twice. Count instead of asserting a single match.
function rowCount(description: string) {
  return screen.queryAllByText(description).length
}

async function selectAccount(name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Filter by account' }))
  const option = await screen.findByRole('option', { name })
  fireEvent.click(option)
}

describe('TransactionHistory account filter', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // Pin the language so assertions do not depend on navigator.language.
    window.localStorage.setItem('language', 'en')
  })

  it('shows every transaction when no account filter is applied', () => {
    renderHistory()

    expect(rowCount('Rent')).toBeGreaterThan(0)
    expect(rowCount('Groceries')).toBeGreaterThan(0)
    expect(rowCount('Dividend')).toBeGreaterThan(0)
  })

  it('offers "all accounts" plus one option per account, including hidden ones', async () => {
    renderHistory()

    fireEvent.click(screen.getByRole('combobox', { name: 'Filter by account' }))
    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent)

    expect(labels).toContain('All accounts')
    expect(labels).toContain('Daily Budget')
    expect(labels).toContain('Savings')
    expect(labels).toContain('Investment')
  })

  it('keeps only the selected account transactions', async () => {
    renderHistory()

    await selectAccount('Investment')

    expect(rowCount('Dividend')).toBeGreaterThan(0)
    expect(rowCount('Rent')).toBe(0)
    expect(rowCount('Groceries')).toBe(0)
  })

  it('switches between accounts without a remount', async () => {
    renderHistory()

    await selectAccount('Investment')
    expect(rowCount('Dividend')).toBeGreaterThan(0)
    expect(rowCount('Rent')).toBe(0)

    await selectAccount('Daily Budget')
    expect(rowCount('Rent')).toBeGreaterThan(0)
    expect(rowCount('Groceries')).toBeGreaterThan(0)
    expect(rowCount('Dividend')).toBe(0)
  })

  it('restores the full list when going back to "all accounts"', async () => {
    renderHistory()

    await selectAccount('Investment')
    expect(rowCount('Rent')).toBe(0)

    await selectAccount('All accounts')
    expect(rowCount('Rent')).toBeGreaterThan(0)
    expect(rowCount('Dividend')).toBeGreaterThan(0)
  })

  it('reports "no transactions in this account" when the active filter matches nothing', async () => {
    renderHistory()

    await selectAccount('Savings')

    expect(screen.getByText('No transactions in this account')).toBeInTheDocument()
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument()
  })

  it('reports "no transactions yet" when there is no data at all, ignoring the filter', () => {
    renderHistory({ transactions: [] })

    expect(screen.getByText('No transactions yet')).toBeInTheDocument()
    expect(screen.queryByText('No transactions in this account')).not.toBeInTheDocument()
  })

  it('does not confuse an account named "All" with the "all accounts" option', async () => {
    // `use-budget#addAccount` derives ids from the name, so an account named
    // "All" really gets id "all". A hardcoded "all" sentinel would make the two
    // options share a value and the filter would silently show everything.
    const colliding: Account[] = [
      { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 0 as Int, icon: 'wallet' },
      { id: 'all', name: 'All', type: 'other', balance: 0 as Int, icon: 'wallet' }
    ]
    const collidingTransactions: Transaction[] = [
      { id: 't-rent', type: 'expense', amount: -1200 as Int, description: 'Rent', account: 'daily', date: new Date('2026-01-10') }
    ]

    renderHistory({ accounts: colliding, transactions: collidingTransactions })

    await selectAccount('All')

    // Filtered to the "All" account, which holds no transactions — not "show all".
    expect(screen.getByText('No transactions in this account')).toBeInTheDocument()
    expect(rowCount('Rent')).toBe(0)
  })

  it('translates the filter labels', () => {
    window.localStorage.setItem('language', 'es')
    renderHistory()

    expect(
      screen.getByRole('combobox', { name: 'Filtrar por cuenta' })
    ).toBeInTheDocument()
  })
})
