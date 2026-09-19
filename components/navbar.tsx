'use client'

import { AccountsList } from './accounts-list'
import { ErrorBoundary } from './error-boundary'
import { TransactionHistory } from './transaction-history'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Button } from '@/components/ui/button'
import { ArrowRightLeft, HistoryIcon, Plus, WalletIcon } from 'lucide-react'
import { Account, Budget, Transaction, type AppSurface } from '@/types'
import { useLanguage } from '@/contexts/language-context'

/** Mobile tab bar surfaces; the wider AppSurface also includes overview/sync/settings. */
export type MobileTab = Extract<AppSurface, 'accounts' | 'history'>

interface NavbarProps {
  accounts: Account[]
  budget: Budget
  transactions: Transaction[]
  activeTab: MobileTab
  onActiveTabChange: (tab: MobileTab) => void
  addAccount: (account: Omit<Account, 'id'>) => void
  updateAccount: (account: Account) => void
  deleteAccount: (accountId: string) => boolean
  removeTransaction: (transactionId: string, refund?: boolean) => void
  onAddTransactionRequest: () => void
  onTransferRequest: () => void
}

/**
 * Mobile chrome: tab bar + tab content + FAB. The active-tab state is owned by
 * the composition root (app/page.tsx) so the desktop sidebar (issue #10,
 * Phase A) drives the same surfaces; FAB and modals are hosted at the root too,
 * so desktop actions can reuse them.
 */
export default function Navbar({
  accounts,
  budget,
  transactions,
  activeTab,
  onActiveTabChange,
  addAccount,
  updateAccount,
  deleteAccount,
  removeTransaction,
  onAddTransactionRequest,
  onTransferRequest
}: NavbarProps) {
  const { t } = useLanguage()

  return (
    <ErrorBoundary>
      {/* Mobile tab chrome. Hidden at lg: the desktop sidebar drives the same state. */}
      <div className="lg:hidden">
        <Tabs
          value={activeTab}
          onValueChange={(value) => onActiveTabChange(value as MobileTab)}
          className="relative"
        >
          <TabsList className="grid w-full grid-cols-3 h-20 bg-slate-900/40">
            <TabsTrigger
              className="gap-2 min-h-full"
              value="accounts"
            >
              <WalletIcon size={16}></WalletIcon>
              {t('accounts')}
            </TabsTrigger>
            <Button
              className="flex gap-4 rounded-full"
              onClick={onTransferRequest}
            >
              <ArrowRightLeft className="h-5 w-5" />
              <small className="font-bold">{t('transfer')}</small>
            </Button>
            <TabsTrigger
              className="gap-2 min-h-full"
              value="history"
            >
              <HistoryIcon size={16}></HistoryIcon>
              {t('history')}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="accounts"
            className="mt-6"
          >
            <ErrorBoundary>
              <AccountsList
                accounts={accounts}
                budget={budget}
                onAddAccount={addAccount}
                onUpdateAccount={updateAccount}
                onDeleteAccount={deleteAccount}
              />
            </ErrorBoundary>
          </TabsContent>

          <TabsContent
            value="history"
            className="mt-6"
          >
            <ErrorBoundary>
              <TransactionHistory
                accounts={accounts}
                transactions={transactions}
                removeTransaction={removeTransaction}
              />
            </ErrorBoundary>
          </TabsContent>
        </Tabs>
      </div>

      {/* Floating Action Button for adding transactions. Hidden at lg where the
          sidebar actions replace it (issue #10, Phase C). */}
      <Button
        className="fixed bottom-6 right-6 rounded-full h-14 w-14 shadow-lg z-50 lg:hidden"
        onClick={onAddTransactionRequest}
        title={t('addExpense')}
      >
        <Plus className="h-6 w-6" />
      </Button>
    </ErrorBoundary>
  )
}