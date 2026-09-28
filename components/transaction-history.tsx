'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useLanguage } from '@/contexts/language-context'
import { useCurrency } from '@/contexts/currency-context'
import { formatTransactionDate } from '@/lib/transaction-date'
import { Account, Transaction } from '@/types'
import { DeleteTransactionModal } from '@/components/modals/delete-transaction-modal'

interface TransactionHistoryProps {
  accounts: Account[]
  transactions: Transaction[]
  removeTransaction: (transactionId: string, refund?: boolean) => void
  // Required, not optional: a grouped row deletes BOTH legs at once, and two
  // `removeTransaction` calls cannot do that (the second one would resurrect
  // the first deleted leg). Making it required lets the compiler guarantee no
  // mount surface is left without a way to delete a transfer.
  removeTransfer: (transferId: string, refund?: boolean) => void
}

/**
 * One rendered entry. A transfer is stored as TWO transactions, so it needs two
 * shapes: `single` for everything that stands alone, `transfer` for a resolved
 * pair. `from` is the outgoing (negative) leg and `to` the incoming one.
 */
type HistoryRow =
  | { kind: 'single'; key: string; transaction: Transaction }
  | {
      kind: 'transfer'
      key: string
      transferId: string
      /**
       * The leg that anchored this row's position in the sorted list (`legs[0]`,
       * the first-seen one, which is the most recent). It is ALSO the leg whose
       * date the row displays: position and label must come from the same leg
       * or the list reads as mis-sorted.
       */
      anchor: Transaction
      from: Transaction
      to: Transaction
    }

/**
 * Render keys are namespaced by row kind. `replaceAll` keeps whatever ids the
 * import file carries and `validateImportJson` checks neither id uniqueness nor
 * a collision between a transaction `id` and a `transferId`, so unprefixed
 * values can genuinely be equal across the two kinds and React would warn about
 * (and mis-reconcile) duplicate keys. The prefix is applied here, once, and
 * `toRowView` reuses the resulting `HistoryRow.key`.
 */
const singleKey = (id: string) => `tx:${id}`
const transferKey = (transferId: string) => `tr:${transferId}`

/**
 * Groups the legs of every transfer into single rows, then applies the account
 * filter to the RESULT.
 *
 * The order is load-bearing: a transfer touches two accounts, so filtering the
 * transactions first would drop one leg and the row would forget the account it
 * also moved money into — the history would silently under-report where the
 * money went.
 */
function buildHistoryRows(
  sortedTransactions: Transaction[],
  accountFilter: string | null
): HistoryRow[] {
  // Legs per transfer id, in arrival (date-descending) order.
  const legsByTransfer = new Map<string, Transaction[]>()
  for (const transaction of sortedTransactions) {
    if (transaction.transferId === undefined) continue
    const legs = legsByTransfer.get(transaction.transferId)
    if (legs) legs.push(transaction)
    else legsByTransfer.set(transaction.transferId, [transaction])
  }

  const rows: HistoryRow[] = []

  // transferIds already emitted in this pass. Membership is what decides
  // whether a group row is emitted, NOT identity of the legs: `replaceAll`
  // keeps whatever ids the import file carries and `validateImportJson` does not
  // check id uniqueness, so two legs of one group can share an `id` and an
  // `id`-anchored check would let both through and render the row twice.
  const emittedTransfers = new Set<string>()

  for (const transaction of sortedTransactions) {
    if (transaction.transferId === undefined) {
      rows.push({ kind: 'single', key: singleKey(transaction.id), transaction })
      continue
    }

    const legs = legsByTransfer.get(transaction.transferId)!

    // EXACTLY two legs is a transfer. Any other count means corrupt data or a
    // half-deleted transfer; rendering those as one row would mean inventing
    // the counterpart that is not there, so each leg degrades to its own row.
    if (legs.length !== 2) {
      rows.push({ kind: 'single', key: singleKey(transaction.id), transaction })
      continue
    }

    // One row per group, no matter how many legs point at it.
    if (emittedTransfers.has(transaction.transferId)) continue
    emittedTransfers.add(transaction.transferId)

    // `from` is the negative leg, `to` the positive one — the same sign
    // convention the whole history already uses. If the signs cannot be told
    // apart, arrival order decides, so the row still renders instead of
    // collapsing or guessing an amount.
    const [first, second] = legs
    const from = first.amount < 0 ? first : second.amount < 0 ? second : first
    const to = from === first ? second : first

    rows.push({
      kind: 'transfer',
      key: transferKey(transaction.transferId),
      transferId: transaction.transferId,
      // `legs[0]` decides the row's position AND supplies the displayed date, so
      // the two cannot disagree. Deriving the date from the negative leg instead
      // put a row labelled with an older date above a row labelled with a newer
      // one whenever the legs carried different dates (reachable via import).
      anchor: legs[0],
      from,
      to
    })
  }

  return rows.filter((row) => {
    if (accountFilter === null) return true
    if (row.kind === 'single') return row.transaction.account === accountFilter
    // A transfer row shows when EITHER account matches, and then it shows BOTH.
    // Hiding the far side would be a lie: the transfer really did touch it.
    return row.from.account === accountFilter || row.to.account === accountFilter
  })
}

