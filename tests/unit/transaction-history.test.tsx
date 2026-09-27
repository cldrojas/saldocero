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
  const removeTransfer = vi.fn()
  const result = render(
    <LanguageProvider>
      <CurrencyProvider>
        <TransactionHistory
          accounts={overrides.accounts ?? accounts}
          transactions={overrides.transactions ?? transactions}
          removeTransaction={removeTransaction}
          removeTransfer={removeTransfer}
        />
      </CurrencyProvider>
    </LanguageProvider>
  )
  return { ...result, removeTransaction, removeTransfer }
}

// The component renders the desktop table and the mobile cards at the same time
// (one is hidden with Tailwind, which jsdom does not apply), so every row's
// description is present twice. Count instead of asserting a single match.
function rowCount(description: string) {
  return screen.queryAllByText(description).length
}

// The enclosing table row (desktop) or card (mobile) of a rendered entry, so
// assertions can be scoped to one row instead of the whole list.
function rowOf(match: HTMLElement) {
  return match.closest('tr, article') as HTMLElement
}

// The desktop table is the ORDERED surface: one <tr> per row, first cell the
// date, second the description. The mobile cards repeat the same data, so
// reading the table keeps order assertions about order and not about the fact
// that each row is rendered on two surfaces. `getAllByRole('row')` would work
// too, but a direct query keeps the header row out of the picture.
function desktopRows() {
  return Array.from(document.querySelectorAll('tbody tr')).map((tr) => {
    const cells = tr.querySelectorAll('td')
    return {
      date: cells[0]?.textContent?.trim() ?? '',
      description: cells[1]?.textContent?.trim() ?? ''
    }
  })
}

