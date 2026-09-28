import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HeaderMenu } from '@/components/header-menu'
import { ThemeProvider } from '@/components/theme-provider'
import { LanguageProvider } from '@/contexts/language-context'
import { CurrencyProvider } from '@/contexts/currency-context'
import type { Budget, Int } from '@/types'

/**
 * HeaderMenu: el mismo ConfigForm se alcanza por dos caminos distintos según el
 * breakpoint. Sobre `sm` el gear del header abre directo el sheet de configs
 * (la fila de iconos no tiene donde alojarlo); bajo `sm` el hamburger sigue
 * llevando al menú que navega a la sub-vista de configuración.
 */
function renderHeaderMenu() {
  const budget: Budget = {
    startAmount: 1000 as Int,
    startDate: new Date('2026-09-01'),
    endDate: undefined,
    autoSave: true,
    mode: 'track'
  }

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <CurrencyProvider>
          <HeaderMenu
            budget={budget}
            onUpdateConfig={vi.fn()}
            onClearData={vi.fn()}
          />
        </CurrencyProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}

describe('HeaderMenu', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // Lenguaje determinista: el provider hidrata desde localStorage.
    window.localStorage.setItem('language', 'es')
  })

  it('expone un trigger de configuración junto al toggle de tema', () => {
    renderHeaderMenu()

    const trigger = screen.getByTestId('header-config-trigger')
    expect(trigger).toHaveAttribute('title', 'Configuración de presupuesto')
  })

  it('abre el sheet de configs desde el gear sobre sm', () => {
    renderHeaderMenu()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('header-config-trigger'))

    const dialog = screen.getByRole('dialog', { name: 'Configuración de presupuesto' })
    // El ConfigForm arranca colapsado detrás de su propio trigger.
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Configuración de presupuesto' })
    )
    expect(dialog.querySelector('form')).toBeInTheDocument()
  })

  it('deja el camino móvil intacto: hamburger → menú → configuración', () => {
    renderHeaderMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))

    // jsdom no aplica el CSS responsive, así que el gear (sm+) y el hamburger
    // (bajo sm) coexisten en el DOM: cada paso se acota a su propio dialog.
    const menu = screen.getByRole('dialog', { name: 'Saldo Cero' })
    fireEvent.click(
      within(menu).getByRole('button', { name: 'Configuración de presupuesto' })
    )

    const dialog = screen.getByRole('dialog', { name: 'Configuración de presupuesto' })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Configuración de presupuesto' })
    )
    expect(dialog.querySelector('form')).toBeInTheDocument()
  })
})
