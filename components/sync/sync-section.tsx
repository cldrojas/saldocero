'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/language-context'
import { SyncPanel } from '@/components/sync/sync-qr-modal'

/**
 * Desktop Sync section (issue #10, Phase F): renders the QR claim export/import
 * flow inline, so it is reachable from the sidebar without the mobile hamburger
 * (that Sheet is `sm:hidden`, i.e. unreachable on desktop).
 *
 * The panel is remounted (via key) to reset the flow: switching mode or
 * finishing an export starts a fresh claim, exactly like reopening the modal.
 */
export function SyncSection() {
  const { t } = useLanguage()
  const [mode, setMode] = useState<'export' | 'import'>('export')
  const [resetKey, setResetKey] = useState(0)

  const selectMode = (next: 'export' | 'import') => {
    setMode(next)
    setResetKey((key) => key + 1)
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'export' ? 'default' : 'outline'}
          onClick={() => selectMode('export')}
        >
          {t('sync.export.title')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'import' ? 'default' : 'outline'}
          onClick={() => selectMode('import')}
        >
          {t('sync.import.title')}
        </Button>
      </div>

      <div className="space-y-4">
        <SyncPanel
          key={`${mode}-${resetKey}`}
          mode={mode}
          active
          onDone={() => setResetKey((key) => key + 1)}
        />
      </div>
    </div>
  )
}

export default SyncSection