// Row descriptions in render order, for the cases where the rendered date is not
// what is under test. Dates are left out on purpose: the shared `transfer`
// fixture parses its dates as UTC, so its label is timezone-dependent, and a test
// that pins it would only be asserting the runner's timezone.
function desktopDescriptions() {
  return desktopRows().map((row) => row.description)
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

// A transfer as `transferFunds` writes it: two legs, one shared id, and the
// generated default descriptions, which differ by construction ('Transfer to X'
// vs 'Transfer from Y') because the user left the note empty.
const transfer: Transaction[] = [
  {
    id: 'leg-out',
    type: 'expense',
    amount: -4201 as Int,
    description: 'Transfer to Savings',
    account: 'daily',
    date: new Date('2026-01-11'),
    transferId: 'tx-1'
  },
  {
    id: 'leg-in',
    type: 'income',
    amount: 4201 as Int,
    description: 'Transfer from Daily Budget',
    account: 'savings',
    date: new Date('2026-01-11'),
    transferId: 'tx-1'
  }
]

describe('TransactionHistory grouped transfers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('language', 'en')
  })

  it('renders a transfer as one row instead of two legs', () => {
    renderHistory({ transactions: transfer })

    // One row per surface (table + card), and neither raw leg text is on screen.
    expect(rowCount('Transfer between accounts')).toBe(2)
    expect(rowCount('Transfer to Savings')).toBe(0)
    expect(rowCount('Transfer from Daily Budget')).toBe(0)
  })

  it('joins the two accounts with an arrow that screen readers can still read', () => {
    renderHistory({ transactions: transfer })

    const row = rowOf(screen.getAllByText('Transfer between accounts')[0])
    expect(row.textContent).toContain('Daily Budget')
    expect(row.textContent).toContain('Savings')
    // The icon is decorative; the glyph is what survives for assistive tech.
    expect(row.querySelector('svg.lucide-arrow-right')).not.toBeNull()
    expect(row.querySelector('.sr-only')?.textContent).toBe('→')
  })

  it('never colors a transfer amount as a loss', () => {
    renderHistory({ transactions: [...transfer, ...transactions] })

    const transferRow = rowOf(screen.getAllByText('Transfer between accounts')[0])
    expect(transferRow.querySelector('.text-red-500')).toBeNull()

    // A real expense in the same list IS red, so the assertion above is about
    // the transfer and not about a selector that matches nothing anywhere.
    const expenseRow = rowOf(screen.getAllByText('Rent')[0])
    expect(expenseRow.querySelector('.text-red-500')).not.toBeNull()
  })

  it('shows the user note when both legs carry the same description', () => {
    const noted = transfer.map((leg) => ({ ...leg, description: 'Move to savings' }))

    renderHistory({ transactions: noted })

    expect(rowCount('Move to savings')).toBe(2)
    expect(rowCount('Transfer between accounts')).toBe(0)
  })

  it('leaves plain expenses and incomes untouched', () => {
    renderHistory()

    const expenseRow = rowOf(screen.getAllByText('Rent')[0])
    expect(expenseRow.querySelector('svg.lucide-arrow-right')).toBeNull()
    expect(expenseRow.querySelector('.sr-only')).toBeNull()

    const incomeRow = rowOf(screen.getAllByText('Dividend')[0])
    expect(incomeRow.querySelector('svg.lucide-arrow-right')).toBeNull()
  })

  it('keeps single-leg movements as plain rows', () => {
    // The daily auto-save and the budget adjustment are `type: 'transfer'` with a
    // single leg. There is no counterpart to group with, so they must not be
    // collapsed nor relabeled as a transfer.
    const singleLeg: Transaction[] = [
      {
        id: 'auto-save',
        type: 'transfer',
        amount: 500 as Int,
        description: 'Daily budget savings',
        account: 'savings',
        date: new Date('2026-01-11')
      }
    ]

    renderHistory({ transactions: singleLeg })

    expect(rowCount('Daily budget savings')).toBe(2)
    expect(rowCount('Transfer between accounts')).toBe(0)
  })

  it('shows a transfer when the filter matches either of its accounts', async () => {
    renderHistory({ transactions: transfer })

    // Destination only.
    await selectAccount('Savings')
    expect(rowCount('Transfer between accounts')).toBe(2)
    const savingsRow = rowOf(screen.getAllByText('Transfer between accounts')[0])
    // The far side is shown too: the transfer really did touch that account.
    expect(savingsRow.textContent).toContain('Daily Budget')
    expect(savingsRow.textContent).toContain('Savings')

    // Source only.
    await selectAccount('Daily Budget')
    expect(rowCount('Transfer between accounts')).toBe(2)
  })

  it('degrades a one-leg transfer group into a plain row', () => {
    renderHistory({ transactions: [transfer[0]] })

    // The surviving leg keeps its own text: rendering it as a grouped row would
    // mean inventing the counterpart that is not there.
    expect(rowCount('Transfer to Savings')).toBe(2)
    expect(rowCount('Transfer between accounts')).toBe(0)
  })

  it('degrades a three-leg transfer group into plain rows', () => {
    const corrupt: Transaction[] = [
      ...transfer,
      {
        id: 'leg-extra',
        type: 'income',
        amount: 10 as Int,
        description: 'Extra',
        account: 'investment',
        date: new Date('2026-01-11'),
        transferId: 'tx-1'
      }
    ]

    renderHistory({ transactions: corrupt })

    expect(rowCount('Transfer to Savings')).toBe(2)
    expect(rowCount('Transfer from Daily Budget')).toBe(2)
    expect(rowCount('Extra')).toBe(2)
    expect(rowCount('Transfer between accounts')).toBe(0)
  })

  it('falls back to a label when a leg points at a deleted account', () => {
    const orphaned = transfer.map((leg) =>
      leg.id === 'leg-in' ? { ...leg, account: 'gone' } : leg
    )

    renderHistory({ transactions: orphaned })

    // Not the raw i18n key: `unknownAccount` exists in both dictionaries.
    expect(rowCount('Unknown account')).toBe(2)
    expect(screen.queryByText('unknownAccount')).not.toBeInTheDocument()
  })

  it('deletes a grouped row through removeTransfer, not removeTransaction', async () => {
    const { removeTransfer, removeTransaction } = renderHistory({ transactions: transfer })

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete: Transfer between accounts' })[0]
    )
    fireEvent.click(await screen.findByText('Delete, keep balance'))

    // Two removeTransaction calls would resurrect the first deleted leg.
    expect(removeTransfer).toHaveBeenCalledWith('tx-1', false)
    expect(removeTransaction).not.toHaveBeenCalled()
  })

  it('confirms a grouped row with its own label and the from -> to pair', async () => {
    renderHistory({ transactions: transfer })

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete: Transfer between accounts' })[0]
    )

    expect(await screen.findByText('Daily Budget -> Savings')).toBeInTheDocument()
  })

  it('deletes a plain row through removeTransaction', async () => {
    const { removeTransfer, removeTransaction } = renderHistory()

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete: Rent' })[0])
    fireEvent.click(await screen.findByText('Delete and refund'))

    expect(removeTransaction).toHaveBeenCalledWith('t-rent', true)
    expect(removeTransfer).not.toHaveBeenCalled()
  })
})

