import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncButton } from '@/components/sync/sync-button'
import { LanguageProvider } from '@/contexts/language-context'

// Hoisted mocks: vitest hoists vi.mock to the top, so the mock fns must live
// outside the factory to be visible to the tests
const { syncNowMock, getSyncConfigMock, getMetaMock } = vi.hoisted(() => ({
  syncNowMock: vi.fn(),
  getSyncConfigMock: vi.fn(),
  getMetaMock: vi.fn(),
}))

vi.mock('@/lib/sync-client', () => ({
  syncNow: (...args: unknown[]) => syncNowMock(...args),
  getSyncConfig: (...args: unknown[]) => getSyncConfigMock(...args),
}))

vi.mock('@/lib/db/meta', () => ({
  getMeta: (...args: unknown[]) => getMetaMock(...args),
}))

const VALID_CONF = { syncCode: 'test-code', syncToken: 'test-token' }
const SYNCED_META = { snapshot_hash: 'abc123', updated_at: '2026-09-11 10:30:00' }
const PENDING_META = { snapshot_hash: null, updated_at: null }

function renderButton() {
  return render(
    <LanguageProvider>
      <SyncButton />
    </LanguageProvider>
  )
}

describe('SyncButton', () => {
  beforeEach(() => {
    syncNowMock.mockReset()
    getSyncConfigMock.mockReset()
    getMetaMock.mockReset()
  })

  it('shows config-pending state and disables the button when no sync config exists', async () => {
    getSyncConfigMock.mockReturnValue(null)
    getMetaMock.mockResolvedValue(PENDING_META)

    renderButton()

    expect(await screen.findByText(/not configured|no configurada/i)).toBeInTheDocument()
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('does not call syncNow when the button is disabled', async () => {
    getSyncConfigMock.mockReturnValue(null)
    getMetaMock.mockResolvedValue(PENDING_META)

    renderButton()

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    await userEvent.click(button).catch(() => undefined)
    expect(syncNowMock).not.toHaveBeenCalled()
  })

  it('shows first-push pending state when config exists but no snapshot hash', async () => {
    getSyncConfigMock.mockReturnValue(VALID_CONF)
    getMetaMock.mockResolvedValue(PENDING_META)

    renderButton()

    expect(await screen.findByText(/first sync pending|primera sincronización pendiente/i)).toBeInTheDocument()
  })

  it('shows synced state with last sync time when snapshot hash exists', async () => {
    getSyncConfigMock.mockReturnValue(VALID_CONF)
    getMetaMock.mockResolvedValue(SYNCED_META)

    renderButton()

    expect(await screen.findByText(/synced|sincronizado/i)).toBeInTheDocument()
    expect(screen.getByText(/10:30/)).toBeInTheDocument()
  })

  it('calls syncNow with the config and shows syncing while pending', async () => {
    getSyncConfigMock.mockReturnValue(VALID_CONF)
    getMetaMock.mockResolvedValue(SYNCED_META)
    let resolveSync: (r: unknown) => void = () => undefined
    syncNowMock.mockReturnValue(new Promise((resolve) => { resolveSync = resolve }))
    const user = userEvent.setup()

    renderButton()

    await user.click(screen.getByRole('button'))
    expect(syncNowMock).toHaveBeenCalledWith(VALID_CONF)
    expect(screen.getByText(/syncing|sincronizando/i)).toBeInTheDocument()

    resolveSync({ action: 'synced', hash: 'abc123', updatedAt: '2026-09-11 10:30:00' })
    await waitFor(() => expect(screen.getByText(/synced|sincronizado/i)).toBeInTheDocument())
  })

  it('shows error state when syncNow fails', async () => {
    getSyncConfigMock.mockReturnValue(VALID_CONF)
    getMetaMock.mockResolvedValue(SYNCED_META)
    syncNowMock.mockResolvedValue({ action: 'error', error: 'network' })
    const user = userEvent.setup()

    renderButton()

    await user.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText(/sync failed|error de sincronización/i)).toBeInTheDocument())
    // Button re-enabled so the user can retry
    expect(screen.getByRole('button')).not.toBeDisabled()
  })

  it('reloads the page after a merged sync (database changed)', async () => {
    getSyncConfigMock.mockReturnValue(VALID_CONF)
    getMetaMock.mockResolvedValue(SYNCED_META)
    syncNowMock.mockResolvedValue({ action: 'merged', hash: 'def456', updatedAt: '2026-09-11 11:00:00' })
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { reload: reloadSpy },
    })
    const user = userEvent.setup()

    try {
      renderButton()
      await user.click(screen.getByRole('button'))
      await waitFor(() => expect(reloadSpy).toHaveBeenCalled())
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      })
    }
  })
})