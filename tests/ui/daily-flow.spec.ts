// tests/ui/daily-flow.spec.ts
// Spec de regresión (task 5.3) — reemplaza 5 specs legacy obsoletas por selectores
// robustos post-Batch 4 (header con HeaderMenu móvil; el SyncButton ya no existe,
// el QR vive en SyncSettings):
//   home, config-form, transfer-form, theme-toggle, language-selector
//
// El estado se prepara SIEMPRE vía la UI real: la app escribe el presupuesto en
// sql.js (WASM) + IndexedDB en el browser, mientras que los helpers legacy
// (ensureConfiguredState/seedDb) escribían la SQLite del server (better-sqlite3):
// bases distintas → el estado sembrado nunca llegaba a la app. Por eso acá el
// setup replica la interacción real del SetupForm (mismo patrón de
// sync-dual-device.spec.ts) y el shadcn DatePicker (popover, sin input date).
//
// Selectores basados en roles/texto accesible, NO en data-testids que no existen
// en la app (solo 'theme-toggle' tiene testid).
import { test, expect, type Page } from '@playwright/test'
import { waitForAppReady } from './test-utils'

// ─── Helpers ────────────────────────────────────────────────

/**
 * Completar el setup inicial del presupuesto a través de la UI real.
 * La app queda en modo setup (sin data) → se llena el formulario y se espera
 * la transición al estado diario (FAB visible = isSetup === false).
 */
async function setupViaUI(page: Page, startAmount = '100000'): Promise<void> {
  await page.goto('/')
  // El título del SetupForm es un elemento genérico (no role heading): la app lo
  // renderiza como texto simple. Aserción por texto, igual que en la UI real.
  await expect(
    page.getByText('Configura tu presupuesto', { exact: true })
  ).toBeVisible()

  await page.locator('#startAmount').fill(startAmount)
  // End date: abrir el DatePicker y elegir el último día habilitado del mes
  // (siempre futuro respecto de hoy → siempre seleccionable).
  await page.getByRole('button', { name: 'Selecciona una fecha' }).click()
  // react-day-picker (shadcn) renderiza cada día como <td role="gridcell"> sin
  // <button> anidado; los días fuera del mes/anteriores llegan [disabled].
  await page.locator('[role="gridcell"]:not([disabled])').last().click()
  await page.getByRole('button', { name: 'Comenzar ahora' }).click()

  // El FAB aparece solo cuando la app quedó en modo configurado.
  await expect(page.getByTitle('Agregar gasto')).toBeVisible()
}

/**
 * Crea una cuenta secundaria desde la tab Cuentas (el setup de UI solo crea la
 * cuenta 'daily'). El tipo default del AccountModal es 'savings'.
 */
