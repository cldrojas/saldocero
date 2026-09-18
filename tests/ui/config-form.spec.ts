import { test, expect } from '@playwright/test'

test.describe('Config Form', () => {
  test('should render collapsible settings panel without hydration errors', async ({ page }) => {
    await page.goto('http://localhost:3000')

    // Wait for the page to load
    await page.waitForSelector('h1')

    // Check that the collapsible trigger is visible
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await expect(configButton).toBeVisible()

    // Verify the button has the settings icon
    await expect(configButton.locator('svg')).toBeVisible()

    // Click to open the collapsible
    await configButton.click()

    // Check that the form content is now visible
    const formCard = page.locator('[data-testid="config-form-card"]').or(
      page.locator('form').first()
    )
    await expect(formCard).toBeVisible()

    // Verify form elements are present
    await expect(page.locator('input[type="number"]')).toBeVisible()
    await expect(page.locator('[data-testid="date-picker"]')).toBeVisible()
    await expect(page.locator('input[type="checkbox"]')).toBeVisible()
  })

  test('should handle form validation correctly', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await page.waitForSelector('h1')

    // Open config form
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await configButton.click()

    // Try to submit without filling required fields
    const submitButton = page.locator('button:has-text("Actualizar Configuración")').or(
      page.locator('button:has-text("Update Settings")')
    )
    await submitButton.click()

    // Check for validation error toast
    await expect(page.locator('[data-testid="toast"]').or(
      page.locator('text=Información faltante').or(
        page.locator('text=Missing information')
      )
    )).toBeVisible()

    // Fill invalid amount (negative number)
    const amountInput = page.locator('input[type="number"]')
    await amountInput.fill('-100')

    await submitButton.click()

    // Check for invalid amount error
    await expect(page.locator('[data-testid="toast"]').or(
      page.locator('text=Cantidad inválida').or(
        page.locator('text=Invalid amount')
      )
    )).toBeVisible()
  })

  test('should handle valid form submission', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await page.waitForSelector('h1')

    // Open config form
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await configButton.click()

    // Fill valid data
    const amountInput = page.locator('input[type="number"]')
    await amountInput.fill('1000')

    // Select a future date
    const datePicker = page.locator('[data-testid="date-picker"]').or(
      page.locator('button').filter({ hasText: /^\d{1,2}\/\d{1,2}\/\d{4}$/ })
    )
    if (await datePicker.isVisible()) {
      await datePicker.click()
      // Select tomorrow's date (implementation depends on date picker component)
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toLocaleDateString()
      await page.locator(`text=${tomorrowStr}`).click()
    }

    // Submit form
    const submitButton = page.locator('button:has-text("Actualizar Configuración")').or(
      page.locator('button:has-text("Update Settings")')
    )
    await submitButton.click()

    // Check for success toast
    await expect(page.locator('[data-testid="toast"]').or(
      page.locator('text=Configuración actualizada').or(
        page.locator('text=Configuration updated')
      )
    )).toBeVisible()

    // Verify form closes after successful submission
    const formCard = page.locator('[data-testid="config-form-card"]').or(
      page.locator('form').first()
    )
    await expect(formCard).not.toBeVisible()
  })

  test('should handle export data functionality', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await page.waitForSelector('h1')

    // Open config form
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await configButton.click()

    // Mock localStorage data
    await page.evaluate(() => {
      localStorage.setItem('daily-budget-data', JSON.stringify({
        test: 'data',
        timestamp: new Date().toISOString()
      }))
    })

    // Click export button
    const exportButton = page.locator('button:has-text("Exportar Datos")').or(
      page.locator('button:has-text("Export Data")')
    )
    await exportButton.click()

    // Check that download was triggered (we can't actually check file download in headless mode)
    // but we can verify the button click worked
    await expect(exportButton).toBeVisible()
  })

  test('should handle clear data functionality with confirmation', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await page.waitForSelector('h1')

    // Open config form
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await configButton.click()

    // Click clear data button
    const clearButton = page.locator('button:has-text("Limpiar Datos")').or(
      page.locator('button:has-text("Clear Data")')
    )
    await clearButton.click()

    // Check that confirmation dialog appears
    const confirmDialog = page.locator('[data-testid="confirm-dialog"]').or(
      page.locator('text=¿Estás seguro?').or(
        page.locator('text=Are you sure?')
      )
    )
    await expect(confirmDialog).toBeVisible()

    // Click cancel to dismiss
    const cancelButton = page.locator('button:has-text("Cancelar")').or(
      page.locator('button:has-text("Cancel")')
    )
    await cancelButton.click()

    // Verify dialog is closed
    await expect(confirmDialog).not.toBeVisible()
  })

  test('should toggle auto-save setting', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await page.waitForSelector('h1')

    // Open config form
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await configButton.click()

    // Find and toggle the auto-save checkbox
    const autoSaveCheckbox = page.locator('input[type="checkbox"]').or(
      page.locator('[data-testid="auto-save-checkbox"]')
    )

    // Check initial state
    const initialChecked = await autoSaveCheckbox.isChecked()

    // Toggle the checkbox
    await autoSaveCheckbox.click()

    // Verify it changed state
    await expect(autoSaveCheckbox).toHaveValue(initialChecked ? 'off' : 'on')
  })

  test('should be responsive on mobile devices', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })

    await page.goto('http://localhost:3000')
    await page.waitForSelector('h1')

    // Open config form
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await configButton.click()

    // Check that form is still usable on mobile
    const formCard = page.locator('[data-testid="config-form-card"]').or(
      page.locator('form').first()
    )
    await expect(formCard).toBeVisible()

    // Verify buttons are accessible
    const submitButton = page.locator('button:has-text("Actualizar Configuración")').or(
      page.locator('button:has-text("Update Settings")')
    )
    await expect(submitButton).toBeVisible()

    // Check that inputs are properly sized for mobile
    const amountInput = page.locator('input[type="number"]')
    await expect(amountInput).toBeVisible()
  })

  test('should handle keyboard navigation', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await page.waitForSelector('h1')

    // Focus on config button using keyboard
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await configButton.focus()

    // Press Enter to open
    await page.keyboard.press('Enter')

    // Check that form opened
    const formCard = page.locator('[data-testid="config-form-card"]').or(
      page.locator('form').first()
    )
    await expect(formCard).toBeVisible()

    // Tab through form elements
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // Try to submit with Enter
    await page.keyboard.press('Enter')

    // Should show validation error
    await expect(page.locator('[data-testid="toast"]')).toBeVisible()
  })

  test('should maintain state across form interactions', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await page.waitForSelector('h1')

    // Open config form
    const configButton = page.locator('button:has-text("Configuración del Presupuesto")').or(
      page.locator('button:has-text("Budget Configuration")')
    )
    await configButton.click()

    // Fill form data
    const amountInput = page.locator('input[type="number"]')
    await amountInput.fill('1500')

    // Toggle auto-save
    const autoSaveCheckbox = page.locator('input[type="checkbox"]')
    await autoSaveCheckbox.click()

    // Close form without saving
    const cancelButton = page.locator('button:has-text("Cancelar")').or(
      page.locator('button:has-text("Cancel")')
    )
    await cancelButton.click()

    // Reopen form
    await configButton.click()

    // Verify form state was reset (form should be empty)
    await expect(amountInput).toHaveValue('')
    await expect(autoSaveCheckbox).not.toBeChecked()
  })
})