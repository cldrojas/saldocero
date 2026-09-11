'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/language-context'
import { getSyncConfig, syncNow } from '@/lib/sync-client'
import { getMeta } from '@/lib/db/meta'
import { cn } from '@/lib/utils'

interface SyncButtonProps {
  className?: string
}

type SyncState = 'config' | 'pending' | 'synced' | 'syncing' | 'error'

/**
 * Formatea el `updated_at` de sync_meta ('2026-09-11 10:30:00') a HH:MM.
 * Se parsea manualmente para evitar ambigüedad de timezone en display local.
 */
function formatTime(updatedAt: string | null): string {
  if (!updatedAt) return ''
  const match = updatedAt.match(/(\d{1,2}):(\d{2})/)
  if (!match) return updatedAt
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

/**
 * Botón "Sincronizar" con estados visibles: synced / pending / last sync /
 * error / config pendiente (FR-4). Ejecuta el pipeline pull → merge → push
 * via `syncNow` y recarga la página cuando el merge cambia la base.
 */
export function SyncButton({ className }: SyncButtonProps) {
  const { t } = useLanguage()
  // Estado inicial derivado de la config local (SSR-safe: null en server).
  // El effect solo resuelve el estado remoto; si no hay config el botón
  // queda en 'config' (disabled) sin consultar el relay.
  const [state, setState] = useState<SyncState>(() => (getSyncConfig() ? 'pending' : 'config'))
  const [lastSync, setLastSync] = useState('')

  useEffect(() => {
    if (!getSyncConfig()) return
    getMeta().then((meta) => {
      if (meta?.snapshot_hash) {
        setState('synced')
        setLastSync(formatTime(meta.updated_at ?? null))
      } else {
        setState('pending')
      }
    })
  }, [])

  const handleSync = async () => {
    const conf = getSyncConfig()
    if (!conf) return
    setState('syncing')
    const result = await syncNow(conf)
    if (result.action === 'error') {
      setState('error')
      return
    }
    // El merge cambió la base local: recargar para reconstruir el estado React
    // desde el nuevo snapshot (los datos locales ya están persistidos).
    if (result.action === 'merged') {
      window.location.reload()
      return
    }
    setState('synced')
    setLastSync(formatTime(result.updatedAt ?? null))
  }

  const disabled = state === 'config' || state === 'syncing'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        variant={state === 'error' ? 'destructive' : 'outline'}
        size="sm"
        onClick={handleSync}
        disabled={disabled}
        data-testid="sync-button"
      >
        <RefreshCw className={cn('h-4 w-4', state === 'syncing' && 'animate-spin')} />
        {t('syncSync')}
      </Button>
      {state === 'synced' && (
        <>
          <span className="text-xs font-medium text-green-600 dark:text-green-500">
            {t('syncSynced')}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('syncLastSync', { time: lastSync })}
          </span>
        </>
      )}
      {state === 'pending' && (
        <span className="text-xs text-muted-foreground">{t('syncFirstPushPending')}</span>
      )}
      {state === 'syncing' && (
        <span className="text-xs text-muted-foreground">{t('syncSyncing')}</span>
      )}
      {state === 'error' && (
        <span className="text-xs text-destructive">{t('syncError')}</span>
      )}
      {state === 'config' && (
        <span className="text-xs text-muted-foreground">{t('syncConfigPending')}</span>
      )}
    </div>
  )
}