import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { TransactionModal } from '@/components/modals/transaction-modal'
import { LanguageProvider } from '@/contexts/language-context'
import { CurrencyProvider } from '@/contexts/currency-context'
import { Account, Int } from '@/types'

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <CurrencyProvider>{ui}</CurrencyProvider>
    </LanguageProvider>
  )
}

describe('TransactionModal account selector', () => {
  const accounts: Account[] = [
    { id: 'daily', name: 'Daily Budget', type: 'daily', balance: 1000 as Int, icon: 'wallet' },
    { id: 'savings', name: 'Savings', type: 'savings', balance: 500 as Int, icon: 'piggybank' }
  ]

  function renderModal() {
    return renderWithProviders(
      <TransactionModal
        isOpen={true}
        onClose={vi.fn()}
        onAddTransaction={vi.fn()}
        onUpdateTransaction={vi.fn()}
        accounts={accounts}
        remainingToday={5000}
      />
    )
  }

  it('shows each account balance next to its name in the dropdown', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('combobox'))

    const dailyOption = await screen.findByRole('option', { name: /Daily Budget/ })
    expect(dailyOption).toHaveTextContent('$1.000')

    const savingsOption = await screen.findByRole('option', { name: /Savings/ })
    expect(savingsOption).toHaveTextContent('$500')
  })

  it('keeps the trigger showing only the selected account name', () => {
    renderModal()

    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('Daily Budget')
    expect(trigger).not.toHaveTextContent('$1.000')
  })

  it('marks negative balances in red', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <TransactionModal
        isOpen={true}
        onClose={vi.fn()}
        onAddTransaction={vi.fn()}
        onUpdateTransaction={vi.fn()}
        accounts={[{ id: 'daily', name: 'Daily Budget', type: 'daily', balance: -300 as Int, icon: 'wallet' }]}
        remainingToday={5000}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const option = await screen.findByRole('option', { name: /Daily Budget/ })
    const balance = option.querySelector('span.tabular-nums')
    expect(balance).toHaveTextContent('$-300')
    expect(balance).toHaveClass('text-red-600')
  })
})