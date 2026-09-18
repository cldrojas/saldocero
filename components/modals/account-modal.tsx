'use client'

import { useState } from 'react'
import { Plus, Wallet, PiggyBank, TrendingUp, CreditCard, Building, Briefcase, Gift, Heart, Home, Landmark, Plane, ShoppingBag, Smartphone, Utensils } from 'lucide-react'
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

// Define available icons
const availableIcons = [
  { id: 'wallet', icon: Wallet, name: 'Wallet' },
  { id: 'piggybank', icon: PiggyBank, name: 'Piggy Bank' },
  { id: 'trending', icon: TrendingUp, name: 'Trending' },
  { id: 'creditcard', icon: CreditCard, name: 'Credit Card' },
  { id: 'building', icon: Building, name: 'Building' },
  { id: 'briefcase', icon: Briefcase, name: 'Briefcase' },
  { id: 'gift', icon: Gift, name: 'Gift' },
  { id: 'heart', icon: Heart, name: 'Heart' },
  { id: 'home', icon: Home, name: 'Home' },
  { id: 'landmark', icon: Landmark, name: 'Landmark' },
  { id: 'plane', icon: Plane, name: 'Plane' },
  { id: 'shopping', icon: ShoppingBag, name: 'Shopping' },
  { id: 'smartphone', icon: Smartphone, name: 'Smartphone' },
  { id: 'utensils', icon: Utensils, name: 'Utensils' }
]

export function AccountModal({
  isOpen,
  onClose,
  onAddAccount,
  accounts
}: {
  isOpen: boolean
  onClose: () => void
  onAddAccount: (account: Omit<Account, 'id'>) => void
  accounts: Account[]
}) {
  const { t } = useLanguage()
  const { toast } = useToast()
  const [accountName, setAccountName] = useState('')
  const [accountType, setAccountType] = useState('savings')
  const [selectedIcon, setSelectedIcon] = useState('piggybank')

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (!accountName.trim()) {
      toast({
        title: t('invalidAccountName'),
        description: t('invalidAccountNameDescription'),
        variant: 'destructive'
      })
      return
    }

    onAddAccount({
      name: accountName,
      type: accountType,
      icon: selectedIcon,
      balance: toInt(0) as Int
    })

    toast({
      title: t('accountAdded'),
      description: t('accountAddedDescription', { name: accountName })
    })

    // Reset form
    setAccountName('')
    setAccountType('savings')
    setSelectedIcon('piggybank')
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              {t('addNewAccount')}
            </DialogTitle>
            <DialogDescription>
              {t('createNewAccount')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="accountName">{t('accountName')}</Label>
              <Input
                id="accountName"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder={t('accountNamePlaceholder') || 'Vacation Fund'}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="accountType">{t('accountType')}</Label>
              <Select value={accountType} onValueChange={setAccountType}>
                <SelectTrigger>
                  <SelectValue placeholder={t('selectAccountType')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="savings">{t('savings')}</SelectItem>
                  <SelectItem value="investment">{t('investment')}</SelectItem>
                  <SelectItem value="expense">{t('expense')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('accountIcon')}</Label>
              <div className="grid grid-cols-7 gap-2">
                {availableIcons.map(({ id, icon, name }) => {
                  const IconComponent = icon
                  return (
                    <Button
                      key={id}
                      type="button"
                      variant={selectedIcon === id ? 'default' : 'outline'}
                      className="h-10 w-10 p-0"
                      onClick={() => setSelectedIcon(id)}
                      title={name}
                    >
                      <IconComponent className="h-5 w-5" />
                    </Button>
                  )
                })}
              </div>
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
              <Plus className="mr-2 h-4 w-4" />
              {t('createAccount')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
