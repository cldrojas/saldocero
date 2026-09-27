'use client'

import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
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
}

export function TransactionHistory({
  accounts,
  transactions,
  removeTransaction
}: TransactionHistoryProps) {
  const { t, language } = useLanguage()
  const { formatCurrency } = useCurrency()
  const [deleteTarget, setDeleteTarget] = useState<{
    transaction: Transaction
    accountName: string
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
  const sortedTransactions = transactions.toSorted(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )

  // Filtering the already-sorted list keeps desktop (table) and mobile (cards)
  // showing exactly the same set.
  const visibleTransactions = accountFilter === null
    ? sortedTransactions
    : sortedTransactions.filter(
      (transaction) => transaction.account === accountFilter
    )

  const handleFilterChange = (value: string) => {
    setAccountFilter(value === allAccountsValue ? null : value)
  }

  const handleDelete = (refund: boolean) => {
    if (!deleteTarget) return
    removeTransaction(deleteTarget.transaction.id, refund)
    setDeleteTarget(null)
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
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
        ) : visibleTransactions.length === 0 ? (
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
                  {visibleTransactions.map((transaction: Transaction) => {
                    const account = accounts.find(
                      (acc) => acc.id === transaction.account
                    )
                    const accountName = account?.name || t('unknownAccount')
                    const description = transaction.description || '—'

                    return (
                      <TableRow key={transaction.id}>
                        <TableCell>
                          {formatTransactionDate(transaction.date, language)}
                        </TableCell>
                        <TableCell>{description}</TableCell>
                        <TableCell className="capitalize">
                          {accountName}
                        </TableCell>
                        <TableCell
                          className={`text-right ${transaction.amount < 0 ? 'text-red-500' : ''}`}
                        >
                          {formatCurrency(Math.abs(transaction.amount))}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            aria-label={`${t('delete')}: ${description}`}
                            title={`${t('delete')}: ${description}`}
                            onClick={() =>
                              setDeleteTarget({
                                transaction,
                                accountName
                              })
                            }
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
              {visibleTransactions.map((transaction: Transaction) => {
                const account = accounts.find(
                  (acc) => acc.id === transaction.account
                )
                const accountName = account?.name || t('unknownAccount')
                const description = transaction.description || '—'

                return (
                  <article
                    key={transaction.id}
                    className="rounded-lg border bg-card p-3 shadow-sm flex items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium leading-5">
                        {description}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <time
                          dateTime={new Date(transaction.date).toISOString()}
                        >
                          {formatTransactionDate(transaction.date, language)}
                        </time>
                        <span aria-hidden="true">•</span>
                        <span className="capitalize break-words">
                          {accountName}
                        </span>
                      </div>
                    </div>
                    <p
                      className={`shrink-0 text-right font-semibold ${transaction.amount < 0 ? 'text-red-500' : ''}`}
                    >
                      {formatCurrency(Math.abs(transaction.amount))}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`${t('delete')}: ${description}`}
                      title={`${t('delete')}: ${description}`}
                      onClick={() =>
                        setDeleteTarget({
                          transaction,
                          accountName
                        })
                      }
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
