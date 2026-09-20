'use client'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { useLanguage } from '@/contexts/language-context'
import { useCurrency } from '@/contexts/currency-context'
import { formatTransactionDate } from '@/lib/transaction-date'
import type { Account, Transaction } from '@/types'

interface RecentTransactionsProps {
  accounts: Account[]
  transactions: Transaction[]
  /** How many movements to show on the desktop overview. */
  limit?: number
}

/**
 * Desktop overview list of the last N movements (issue #10, Phase B). Reuses the
 * same data access and date formatting as TransactionHistory; the full history
 * surface remains available from the sidebar.
 */
export function RecentTransactions({
  accounts,
  transactions,
  limit = 6
}: RecentTransactionsProps) {
  const { t, language } = useLanguage()
  const { formatCurrency } = useCurrency()

  const recent = transactions
    .toSorted((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('overview.recentTransactions')}</CardTitle>
        <CardDescription>{t('recentExpensesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">
            {t('noTransactions')}
          </p>
        ) : (
          <ul className="divide-y">
            {recent.map((transaction) => {
              const account = accounts.find(
                (acc) => acc.id === transaction.account
              )
              const accountName = account?.name || t('unknownAccount')
              const description = transaction.description || '—'

              return (
                <li
                  key={transaction.id}
                  className="flex items-center gap-3 py-2.5"
                >
                  <time
                    dateTime={new Date(transaction.date).toISOString()}
                    className="w-14 shrink-0 text-sm text-muted-foreground"
                  >
                    {formatTransactionDate(transaction.date, language)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{description}</p>
                    <p className="truncate text-xs text-muted-foreground capitalize">
                      {accountName}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 text-right text-sm font-semibold ${transaction.amount < 0 ? 'text-red-500' : ''}`}
                  >
                    {formatCurrency(Math.abs(transaction.amount))}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}