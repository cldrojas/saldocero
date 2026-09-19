'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useBudget } from '@/hooks/use-budget'
import { HeaderMenu } from '@/components/header-menu'
import { useLanguage } from '@/contexts/language-context'
import { SetupForm } from '@/components/setup-form'
import { DailyBudgetStatus } from '@/components/daily-budget-status'
import { ErrorBoundary, EmptyState } from '@/components/error-boundary'
import Navbar, { type MobileTab } from '@/components/navbar'
import { AppShell } from '@/components/layout/app-shell'
import { AccountsList } from '@/components/accounts-list'
import { RecentTransactions } from '@/components/recent-transactions'
import { TransactionHistory } from '@/components/transaction-history'
import { TransactionModal } from '@/components/modals/transaction-modal'
import { TransferModal } from '@/components/modals/transfer-modal'
import type { AppSurface, Transaction } from '@/types'

/**
 * Main component for the Daily Budget application.
 * Composition root: owns the active surface (shared by the desktop sidebar and
 * the mobile tab chrome) and the new-transaction/transfer modals (openable from
 * both shells). Two responsive surfaces reuse the same content components
 * (issue #10): desktop at lg+ via the sidebar, mobile below lg via the tabs.
 * @returns JSX element for the entire app.
 */
export default function DailyBudgetApp() {
  const { t } = useLanguage()

  const {
    budget,
    accounts,
    transactions,
    dailyAllowance,
    remainingToday,
    progress,
    setupBudget,
    addTransaction,
    updateTransaction,
    addAccount,
    updateAccount,
    deleteAccount,
    isSetup,
    clearData,
    transferFunds,
    updateConfig,
    getRemainingDays,
    removeTransaction
  } = useBudget()

  // Active surface: desktop sidebar (lg+) and mobile tab bar drive the same content.
  const [activeSurface, setActiveSurface] = useState<AppSurface>('overview')

  // Modal state lives here so both the mobile chrome (FAB / tab bar) and the
  // desktop sidebar actions can open the same modals.
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)

  const openNewTransaction = () => {
    setEditingTransaction(null)
    setIsTransactionModalOpen(true)
  }

  const closeTransactionModal = () => {
    setIsTransactionModalOpen(false)
    setEditingTransaction(null)
  }

  // Mobile tabs only expose accounts/history; overview defaults to the accounts
  // tab so first load stays identical to the pre-desktop behavior.
  const activeTab: MobileTab = activeSurface === 'accounts' ? 'accounts' : 'history'

  const handleActiveTabChange = (tab: MobileTab) => setActiveSurface(tab)

  // AccountsList expects on* prop names; Navbar expects the plain names.
  const desktopAccountActions = {
    onAddAccount: addAccount,
    onUpdateAccount: updateAccount,
    onDeleteAccount: deleteAccount
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="container flex items-center justify-between h-16 px-4">
            <h1 className="text-xl font-bold">{t('appName')}</h1>
            <HeaderMenu
              budget={budget}
              onUpdateConfig={updateConfig}
              onClearData={clearData}
            />
          </div>
        </header>

        {!isSetup ? (
          <main className="container px-4 py-6 md:py-10 space-y-8">
            <ErrorBoundary>
              <SetupForm
                onSetup={({ startAmount, endDate, mode }) => {
                  setupBudget({ startAmount, endDate: endDate!, mode })
                }}
              />
            </ErrorBoundary>
          </main>
        ) : accounts.length === 0 ? (
          <main className="container px-4 py-6 md:py-10 space-y-8">
            <ErrorBoundary>
              <EmptyState
                title={t('noAccounts') || 'No accounts available'}
                description={
                  t('noAccountsDescription') ||
                  'Please add an account to get started with transfers.'
                }
                action={
                  <Button
                    onClick={() => {
                      console.log('Add account clicked')
                    }}
                  >
                    {t('addAccount') || 'Add Account'}
                  </Button>
                }
              />
            </ErrorBoundary>
          </main>
        ) : (
          <AppShell
            nav={{ activeSurface, onSurfaceChange: setActiveSurface }}
          >
            {/* Desktop surfaces (lg+): sidebar-driven, no tab switching. */}
            <div className="hidden lg:block space-y-8">
              {activeSurface === 'overview' && (
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
                  <ErrorBoundary>
                    <DailyBudgetStatus
                      budget={budget}
                      dailyAllowance={dailyAllowance}
                      remainingToday={remainingToday}
                      progress={progress}
                      accounts={accounts}
                      remainingDays={getRemainingDays()}
                    />
                  </ErrorBoundary>
                  <div className="min-w-0 space-y-6">
                    <ErrorBoundary>
                      <AccountsList
                        accounts={accounts}
                        budget={budget}
                        {...desktopAccountActions}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <RecentTransactions
                        accounts={accounts}
                        transactions={transactions}
                      />
                    </ErrorBoundary>
                  </div>
                </div>
              )}
              {activeSurface === 'accounts' && (
                <ErrorBoundary>
                  <AccountsList
                    accounts={accounts}
                    budget={budget}
                    {...desktopAccountActions}
                  />
                </ErrorBoundary>
              )}
              {activeSurface === 'history' && (
                <ErrorBoundary>
                  <TransactionHistory
                    accounts={accounts}
                    transactions={transactions}
                    removeTransaction={removeTransaction}
                  />
                </ErrorBoundary>
              )}
            </div>

            {/* Mobile surfaces (below lg): status card + tab chrome, unchanged. */}
            <div className="lg:hidden">
              <div className="space-y-8">
                <ErrorBoundary>
                  <DailyBudgetStatus
                    budget={budget}
                    dailyAllowance={dailyAllowance}
                    remainingToday={remainingToday}
                    progress={progress}
                    accounts={accounts}
                    remainingDays={getRemainingDays()}
                  />
                </ErrorBoundary>

                <Navbar
                  accounts={accounts}
                  budget={budget}
                  transactions={transactions}
                  activeTab={activeTab}
                  onActiveTabChange={handleActiveTabChange}
                  addAccount={addAccount}
                  updateAccount={updateAccount}
                  deleteAccount={deleteAccount}
                  removeTransaction={removeTransaction}
                  onAddTransactionRequest={openNewTransaction}
                  onTransferRequest={() => setIsTransferModalOpen(true)}
                />
              </div>
            </div>
          </AppShell>
        )}
      </div>

      {/* Modals hosted once, shared by the mobile chrome and desktop actions. */}
      <TransactionModal
        isOpen={isTransactionModalOpen}
        onClose={closeTransactionModal}
        onAddTransaction={addTransaction}
        onUpdateTransaction={updateTransaction}
        accounts={accounts}
        remainingToday={remainingToday}
        transaction={editingTransaction}
        key={editingTransaction?.id}
      />

      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        onTransfer={transferFunds}
        accounts={accounts}
      />
    </ErrorBoundary>
  )
}