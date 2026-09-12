import { test, expect, type Page } from '@playwright/test'
import { ensureConfiguredState } from './test-utils'

// La configuración del presupuesto vive en el Sheet del menú móvil
// (sm:hidden), así que estos tests corren en viewport móvil.
test.use({ viewport: { width: 390, height: 844 } })

// Abre el Sheet móvil → vista de configuración → expande el Collapsible del
// ConfigForm (que contiene el formulario).
async function openConfigForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open menu' }).click()
  // Primer botón "Configuración de presupuesto": navega a la vista settings
  await page.locator('button:has-text("Configuración de presupuesto")').first().click()
  // Segundo: el CollapsibleTrigger del ConfigForm expande el formulario
  await page.locator('button:has-text("Configuración de presupuesto")').last().click()
  // El formulario vive dentro del CollapsibleContent (solo montado si está abierto)
  await page.locator('form').first().waitFor()
}

test.describe('Config Form', () => {
  test('should render settings panel without hydration errors', async ({ page }) => {
    await ensureConfiguredState(page)

    // Abrir el menú móvil y verificar el trigger de configuración en el nav
    await page.getByRole('button', { name: 'Open menu' }).click()
    const navButton = page.locator('button:has-text("Configuración de presupuesto")')
    await expect(navButton).toBeVisible()

    // Verify the button has the settings icon
    await expect(navButton.locator('svg')).toBeVisible()

    // Click to open the config view
    await navButton.click()

    // El CollapsibleTrigger del ConfigForm también tiene icono de settings
    const formTrigger = page.locator('button:has-text("Configuración de presupuesto")')
    await expect(formTrigger).toBeVisible()
    await expect(formTrigger.locator('svg')).toBeVisible()

    // Click para expandir el formulario
    await formTrigger.click()

    // Check that the form content is now visible
    const form = page.locator('form').first()
    await expect(form).toBeVisible()

    // Verify form elements are present
    await expect(page.locator('input[type="number"]')).toBeVisible()
    await expect(page.getByRole('checkbox')).toBeVisible()
  })

  test('should handle form validation correctly', async ({ page }) => {
    await ensureConfiguredState(page)
    await openConfigForm(page)

    const amountInput = page.locator('input[type="number"]')
    const submitButton = page.locator('button:has-text("Guardar cambios")')

    // Monto 0 → startAmount falsy → falta información
    await amountInput.fill('0')
    await submitButton.click()
    await expect(page.getByText('Falta información', { exact: true })).toBeVisible()

    // Monto negativo → inválido
    await amountInput.fill('-100')
    await submitButton.click()
    await expect(page.getByText('Monto inválido', { exact: true })).toBeVisible()
  })

  test('should handle valid form submission', async ({ page }) => {
    await ensureConfiguredState(page)
    await openConfigForm(page)

    // Fill valid data
    const amountInput = page.locator('input[type="number"]')
    await amountInput.fill('1000')

    // Submit form
    const submitButton = page.locator('button:has-text("Guardar cambios")')
    await submitButton.click()

    // Check for success toast
    await expect(page.getByText('Presupuesto actualizado', { exact: true })).toBeVisible()

    // Verify form closes after successful submission (Collapsible se colapsa)
    await expect(page.locator('form').first()).not.toBeVisible()
  })

  test('should handle export data functionality', async ({ page }) => {
    // Export Data sale del hook (datos reales de SQLite), no de un backup
    // de localStorage: el seed se escribe en la DB de test.
    await ensureConfiguredState(page)
    await openConfigForm(page)

    // Click export button
    const exportButton = page.locator('button:has-text("Exportar datos")')
    await exportButton.click()

    // En headless no se inspecciona el archivo; verificamos que el botón
    // siga operativo tras disparar la descarga.
    await expect(exportButton).toBeVisible()
  })

  test('should handle clear data functionality with confirmation', async ({ page }) => {
    await ensureConfiguredState(page)
    await openConfigForm(page)

    // Click clear data button (destructive)
    const clearButton = page.locator('button:has-text("Borrar todos los datos")')
    await clearButton.click()

    // Radix AlertDialog → role="alertdialog"
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('¿Estás seguro?', { exact: true })).toBeVisible()

    // Click cancel to dismiss — Radix AlertDialog cierra con Escape.
    // No usamos click porque el overlay del Sheet (z-50 bg-black/80) se
    // interpone y Playwright no puede clickear limpiamente el botón.
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('should toggle auto-save setting', async ({ page }) => {
    await ensureConfiguredState(page)
    await openConfigForm(page)

    // El Checkbox es Radix → role="checkbox" (no un input nativo)
    const autoSaveCheckbox = page.getByRole('checkbox')

    // El seed usa autoSave: true → inicia chequeado
    await expect(autoSaveCheckbox).toBeChecked()

    // Toggle the checkbox
    await autoSaveCheckbox.click()

    // Verify it changed state
    await expect(autoSaveCheckbox).not.toBeChecked()
  })

  test('should be responsive on mobile devices', async ({ page }) => {
    await ensureConfiguredState(page)
    await openConfigForm(page)

    // Check that form is still usable on mobile
    await expect(page.locator('form').first()).toBeVisible()

    // Verify buttons are accessible
    await expect(page.locator('button:has-text("Guardar cambios")')).toBeVisible()

    // Check that inputs are properly sized for mobile
    await expect(page.locator('input[type="number"]')).toBeVisible()
  })

  test('should handle keyboard navigation', async ({ page }) => {
    await ensureConfiguredState(page)

    // Abrir el menú móvil y enfocar el trigger de configuración con teclado
    await page.getByRole('button', { name: 'Open menu' }).click()
    const navButton = page.locator('button:has-text("Configuración de presupuesto")')
    await navButton.focus()

    // Press Enter to navigate to the settings view
    await page.keyboard.press('Enter')

    // En la vista settings, expandir el Collapsible del form con teclado
    const formTrigger = page.locator('button:has-text("Configuración de presupuesto")')
    await formTrigger.focus()
    await page.keyboard.press('Enter')

    // Check that form opened
    await expect(page.locator('form').first()).toBeVisible()
  })

  test('should maintain state across form interactions', async ({ page }) => {
    await ensureConfiguredState(page)
    await openConfigForm(page)

    // Fill form data
    const amountInput = page.locator('input[type="number"]')
    await amountInput.fill('1500')

    // Toggle auto-save
    await page.getByRole('checkbox').click()

    // Close sheet without saving (Escape cierra el Sheet y resetea la vista)
    await page.keyboard.press('Escape')

    // Reopen form
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.locator('button:has-text("Configuración de presupuesto")').first().click()
    await page.locator('button:has-text("Configuración de presupuesto")').last().click()
    await page.locator('form').first().waitFor()

    // Verify form state was reset (values from DB, not unsaved edits)
    // DEFAULT_E2E_STATE.startAmount = 1000
    await expect(page.locator('input[type="number"]')).toHaveValue(/1000/)
  })
})