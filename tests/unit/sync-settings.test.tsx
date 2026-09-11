import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncSettings } from '@/components/sync/sync-settings'
import { LanguageProvider } from '@/contexts/language-context'

// Hoisted mocks: vitest hoists vi.mock to the top, so the mock fns must live
// outside the factory to be visible to the tests
const { syncNowMock, setSyncConfigMock, getSyncConfigMock, getMetaMock, listBackupsMock, restoreBackupMock } = vi.hoisted(() => ({
  syncNowMock: vi.fn(),
  setSyncConfigMock: vi.fn(),
  getSyncConfigMock: vi.fn(),
  getMetaMock: vi.fn(),
  listBackupsMock: vi.fn(),
  restoreBackupMock: vi.fn(),
}))

vi.mock('@/lib/sync-client', () => ({
  syncNow: (...args: unknown[]) => syncNowMock(...args),
  setSyncConfig: (...args: unknown[]) => setSyncConfigMock(...args),
  getSyncConfig: (...args: unknown[]) => getSyncConfigMock(...args),
}))

vi.mock('@/lib/db/meta', () => ({
  getMeta: (...args: unknown[]) => getMetaMock(...args),
}))

vi.mock('@/lib/db/persistence', () => ({
  listBackups: (...args: unknown[]) => listBackupsMock(...args),
  restoreBackup: (...args: unknown[]) => restoreBackupMock(...args),
}))

const NEW_CONF = { syncCode: 'new-code', syncToken: 'new-token' }
const VALID_CONF = { syncCode: 'test-code', syncToken: 'test-token' }
const PENDING_META = { snapshot_hash: null, updated_at: null }
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
    syncNowMock.mockReset()
    setSyncConfigMock.mockReset()
    getSyncConfigMock.mockReset()
    getMetaMock.mockReset()
    listBackupsMock.mockReset()
    restoreBackupMock.mockReset()
  })

  it('saves the sync code and token with setSyncConfig on submit', async () => {
    getSyncConfigMock.mockReturnValue(null)
    getMetaMock.mockResolvedValue(PENDING_META)
    listBackupsMock.mockResolvedValue([])
    const user = userEvent.setup()

    renderSettings()

    await user.type(screen.getByLabelText(/sync code|código de sincronización/i), NEW_CONF.syncCode)
    await user.type(screen.getByLabelText(/sync token|token de sincronización/i), NEW_CONF.syncToken)
    await user.click(screen.getByRole('button', { name: /save|guardar/i }))

    expect(setSyncConfigMock).toHaveBeenCalledWith(NEW_CONF)
    expect(await screen.findByText(/config saved|configuración guardada/i)).toBeInTheDocument()
  })

  it('does not save when the fields are empty', async () => {
    getSyncConfigMock.mockReturnValue(null)
    getMetaMock.mockResolvedValue(PENDING_META)
    listBackupsMock.mockResolvedValue([])
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByRole('button', { name: /save|guardar/i }))

    expect(setSyncConfigMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /save|guardar/i })).toBeDisabled()
  })

  it('shows the first-push invitation and runs syncNow only after confirming', async () => {
    getSyncConfigMock.mockReturnValue(VALID_CONF)
    getMetaMock.mockResolvedValue(PENDING_META)
    listBackupsMock.mockResolvedValue([])
    syncNowMock.mockResolvedValue({ action: 'synced', hash: 'abc123', updatedAt: '2026-09-11 10:30:00' })
    const user = userEvent.setup()

    renderSettings()

    const uploadButton = await screen.findByRole('button', { name: /upload.*first time|subir.*primera vez/i })
    await user.click(uploadButton)

    // Dialog is open, nothing has been sent yet
    expect(syncNowMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /continue|continuar|subir|confirm/i }))

    expect(syncNowMock).toHaveBeenCalledWith(VALID_CONF)
    await waitFor(() => expect(screen.getByText(/synced|sincronizado/i)).toBeInTheDocument())
  })

  it('does not run syncNow when the first-push dialog is cancelled', async () => {
    getSyncConfigMock.mockReturnValue(VALID_CONF)
    getMetaMock.mockResolvedValue(PENDING_META)
    listBackupsMock.mockResolvedValue([])
    const user = userEvent.setup()

    renderSettings()

    const uploadButton = await screen.findByRole('button', { name: /upload.*first time|subir.*primera vez/i })
    await user.click(uploadButton)

    await user.click(screen.getByRole('button', { name: /cancel|cancelar/i }))

    expect(syncNowMock).not.toHaveBeenCalled()
  })

  it('lists local backups and restores the selected one', async () => {
    getSyncConfigMock.mockReturnValue(null)
    getMetaMock.mockResolvedValue(PENDING_META)
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

  it('shows an empty-state message when there are no backups', async () => {
    getSyncConfigMock.mockReturnValue(null)
    getMetaMock.mockResolvedValue(PENDING_META)
    listBackupsMock.mockResolvedValue([])

    renderSettings()

    expect(await screen.findByText(/no backups|no hay copias/i)).toBeInTheDocument()
  })

  it('shows an error when the first push fails', async () => {
    getSyncConfigMock.mockReturnValue(VALID_CONF)
    getMetaMock.mockResolvedValue(PENDING_META)
    listBackupsMock.mockResolvedValue([])
    syncNowMock.mockResolvedValue({ action: 'error', error: 'network' })
    const user = userEvent.setup()

    renderSettings()

    const uploadButton = await screen.findByRole('button', { name: /upload.*first time|subir.*primera vez/i })
    await user.click(uploadButton)
    await user.click(screen.getByRole('button', { name: /continue|continuar|subir|confirm/i }))

    await waitFor(() => expect(screen.getByText(/sync failed|error de sincronización/i)).toBeInTheDocument())
  })
})