import { test, expect } from '@playwright/test'
import {
  ensureConfiguredState,
  waitForAppReady
} from './test-utils'
import { HIGH_BALANCE_SETUP, LOW_BALANCE_SETUP, getTransferTestData, getTestScenario } from './test-data'

test.describe('Transfer Form', () => {
  test('should render transfer form without hydration errors', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Check that the transfer form is visible
    const formCard = page.locator('[data-testid="transfer-form"]').or(
      page.locator('h3:has-text("Transferir Fondos")').or(
        page.locator('h3:has-text("Transfer Funds")')
      ).locator('..').locator('..')
    )
    await expect(formCard).toBeVisible()

    // Verify form elements are present
    await expect(page.locator('select').or(page.locator('[role="combobox"]'))).toHaveCount(2)
    await expect(page.locator('input[type="number"]')).toBeVisible()
    await expect(page.locator('input[placeholder*="transfer"]').or(
      page.locator('input[placeholder*="Transferir"]')
    )).toBeVisible()
    await expect(page.locator('button:has-text("Transferir Fondos")').or(
      page.locator('button:has-text("Transfer Funds")')
    )).toBeVisible()
  })

  test('should handle form validation correctly', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Try to submit empty form
    const submitButton = page.locator('button:has-text("Transferir Fondos")').or(
      page.locator('button:has-text("Transfer Funds")')
    )
    await submitButton.click()

    // Check for validation error toast
    await expect(page.locator('[data-testid="toast"]').or(
      page.locator('text=Cuentas faltantes').or(
        page.locator('text=Missing accounts')
      )
    )).toBeVisible()

    // Select same account for both source and destination
    const fromSelect = page.locator('[data-testid="transfer-from-account"]').first()
    const toSelect = page.locator('[data-testid="transfer-to-account"]').first()

    if (await fromSelect.isVisible() && await toSelect.isVisible()) {
      await fromSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      await toSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      const amountInput = page.locator('input[type="number"]')
      await amountInput.fill('100')

      await submitButton.click()

      // Check for invalid transfer error
      await expect(page.locator('[data-testid="toast"]').or(
        page.locator('text=Transferencia inválida').or(
          page.locator('text=Invalid transfer')
        )
      )).toBeVisible()
    }

    // Fill invalid amount (negative number)
    const amountInput = page.locator('[data-testid="transfer-amount"]')
    await amountInput.fill('-50')

    await submitButton.click()

    // Check for invalid amount error
    await expect(page.locator('[data-testid="toast"]').or(
      page.locator('text=Cantidad inválida').or(
        page.locator('text=Invalid amount')
      )
    )).toBeVisible()

    // Fill zero amount
    await amountInput.fill('0')
    await submitButton.click()

    // Check for invalid amount error
    await expect(page.locator('[data-testid="toast"]').or(
      page.locator('text=Cantidad inválida').or(
        page.locator('text=Invalid amount')
      )
    )).toBeVisible()
  })

  test('should handle valid transfer submission', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Select different accounts for transfer
    const fromSelect = page.locator('[data-testid="transfer-from-account"]').first()
    const toSelect = page.locator('[data-testid="transfer-to-account"]').first()

    if (await fromSelect.isVisible() && await toSelect.isVisible()) {
      await fromSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      await toSelect.click()
      await page.locator('text=Savings').or(page.locator('text=Ahorros')).click()

      // Fill valid amount
      const amountInput = page.locator('[data-testid="transfer-amount"]')
      await amountInput.fill('100')

      // Fill description
      const descriptionInput = page.locator('[data-testid="transfer-description"]')
      await descriptionInput.fill('Test transfer')

      // Submit form
      const submitButton = page.locator('button:has-text("Transferir Fondos")').or(
        page.locator('button:has-text("Transfer Funds")')
      )
      await submitButton.click()

      // Check for success toast
      await expect(page.locator('[data-testid="toast"]').or(
        page.locator('text=Transferencia completada').or(
          page.locator('text=Transfer completed')
        )
      )).toBeVisible()

      // Verify form is reset after successful submission
      await expect(amountInput).toHaveValue('')
      await expect(descriptionInput).toHaveValue('')
    }
  })

  test('should handle insufficient funds validation', async ({ page }) => {
    // Set up test app state with low balance for testing insufficient funds
    await ensureConfiguredState(page, LOW_BALANCE_SETUP)

    // Select accounts for transfer
    const fromSelect = page.locator('[data-testid="transfer-from-account"]').first()
    const toSelect = page.locator('[data-testid="transfer-to-account"]').first()

    if (await fromSelect.isVisible() && await toSelect.isVisible()) {
      await fromSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      await toSelect.click()
      await page.locator('text=Savings').or(page.locator('text=Ahorros')).click()

      // Fill amount that exceeds account balance
      const amountInput = page.locator('[data-testid="transfer-amount"]')
      await amountInput.fill('999999')

      // Submit form
      const submitButton = page.locator('[data-testid="transfer-submit"]')
      await submitButton.click()

      // Check for insufficient funds error
      await expect(page.locator('[data-testid="toast"]').or(
        page.locator('text=Fondos insuficientes').or(
          page.locator('text=Insufficient funds')
        )
      )).toBeVisible()
    }
  })

  test('should handle account selection with balance display', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Check from account selector
    const fromSelect = page.locator('[data-testid="transfer-from-account"]').first()

    if (await fromSelect.isVisible()) {
      await fromSelect.click()

      // Check that account options show balances
      const dailyOption = page.locator('text=Daily').or(page.locator('text=Diario'))
      await expect(dailyOption).toBeVisible()

      // Select Daily account
      await dailyOption.click()
      await expect(fromSelect).toHaveValue('daily')
    }

    // Check to account selector
    const toSelect = page.locator('[data-testid="transfer-to-account"]').first()

    if (await toSelect.isVisible()) {
      await toSelect.click()

      // Check that destination accounts are available
      const savingsOption = page.locator('text=Savings').or(page.locator('text=Ahorros'))
      await expect(savingsOption).toBeVisible()

      const investmentOption = page.locator('text=Investment').or(page.locator('text=Inversión'))
      await expect(investmentOption).toBeVisible()

      // Select Savings account
      await savingsOption.click()
      await expect(toSelect).toHaveValue('savings')
    }
  })

  test('should handle description input', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    const descriptionInput = page.locator('[data-testid="transfer-description"]')

    // Test placeholder text
    const placeholder = await descriptionInput.getAttribute('placeholder')
    expect(placeholder).toMatch(/(¿Para qué es esta transferencia\?|What is this transfer for\?)/)

    // Fill description
    await descriptionInput.fill('Monthly savings transfer')

    // Verify value is set
    await expect(descriptionInput).toHaveValue('Monthly savings transfer')

    // Test empty description (should use default)
    await descriptionInput.clear()

    // Submit form to test default description
    const fromSelect = page.locator('[data-testid="transfer-from-account"]').first()
    const toSelect = page.locator('[data-testid="transfer-to-account"]').first()

    if (await fromSelect.isVisible() && await toSelect.isVisible()) {
      await fromSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      await toSelect.click()
      await page.locator('text=Savings').or(page.locator('text=Ahorros')).click()

      const amountInput = page.locator('[data-testid="transfer-amount"]')
      await amountInput.fill('50')

      const submitButton = page.locator('button:has-text("Transferir Fondos")').or(
        page.locator('button:has-text("Transfer Funds")')
      )
      await submitButton.click()

      // Should succeed with default description
      await expect(page.locator('[data-testid="toast"]').or(
        page.locator('text=Transferencia completada').or(
          page.locator('text=Transfer completed')
        )
      )).toBeVisible()
    }
  })

  test('should handle keyboard navigation', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Tab through form elements
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // Fill form using keyboard
    await page.keyboard.type('100')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Keyboard test transfer')
    await page.keyboard.press('Tab')

    // Submit with Enter
    await page.keyboard.press('Enter')

    // Check for success toast
    await expect(page.locator('[data-testid="toast"]').or(
      page.locator('text=Transferencia completada').or(
        page.locator('text=Transfer completed')
      )
    )).toBeVisible()
  })

  test('should maintain form state during validation errors', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Fill partial data
    const amountInput = page.locator('[data-testid="transfer-amount"]')
    await amountInput.fill('200')

    const descriptionInput = page.locator('[data-testid="transfer-description"]')
    await descriptionInput.fill('State preservation test')

    // Try to submit with invalid data (same accounts)
    const fromSelect = page.locator('[data-testid="transfer-from-account"]').first()
    const toSelect = page.locator('[data-testid="transfer-to-account"]').first()

    if (await fromSelect.isVisible() && await toSelect.isVisible()) {
      await fromSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      await toSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      const submitButton = page.locator('button:has-text("Transferir Fondos")').or(
        page.locator('button:has-text("Transfer Funds")')
      )
      await submitButton.click()

      // Verify form data is preserved after validation error
      await expect(amountInput).toHaveValue('200')
      await expect(descriptionInput).toHaveValue('State preservation test')
    }
  })

  test('should handle decimal amounts', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Select accounts for transfer
    const fromSelect = page.locator('[data-testid="transfer-from-account"]').first()
    const toSelect = page.locator('[data-testid="transfer-to-account"]').first()

    if (await fromSelect.isVisible() && await toSelect.isVisible()) {
      await fromSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      await toSelect.click()
      await page.locator('text=Savings').or(page.locator('text=Ahorros')).click()

      // Test decimal input
      const amountInput = page.locator('[data-testid="transfer-amount"]')
      await amountInput.fill('75.25')

      const descriptionInput = page.locator('[data-testid="transfer-description"]')
      await descriptionInput.fill('Decimal transfer test')

      // Submit form
      const submitButton = page.locator('button:has-text("Transferir Fondos")').or(
        page.locator('button:has-text("Transfer Funds")')
      )
      await submitButton.click()

      // Check for success toast
      await expect(page.locator('[data-testid="toast"]').or(
        page.locator('text=Transferencia completada').or(
          page.locator('text=Transfer completed')
        )
      )).toBeVisible()
    }
  })

  test('should be accessible', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Check form labels
    await expect(page.locator('label')).toHaveCount(4)

    // Check input accessibility
    const amountInput = page.locator('[data-testid="transfer-amount"]')
    await expect(amountInput).toHaveAttribute('required')

    const descriptionInput = page.locator('[data-testid="transfer-description"]')
    await expect(descriptionInput).toBeVisible()

    // Check button accessibility
    const submitButton = page.locator('button:has-text("Transferir Fondos")').or(
      page.locator('button:has-text("Transfer Funds")')
    )
    await expect(submitButton).toBeVisible()

    // Test focus management
    await amountInput.focus()
    await expect(amountInput).toBeFocused()
  })

  test('should handle rapid form submissions', async ({ page }) => {
    // Set up test app state with multiple accounts
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)

    // Select accounts for transfer
    const fromSelect = page.locator('[data-testid="transfer-from-account"]').first()
    const toSelect = page.locator('[data-testid="transfer-to-account"]').first()

    if (await fromSelect.isVisible() && await toSelect.isVisible()) {
      await fromSelect.click()
      await page.locator('text=Daily').or(page.locator('text=Diario')).click()

      await toSelect.click()
      await page.locator('text=Savings').or(page.locator('text=Ahorros')).click()

      // Fill form data
      const amountInput = page.locator('[data-testid="transfer-amount"]')
      const descriptionInput = page.locator('[data-testid="transfer-description"]')
      const submitButton = page.locator('button:has-text("Transferir Fondos")').or(
        page.locator('button:has-text("Transfer Funds")')
      )

      // Submit multiple times quickly
      await amountInput.fill('25')
      await descriptionInput.fill('Rapid transfer 1')
      await submitButton.click()

      await amountInput.fill('50')
      await descriptionInput.fill('Rapid transfer 2')
      await submitButton.click()

      // Check that both transfers were processed
      await expect(page.locator('[data-testid="toast"]')).toHaveCount(2)
    }
  })

  test('should handle uninitialized app state gracefully', async ({ page }) => {
    // Test with no accounts (uninitialized state)
    await ensureConfiguredState(page, {
      budget: {
        startAmount: 0,
        endDate: new Date(),
        autoSave: false
      },
      accounts: [],
      isSetup: true
    })

    // Should show empty state instead of crashing
    await expect(page.locator('text=No accounts available')).toBeVisible()
    await expect(page.locator('button:has-text("Add Account")')).toBeVisible()
  })

  test('should handle insufficient accounts for transfers', async ({ page }) => {
    // Test with only one account (not enough for transfers)
    await ensureConfiguredState(page, {
      budget: {
        startAmount: 1000,
        endDate: new Date(),
        autoSave: false
      },
      accounts: [
        {
          id: 'daily',
          name: 'Daily Budget',
          type: 'daily',
          balance: 1000,
          icon: 'wallet'
        }
      ],
      isSetup: true
    })

    // Should show insufficient accounts message
    await expect(page.locator('text=Need more accounts')).toBeVisible()
    await expect(page.locator('button:has-text("Add Account")')).toBeVisible()
  })
})