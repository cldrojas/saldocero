'use client'

// QR export / import modal (Phase 4, qr-sync-export). Device A issues a
// time-limited claim against the relay and renders it as a QR token; device B
// scans the QR (or types the token) and imports the snapshot after confirming
// a preview. Camera scanning is progressive enhancement over the manual path.
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import ConfirmDialog from '@/components/modals/confirm-dialog'
import { useLanguage } from '@/contexts/language-context'
import { useToast } from '@/hooks/use-toast'
import {
  applyClaimImport,
  buildClaimUrl,
  createClaim,
  fetchClaim,
  getSyncCode,
  getSyncConfig,
  SyncAuthError,
} from '@/lib/sync-client'
import type { ClaimIssueResult, ClaimFetchResult } from '@/lib/sync-client'

export interface SyncQrModalProps {
  open: boolean
  mode: 'export' | 'import'
  onOpenChange: (open: boolean) => void
  syncCode?: string // used in export mode (device A's code)
  initialToken?: string // optional claim token to prefill (sync-import deep link)
}

type ClaimData = Extract<ClaimFetchResult, { ok: true }>
type IssuedClaim = Extract<ClaimIssueResult, { ok: true }>

function canUseCamera(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  )
}

function formatCountdown(remainingMs: number): { mm: string; ss: string } {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const ss = String(totalSeconds % 60).padStart(2, '0')
  return { mm, ss }
}

/**
 * Ticks the remaining lifetime of an issued claim every second. Calls onExpire
 * exactly once when the deadline passes.
 */
export function ClaimCountdown({
  expiryMs,
  onExpire,
}: {
  expiryMs: number
  onExpire: () => void
}) {
  const { t } = useLanguage()
  const [now, setNow] = useState(() => Date.now())
  const firedRef = useRef(false)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const remainingMs = Math.max(0, expiryMs - now)
  useEffect(() => {
    if (remainingMs > 0 || firedRef.current) return
    firedRef.current = true
    onExpire()
  }, [remainingMs, onExpire])

  const { mm, ss } = formatCountdown(remainingMs)
  return <span data-testid="claim-countdown">{t('sync.export.countdown', { mm, ss })}</span>
}

