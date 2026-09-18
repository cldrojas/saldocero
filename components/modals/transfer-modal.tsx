'use client'

import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
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
import { useToast } from '@/hooks/use-toast'
import { useLanguage } from '@/contexts/language-context'
import { Account, Int, toInt } from '@/types'
import { useCurrency } from '@/contexts/currency-context'

interface TransferModalProps {
  isOpen: boolean
  onClose: () => void
  onTransfer: (transfer: {
    amount: Int
    fromAccount: string
    toAccount: string
    description?: string
  }) => void
  accounts: Account[]
}

export function TransferModal({
  isOpen,
  onClose,
  onTransfer,
  accounts
}: TransferModalProps) {
  const { t } = useLanguage()
  const { formatCurrency } = useCurrency()
  const { toast } = useToast()
  const [amount, setAmount] = useState('')
  const [fromAccount, setFromAccount] = useState('')
  const [toAccount, setToAccount] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (!fromAccount || !toAccount) {
      toast({
        title: t('missingAccounts'),
        description: t('missingAccountsDescription'),
        variant: 'destructive'
      })
      return
    }

    if (fromAccount === toAccount) {
      toast({
        title: t('invalidTransfer'),
        description: t('invalidTransferDescription'),
        variant: 'destructive'
      })
      return
    }

    if (!amount || Number.parseFloat(amount) <= 0) {
      toast({
        title: t('invalidAmount'),
        description: t('invalidAmountDescription'),
        variant: 'destructive'
      })
      return
    }

    const transferAmount = toInt(Number.parseFloat(amount))

    if (!transferAmount) {
      toast({
        title: t('invalidAmount'),
        description: t('invalidAmountDescription'),
        variant: 'destructive'
      })
      return
    }

    const sourceAccount = accounts.find((acc) => acc.id === fromAccount)

    if (sourceAccount && sourceAccount.balance < transferAmount) {
      toast({
        title: t('insufficientFunds'),
        description: t('insufficientFundsDescription', {
          account: sourceAccount.name
        }),
        variant: 'destructive'
      })
      return
    }

    onTransfer({
      amount: transferAmount,
      fromAccount,
      toAccount,
      description: description || undefined
    })

    toast({
      title: t('transferSuccess'),
      description: t('transferSuccessDescription')
    })

    // Reset form
    setAmount('')
    setFromAccount('')
    setToAccount('')
    setDescription('')
    onClose()
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onClose}
    >
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              {t('transfer')}
            </DialogTitle>
            <DialogDescription>
              {t('transferDescription') ||
                'Transfer funds between your accounts'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">{t('amount')}</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="fromAccount">{t('fromAccount')}</Label>
              <Select
                value={fromAccount}
                onValueChange={setFromAccount}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('selectAccount')} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem
                      key={acc.id}
                      value={acc.id}
                    >
                      {acc.name} ({formatCurrency(acc.balance)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="toAccount">{t('toAccount')}</Label>
              <Select
                value={toAccount}
                onValueChange={setToAccount}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('selectAccount')} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem
                      key={acc.id}
                      value={acc.id}
                    >
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">{t('description')}</Label>
              <Input
                id="description"
                placeholder={t('optionalDescription') || 'Optional note'}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              {t('cancel')}
            </Button>
            <Button type="submit">
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              {t('transfer')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