async function createAccount(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: 'Cuentas' }).click()
  await page.getByRole('button', { name: 'Agregar nueva cuenta' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nombre de cuenta').fill(name)
  await dialog.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(dialog).not.toBeVisible()
}

/** Abre el TransferModal con el botón 'Transferir' del Navbar (Button plano, no tab) */
async function openTransferModal(page: Page) {
  await page.getByRole('button', { name: 'Transferir' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

/** Selecciona una cuenta en un shadcn Select: label → parent div → combobox trigger */
async function selectAccount(
  page: Page,
  labelText: string,
  accountNamePattern: RegExp | string
) {
  const label = page.getByText(labelText, { exact: true })
  const trigger = label.locator('..').getByRole('combobox')
  await trigger.click()
  await page.getByRole('option', { name: accountNamePattern }).click()
}

/** Envía el formulario de transferencia dentro del diálogo */
async function submitTransfer(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Transferencias' }).click()
}

// ─── Tests ──────────────────────────────────────────────────

test.describe('Flujo diario (regresión post-Batch 4)', () => {
  test('tour fresco: setup → estado diario → tabs → FAB → agregar gasto', async ({
    page
  }) => {
    await setupViaUI(page, '1000')

    // Estado diario visible
    await expect(page.getByText('Presupuesto Diario', { exact: true })).toBeVisible()
    await expect(
      page.getByText('Presupuesto disponible hoy', { exact: true })
    ).toBeVisible()

    // Tabs del Navbar: Cuentas/Historial son tabs Radix; Transferir es un Button
    await expect(page.getByRole('tab', { name: 'Cuentas' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Transferir' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Historial' })).toBeVisible()

    // FAB abre el diálogo de gasto (FAB y submit comparten nombre → scope al abrir)
    await page.getByRole('button', { name: 'Agregar gasto' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('heading', { name: 'Agregar gasto' })
    ).toBeVisible()

    // Cancelar cierra el diálogo sin persistir
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    await expect(dialog).not.toBeVisible()
  })

  test('agregar gasto completo con cuenta seleccionada', async ({ page }) => {
    await setupViaUI(page)

    await page.getByRole('button', { name: 'Agregar gasto' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel('Monto').fill('250')
    await dialog.getByLabel('Descripción').fill('Cena')

    // Cuenta: el Select usa Label 'Cuenta' + combobox (default 'daily' → la
    // única cuenta creada por el setup)
    await dialog.getByText('Cuenta', { exact: true }).locator('..').getByRole('combobox').click()
    await page.getByRole('option', { name: /Daily Budget/ }).click()

    await dialog.getByRole('button', { name: 'Agregar gasto' }).click()

    // Toast de éxito y cierre automático del diálogo
    await expect(page.getByText('Gasto registrado', { exact: true })).toBeVisible()
    await expect(dialog).not.toBeVisible()
  })

  test('modal de transferencia: render y validaciones', async ({ page }) => {
    await setupViaUI(page)
    await createAccount(page, 'Savings')
    await openTransferModal(page)

    const dialog = page.getByRole('dialog')

    // Render completo
    await expect(
      dialog.getByRole('heading', { name: 'Transferencias' })
    ).toBeVisible()
    await expect(dialog.locator('#amount')).toBeVisible()
    await expect(dialog.locator('#description')).toBeVisible()
    await expect(dialog.getByRole('combobox')).toHaveCount(2)
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible()

    // 1) Envío vacío → faltan cuentas
    await submitTransfer(page)
    await expect(page.getByText('Faltan cuentas', { exact: true })).toBeVisible()

    // 2) Monto negativo → monto inválido
    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Savings')
    await page.locator('#amount').fill('-50')
    await submitTransfer(page)
    await expect(page.getByText('Monto inválido', { exact: true })).toBeVisible()

    // 3) Misma cuenta → transferencia inválida (y el formulario conserva su estado)
    await page.locator('#amount').fill('100')
    await selectAccount(page, 'Hacia', 'Daily Budget')
    await submitTransfer(page)
    await expect(page.getByText('Transferencia inválida', { exact: true })).toBeVisible()
    await expect(page.locator('#amount')).toHaveValue('100')
  })

  test('fondos insuficientes en transferencia', async ({ page }) => {
    await setupViaUI(page, '100')
    await createAccount(page, 'Savings')
    await openTransferModal(page)

    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Savings')
    await page.locator('#amount').fill('99999')
    await submitTransfer(page)

    await expect(page.getByText('Fondos insuficientes', { exact: true })).toBeVisible()
  })

  test('transferencia exitosa: toast y cierre del modal', async ({ page }) => {
    await setupViaUI(page)
    await createAccount(page, 'Savings')
    await openTransferModal(page)

    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Savings')
    await page.locator('#amount').fill('100')
    await page.locator('#description').fill('Test transfer')
    await submitTransfer(page)

    await expect(page.getByText('Transferencia completada', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('configuración móvil: menú → presupuesto → guardar', async ({ page }) => {
    await setupViaUI(page)

    // ConfigForm vive en el Sheet del HeaderMenu (solo móvil). Sin reload: el
    // layout cambia por CSS responsive y el budget sigue en memoria (opción
    // elegida porque el boot-restore tras reload no lo ejercita ningún test).
    await page.setViewportSize({ width: 390, height: 844 })

    // Botón del menú móvil (hardcoded en inglés)
    await page.getByRole('button', { name: 'Open menu' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Primer 'Configuración de presupuesto': navegación a settings;
    // segundo: CollapsibleTrigger del formulario
    const configButtons = page.getByRole('button', {
      name: 'Configuración de presupuesto'
    })
    await configButtons.first().click()
    await configButtons.last().click()

    // Apuntar al form del diálogo (no al SetupForm del main): actualizar
    // monto inicial y guardar
    const dialog = page.getByRole('dialog', {
      name: 'Configuración de presupuesto'
    })
    const form = dialog.locator('form')
    await expect(form).toBeVisible()
    await form.locator('input[type="number"]').first().fill('1200')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page.getByText('Presupuesto actualizado', { exact: true })).toBeVisible()
  })

  test('idioma y tema: switch, persistencia y sin errores de hidratación', async ({
    page
  }) => {
    await page.goto('/')
    await waitForAppReady(page)

    const themeToggle = page.getByTestId('theme-toggle')

    // Por defecto: tema dark + idioma es (title del toggle = t('lightMode'))
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(themeToggle).toHaveAttribute('title', 'Modo Claro')

    // Cambiar idioma a inglés (menú items hardcoded: 'English'/'Español')
    // Regex de nombre accesible: tras el switch el botón pasa a mostrar 'EN'
    const langButton = page.getByRole('button', { name: /^(ES|EN)$/ })
    await langButton.click()
    await page.getByRole('menuitem', { name: 'English' }).click()
    await expect(langButton).toHaveText('EN')
    await expect(themeToggle).toHaveAttribute('title', 'Light Mode')

    // Alternar tema → light
    await themeToggle.click()
    await expect(page.locator('html')).toHaveClass(/light/)
    await expect(themeToggle).toHaveAttribute('title', 'Dark Mode')

    // Persiste tras recargar (localStorage localidad + tema)
    await page.reload()
    await waitForAppReady(page)
    await expect(themeToggle).toHaveAttribute('title', 'Dark Mode')
    await expect(page.getByRole('button', { name: 'EN', exact: true })).toBeVisible()
  })
})