'use client'

// Thin Radix Dialog wrapper around SyncPanel. The panel owns the whole
// export/import flow; the modal only supplies the dialog surface and the
// accessible title/description, so the same UI can also render inline as a
// desktop section (issue #10, Phase F) without duplicated logic.
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useLanguage } from '@/contexts/language-context'
import { SyncPanel } from '@/components/sync/sync-panel'

// Re-exported for backwards compatibility with existing importers.
export { ClaimCountdown } from '@/components/sync/sync-panel'

export interface SyncQrModalProps {
  open: boolean
  mode: 'export' | 'import'
  onOpenChange: (open: boolean) => void
  initialToken?: string // optional claim token to prefill (sync-import deep link)
}

export function SyncQrModal({ open, mode, onOpenChange, initialToken }: SyncQrModalProps) {
  const { t } = useLanguage()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'export' ? t('sync.export.title') : t('sync.import.title')}
          </DialogTitle>
          {mode === 'import' && (
            <DialogDescription className="sr-only">
              {t('sync.import.title')}
            </DialogDescription>
          )}
        </DialogHeader>

        <SyncPanel
          mode={mode}
          active={open}
          initialToken={initialToken}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

export default SyncQrModal