// Shapes only an import can produce. `replaceAll` keeps the id and the date each
// leg had in the file, and `validateImportJson` checks neither id uniqueness
// nor date coherence between the legs of one `transferId`.
describe('TransactionHistory import-shaped transfers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('language', 'en')
  })

  it('shows the anchor leg date, so a grouped row never reads older than the row above it', () => {
    // The NEGATIVE leg is the older one, so the row's position (anchored on the
    // first-seen = most recent leg) and the date it used to display (taken from
    // the negative leg) disagreed: a row labelled "10 Jan" rendered above a row
    // labelled "12 Jan".
    //
    // Local-time construction, not `new Date('2026-01-15')`: the ISO form is
    // parsed as UTC midnight and would render as the previous day west of
    // Greenwich, making the expected label timezone-dependent.
    const divergentDates: Transaction[] = [
      {
        id: 'div-in',
        type: 'income',
        amount: 300 as Int,
        description: 'Transfer from Daily Budget',
        account: 'savings',
        date: new Date(2026, 0, 15),
        transferId: 'tx-div'
      },
      {
        id: 'div-out',
        type: 'expense',
        amount: -300 as Int,
        description: 'Transfer to Savings',
        account: 'daily',
        date: new Date(2026, 0, 10),
        transferId: 'tx-div'
      }
    ]

    renderHistory({
      transactions: [
        ...divergentDates,
        {
          id: 'noise',
          type: 'expense',
          amount: -50 as Int,
          description: 'Noise',
          account: 'daily',
          date: new Date(2026, 0, 12)
        }
      ]
    })

    // Sorted most-recent-first: the group anchors on its 15 Jan leg and the
    // plain expense lands between it and the now-hidden 10 Jan leg. The whole
    // list is asserted so a row reappearing anywhere is caught too.
    expect(desktopRows()).toEqual([
      { date: '15 Jan', description: 'Transfer between accounts' },
      { date: '12 Jan', description: 'Noise' }
    ])

    // The displayed date is the anchor leg's, not the outgoing leg's.
    const grouped = rowOf(screen.getAllByText('Transfer between accounts')[0])
    expect(grouped.textContent).toContain('15 Jan')
    expect(grouped.textContent).not.toContain('10 Jan')
  })

  it('renders a group once when both legs share the same id', () => {
    // Anchoring the group on leg identity cannot work here: with one shared id
    // BOTH iterations pass an `id === legs[0].id` check, so the row was pushed
    // twice and its content was duplicated on screen.
    const sharedIds = transfer.map((leg) => ({ ...leg, id: 'duplicated' }))

    renderHistory({ transactions: sharedIds })

    // Exactly one row, counted in the rendered output rather than inferred from
    // a console warning.
    expect(desktopDescriptions()).toEqual(['Transfer between accounts'])
    // One per surface (table + card), so the mobile list is not duplicated
    // either.
    expect(rowCount('Transfer between accounts')).toBe(2)
    // And no leg escapes as a plain row.
    expect(rowCount('Transfer to Savings')).toBe(0)
    expect(rowCount('Transfer from Daily Budget')).toBe(0)
  })

  it('never collides a plain row key with a group row key', () => {
    // Both surfaces render one list, so a plain row and a group row share a key
    // scope. An imported transaction whose `id` equals another transaction's
    // `transferId` made the two keys literally equal.
    const colliding: Transaction[] = [
      ...transfer.map((leg) => ({ ...leg, transferId: 'tx-1' })),
      {
        id: 'tx-1',
        type: 'expense',
        amount: -42 as Int,
        description: 'Collides',
        account: 'daily',
        date: new Date(2026, 0, 11)
      }
    ]

    const consoleErrors: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args)
    })

    try {
      renderHistory({ transactions: colliding })
    } finally {
      spy.mockRestore()
    }

    expect(duplicateKeyWarnings(consoleErrors)).toEqual([])
    // Control: both rows really are on screen, so the assertion above is about
    // the keys and not about a list that rendered nothing.
    expect(desktopDescriptions()).toEqual([
      'Collides',
      'Transfer between accounts'
    ])
  })
})

// React reports a duplicate key through console.error. Match on the key itself
// so the assertion survives React changing the surrounding warning copy.
function duplicateKeyWarnings(consoleErrors: unknown[][]) {
  return consoleErrors.filter(([first]) =>
    typeof first === 'string' && first.toLowerCase().includes('same key')
  )
}
