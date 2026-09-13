import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DailyBudgetStatus } from '@/components/daily-budget-status'
import { LanguageProvider } from '@/contexts/language-context'
import { CurrencyProvider } from '@/contexts/currency-context'
import { Account, Budget } from '@/types'

const trackBudget: Budget = {
  startAmount: 0,
  startDate: new Date(),
  endDate: undefined,
  autoSave: false,
  mode: 'track'
}

const accounts: Account[] = [
  { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 1000, icon: 'wallet' },
  { id: 'savings', name: 'Savings', type: 'savings', balance: 500, icon: 'piggybank', hidden: true },
  { id: 'investment', name: 'Investment', type: 'investment', balance: 2000, icon: 'trending' }
]

function renderWithProviders() {
  return render(
    <LanguageProvider>
      <CurrencyProvider>
        <DailyBudgetStatus
          budget={trackBudget}
          dailyAllowance={0}
          remainingToday={0}
          progress={100}
          accounts={accounts}
          remainingDays={0}
        />
      </CurrencyProvider>
    </LanguageProvider>
  )
}

describe('DailyBudgetStatus hidden accounts', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('excludes hidden accounts from the summed total', () => {
    renderWithProviders()

    // Visible balances: 1000 (daily) + 2000 (investment) = 3000
    expect(screen.getByText(/3\.000/)).toBeInTheDocument()
  })

  it('excludes hidden accounts from the balance dropdown', () => {
    renderWithProviders()

    fireEvent.click(screen.getByRole('combobox'))

    const options = screen.getAllByRole('option')
    const labels = options.map((option) => option.textContent)

    expect(labels).toContain('All accounts')
    expect(labels).toContain('Daily Budget')
    expect(labels).toContain('Investment')
    expect(labels).not.toContain('Savings')
  })

  it('falls back to the total when the selected account is hidden', () => {
    window.localStorage.setItem('dailyBudget:selectedBalanceAccount', 'savings')
    renderWithProviders()

    // 'savings' is hidden → falls back to total of visible accounts (3000)
    expect(screen.getByText(/3\.000/)).toBeInTheDocument()
  })

  it('shows a specific visible account balance when selected', () => {
    window.localStorage.setItem('dailyBudget:selectedBalanceAccount', 'daily')
    renderWithProviders()

    expect(screen.getByText(/1\.000/)).toBeInTheDocument()
  })
})
