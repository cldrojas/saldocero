'use client'

// Sync settings panel: local backup list + restore and the QR export/import
// flow (Opción B — claim autocontenido). No hay sync code/token que configurar:
// el dispositivo exporta su snapshot como un claim anónimo y comparte el QR.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import SyncQrModal from '@/components/sync/sync-qr-modal'
import { useLanguage } from '@/contexts/language-context'
import { listBackups, restoreBackup } from '@/lib/db/persistence'

export type BackupInfo = { label: string; at: string }

export function SyncSettings() {
  const { t } = useLanguage()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [restoredLabel, setRestoredLabel] = useState<string | null>(null)
  const [qrMode, setQrMode] = useState<'export' | 'import' | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const list = await listBackups().catch(() => [] as BackupInfo[])
      if (!active) return
      setBackups(list)
    })()
    return () => {
      active = false
    }
  }, [])

  async function handleRestore(label: string): Promise<void> {
    try {
      await restoreBackup(label)
      setRestoredLabel(label)
    } catch {
      setRestoredLabel(null)
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold">{t('syncSettingsTitle')}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setQrMode('export')}
            data-testid="qr-export-button"
          >
            {t('sync.export.title')}
          </Button>
          <Button
            variant="outline"
            onClick={() => setQrMode('import')}
            data-testid="qr-import-button"
          >
            {t('sync.import.title')}
          </Button>
        </div>
      </section>

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
                <Button variant="outline" onClick={() => void handleRestore(b.label)}>
                  {t('syncRestore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {restoredLabel && <p className="mt-2 text-sm text-green-600">{t('syncRestored')}</p>}
      </section>

      <SyncQrModal
        key={qrMode ?? 'closed'}
        open={qrMode !== null}
        mode={qrMode ?? 'export'}
        onOpenChange={(open) => {
          if (!open) {
            setQrMode(null)
            // La importación modifica la DB vía setDb pero el state de la app no
            // observa ese cambio en vivo (patrón IDB boot). Recargamos para que
            // el boot re-lea la DB ya importada.
            window.location.reload()
          }
        }}
      />
    </div>
  )
}

export default SyncSettings