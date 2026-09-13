"use client"

import React, { useState } from "react"
import { Settings, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/date-picker"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useToast } from "@/hooks/use-toast"
import { useLanguage } from "@/contexts/language-context"
import { toInt, type Budget } from "@/types"
import ConfirmDialog from "@/components/modals/confirm-dialog"
import { Checkbox } from "./ui/checkbox"
import { useBudget } from "@/hooks/use-budget"

export function ConfigForm({ budget, onUpdateConfig, onClearData }: {
  budget: Budget, onClearData: () => void, onUpdateConfig: (config: {
    startAmount?: number;
    endDate?: Date | undefined;
    mode?: 'daily' | 'track';
    autoSave?: boolean
  }) => void,
}) {
  const { t } = useLanguage()
  const { toast } = useToast()
  const { setLastCheckedDay, accounts, transactions, dailyAllowance, remainingToday, progress, isSetup } = useBudget()
  const [isOpen, setIsOpen] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [showDeleteDateConfirm, setShowDeleteDateConfirm] = useState(false)
  const [autoSave, setAutoSave] = useState(budget.autoSave)
  const [startAmount, setStartAmount] = useState(budget.startAmount)
  const [endDate, setEndDate] = useState(budget.endDate)
  const [mode, setMode] = useState<'daily' | 'track'>(budget.mode || (budget.endDate ? 'daily' : 'track'))

  const getYesterday = () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    return yesterday
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!startAmount || (mode === 'daily' && !endDate)) {
      toast({
        title: t("missingInformation"),
        description: t("missingInformationDescription"),
        variant: "destructive",
      })
      return
    }

    if (isNaN(startAmount) || startAmount <= 0) {
      toast({
        title: t("invalidAmount"),
        description: t("invalidAmountDescription"),
        variant: "destructive",
      })
      return
    }

    onUpdateConfig({
      startAmount: toInt(startAmount) ?? 0,
      endDate: mode === 'daily' ? endDate : undefined,
      mode,
      autoSave
    })


    setIsOpen(false)

    toast({
      title: t("configUpdated"),
      description: t("configUpdatedDescription"),
    })
  }

  const handleDeleteDate = () => {
    // Switch to track mode when removing date
    setMode('track')
    setEndDate(undefined)
    setShowDeleteDateConfirm(false)
    onUpdateConfig({ mode: 'track', endDate: undefined })
    toast({
      title: t("modeChanged") || "Mode changed",
      description: t("trackModeEnabled") || "Track mode enabled",
    })
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="flex items-center justify-between w-full">
          <span>{t("budgetConfiguration")}</span>
          <Settings className="h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("updateBudgetSettings")}</CardTitle>
            <CardDescription>{t("modifyBudgetConfig")}</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="flex justify-between mb-4">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    // Export desde la fuente real (SQLite vía hook), no del
                    // backup localStorage (reemplazado tras el pivote sqlite-local).
                    const exportData = {
                      budget: {
                        startAmount: budget.startAmount,
                        startDate: budget.startDate ? budget.startDate.toISOString() : null,
                        endDate: budget.endDate ? budget.endDate.toISOString() : null,
                        mode: budget.mode || 'track',
                        autoSave: budget.autoSave,
                        isSetup,
                      },
                      accounts: accounts.map((a) => ({
                        id: a.id,
                        name: a.name,
                        type: a.type,
                        icon: a.icon,
                        hidden: Boolean(a.hidden),
                        balance: a.balance,
                      })),
                      transactions: transactions.map((tx) => ({
                        id: tx.id,
                        type: tx.type,
                        amount: tx.amount,
                        description: tx.description,
                        account: tx.account,
                        date: tx.date ? new Date(tx.date).toISOString() : null,
                      })),
                      dailyAllowance,
                      remainingToday,
                      progress,
                      lastCheckedDay: null,
                    }
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                      type: 'application/json',
                    })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'daily-budget-export.json'
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                  }}
                >
                  {t("exportData")}
                </Button>
              </div>
              <div className="space-y-2">
                <Label>{t('selectMode') || 'Mode'}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={mode === 'daily' ? 'default' : 'outline'}
                    onClick={() => setMode('daily')}
                    className="flex-1"
                  >
                    {t('dailyMode') || 'Daily Mode'}
                  </Button>
                  <Button
                    type="button"
                    variant={mode === 'track' ? 'default' : 'outline'}
                    onClick={() => setMode('track')}
                    className="flex-1"
                  >
                    {t('trackMode') || 'Track Mode'}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="startAmount">{t("startingAmount")}</Label>
                <Input
                  id="startAmount"
                  type="number"
                  step="1"
                  placeholder="1000"
                  value={startAmount}
                  onChange={(e) => setStartAmount(toInt(e.target.value) || 0)}
                  required
                />
              </div>
              {mode === 'daily' && (
                <div className="space-y-2">
                  <Label htmlFor="endDate">{t("endDate")}</Label>
                  {endDate ? (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <DatePicker date={endDate} setDate={setEndDate} className="w-full" />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowDeleteDateConfirm(true)}
                        title={t("removeDate") || "Remove date"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("needDateToCalculate") || "Necesito una fecha para poder calcular"}
                    </p>
                  )}
                </div>
              )}
              {mode === 'daily' && (
                <div className="space-y-2">
                  <Label htmlFor="autosave">{t("toggleAutoSaving")}</Label>
                  <Checkbox className="ml-2" checked={autoSave} onCheckedChange={() => setAutoSave(!autoSave)} />
                </div>
              )}
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLastCheckedDay(getYesterday())}
                  title={t("close")}
                >
                  Mess with the time
                </Button>
                <Button variant="destructive" onClick={(e) => {
                  e.preventDefault()
                  setShowConfirm(true)
                }}>{t("clearData")}</Button>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit">{t("updateSettings")}</Button>
            </CardFooter>
            <ConfirmDialog
              open={showConfirm}
              onOpenChange={setShowConfirm}
              onConfirm={onClearData}
              title={t('youSure')}
              description={t("undoable")}
              confirmText={t("confirm")}
              cancelText={t("cancel")}
            />
            <ConfirmDialog
              open={showDeleteDateConfirm}
              onOpenChange={setShowDeleteDateConfirm}
              onConfirm={handleDeleteDate}
              title={t('removeEndDate') || "Remove end date?"}
              description={t('removeEndDateDescription') || "This will switch to track mode."}
              confirmText={t("confirm")}
              cancelText={t("cancel")}
            />
          </form>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  )
}
