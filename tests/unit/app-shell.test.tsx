import { render, screen, within, fireEvent } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AppShell } from '@/components/layout/app-shell'
import { LanguageProvider } from '@/contexts/language-context'
import type { AppSurface } from '@/types'

/**
 * Desktop shell (issue #10, Phases A + C): the sidebar must expose every surface
 * and both actions, mark the active surface for assistive tech, and never own
 * the state itself (the page owns it via the callbacks).
 */
function renderShell(activeSurface: AppSurface = 'overview') {
  const onSurfaceChange = vi.fn()
  const onNewTransaction = vi.fn()
  const onTransfer = vi.fn()

  render(
    <LanguageProvider>
      <AppShell nav={{ activeSurface, onSurfaceChange, onNewTransaction, onTransfer }}>
        <p>Contenido de la superficie</p>
      </AppShell>
    </LanguageProvider>
  )

  return { onSurfaceChange, onNewTransaction, onTransfer }
}

function navItems(): HTMLElement[] {
  const nav = screen.getByRole('navigation', { name: 'Main navigation' })
  return within(nav).getAllByRole('button')
}

describe('AppShell (desktop sidebar)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // Deterministic language: the provider hydrates from localStorage.
    window.localStorage.setItem('language', 'es')
  })

  it('renders the five sections with their localized labels in order', () => {
    renderShell()

    expect(navItems().map((item) => item.textContent)).toEqual([
      'Resumen',
      'Cuentas',
      'Historial',
      'Sincronizar',
      'Ajustes'
    ])
  })

  it('exposes each section shortcut via aria-keyshortcuts', () => {
    renderShell()

    expect(navItems().map((item) => item.getAttribute('aria-keyshortcuts'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5'
    ])
  })

  it('marks only the active surface with aria-current', () => {
    renderShell('history')

    const current = navItems().filter(
      (item) => item.getAttribute('aria-current') === 'page'
    )
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toBe('Historial')
  })

  it('reports surface changes to the owner instead of switching locally', () => {
    const { onSurfaceChange } = renderShell('overview')

    fireEvent.click(screen.getByRole('button', { name: /Sincronizar/ }))
    expect(onSurfaceChange).toHaveBeenCalledWith('sync')

    fireEvent.click(screen.getByRole('button', { name: /Ajustes/ }))
    expect(onSurfaceChange).toHaveBeenCalledWith('settings')
  })

  it('keeps the actions always visible and wired to their handlers', () => {
    const { onNewTransaction, onTransfer } = renderShell()

    const newTransaction = screen.getByRole('button', { name: /Nueva transacción/ })
    const transfer = screen.getByRole('button', { name: /Transferencias/ })

    expect(newTransaction).toHaveAttribute('aria-keyshortcuts', 'n')
    expect(transfer).toHaveAttribute('aria-keyshortcuts', 't')

    fireEvent.click(newTransaction)
    fireEvent.click(transfer)

    expect(onNewTransaction).toHaveBeenCalledTimes(1)
    expect(onTransfer).toHaveBeenCalledTimes(1)
  })

  it('renders the active surface content inside the shell', () => {
    renderShell()

    expect(screen.getByText('Contenido de la superficie')).toBeInTheDocument()
  })
})
