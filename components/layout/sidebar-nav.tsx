'use client'

import { ArrowRightLeft, History, Home, Plus, Wallet, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/language-context'
import type { AppSurface } from '@/types'

export interface SidebarNavProps {
  activeSurface: AppSurface
  onSurfaceChange: (surface: AppSurface) => void
  /** Opens the new-transaction modal from the desktop shell. */
  onNewTransaction: () => void
  /** Opens the transfer modal from the desktop shell. */
  onTransfer: () => void
}

// Sync and Settings entries land with their desktop surfaces
// (ConfigForm / SyncQrModal are wired in a later phase of issue #10).
const NAV_ITEMS: ReadonlyArray<{
  surface: AppSurface
  labelKey: string
  icon: LucideIcon
  shortcut: string
}> = [
  { surface: 'overview', labelKey: 'sidebar.overview', icon: Home, shortcut: '1' },
  { surface: 'accounts', labelKey: 'accounts', icon: Wallet, shortcut: '2' },
  { surface: 'history', labelKey: 'history', icon: History, shortcut: '3' },
]

const ACTION_SHORTCUTS: ReadonlyArray<{
  key: string
  shortcut: string
}> = [
  { key: 'n', shortcut: 'n' },
  { key: 't', shortcut: 't' },
]

/**
 * Desktop sidebar navigation + always-visible actions (issue #10, Phases A & C).
 * Rendered only at lg+ inside the app shell; the mobile tab bar drives the same
 * active-surface state. Shortcuts are exposed via aria-keyshortcuts/title for
 * discoverability; the keys are handled by useHotkeys in the page, never here.
 */
export function SidebarNav({
  activeSurface,
  onSurfaceChange,
  onNewTransaction,
  onTransfer
}: SidebarNavProps) {
  const { t } = useLanguage()

  return (
    <div className="flex h-full flex-col">
      <nav aria-label="Main navigation" className="space-y-1">
        {NAV_ITEMS.map(({ surface, labelKey, icon: Icon, shortcut }) => (
          <Button
            key={surface}
            type="button"
            variant={activeSurface === surface ? 'secondary' : 'ghost'}
            className="w-full justify-start gap-3 px-3"
            aria-current={activeSurface === surface ? 'page' : undefined}
            aria-keyshortcuts={shortcut}
            title={`${t(labelKey)} (${shortcut})`}
            onClick={() => onSurfaceChange(surface)}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </Button>
        ))}
      </nav>

      {/* Always-visible actions replace the mobile FAB on the desktop shell. */}
      <div className="mt-6 space-y-2 border-t pt-4">
        <Button
          type="button"
          className="w-full justify-start gap-3 px-3"
          aria-keyshortcuts={ACTION_SHORTCUTS[0].shortcut}
          title={`${t('sidebar.newTransaction')} (n)`}
          onClick={onNewTransaction}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('sidebar.newTransaction')}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-3 px-3"
          aria-keyshortcuts={ACTION_SHORTCUTS[1].shortcut}
          title={`${t('transfer')} (t)`}
          onClick={onTransfer}
        >
          <ArrowRightLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('transfer')}</span>
        </Button>
      </div>
    </div>
  )
}