export function SyncQrModal({
  open,
  mode,
  onOpenChange,
  syncCode,
  initialToken,
}: SyncQrModalProps) {
  const { t } = useLanguage()
  const { toast } = useToast()

  // ---- export state ----
  const [claim, setClaim] = useState<IssuedClaim | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [authError, setAuthError] = useState(false)
  const [expired, setExpired] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // ---- import state ----
  const [tab, setTab] = useState<'camera' | 'manual'>('manual')
  const [token, setToken] = useState(initialToken ?? '')
  const [preview, setPreview] = useState<ClaimData | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const cameraId = useRef(`sync-qr-camera-${Math.random().toString(36).slice(2)}`).current
  const cameraRef = useRef<HTMLDivElement | null>(null)
  // Live html5-qrcode instance so the close/unmount cleanup can stop it.
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null)
  const pendingDataRef = useRef<ClaimData | null>(null)

  const hasCamera = canUseCamera()

  // El estado se resetea por remount: SyncQrModal se monta con
  // key={qrMode ?? 'closed'} desde sync-settings al abrirse. No hay
  // setState síncrono en effects (react-hooks/set-state-in-effect).

  // Export: issue a claim against the latest relay snapshot on open.
  useEffect(() => {
    if (!open || mode !== 'export' || claim || exportError || authError) return
    const conf = getSyncConfig()
    if (!conf || !syncCode) return
    let active = true
    void (async () => {
      let res: ClaimIssueResult
      try {
        res = await createClaim({ syncCode, syncToken: conf.syncToken })
      } catch (err) {
        if (!active) return
        if (err instanceof SyncAuthError) setAuthError(true)
        else setExportError('network')
        return
      }
      if (!active) return
      if (res.ok) setClaim(res)
      else setExportError(res.error)
    })()
    return () => {
      active = false
    }
  }, [open, mode, claim, exportError, authError, syncCode])

  // Export: render the QR once the claim is issued.
  useEffect(() => {
    if (!claim || !canvasRef.current) return
    const canvas = canvasRef.current
    const url = buildClaimUrl(window.location.origin, claim.syncCode, claim.token)
    void QRCode.toCanvas(canvas, url, { width: 220, margin: 1 }).catch(() => {
      // El QR es best-effort; el token tipoable sigue siendo ruta válida.
      setExportError('network')
    })
  }, [claim])

  // Import: prefill the token from the deep link and run the same flow.
  // El token ya viene propagado por useState(initialToken) y el remount por key.
  useEffect(() => {
    if (!open || mode !== 'import' || !initialToken) return
    const tkn = initialToken.trim()
    if (!tkn) return
    void runImport(tkn)
  }, [open, mode, initialToken])

  // Import: imperatively mount the html5-qrcode scanner on the camera tab.
  useEffect(() => {
    if (!open || mode !== 'import' || tab !== 'camera' || preview !== null) return
    let active = true

    void (async () => {
      try {
        const mod = await import('html5-qrcode')
        const Html5QrcodeClass = mod.Html5Qrcode
        const instance = new Html5QrcodeClass(cameraId)
        if (!active) return
        scannerRef.current = instance

        const onSuccess = (decodedText: string): void => {
          void (async () => {
            try {
              await instance.stop()
            } catch {
              // no estaba escaneando
            }
            try {
              instance.clear()
            } catch {
              // elemento ya limpiado
            }
            if (scannerRef.current === instance) scannerRef.current = null
            let claimToken: string | null = null
            try {
              claimToken = new URL(decodedText).searchParams.get('claim')
            } catch {
              // decodedText no era una URL absoluta
            }
            if (claimToken) await runImport(claimToken)
            else setImportError('claim_not_found')
          })()
        }

        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          onSuccess,
          () => {
            // Los errores por frame (códigos no legibles) son ruido; se ignoran.
          }
        )
      } catch {
        // camera es mejora progresiva: caer a la pestaña manual es la ruta segura
        if (active) {
          scannerRef.current = null
          setTab('manual')
        }
      }
    })()

    return () => {
      active = false
      const current = scannerRef.current
      scannerRef.current = null
      if (!current) return
      // stop() puede lanzar throw SÍNCRONO ("Cannot stop, scanner is not
      // running or paused") si el scanner nunca llegó a arrancar (p.ej. el
      // start() falló en headless). Un throw síncrono aquí rompería el unmount
      // y el ErrorBoundary tiraría toda la UI; el .catch(async) no lo cubre.
      try {
        void current
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              current.clear()
            } catch {
              // ya limpiado
            }
          })
      } catch {
        // scanner nunca corrió → no hay nada que limpiar
      }
    }
  }, [open, mode, tab, preview === null, cameraId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runImport(rawToken: string): Promise<void> {
    const tkn = rawToken.trim()
    if (!tkn) return
    setImportError(null)
    setBusy(true)
    const data = await fetchClaim(tkn)
    setBusy(false)
    if (!data.ok) {
      setImportError(data.error)
      return
    }
    setPreview(data)
  }

  function handleConfirm(): void {
    if (!preview) return
    const current = getSyncCode()
    if (current === null || current === preview.syncCode) {
      void doApply(preview, false)
      return
    }
    pendingDataRef.current = preview
    setReplaceOpen(true)
  }

  async function doApply(data: ClaimData, replaceCode: boolean): Promise<void> {
    setBusy(true)
    const res = await applyClaimImport(data, { replaceCode })
    setBusy(false)
    if (res.action === 'error') {
      toast({
        title: t('syncError'),
        variant: 'destructive',
      })
      return
    }
    toast({ title: t('syncSynced') })
    onOpenChange(false)
  }

  async function handleDone(): Promise<void> {
    if (!claim) return
    setBusy(true)
    try {
      await fetch(`/api/sync/claim/${encodeURIComponent(claim.token)}`, { method: 'DELETE' })
    } catch {
      // La invalidación es best-effort: el TTL del claim la reemplaza.
    }
    setBusy(false)
    onOpenChange(false)
  }

  function errorLabel(error: string): string {
    switch (error) {
      case 'claim_expired':
        return t('sync.claim.error_expired')
      case 'claim_consumed':
        return t('sync.claim.error_consumed')
      case 'claim_not_found':
        return t('sync.claim.error_not_found')
      default:
        return t('syncError')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {mode === 'export' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('sync.export.title')}</DialogTitle>
            </DialogHeader>

            {authError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {t('sync.import.token_banner')}
              </div>
            )}

            {!authError && exportError && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {errorLabel(exportError)}
              </p>
            )}

            {!authError && !exportError && claim && !expired && (
              <div className="flex flex-col items-center gap-3">
                <canvas
                  ref={canvasRef}
                  data-testid="claim-qr-canvas"
                  className="rounded-md border bg-white p-2"
                  aria-label={t('sync.export.title')}
                />
                <ClaimCountdown expiryMs={claim.expiresAt} onExpire={() => setExpired(true)} />
              </div>
            )}

            {!authError && !exportError && claim && expired && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {t('sync.claim.error_expired')}
              </p>
            )}

            {!authError && !exportError && claim && (
              <>
                <div>
                  <label
                    htmlFor="sync-claim-token"
                    className="text-sm font-medium text-muted-foreground"
                  >
                    {t('sync.export.claim_token_label')}
                  </label>
                  <p
                    id="sync-claim-token"
                    data-testid="claim-token"
                    className="mt-1 select-all break-all rounded-md border bg-muted p-2 font-mono text-xs text-muted-foreground"
                  >
                    {claim.token}
                  </p>
                </div>
                <DialogFooter>
                  <Button onClick={() => void handleDone()} disabled={busy}>
                    {t('sync.export.done')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('sync.import.title')}</DialogTitle>
              <DialogDescription className="sr-only">
                {t('sync.import.title')}
              </DialogDescription>
            </DialogHeader>

            {mode === 'import' && !getSyncConfig()?.syncToken && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                {t('sync.import.token_banner')}
              </div>
            )}

            {preview ? (
              <div className="space-y-1 rounded-md border p-4">
                <p className="font-medium">{t('sync.import.preview_title')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('sync.import.preview_date', {
                    date: new Date(preview.updatedAt).toLocaleString(),
                  })}
                </p>
                <p className="text-xs font-mono text-muted-foreground">
                  {t('sync.import.preview_hash', { shortHash: preview.hash.slice(0, 8) })}
                </p>
              </div>
            ) : (
              <Tabs value={tab} onValueChange={(v) => setTab(v as 'camera' | 'manual')}>
                <TabsList className="grid w-full grid-cols-2">
                  {hasCamera && <TabsTrigger value="camera">{t('sync.import.camera_tab')}</TabsTrigger>}
                  <TabsTrigger value="manual">{t('sync.import.manual_tab')}</TabsTrigger>
                </TabsList>

                {hasCamera && (
                  <TabsContent value="camera">
                    <div ref={cameraRef} id={cameraId} className="h-64 w-full overflow-hidden rounded-md border" />
                  </TabsContent>
                )}

                <TabsContent value="manual">
                  <div className="flex gap-2">
                    <Input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={t('sync.import.enter_token')}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      disabled={busy}
                      data-testid="claim-token-input"
                    />
                    <Button
                      onClick={() => void runImport(token)}
                      disabled={busy || !token.trim()}
                      data-testid="claim-import-button"
                    >
                      {t('sync.import.button')}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            )}

            {importError && (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {errorLabel(importError)}
              </p>
            )}

            <DialogFooter>
              {preview && (
                <>
                  <Button variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                    {t('sync.import.cancel')}
                  </Button>
                  <Button onClick={handleConfirm} disabled={busy}>
                    {t('sync.import.confirm')}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>

      <ConfirmDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        onConfirm={() => {
          const data = pendingDataRef.current
          pendingDataRef.current = null
          setReplaceOpen(false)
          if (data) void doApply(data, true)
        }}
        title={t('youSure')}
        description={
          replaceOpen
            ? t('sync.claim.replace_confirm', {
                current: getSyncCode() ?? '—',
                new: preview?.syncCode ?? '—',
              })
            : undefined
        }
        confirmText={t('confirm')}
        cancelText={t('cancel')}
      />
    </Dialog>
  )
}

export default SyncQrModal