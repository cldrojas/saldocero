'use client'

import { FormEvent, useState } from 'react'
import { Edit, ArrowUpLeft, ArrowDownRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useLanguage } from '@/contexts/language-context'
import { useCurrency } from '@/contexts/currency-context'
import { DatePicker } from '../date-picker'
import { Account, Int, Transaction, TransactionType, toInt } from '@/types'

export function TransactionModal({
  isOpen,
  onClose,
  onAddTransaction,
  onUpdateTransaction,
  accounts,
  remainingToday,
  transaction
}: {
  isOpen: boolean
  onClose: () => void
  onAddTransaction: (transaction: Omit<Transaction, 'id'>) => void
  onUpdateTransaction: (transaction: Transaction) => void
  accounts: Account[]
  remainingToday: number
  transaction?: Transaction | null
}) {
  const { t } = useLanguage()
  const { formatCurrency } = useCurrency()
  const { toast } = useToast()

  // Initialize state from transaction prop (works with component key remount)
  const [amount, setAmount] = useState(() => transaction ? Math.abs(transaction.amount) : 0)
  const [description, setDescription] = useState(() => transaction?.description || '')
  const [date, setDate] = useState(() => transaction ? new Date(transaction.date) : new Date())
  const [account, setAccount] = useState(() => transaction?.account || 'daily')
  const [transactionType, setTransactionType] = useState<TransactionType>(() => transaction?.type || 'expense')

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!amount || amount <= 0) {
      toast({
        title: t('invalidAmount'),
        description: t('invalidAmountDescription'),
        variant: 'destructive'
      })
      return
    }

    if (!Number.isInteger(amount)) {
      toast({
        title: t('invalidAmount'),
        description: 'Amount must be a whole number',
        variant: 'destructive'
      })
      return
    }

    if (transaction) {
      // Update existing transaction
      onUpdateTransaction({
        ...transaction,
        type: transactionType,
        amount: toInt(transaction.amount < 0 ? -amount : amount) as Int, // Preserve sign
        description,
        account,
        date
      })

      toast({
        title: t('transactionUpdated'),
        description: t('transactionUpdatedDescription', { amount: formatCurrency(amount) })
      })
    } else {
      // Add new transaction
      onAddTransaction({
        type: transactionType,
        amount: toInt(amount) as Int,
        description,
        account,
        date
      })

      if (transactionType === 'income') {
        toast({
          title: t('incomeAdded'),
          description: t('incomeAddedDescription', { amount: formatCurrency(amount) })
        })
      } else {
        toast({
          title: t('expenseAdded'),
          description: t('expenseAddedDescription', { amount: formatCurrency(amount) })
        })
      }
    }

    onClose()
  }

  const isEditing = !!transaction
  const selectedAccount = accounts.find((acc) => acc.id === account)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onClose}
    >
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditing ? (
              t('editTransaction')
            ) : transactionType === 'income' ? (
              <>
                <ArrowUpLeft className="h-5 w-5 text-green-600 dark:text-green-500" />
                {t('addIncome')}
              </>
            ) : (
              <>
                <ArrowDownRight className="h-5 w-5 text-red-600 dark:text-red-500" />
                {t('addExpense')}
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isEditing ? t('editTransactionDescription') : transactionType === 'income' ? t('addIncomeDescription') : t('addExpenseDescription')}
          </DialogDescription>
        </DialogHeader>
        {!isEditing && (
          <Tabs 
            value={transactionType} 
            onValueChange={(v) => setTransactionType(v as TransactionType)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger 
                value="expense"
                className="flex items-center gap-2 data-[state=active]:text-red-600 data-[state=active]:dark:text-red-500"
              >
                <ArrowDownRight className="h-4 w-4" />
                {t('expenses')}
              </TabsTrigger>
              <TabsTrigger 
                value="income"
                className="flex items-center gap-2 data-[state=active]:text-green-600 data-[state=active]:dark:text-green-500"
              >
                <ArrowUpLeft className="h-4 w-4" />
                {t('income')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 pt-4"
        >
          <div className="space-y-2">
            <Label htmlFor="amount">{t('amount')}</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.valueAsNumber || 0)}
              required
            />
            {!isEditing && transactionType === 'expense' && amount > remainingToday && (
              <p className="text-sm text-yellow-500 dark:text-yellow-400">
                {t('expenseExceedsWarning')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('description')}</Label>
            <Textarea
              id="description"
              placeholder={transactionType === 'income' ? t('whatIncomeFor') : t('whatExpenseFor')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="account">{t('account')}</Label>
            <Select
              value={account}
              onValueChange={setAccount}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('selectAccount')}>
                  {selectedAccount?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {accounts.map((acc) => (
                  <SelectItem
                    key={acc.id}
                    value={acc.id}
                  >
                    <span className="flex w-full items-center justify-between gap-4">
                      <span>{acc.name}</span>
                      <span className={`tabular-nums ${acc.balance < 0 ? 'text-red-600 dark:text-red-500' : 'text-muted-foreground'}`}>
                        {formatCurrency(acc.balance)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">{t('date')}</Label>
            <DatePicker
              date={date}
              setDate={setDate}
              className="w-full"
              allowPrevious
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              {t('cancel')}
            </Button>
            <Button 
              type="submit"
              variant={isEditing ? 'default' : transactionType === 'income' ? 'income' : 'destructive'}
            >
              {isEditing ? (
                <>
                  <Edit className="mr-2 h-4 w-4" />
                  {t('updateTransaction')}
                </>
              ) : transactionType === 'income' ? (
                <>
                  <ArrowUpLeft className="mr-2 h-4 w-4" />
                  {t('addIncome')}
                </>
              ) : (
                <>
                  <ArrowDownRight className="mr-2 h-4 w-4" />
                  {t('addExpense')}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
