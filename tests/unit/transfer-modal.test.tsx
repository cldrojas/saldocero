import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferModal } from '@/components/modals/transfer-modal'
import { LanguageProvider } from '@/contexts/language-context'
import { CurrencyProvider } from '@/contexts/currency-context'
import { Int } from '@/types'

// Mock the DatePicker component to control dates
vi.mock('@/components/date-picker', () => ({
  DatePicker: ({ date, setDate, className }: { date: Date | undefined; setDate: (date: Date) => void; className?: string; allowPrevious?: boolean }) => (
    <div className={className} data-testid="date-picker">
      <input
        id="date"
        type="date"
        value={date ? date.toISOString().split('T')[0] : ''}
        data-testid="transfer-date-input"
        onChange={(e) => {
          if (e.target.value) {
            const [year, month, day] = e.target.value.split('-')
            setDate(new Date(Number(year), Number(month) - 1, Number(day)))
          }
        }}
      />
    </div>
  )
}))

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <LanguageProvider>
      <CurrencyProvider>{ui}</CurrencyProvider>
    </LanguageProvider>
  )
}

describe('TransferModal', () => {
  const accounts = [
    { id: 'daily', name: 'Daily', balance: 1000 as Int, currency: 'USD', type: 'daily' as const, icon: 'wallet' },
    { id: 'savings', name: 'Savings', balance: 500 as Int, currency: 'USD', type: 'savings' as const, icon: 'piggybank' }
  ]

  it('passes selected past date to onTransfer', async () => {
    const user = userEvent.setup()
    const onTransfer = vi.fn()
    const onClose = vi.fn()
    const pastDate = new Date('2024-01-15')

    renderWithProviders(
      <TransferModal
        isOpen={true}
        onClose={onClose}
        onTransfer={onTransfer}
        accounts={accounts}
      />
    )

    await user.type(screen.getByLabelText(/amount/i), '100')
    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(screen.getByRole('option', { name: /Daily/i }))
    await user.click(screen.getAllByRole('combobox')[1])
    await user.click(screen.getByRole('option', { name: /Savings/i }))

    const dateInput = screen.getByTestId('transfer-date-input')
    fireEvent.change(dateInput, { target: { value: '2024-01-15' } })

    await user.click(screen.getByRole('button', { name: /transfer/i }))

    await waitFor(() => {
      expect(onTransfer).toHaveBeenCalled()
    })

    const call = onTransfer.mock.calls[0][0]
    expect(call.date.getFullYear()).toBe(2024)
    expect(call.date.getMonth()).toBe(0)
    expect(call.date.getDate()).toBe(15)
  })

  it('passes today when date is not changed', async () => {
    const user = userEvent.setup()
    const onTransfer = vi.fn()
    const onClose = vi.fn()
    const today = new Date()

    renderWithProviders(
      <TransferModal
        isOpen={true}
        onClose={onClose}
        onTransfer={onTransfer}
        accounts={accounts}
      />
    )

    await user.type(screen.getByLabelText(/amount/i), '100')
    await user.click(screen.getAllByRole('combobox')[0])
    await user.click(screen.getByRole('option', { name: /Daily/i }))
    await user.click(screen.getAllByRole('combobox')[1])
    await user.click(screen.getByRole('option', { name: /Savings/i }))

    await user.click(screen.getByRole('button', { name: /transfer/i }))

    await waitFor(() => {
      expect(onTransfer).toHaveBeenCalled()
    })

    const call = onTransfer.mock.calls[0][0]
    expect(call.date.toDateString()).toBe(today.toDateString())
  })
})
