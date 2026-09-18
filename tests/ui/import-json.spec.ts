// tests/ui/import-json.spec.ts
// Spec E2E de `import-data-json` (era localStorage): flujo completo de
// importación del export legacy (`daily-budget-export.json`) desde la
// configuración → preview → confirmación de reemplazo → toast → persistencia
// tras reload.
//
// Port de e6f944a:tests/ui/import-json.spec.ts al flujo actual: el estado se
// prepara con los helpers de la era (setupTestAppState vía localStorage, sin
// setup por UI) y el import persiste en `localStorage['daily-budget-data']`.
import { test, expect, type Page } from '@playwright/test'
import { waitForAppReady } from './test-utils'

// ─── Fixture ───────────────────────────────────────────────

// Shape canónico del export legacy (FR-2): budget + accounts + transactions,
// idéntico al blob de `daily-budget-data`. La cuenta 'Viajes' está oculta
// (hidden).
const IMPORT_JSON = {
  budget: {
    startAmount: 50000,
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-09-30T00:00:00.000Z',
    mode: 'daily',
    autoSave: true,
    isSetup: true,
  },
  accounts: [
    { id: 'daily', name: 'Diario', type: 'daily', icon: 'wallet', hidden: false, balance: 34000 },
    { id: 'savings', name: 'Ahorro', type: 'savings', icon: 'piggy-bank', hidden: false, balance: 120000 },
    { id: 'custom-1', name: 'Viajes', type: 'custom', icon: 'plane', hidden: true, balance: 8000 },
  ],
  transactions: [
    { id: 'tx-1', type: 'income', amount: 50000, description: 'Sueldo', account: 'daily', date: '2026-08-01' },
    { id: 'tx-2', type: 'expense', amount: -4000, description: 'Supermercado', account: 'daily', date: '2026-08-03' },
    { id: 'tx-3', type: 'expense', amount: -6000, description: 'Vuelo', account: 'custom-1', date: '2026-08-05' },
    { id: 'tx-4', type: 'transfer', amount: -10000, description: 'Transferencia', account: 'savings', date: '2026-08-10' },
  ],
} as const

function importJsonBuffer(): Buffer {
  return Buffer.from(JSON.stringify(IMPORT_JSON))
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Pinta el idioma ES (localStorage['language']) antes de que la app hidrate:
 * el headless chromium resuelve navigator.language → 'en' y rompería los
 * selectores en español. Se registra ANTES de ensureConfiguredState para que el
 * reload aplique ambos init scripts.
 */
async function seedSpanishLanguage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('language', 'es')
  })
}

/**
 * Setup inicial del presupuesto vía la UI real (mismo patrón que el reference
 * e6f944a). NO usar init scripts para sembrar `daily-budget-data`: se re-aplican
 * en cada navigation y pisarían el import en el reload de persistencia.
 */
async function setupViaUI(page: Page): Promise<void> {
  await page.goto('/')
  await expect(
    page.getByText('Configura tu presupuesto', { exact: true })
  ).toBeVisible()

  await page.locator('#startAmount').fill('100000')
  await page.getByRole('button', { name: 'Selecciona una fecha' }).click()
  await page.locator('[role="gridcell"]:not([disabled])').last().click()
  await page.getByRole('button', { name: 'Comenzar ahora' }).click()

  await expect(page.getByText('Presupuesto Diario', { exact: true })).toBeVisible()
}

/**
 * Abre la configuración desde el menú móvil (ConfigForm vive en el Sheet del
 * HeaderMenu) y devuelve el dialog de la configuración.
 */
async function openConfigSheet(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })

  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Primer 'Configuración de presupuesto': navegación a settings;
  // segundo: CollapsibleTrigger del formulario.
  const configButtons = page.getByRole('button', {
    name: 'Configuración de presupuesto',
  })
  await configButtons.first().click()
  await configButtons.last().click()

  const dialog = page.getByRole('dialog', {
    name: 'Configuración de presupuesto',
  })
  await expect(dialog.locator('form')).toBeVisible()
  return dialog
}

// ─── Tests ─────────────────────────────────────────────────

test('importa el export legacy: preview → reemplazo → toast → persistencia', async ({ page }) => {
  await seedSpanishLanguage(page)
  await setupViaUI(page)

  const configDialog = await openConfigSheet(page)
  await configDialog.getByTestId('import-data-button').click()

  const importDialog = page.getByRole('dialog', { name: 'Importar desde archivo' })
  await expect(importDialog).toBeVisible()

  // Elegir el archivo: como el estado ya tiene cuentas (setup previo), el
  // import implica reemplazo (FR-3) → preview con contadores y advertencia.
  await page.getByTestId('import-file-input').setInputFiles({
    name: 'daily-budget-export.json',
    mimeType: 'application/json',
    buffer: importJsonBuffer(),
  })

  const preview = page.getByTestId('import-preview')
  await expect(preview).toContainText('daily-budget-export.json')
  await expect(preview).toContainText('Cuentas: 3')
  await expect(preview).toContainText('Transacciones: 4')
  await expect(preview).toContainText('2026-08-01 — 2026-08-10')

  // Reemplazo: la advertencia exige confirmación explícita.
  await expect(page.getByTestId('import-overwrite-warning')).toBeVisible()
  await expect(
    page.getByText('Esto reemplazará tus datos actuales', { exact: true })
  ).toBeVisible()
  const confirmButton = page.getByTestId('import-confirm-button')
  await expect(confirmButton).toBeDisabled()
  await page.getByTestId('import-confirm-checkbox').click()
  await expect(confirmButton).toBeEnabled()
  await confirmButton.click()

  // Éxito: toast y cierre del modal.
  await expect(
    page.getByText('Datos importados correctamente', { exact: true })
  ).toBeVisible()
  await expect(importDialog).not.toBeVisible()

  // Persistencia (localStorage): tras recargar, la app arranca con los datos
  // importados y las cuentas reemplazan a las del setup.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload()
  await waitForAppReady(page)
  await expect(page.getByText('Presupuesto Diario', { exact: true })).toBeVisible()
  await expect(page.getByText('Presupuesto disponible hoy', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Cuentas' }).click()
  await expect(page.getByText('Diario', { exact: true })).toBeVisible()
  await expect(page.getByText('Ahorro', { exact: true })).toBeVisible()
})

test('archivo no válido: muestra el error sin abrir la confirmación', async ({ page }) => {
  await seedSpanishLanguage(page)
  await setupViaUI(page)

  const configDialog = await openConfigSheet(page)
  await configDialog.getByTestId('import-data-button').click()

  const importDialog = page.getByRole('dialog', { name: 'Importar desde archivo' })
  await expect(importDialog).toBeVisible()

  await page.getByTestId('import-file-input').setInputFiles({
    name: 'corrupto.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{esto no es json'),
  })

  await expect(page.getByTestId('import-error')).toContainText(
    'El archivo no es un JSON válido'
  )
  // Sin preview ni confirmación: el import no avanza.
  await expect(page.getByTestId('import-preview')).not.toBeVisible()
  await expect(page.getByTestId('import-confirm-button')).not.toBeVisible()
})