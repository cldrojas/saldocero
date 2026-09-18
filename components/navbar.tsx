'use client'

import { useState } from 'react'
import { AccountsList } from './accounts-list'
import { ErrorBoundary } from './error-boundary'
import { TransactionHistory } from './transaction-history'
import { TransactionModal } from './modals/transaction-modal'
import { TransferModal } from './modals/transfer-modal'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Button } from '@/components/ui/button'
import { ArrowRightLeft, HistoryIcon, Plus, WalletIcon } from 'lucide-react'
import { Account, Budget, Transaction, Int } from '@/types'
import { useLanguage } from '@/contexts/language-context'

interface NavbarProps {
  accounts: Account[]
  budget: Budget
  transactions: Transaction[]
  addAccount: (account: Omit<Account, 'id'>) => void
  updateAccount: (account: Account) => void
  deleteAccount: (accountId: string) => boolean
  addTransaction: (transaction: Omit<Transaction, 'id'>) => void
  updateTransaction: (transaction: Transaction) => void
  removeTransaction: (transactionId: string, refund?: boolean) => void
  transferFunds: (transfer: {
    amount: Int
    fromAccount: string
    toAccount: string
    description?: string
  }) => void
}

export default function Navbar({
  accounts,
  budget,
  transactions,
  addAccount,
  updateAccount,
  deleteAccount,
  addTransaction,
  updateTransaction,
  removeTransaction,
  transferFunds
}: NavbarProps) {
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [editingTransaction, setEditingTransaction] =
    useState<Transaction | null>(null)
  const { t } = useLanguage()

  // Calculate remainingToday for the transaction modal
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayTransactions = transactions.filter((t) => {
    const txDate = new Date(t.date)
    txDate.setHours(0, 0, 0, 0)
    return txDate.getTime() === today.getTime() && t.type === 'expense'
  })
  const totalSpentToday = todayTransactions.reduce(
    (sum, t) => sum + Math.abs(Number(t.amount)),
    0
  )
  const dailyAllowance =
    budget.startAmount && budget.endDate
      ? Math.floor(
          Number(budget.startAmount) /
            Math.ceil(
              (Number(budget.endDate) - Number(budget.startDate)) /
                (1000 * 60 * 60 * 24)
            )
        )
      : 0
  const remainingToday = dailyAllowance - totalSpentToday

  return (
    <ErrorBoundary>
      <Tabs
        defaultValue="accounts"
        className="relative"
      >
        <TabsList className="grid w-full grid-cols-3 h-20 bg-slate-900/40">
          <TabsTrigger
            className="gap-2 min-h-full"
            value="accounts"
          >
            <WalletIcon size={16}></WalletIcon>
            Cuentas
          </TabsTrigger>
          <Button
            className="flex gap-4 rounded-full  "
            onClick={() => setIsTransferModalOpen(true)}
          >
            <ArrowRightLeft className="h-5 w-5" />
            <small className="font-bold">Transferir</small>
          </Button>
          <TabsTrigger
            className="gap-2 min-h-full"
            value="history"
          >
            <HistoryIcon size={16}></HistoryIcon>Historial
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


      {/* Floating Action Button for adding transactions */}
      <Button
        className="fixed bottom-6 right-6 rounded-full h-14 w-14 shadow-lg z-50"
        onClick={() => {
          setEditingTransaction(null)
          setIsTransactionModalOpen(true)
        }}
        title={t('addExpense')}
      >
        <Plus className="h-6 w-6" />
      </Button>

      {/* Transaction Modal */}
      <TransactionModal
        isOpen={isTransactionModalOpen}
        onClose={() => {
          setIsTransactionModalOpen(false)
          setEditingTransaction(null)
        }}
        onAddTransaction={addTransaction}
        onUpdateTransaction={updateTransaction}
        accounts={accounts}
        remainingToday={remainingToday}
        transaction={editingTransaction}
        key={editingTransaction?.id}
      />

      {/* Transfer Modal */}
      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        onTransfer={transferFunds}
        accounts={accounts}
      />
    </ErrorBoundary>
  )
}
