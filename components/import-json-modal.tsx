'use client'

// Import JSON modal (Fase 3 de `import-data-json`). File picker + preview +
// confirmación de reemplazo, usando la librería de Fase 2 (readImportFile →
// buildImportPreview → applyJsonImport). El parent (config-form) orquesta el
// refresh y el toast de éxito vía onImported (D7).
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useLanguage } from '@/contexts/language-context'
import { getDb } from '@/lib/db/client'
import {
  applyJsonImport,
  buildImportPreview,
  readImportFile,
  type ImportFileError,
  type ImportPreview,
} from '@/lib/import-json'

export interface ImportJsonModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se dispara con los contadores de filas resultantes tras un import exitoso. */
  onImported: (result: { accounts: number; transactions: number }) => void
}

type ImportError = ImportFileError | 'unexpected'

// Conteo directo en la DB singleton (mismo patrón que countRows en import-json.ts,
// que no está exportado). Si ya hay cuentas → el import implica reemplazo (D2/FR-3).
async function countAccounts(): Promise<number> {
  const db = await getDb()
  const stmt = db.prepare('SELECT COUNT(*) AS count FROM accounts')
  try {
    stmt.step()
    return (stmt.getAsObject() as { count: number }).count
  } finally {
    stmt.free()
  }
}

export default function ImportJsonModal({
  open,
  onOpenChange,
  onImported,
}: ImportJsonModalProps) {
  const { t } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [filePickerKey, setFilePickerKey] = useState(0)
  const [fileName, setFileName] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [replaceWarning, setReplaceWarning] = useState(false)
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ImportError | null>(null)

  // Reset del estado al cerrar (en vez de un efecto de reset al abrir, que el
  // rule react-hooks/set-state-in-effect desaconseja): todo cierre —cancelar,
  // Escape, click afuera o éxito— deja el modal limpio para la próxima apertura
  // y reinicia el input file (key) para poder volver a elegir el mismo archivo.
  function handleOpenChange(next: boolean): void {
    setFileName('')
    setSourceText('')
    setPreview(null)
    setReplaceWarning(false)
    setReplaceConfirmed(false)
    setBusy(false)
    setError(null)
    setFilePickerKey((k) => k + 1)
    onOpenChange(next)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const res = await readImportFile(file)
      if (!res.ok) {
        setError(res.error)
        return
      }
      // ¿La DB ya tiene cuentas? Si sí, el import reemplaza los datos actuales
      // (backup + clearData) y necesita confirmación explícita (FR-3).
      const existing = await countAccounts()
      const data = res.data
      setFileName(file.name)
      setSourceText(JSON.stringify(data))
      setPreview(buildImportPreview(data))
      setReplaceWarning(existing > 0)
      setReplaceConfirmed(false)
    } catch {
      setError('unexpected')
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!preview || busy) return
    setBusy(true)
    try {
      const result = await applyJsonImport(sourceText, { replace: replaceWarning })
      onImported(result)
      handleOpenChange(false)
    } catch (err) {
      const importErr = (err as { error?: ImportFileError })?.error
      setError(importErr ?? 'unexpected')
      setBusy(false)
    }
  }

  function errorLabel(error: ImportError): string {
    switch (error) {
      case 'too-large':
        return t('importErrorTooLarge')
      case 'invalid-json':
        return t('importErrorInvalidJson')
      case 'invalid-shape':
        return t('importErrorInvalidShape')
      default:
        return t('importErrorUnexpected')
    }
  }

  const modeLabel = preview?.mode === 'daily' ? t('dailyMode') || 'Daily Mode' : t('trackMode') || 'Track Mode'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('importPreviewTitle')}</DialogTitle>
          <DialogDescription className="sr-only">{t('importPreviewTitle')}</DialogDescription>
        </DialogHeader>

        <input
          key={filePickerKey}
          ref={fileInputRef}
          data-testid="import-file-input"
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void handleFileChange(e)}
        />

        {error && (
          <p
            data-testid="import-error"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {errorLabel(error)}
          </p>
        )}

        {!preview && (
          <div className="flex flex-col items-center gap-3 py-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('importFile')}
            </Button>
          </div>
        )}

        {preview && (
          <>
            <div data-testid="import-preview" className="space-y-1 rounded-md border p-4 text-sm">
              <p className="break-all font-medium">{fileName}</p>
              <p className="text-muted-foreground">
                {t('importPreviewAccounts')}: {preview.accounts}
              </p>
              <p className="text-muted-foreground">
                {t('importPreviewTransactions')}: {preview.transactions}
              </p>
              <p className="text-muted-foreground">
                {t('importPreviewMode')}: {modeLabel}
              </p>
              {preview.dateRange.start && preview.dateRange.end && (
                <p className="text-muted-foreground">
                  {t('importPreviewDateRange')}: {preview.dateRange.start} — {preview.dateRange.end}
                </p>
              )}
            </div>

            {replaceWarning && (
              <div
                data-testid="import-overwrite-warning"
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <p>{t('importOverwriteWarning')}</p>
                <label className="mt-2 flex items-center gap-2">
                  <Checkbox
                    data-testid="import-confirm-checkbox"
                    checked={replaceConfirmed}
                    onCheckedChange={(checked) => setReplaceConfirmed(checked === true)}
                  />
                  <span>
                    {t('youSure')} {t('undoable')}
                  </span>
                </label>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => handleOpenChange(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="button"
                data-testid="import-confirm-button"
                disabled={busy || (replaceWarning && !replaceConfirmed)}
                onClick={() => void handleConfirm()}
              >
                {t('importConfirm')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}