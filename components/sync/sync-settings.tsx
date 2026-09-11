'use client'

// Sync settings panel (Batch 4, task 4.2): configure code + token, guided
// first push with explicit confirmation, and local backup list + restore.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ConfirmDialog from '@/components/modals/confirm-dialog'
import { useLanguage } from '@/contexts/language-context'
import { getSyncConfig, setSyncConfig, syncNow } from '@/lib/sync-client'
import type { SyncConfig, SyncResult } from '@/lib/sync-client'
import { getMeta } from '@/lib/db/meta'
import type { MetaRead } from '@/lib/db/meta'
import { listBackups, restoreBackup } from '@/lib/db/persistence'

export type BackupInfo = { label: string; at: string }

export function SyncSettings() {
  const { t } = useLanguage()
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [meta, setMeta] = useState<MetaRead | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [restoredLabel, setRestoredLabel] = useState<string | null>(null)

  const hasSync = config !== null
  const needsFirstPush = hasSync && meta !== null && !meta.snapshot_hash

  useEffect(() => {
    let active = true
    void (async () => {
      const cfg = getSyncConfig()
      const m = await getMeta().catch(() => null)
      const list = await listBackups().catch(() => [] as BackupInfo[])
      if (!active) return
      setConfig(cfg)
      setMeta(m)
      setBackups(list)
    })()
    return () => {
      active = false
    }
  }, [])

  function handleSave(): void {
    const next = { syncCode: code.trim(), syncToken: token.trim() }
    if (!next.syncCode || !next.syncToken) return
    setSyncConfig(next)
    setConfig(next)
    setSaved(true)
    setResult(null)
  }

  async function handleFirstPush(): Promise<void> {
    if (!config) return
    setBusy(true)
    setResult(null)
    setConfirmOpen(false)
    const res = await syncNow(config)
    setResult(res)
    setBusy(false)
    if (res.action !== 'error') {
      const m = await getMeta().catch(() => null)
      setMeta(m)
    }
  }

  async function handleRestore(label: string): Promise<void> {
    try {
      await restoreBackup(label)
      setRestoredLabel(label)
      setResult(null)
    } catch {
      setRestoredLabel(null)
      setResult({ action: 'error', error: 'restore' })
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">{t('syncSettingsTitle')}</h2>
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            handleSave()
          }}
        >
          <div>
            <label htmlFor="sync-code">{t('syncCodeLabel')}</label>
            <Input
              id="sync-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('syncCodeLabel')}
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="sync-token">{t('syncTokenLabel')}</label>
            <Input
              id="sync-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('syncTokenLabel')}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Button type="submit" disabled={!code.trim() || !token.trim()}>
              {t('syncSave')}
            </Button>
            {saved && <p className="text-sm text-green-600">{t('syncConfigSaved')}</p>}
          </div>
        </form>
      </section>

      {needsFirstPush && (
        <section className="rounded-md border p-4">
          <h3 className="font-medium">{t('syncFirstPushPending')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('syncFirstPushPendingDescription')}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
          >
            {t('syncUploadFirst')}
          </Button>
          {result?.action === 'error' && <p className="mt-2 text-sm text-red-600">{t('syncError')}</p>}
        </section>
      )}

      {result && result.action !== 'error' && (
        <p className="text-sm text-green-600">{t('syncSynced')}</p>
      )}

      <section>
        <h3 className="font-medium">{t('syncBackupsTitle')}</h3>
        {backups.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t('syncNoBackups')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {backups.map((b) => (
              <li
                key={b.label}
                className="flex items-center justify-between rounded-md border p-2"
              >
                <div>
                  <p className="text-sm font-medium">{b.label}</p>
                  <p className="text-xs text-muted-foreground">{b.at}</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void handleRestore(b.label)}
                  disabled={busy}
                >
                  {t('syncRestore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {restoredLabel && <p className="mt-2 text-sm text-green-600">{t('syncRestored')}</p>}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => void handleFirstPush()}
        title={t('syncFirstPushTitle')}
        description={t('syncFirstPushDescription')}
        confirmText={t('confirm')}
        cancelText={t('cancel')}
      />
    </div>
  )
}

export default SyncSettings