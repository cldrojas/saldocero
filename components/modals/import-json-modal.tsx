'use client'

// Import JSON modal (era localStorage). File picker + preview + confirmación de
// reemplazo. Port de e6f944a (era sql.js) SIN la capa de DB: el apply valida y
// delega en useBudget().replaceAll, que persiste el blob en localStorage y
// actualiza el estado del hook al instante (sin reload). El parent
// (config-form) orquesta el toast de éxito vía onImported.
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
import { useBudget } from '@/hooks/use-budget'
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
  /** Se dispara con los contadores resultantes tras un import exitoso. */
  onImported: (result: { accounts: number; transactions: number }) => void
}

type ImportError = ImportFileError | 'unexpected'

export default function ImportJsonModal({
  open,
  onOpenChange,
  onImported,
}: ImportJsonModalProps) {
  const { t } = useLanguage()
  const { accounts: currentAccounts, replaceAll } = useBudget()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [filePickerKey, setFilePickerKey] = useState(0)
  const [fileName, setFileName] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [replaceWarning, setReplaceWarning] = useState(false)
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ImportError | null>(null)

  // Reset del estado al cerrar (en vez de un efecto de reset al abrir): todo
  // cierre —cancelar, Escape, click afuera o éxito— deja el modal limpio para
  // la próxima apertura y reinicia el input file (key) para poder volver a
  // elegir el mismo archivo.
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
      // Si ya hay cuentas en el estado actual → el import reemplaza los datos
      // y necesita confirmación explícita (FR-3).
      const data = res.data
      setFileName(file.name)
      setSourceText(JSON.stringify(data))
      setPreview(buildImportPreview(data))
      setReplaceWarning(currentAccounts.length > 0)
      setReplaceConfirmed(false)
    } catch {
      setError('unexpected')
    } finally {
      setBusy(false)
    }
  }

  function handleConfirm(): void {
    if (!preview || busy) return
    setBusy(true)
    try {
      const result = applyJsonImport(sourceText, replaceAll)
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

  const modeLabel = preview?.mode === 'daily' ? t('dailyMode') : t('trackMode')

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
          accept=".json,application/json"
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
                onClick={handleConfirm}
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