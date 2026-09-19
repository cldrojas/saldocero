'use client'

import { History, Home, Wallet, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/language-context'
import type { AppSurface } from '@/types'

export interface SidebarNavProps {
  activeSurface: AppSurface
  onSurfaceChange: (surface: AppSurface) => void
}

// Sync and Settings entries land with their desktop surfaces
// (ConfigForm / SyncQrModal are wired in a later phase of issue #10).
const NAV_ITEMS: ReadonlyArray<{
  surface: AppSurface
  labelKey: string
  icon: LucideIcon
}> = [
  { surface: 'overview', labelKey: 'sidebar.overview', icon: Home },
  { surface: 'accounts', labelKey: 'accounts', icon: Wallet },
  { surface: 'history', labelKey: 'history', icon: History },
]

/**
 * Desktop sidebar navigation (issue #10, Phase A). Rendered only at lg+ inside
 * the app shell; the mobile tab bar drives the same active-surface state.
 */
export function SidebarNav({ activeSurface, onSurfaceChange }: SidebarNavProps) {
  const { t } = useLanguage()

  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {NAV_ITEMS.map(({ surface, labelKey, icon: Icon }) => (
        <Button
          key={surface}
          type="button"
          variant={activeSurface === surface ? 'secondary' : 'ghost'}
          className="w-full justify-start gap-3 px-3"
          aria-current={activeSurface === surface ? 'page' : undefined}
          onClick={() => onSurfaceChange(surface)}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t(labelKey)}</span>
        </Button>
      ))}
    </nav>
  )
}