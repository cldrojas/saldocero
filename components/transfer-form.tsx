"use client"

import React, { useState } from "react"
import { Account, Int, toInt } from "@/types"
import { ArrowRightLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useLanguage } from "@/contexts/language-context"
import { useCurrency } from "@/contexts/currency-context"
import { EmptyState } from "@/components/error-boundary"

interface TransferFormProps {
  accounts: Account[]
  onTransfer: (transfer: { amount: Int; fromAccount: string; toAccount: string; description?: string }) => void
}

export function TransferForm({ accounts, onTransfer }: TransferFormProps) {
  const { t } = useLanguage()
  const { formatCurrency } = useCurrency()
  const { toast } = useToast()
  const [amount, setAmount] = useState("")
  const [fromAccount, setFromAccount] = useState("")
  const [toAccount, setToAccount] = useState("")
  const [description, setDescription] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!fromAccount || !toAccount) {
      toast({
        title: t("missingAccounts"),
        description: t("missingAccountsDescription"),
        variant: "destructive",
      })
      return
    }

    if (fromAccount === toAccount) {
      toast({
        title: t("invalidTransfer"),
        description: t("invalidTransferDescription"),
        variant: "destructive",
      })
      return
    }

    if (!amount || Number.parseFloat(amount) <= 0) {
      toast({
        title: t("invalidAmount"),
        description: t("invalidAmountDescription"),
        variant: "destructive",
      })
      return
    }

    const transferAmount = toInt(Number.parseFloat(amount))

    if (!transferAmount) {
      toast({
        title: t("invalidAmount"),
        description: t("invalidAmountDescription"),
        variant: "destructive",
      })
      return
    }

    const sourceAccount = accounts.find((acc: Account) => acc.id === fromAccount)

    if (sourceAccount && sourceAccount.balance < transferAmount) {
      toast({
        title: t("insufficientFunds"),
        description: t("insufficientFundsDescription", { account: sourceAccount.name }),
        variant: "destructive",
      })
      return
    }

    onTransfer({
      amount: transferAmount,
      fromAccount,
      toAccount,
      description: description || t("transferDescription"),
    })

    // Reset form
    setAmount("")
    setDescription("")
    setFromAccount("")
    setToAccount("")

    // Show toast
    toast({
      title: t("transferComplete"),
      description: t("transferCompleteDescription", { amount: formatCurrency(transferAmount) }),
    })
  }

  // Handle uninitialized state
  if (!accounts || accounts.length === 0) {
    return (
      <EmptyState
        title={t("noAccounts") || "No accounts available"}
        description={t("noAccountsDescription") || "Please add accounts before making transfers."}
        action={
          <Button onClick={() => {
            // TODO: Add account creation flow
          }}>
            {t("addAccount") || "Add Account"}
          </Button>
        }
      />
    )
  }

  // Handle insufficient accounts for transfers
  if (accounts.length < 2) {
    return (
      <EmptyState
        title={t("insufficientAccounts") || "Need more accounts"}
        description={t("insufficientAccountsDescription") || "You need at least 2 accounts to make transfers."}
        action={
          <Button onClick={() => {
            // TODO: Add account creation flow
          }}>
            {t("addAccount") || "Add Account"}
          </Button>
        }
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("transferFunds")}</CardTitle>
        <CardDescription>{t("transferDescription")}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fromAccount">{t("fromAccount")}</Label>
            <Select value={fromAccount} onValueChange={setFromAccount}>
              <SelectTrigger data-testid="transfer-from-account">
                <SelectValue placeholder={t("selectSourceAccount")} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id} data-testid={`account-option-${account.id}`}>
                    {account.name} ({formatCurrency(account.balance)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="toAccount">{t("toAccount")}</Label>
            <Select value={toAccount} onValueChange={setToAccount}>
              <SelectTrigger data-testid="transfer-to-account">
                <SelectValue placeholder={t("selectDestinationAccount")} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id} data-testid={`account-option-${account.id}`}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">{t("amount")}</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="transfer-amount"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t("description")}</Label>
            <Input
              id="description"
              placeholder={t("whatTransferFor")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="transfer-description"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" data-testid="transfer-submit">
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            {t("transferFunds")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
