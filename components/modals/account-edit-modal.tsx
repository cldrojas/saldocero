'use client'

import { useState } from 'react'
import {
  Wallet,
  PiggyBank,
  TrendingUp,
  CreditCard,
  Building,
  Briefcase,
  Gift,
  Heart,
  Home,
  Landmark,
  Plane,
  ShoppingBag,
  Smartphone,
  Utensils
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useLanguage } from '@/contexts/language-context'
import { Int, toInt } from '@/types'

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

export function AccountEditModal({ account, isOpen, onClose, onSave }: {
  account: { id: string; name: string; balance: Int; icon: string } | null,
  isOpen: boolean,
  onClose: () => void,
  onSave: (updatedAccount: { id?: string; name: string; balance: Int; icon: string }) => void
}) {
  const { t } = useLanguage()
  const { toast } = useToast()
  const [accountName, setAccountName] = useState(account?.name || '')
  const [accountBalance, setAccountBalance] = useState(toInt(account?.balance || 0))
  const [selectedIcon, setSelectedIcon] = useState(account?.icon || 'wallet')

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

    onSave({
      ...account,
      name: accountName,
      icon: selectedIcon,
      balance: accountBalance || 0 as Int
    })

    toast({
      title: t('accountUpdated'),
      description: t('accountUpdatedDescription', { name: accountName })
    })

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
            <DialogTitle>{t('editAccount')}</DialogTitle>
            <DialogDescription>{t('editAccountDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="accountName">{t('accountName')}</Label>
              <Input
                id="accountName"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder={t('accountNamePlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="accountName">{t('Balance')}</Label>
              <Input
                id="accountBalance"
                value={accountBalance || ''}
                onChange={(e) => setAccountBalance(toInt(Number(e.target.value) || 0))}
                placeholder={t('accountBalancePlaceholder')}
              />
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              {t('cancel')}
            </Button>
            <Button type="submit">{t('saveChanges')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
