'use client'

import React, { useState } from 'react'
import { Account, Budget, Int } from '@/types'
import {
  Wallet,
  PiggyBank,
  TrendingUp,
  Edit,
  Eye,
  EyeOff,
  Trash2,
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
  Utensils,
  Plus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { useLanguage } from '@/contexts/language-context'
import { useCurrency } from '@/contexts/currency-context'
import { AccountEditModal } from './modals/account-edit-modal'
import { AccountModal } from './modals/account-modal'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

// Default account IDs that cannot be deleted
const DEFAULT_ACCOUNT_IDS = ['daily', 'savings', 'investment']

// Map of icon IDs to icon components
const iconMap = {
  wallet: Wallet,
  piggybank: PiggyBank,
  trending: TrendingUp,
  creditcard: CreditCard,
  building: Building,
  briefcase: Briefcase,
  gift: Gift,
  heart: Heart,
  home: Home,
  landmark: Landmark,
  plane: Plane,
  shopping: ShoppingBag,
  smartphone: Smartphone,
  utensils: Utensils
}

interface AccountsListProps {
  accounts: Account[]
  budget: Budget
  onAddAccount: (account: Omit<Account, 'id'>) => void
  onUpdateAccount: (account: Account) => void
  onDeleteAccount: (accountId: string) => boolean
}

export function AccountsList({
  accounts,
  budget,
  onAddAccount,
  onUpdateAccount,
  onDeleteAccount
}: AccountsListProps) {
  const { t } = useLanguage()
  const { formatCurrency } = useCurrency()
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  // Filter accounts based on mode (hide savings in track mode)
  const isTrackMode = budget.mode === 'track' || (!budget.mode && !budget.endDate)
  const filteredAccounts = isTrackMode
    ? accounts.filter(acc => acc.id !== 'savings')
    : accounts

  const handleEditClick = (account: Account) => {
    setEditingAccount(account)
    setIsEditModalOpen(true)
  }

  const handleDeleteClick = (account: Account) => {
    setAccountToDelete(account)
    setIsDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (accountToDelete) {
      const success = onDeleteAccount(accountToDelete.id)
      if (success) {
        // Toast handled by parent
      }
    }
    setIsDeleteDialogOpen(false)
    setAccountToDelete(null)
  }

  const handleSaveEdit = (updatedAccount: { id?: string; name: string; balance: Int; icon: string }) => {
    if (editingAccount) {
      onUpdateAccount({
        ...editingAccount,
        ...updatedAccount
      })
    }
  }

  const getAccountIcon = (account: Account) => {
    const IconComponent = iconMap[account.icon as keyof typeof iconMap] || Wallet
    return <IconComponent className="h-5 w-5" />
  }

  const canDeleteAccount = (accountId: string) => {
    return !DEFAULT_ACCOUNT_IDS.includes(accountId)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredAccounts.map((account) => (
          <Card key={account.id} className={account.hidden ? 'opacity-50' : ''}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{account.name}</CardTitle>
              <div className="flex items-center space-x-2">
                <div className="h-5 w-5 text-muted-foreground">
                  {getAccountIcon(account)}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onUpdateAccount({ ...account, hidden: !account.hidden })}
                  title={account.hidden ? t('showAccount') : t('hideAccount')}
                >
                  {account.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleEditClick(account)}
                  title={t('editAccount')}
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                {canDeleteAccount(account.id) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    onClick={() => handleDeleteClick(account)}
                    title={t('deleteAccount')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(account.balance)}</div>
              <p className="text-xs text-muted-foreground">
                {t(account.type)} {t('account')}
              </p>
            </CardContent>
          </Card>
        ))}

        {/* Add new account button as li */}
        <li className="list-none">
          <Button
            variant="outline"
            className="w-full h-full min-h-[100px] flex flex-col items-center justify-center gap-2 border-dashed"
            onClick={() => setIsAccountModalOpen(true)}
          >
            <Plus className="h-8 w-8" />
            <span className="text-sm">{t('addNewAccount')}</span>
          </Button>
        </li>
      </div>

      {/* Account Creation Modal */}
      <AccountModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        onAddAccount={onAddAccount}
        accounts={accounts}
      />

      {/* Account Edit Modal */}
      {editingAccount && (
        <AccountEditModal
          account={editingAccount}
          key={editingAccount?.id}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSave={handleSaveEdit}
        />
      )}

      {/* Delete Account Confirmation Dialog */}
      {isDeleteDialogOpen && accountToDelete && (
        <AlertDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('deleteAccount')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('deleteAccountConfirmation', { name: accountToDelete.name })}
                {accountToDelete.balance > 0 && (
                  <p className="mt-2 font-medium">
                    {t('deleteAccountBalance', {
                      balance: formatCurrency(accountToDelete.balance),
                      savings: t('savings')
                    })}
                  </p>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-destructive text-destructive-foreground"
              >
                {t('delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