/**
 * Everything the table row and the mobile card need, resolved once so the two
 * surfaces cannot drift apart. `accountTo` is only set for transfer rows.
 */
type RowView = {
  key: string
  date: Date
  description: string
  accountFrom: string
  accountTo: string | null
  amount: number
  // Transfers are never negative-colored: the money stayed inside the app.
  isNegative: boolean
  transferId: string | null
}

export function TransactionHistory({
  accounts,
  transactions,
  removeTransaction,
  removeTransfer
}: TransactionHistoryProps) {
  const { t, language } = useLanguage()
  const { formatCurrency } = useCurrency()
  const [deleteTarget, setDeleteTarget] = useState<{
    transaction: Transaction
    accountName: string
    transferId?: string
  } | null>(null)
  // `null` means "no account filter applied". Kept distinct from any account id so
  // the "all accounts" option can never be confused with a real account.
  const [accountFilter, setAccountFilter] = useState<string | null>(null)

  // Radix reserves the empty string, so the "all accounts" option needs a real
  // value. Account ids are user-derived slugs (`use-budget#addAccount` maps a name
  // to `name.toLowerCase().replace(/\s+/g, '-')`), so hardcoding a sentinel would
  // collide with an account literally named e.g. "All": two items sharing one value
  // and a filter that silently keeps showing everything. Derive a value that
  // cannot collide instead.
  const allAccountsValue = useMemo(() => {
    const accountIds = new Set(accounts.map((account) => account.id))
    let candidate = '__all__'
    while (accountIds.has(candidate)) candidate = `_${candidate}`
    return candidate
  }, [accounts])

  // Sort transactions by date descending (most recent first)
  const sortedTransactions = useMemo(
    () => transactions.toSorted(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    ),
    [transactions]
  )

  // Group FIRST, filter the resulting rows second. Filtering the already-grouped
  // rows keeps desktop (table) and mobile (cards) showing exactly the same set.
  const rows = useMemo(
    () => buildHistoryRows(sortedTransactions, accountFilter),
    [sortedTransactions, accountFilter]
  )

  // Account id → display name. Transfers can point at an account the user has
  // since deleted, so this falls back to a label instead of rendering nothing.
  const accountName = (accountId: string) =>
    accounts.find((acc) => acc.id === accountId)?.name || t('unknownAccount')

  const toRowView = (row: HistoryRow): RowView => {
    if (row.kind === 'single') {
      const { transaction } = row
      return {
        key: row.key,
        date: transaction.date,
        description: transaction.description || '—',
        accountFrom: accountName(transaction.account),
        accountTo: null,
        amount: Math.abs(transaction.amount),
        isNegative: transaction.amount < 0,
        transferId: null
      }
    }

    const { from, to } = row

    // A user-supplied note is written to BOTH legs, so two equal non-empty
    // descriptions mean the user wrote it. The generated defaults can never be
    // equal ('Transfer to X' vs 'Transfer from Y' — different prefixes by
    // construction), so anything else is the generic label. Deterministic, not
    // a heuristic guess.
    const sharedNote =
      from.description && from.description === to.description
        ? from.description
        : null

    return {
      key: row.key,
      // The anchor leg, NOT `from`: the anchor is the leg that decided this
      // row's position, so it is the only date that can be consistent with it.
      date: row.anchor.date,
      description: sharedNote || t('transferBetweenAccounts'),
      accountFrom: accountName(from.account),
      accountTo: accountName(to.account),
      // Magnitude of the outgoing leg. Deliberately NOT colored as a loss: the
      // money did not leave the app, and painting it red is exactly the lie
      // this grouping exists to remove.
      amount: Math.abs(from.amount),
      isNegative: false,
      transferId: row.transferId
    }
  }

  const handleFilterChange = (value: string) => {
    setAccountFilter(value === allAccountsValue ? null : value)
  }

  const openDelete = (row: HistoryRow, view: RowView) => {
    setDeleteTarget({
      // For a transfer the modal gets the outgoing leg wearing the row's
      // already-resolved description. The modal only reads `description`,
      // `Math.abs(amount)` and `accountName`, so this is enough for it to
      // confirm the row the user actually clicked.
      transaction: row.kind === 'transfer'
        ? { ...row.from, description: view.description }
        : row.transaction,
      accountName: view.accountTo
        ? `${view.accountFrom} -> ${view.accountTo}`
        : view.accountFrom,
      transferId: view.transferId ?? undefined
    })
  }

  const handleDelete = (refund: boolean) => {
    if (!deleteTarget) return
    if (deleteTarget.transferId !== undefined) {
      removeTransfer(deleteTarget.transferId, refund)
    } else {
      removeTransaction(deleteTarget.transaction.id, refund)
    }
    setDeleteTarget(null)
  }

  return (
    <Card>
      <CardHeader className="flex flex-col items-center gap-4 space-y-0 sm:flex-row sm:justify-between">
        <div className="min-w-0">
          <CardTitle>{t('transactionHistory')}</CardTitle>
          <CardDescription>{t('transactionDescription')}</CardDescription>
        </div>
        <Select
          value={accountFilter === null ? allAccountsValue : accountFilter}
          onValueChange={handleFilterChange}
        >
          <SelectTrigger
            className="w-[11rem] shrink-0"
            aria-label={t('filterByAccount')}
          >
            <SelectValue placeholder={t('allAccounts')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={allAccountsValue}>{t('allAccounts')}</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">
            {t('noTransactions')}
          </p>
        ) : rows.length === 0 ? (
          // The account filter is active and matched nothing. This is deliberately
          // not `noTransactions`: there IS data, it just belongs to other accounts,
          // and claiming otherwise would be a lie.
          <p className="text-center text-muted-foreground py-4">
            {t('noTransactionsInAccount')}
          </p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('date')}</TableHead>
                    <TableHead>{t('description')}</TableHead>
                    <TableHead>{t('account')}</TableHead>
                    <TableHead className="text-right">{t('amount')}</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row: HistoryRow) => {
                    const view = toRowView(row)

                    return (
                      <TableRow key={view.key}>
                        <TableCell>
                          {formatTransactionDate(view.date, language)}
                        </TableCell>
                        <TableCell>{view.description}</TableCell>
                        <TableCell>
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span className="capitalize break-words">
                              {view.accountFrom}
                            </span>
                            {view.accountTo && (
                              <>
                                {/* The icon carries the direction visually; the
                                    sr-only glyph keeps it for screen readers. */}
                                <ArrowRight
                                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <span className="sr-only">→</span>
                                <span className="capitalize break-words">
                                  {view.accountTo}
                                </span>
                              </>
                            )}
                          </span>
                        </TableCell>
                        <TableCell
                          className={`text-right ${view.isNegative ? 'text-red-500' : ''}`}
                        >
                          {formatCurrency(view.amount)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            aria-label={`${t('delete')}: ${view.description}`}
                            title={`${t('delete')}: ${view.description}`}
                            onClick={() => openDelete(row, view)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3 md:hidden">
              {rows.map((row: HistoryRow) => {
                const view = toRowView(row)

                return (
                  <article
                    key={view.key}
                    className="rounded-lg border bg-card p-3 shadow-sm flex items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium leading-5">
                        {view.description}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <time dateTime={new Date(view.date).toISOString()}>
                          {formatTransactionDate(view.date, language)}
                        </time>
                        <span aria-hidden="true">•</span>
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="capitalize break-words">
                            {view.accountFrom}
                          </span>
                          {view.accountTo && (
                            <>
                              <ArrowRight
                                className="h-3.5 w-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span className="sr-only">→</span>
                              <span className="capitalize break-words">
                                {view.accountTo}
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                    <p
                      className={`shrink-0 text-right font-semibold ${view.isNegative ? 'text-red-500' : ''}`}
                    >
                      {formatCurrency(view.amount)}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`${t('delete')}: ${view.description}`}
                      title={`${t('delete')}: ${view.description}`}
                      onClick={() => openDelete(row, view)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </article>
                )
              })}
            </div>
          </>
        )}
      </CardContent>

      <DeleteTransactionModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        transaction={deleteTarget?.transaction ?? null}
        onDelete={handleDelete}
        accountName={deleteTarget?.accountName}
      />
    </Card>
  )
}
