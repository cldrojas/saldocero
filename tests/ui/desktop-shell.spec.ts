import { test, expect, type Page } from '@playwright/test'
import { DEFAULT_TEST_CONFIG, setupTestAppState } from './test-utils'

/**
 * Fuerza español antes de que cargue la app. No se importa `forceSpanish` de
 * `e2e-constants.ts` a propósito: ese módulo lee credenciales de `.env.e2e` al
 * importarse y rompe la colección de este spec cuando el archivo no existe.
 */
async function forceSpanish(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('language', 'es')
  })
}

/**
 * Desktop shell (issue #10, Phases A–F).
 *
 * Runs at a real desktop viewport (1280×800), which is what makes these
 * assertions meaningful: the sidebar replaces the mobile chrome at `lg`, and the
 * per-surface content only exists above that breakpoint.
 *
 * Not covered here on purpose: the QR export flow renders a claim through
 * `/api/sync/claim`, so these tests assert reachability and mode switching
 * without triggering a network round-trip.
 */
test.use({ viewport: { width: 1280, height: 800 } })

const SIDEBAR = { name: 'Main navigation' } as const

test.describe('Desktop shell (lg+)', () => {
  test.beforeEach(async ({ page }) => {
    await forceSpanish(page)
    await setupTestAppState(page, DEFAULT_TEST_CONFIG)
    await page.goto('/')
    // `h1` exists in both the pre-hydration setup screen and the configured
    // shell, so wait for the sidebar itself: it only exists once hydrated.
    await expect(page.getByRole('navigation', SIDEBAR).getByRole('button')).toHaveCount(5)
  })

  test('renders the sidebar with all five sections and no mobile chrome', async ({ page }) => {
    const nav = page.getByRole('navigation', SIDEBAR)

    await expect(nav).toBeVisible()
    await expect(nav.getByRole('button')).toHaveCount(5)
    await expect(page.getByTestId('mobile-chrome')).toBeHidden()
    await expect(page.getByTestId('mobile-fab-add-transaction')).toBeHidden()
    // The hamburger that hosts ConfigForm is `sm:hidden`: unreachable on desktop.
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden()
    // The config gear covers the band the sidebar does not. At lg the sidebar
    // owns settings, and two controls sharing the same accessible name would
    // also make `getByRole('button', { name: 'Configuración de presupuesto' })`
    // ambiguous.
    await expect(page.getByTestId('header-config-trigger')).toBeHidden()
  })

  test('switches surfaces from the sidebar without leaving the page', async ({ page }) => {
    const nav = page.getByRole('navigation', SIDEBAR)

    await nav.getByRole('button', { name: 'Ajustes' }).click()
    await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible()
    // ConfigForm renders inline (no Sheet): expanding it exposes the data tools.
    await page.getByRole('button', { name: 'Configuración de presupuesto' }).click()
    await expect(page.getByTestId('import-data-button')).toBeVisible()
    await expect(page.getByTestId('qr-export-button')).toBeVisible()

    await nav.getByRole('button', { name: 'Historial' }).click()
    await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeHidden()
    await expect(page.getByTestId('import-data-button')).toBeHidden()
  })

  test('exposes Sync as a desktop section with both modes', async ({ page }) => {
    await page.getByRole('navigation', SIDEBAR).getByRole('button', { name: 'Sincronizar' }).click()

    await expect(page.getByRole('heading', { name: 'Sincronizar' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Compartir vía QR' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Escanear QR o ingresar código' })).toBeVisible()
  })

  test('keyboard shortcuts drive surfaces and actions', async ({ page }) => {
    await page.keyboard.press('5')
    await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible()

    await page.keyboard.press('1')
    await expect(page.getByText('Movimientos recientes')).toBeVisible()

    await page.keyboard.press('n')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.keyboard.press('t')
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('keeps the mobile chrome below lg', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    await expect(page.getByTestId('mobile-chrome')).toBeVisible()
    await expect(page.getByTestId('mobile-fab-add-transaction')).toBeVisible()
    await expect(page.getByRole('navigation', SIDEBAR)).toBeHidden()
    // The gear belongs to the sm..lg band only; below sm the hamburger owns the
    // whole menu, config included.
    await expect(page.getByTestId('header-config-trigger')).toBeHidden()
  })

  test('opens the config sheet from the header gear between sm and lg', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 800 })

    // The band the sidebar does not cover yet: neither the sidebar nor the
    // mobile chrome is a complete way in, so the gear opens the config directly.
    await expect(page.getByRole('navigation', SIDEBAR)).toBeHidden()
    const gear = page.getByTestId('header-config-trigger')
    await expect(gear).toBeVisible()

    await gear.click()

    const sheet = page.getByRole('dialog', { name: 'Configuración de presupuesto' })
    await expect(sheet).toBeVisible()
    // The form keeps its own collapsed trigger, same as every other surface.
    await sheet.getByRole('button', { name: 'Configuración de presupuesto' }).click()
    await expect(page.getByTestId('import-data-button')).toBeVisible()
    await expect(page.getByTestId('qr-export-button')).toBeVisible()
  })
})
