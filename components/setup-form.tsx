'use client'

import { useState } from "react";
import { useLanguage } from "@/contexts/language-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/date-picker";
import { Int, toInt } from "@/types";

/**
 * Component for setting up the initial budget.
 * @param onSetup - Callback function to handle setup with start amount, end date, and mode.
 * @returns JSX element for the setup form.
 * @example
 * <SetupForm onSetup={(data) => console.log(data)} />
 */
export function SetupForm({
  onSetup
}: {
  onSetup: (data: { startAmount: Int; endDate?: Date; mode: 'daily' | 'track' }) => void
}) {
  const { t } = useLanguage()
  const [startAmount, setStartAmount] = useState<Int | null>(null)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [mode, setMode] = useState<'daily' | 'track'>('daily')

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!startAmount || startAmount <= 0) return
    if (mode === 'daily' && !endDate) return

    onSetup({
      startAmount: startAmount,
      endDate: mode === 'daily' ? endDate : undefined,
      mode
    })
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{t('setupTitle')}</CardTitle>
        <CardDescription>{t('setupDescription')}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
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
            <Label htmlFor="startAmount">{t('startingAmount')}</Label>
            <Input
              id="startAmount"
              type="number"
              placeholder="2750000"
              autoFocus
              value={startAmount ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setStartAmount(toInt(e.target.valueAsNumber) ?? null)
              }
              required
            />
          </div>
          {mode === 'daily' && (
            <div className="space-y-2">
              <Label htmlFor="endDate">{t('endDate')}</Label>
              <DatePicker
                date={endDate}
                setDate={setEndDate}
                className="w-full"
              />
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            type="submit"
            className="w-full"
          >
            {t('startTracking')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}