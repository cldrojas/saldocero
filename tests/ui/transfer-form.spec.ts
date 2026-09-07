import { test, expect, type Page } from '@playwright/test'
import {
  ensureConfiguredState,
  waitForAppReady
} from './test-utils'
import { HIGH_BALANCE_SETUP, LOW_BALANCE_SETUP } from './test-data'

// ─── Helpers ────────────────────────────────────────────────

/** Open the TransferModal by clicking the "Transferir" button in the Navbar tablist */
async function openTransferModal(page: Page) {
  await page
    .locator('[role="tablist"]')
    .getByRole('button', { name: 'Transferir' })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

/**
 * Select an account in a shadcn Select (Radix).
 * Finds the <label> by exact text, walks up to the parent div,
 * then clicks the combobox trigger inside it.
 */
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

/** Submit the transfer form inside the dialog */
async function submitTransfer(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Transferencias' }).click()
}

// ─── Tests ──────────────────────────────────────────────────

test.describe('Transfer Form', () => {
  test('should render transfer modal with all form elements', async ({
    page
  }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    const dialog = page.getByRole('dialog')

    // Title
    await expect(dialog.getByRole('heading', { name: 'Transferencias' })).toBeVisible()

    // Form fields
    await expect(dialog.locator('#amount')).toBeVisible()
    await expect(dialog.locator('#description')).toBeVisible()
    await expect(dialog.getByRole('combobox')).toHaveCount(2)

    // Buttons
    await expect(
      dialog.getByRole('button', { name: 'Cancelar' })
    ).toBeVisible()
    // Submit button contains icon + text "Transferencias"
    await expect(
      dialog.getByRole('button', { name: 'Transferencias' })
    ).toBeVisible()
  })

  test('should show validation error when submitting empty form', async ({
    page
  }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    // Submit without selecting accounts
    await submitTransfer(page)

    await expect(page.getByText('Faltan cuentas', { exact: true })).toBeVisible()
  })

  test('should show validation error for same-account transfer', async ({
    page
  }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    // Select the same account for both source and destination
    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Daily Budget')

    await page.locator('#amount').fill('100')
    await submitTransfer(page)

    await expect(page.getByText('Transferencia inválida', { exact: true })).toBeVisible()
  })

  test('should show validation error for negative amount', async ({
    page
  }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Savings')

    await page.locator('#amount').fill('-50')
    await submitTransfer(page)

    await expect(page.getByText('Monto inválido', { exact: true })).toBeVisible()
  })

  test('should show validation error for zero amount', async ({ page }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Savings')

    await page.locator('#amount').fill('0')
    await submitTransfer(page)

    await expect(page.getByText('Monto inválido', { exact: true })).toBeVisible()
  })

  test('should complete a valid transfer successfully', async ({ page }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Savings')

    await page.locator('#amount').fill('100')
    await page.locator('#description').fill('Test transfer')

    await submitTransfer(page)

    // Success toast
    await expect(page.getByText('Transferencia completada', { exact: true })).toBeVisible()

    // Modal closes
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('should show insufficient funds error', async ({ page }) => {
    await ensureConfiguredState(page, LOW_BALANCE_SETUP)
    await openTransferModal(page)

    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Savings')

    // Daily Budget has balance 100 — try to transfer 99999
    await page.locator('#amount').fill('99999')
    await submitTransfer(page)

    await expect(page.getByText('Fondos insuficientes', { exact: true })).toBeVisible()
  })

  test('should maintain form state after validation error', async ({
    page
  }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    // Fill the form
    await page.locator('#amount').fill('200')
    await page.locator('#description').fill('State preservation test')

    // Select same account → triggers validation error
    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Daily Budget')

    await submitTransfer(page)
    await expect(page.getByText('Transferencia inválida', { exact: true })).toBeVisible()

    // Form values should be preserved
    await expect(page.locator('#amount')).toHaveValue('200')
    await expect(page.locator('#description')).toHaveValue(
      'State preservation test'
    )
  })

  test('should support keyboard interaction on form elements', async ({
    page
  }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    // Amount input should be focusable
    const amountInput = page.locator('#amount')
    await amountInput.focus()
    await expect(amountInput).toBeFocused()
    await amountInput.fill('50')

    // Description input should be focusable
    const descInput = page.locator('#description')
    await descInput.focus()
    await expect(descInput).toBeFocused()
    await descInput.fill('Keyboard test')

    // Selects should be focusable via keyboard
    const fromTrigger = page
      .getByText('Desde', { exact: true })
      .locator('..')
      .getByRole('combobox')
    await fromTrigger.focus()
    await expect(fromTrigger).toBeFocused()

    // Press Escape to close dialog (valid keyboard action)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('should display account options with balances in from selector', async ({
    page
  }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    // Open the "from" account selector
    const fromTrigger = page
      .getByText('Desde', { exact: true })
      .locator('..')
      .getByRole('combobox')
    await fromTrigger.click()

    // Verify account options are visible
    await expect(
      page.getByRole('option', { name: /Daily Budget/ })
    ).toBeVisible()
    await expect(
      page.getByRole('option', { name: /Savings/ })
    ).toBeVisible()
    await expect(
      page.getByRole('option', { name: /Investment/ })
    ).toBeVisible()
    await expect(
      page.getByRole('option', { name: /Emergency Fund/ })
    ).toBeVisible()

    // Select one
    await page.getByRole('option', { name: /Savings/ }).click()
  })

  test('should handle decimal amounts correctly', async ({ page }) => {
    await ensureConfiguredState(page, HIGH_BALANCE_SETUP)
    await openTransferModal(page)

    await selectAccount(page, 'Desde', 'Daily Budget')
    await selectAccount(page, 'Hacia', 'Savings')

    await page.locator('#amount').fill('75.50')
    await page.locator('#description').fill('Decimal transfer test')

    await submitTransfer(page)

    await expect(page.getByText('Transferencia completada', { exact: true })).toBeVisible()
  })

  test('should handle uninitialized state (no accounts)', async ({ page }) => {
    await ensureConfiguredState(page, {
      budget: {
        startAmount: 0,
        endDate: new Date(),
        autoSave: false
      },
      accounts: [],
      isSetup: true
    })

    // Page-level EmptyState (accounts.length === 0)
    await expect(page.getByText('Sin cuentas disponibles')).toBeVisible()
  })

  test('should open transfer modal with single account', async ({ page }) => {
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

    // With 1 account the Navbar renders; modal can open
    await openTransferModal(page)

    // Form is visible
    await expect(page.locator('#amount')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('combobox')).toHaveCount(2)

    // The from selector should have 1 option
    const fromTrigger = page
      .getByText('Desde', { exact: true })
      .locator('..')
      .getByRole('combobox')
    await fromTrigger.click()
    await expect(
      page.getByRole('option', { name: /Daily Budget/ })
    ).toBeVisible()
  })
})
