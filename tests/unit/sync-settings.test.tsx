// tests/unit/sync-settings.test.tsx
// SyncSettings post-Opción B: ya no hay form de sync code/token ni flujo
// first-push (se eliminaron con syncNow/setSyncConfig/getSyncConfig y el banner
// de sync_meta). Solo resta: acciones QR (export/import) + backups locales.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncSettings } from '@/components/sync/sync-settings'
import { LanguageProvider } from '@/contexts/language-context'

// Hoisted mocks: vitest hoists vi.mock to the top, so the mock fns must live
// outside the factory to be visible to the tests
const { SyncQrModalMock, listBackupsMock, restoreBackupMock } = vi.hoisted(() => ({
  SyncQrModalMock: vi.fn(),
  listBackupsMock: vi.fn(),
  restoreBackupMock: vi.fn(),
}))

// El modal QR se mockea entero para mantener el test hermético (evita cargar
// sql.js/WASM, el fetch de creación de claims y la lib de QR en el unit test).
vi.mock('@/components/sync/sync-qr-modal', () => ({
  default: (props: { open?: boolean; mode?: 'export' | 'import' }) => {
    SyncQrModalMock(props)
    if (!props.open) return null
    return (
      <div data-testid="qr-modal" data-mode={props.mode}>
        QR {props.mode}
      </div>
    )
  },
}))

vi.mock('@/lib/db/persistence', () => ({
  listBackups: (...args: unknown[]) => listBackupsMock(...args),
  restoreBackup: (...args: unknown[]) => restoreBackupMock(...args),
}))

const BACKUPS = [
  { label: 'backup-1', at: '2026-09-11 09:00:00' },
  { label: 'backup-2', at: '2026-09-11 10:00:00' },
]

function renderSettings() {
  return render(
    <LanguageProvider>
      <SyncSettings />
    </LanguageProvider>
  )
}

describe('SyncSettings', () => {
  beforeEach(() => {
    SyncQrModalMock.mockReset()
    listBackupsMock.mockReset()
    restoreBackupMock.mockReset()
  })

  it('solo expone acciones QR + backups: sin form de sync code/token ni first-push', async () => {
    listBackupsMock.mockResolvedValue([])

    renderSettings()

    expect(screen.getByTestId('qr-export-button')).toBeInTheDocument()
    expect(screen.getByTestId('qr-import-button')).toBeInTheDocument()
    expect(screen.queryByLabelText(/sync code|código de sincronización/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/sync token|token de sincronización/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upload.*first time|subir.*primera vez/i })).not.toBeInTheDocument()
    expect(await screen.findByText(/no backups|no hay copias/i)).toBeInTheDocument()
  })

  it('abre el modal QR en modo export al pulsar el botón de exportar', async () => {
    listBackupsMock.mockResolvedValue([])
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByTestId('qr-export-button'))
    expect(SyncQrModalMock).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, mode: 'export' }))
    expect(screen.getByTestId('qr-modal')).toHaveAttribute('data-mode', 'export')
  })

  it('abre el modal QR en modo import al pulsar el botón de importar', async () => {
    listBackupsMock.mockResolvedValue([])
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByTestId('qr-import-button'))
    expect(SyncQrModalMock).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, mode: 'import' }))
    expect(screen.getByTestId('qr-modal')).toHaveAttribute('data-mode', 'import')
  })

  it('lista los backups locales y restaura el seleccionado', async () => {
    listBackupsMock.mockResolvedValue(BACKUPS)
    restoreBackupMock.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const user = userEvent.setup()

    renderSettings()

    expect(await screen.findByText('backup-1')).toBeInTheDocument()
    expect(screen.getByText('backup-2')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /restore|restaurar/i })[0])

    expect(restoreBackupMock).toHaveBeenCalledWith('backup-1')
    await waitFor(() => expect(screen.getByText(/backup restored|copia restaurada/i)).toBeInTheDocument())
  })

  it('muestra empty-state cuando no hay backups', async () => {
    listBackupsMock.mockResolvedValue([])

    renderSettings()

    expect(await screen.findByText(/no backups|no hay copias/i)).toBeInTheDocument()
  })
})