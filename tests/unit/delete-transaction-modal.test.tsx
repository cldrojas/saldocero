import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { DeleteTransactionModal } from '@/components/modals/delete-transaction-modal'
import { LanguageProvider } from '@/contexts/language-context'
import { CurrencyProvider } from '@/contexts/currency-context'
import { Transaction, Int } from '@/types'

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <CurrencyProvider>{ui}</CurrencyProvider>
    </LanguageProvider>
  )
}

describe('DeleteTransactionModal', () => {
  const baseTransaction: Transaction = {
    id: '1',
    type: 'expense',
    amount: -1500 as Int,
    description: 'Groceries',
    account: 'daily',
    date: new Date('2024-01-15')
  }

  it('renders when open with transaction details', () => {
    renderWithProviders(
      <DeleteTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        transaction={baseTransaction}
        onDelete={vi.fn()}
        accountName="Daily Budget"
      />
    )

    expect(screen.getByText('What should happen to the balance?')).toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Daily Budget')).toBeInTheDocument()
    expect(screen.getByText('Delete and refund')).toBeInTheDocument()
    expect(screen.getByText('Delete, keep balance')).toBeInTheDocument()
  })

  it('calls onDelete(true) when "Delete and refund" is clicked', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(
      <DeleteTransactionModal
        isOpen={true}
        onClose={onClose}
        transaction={baseTransaction}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByText('Delete and refund'))
    expect(onDelete).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onDelete(false) when "Delete, keep balance" is clicked', () => {
    const onDelete = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(
      <DeleteTransactionModal
        isOpen={true}
        onClose={onClose}
        transaction={baseTransaction}
        onDelete={onDelete}
      />
    )

    fireEvent.click(screen.getByText('Delete, keep balance'))
    expect(onDelete).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not render when transaction is null', () => {
    const { container } = renderWithProviders(
      <DeleteTransactionModal
        isOpen={true}
        onClose={vi.fn()}
        transaction={null}
        onDelete={vi.fn()}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()

    renderWithProviders(
      <DeleteTransactionModal
        isOpen={true}
        onClose={onClose}
        transaction={baseTransaction}
        onDelete={vi.fn()}
      />
    )

    const closeButton = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalled()
  })
})
