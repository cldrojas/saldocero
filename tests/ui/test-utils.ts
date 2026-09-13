// tests/ui/test-utils.ts
// Helpers E2E post-pivote offline-first: la app es 100% client-side
// (sql.js WASM + IndexedDB en el browser) y Playwright aísla el storage por
// test, así que el estado se prepara SIEMPRE vía la UI real (fillSetupForm).
// Ya no existe el stack server (app/actions + better-sqlite3), por lo que los
// helpers legacy de seed/lectura directa en SQLite fueron eliminados.
import type { Page } from '@playwright/test'
import { addDays } from 'date-fns'

export interface TestBudgetConfig {
  startAmount: number
  endDate?: Date
  autoSave?: boolean
}

/**
 * Waits for the app to be fully loaded and setup
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // Wait for either setup form or main app content
  await page.waitForFunction(() => {
    const setupForm = document.querySelector('[data-testid="setup-form"]')
    const mainApp = document.querySelector('h1')
    return setupForm !== null || mainApp !== null
  })
}

/**
 * Fills out the setup form with test data
 */
export async function fillSetupForm(
  page: Page,
  config: TestBudgetConfig = { startAmount: 500, endDate: addDays(new Date(), 30) }
): Promise<void> {
  // Wait for setup form to be visible
  await page.waitForSelector('[data-testid="setup-form"]')

  // Fill amount
  const amountInput = page.locator('[data-testid="setup-amount"]').or(
    page.locator('input[type="number"]')
  )
  await amountInput.fill(config.startAmount.toString())

  // Set end date (30 days from now if not specified)
  const endDate = config.endDate || addDays(new Date(), 30)
  const dateInput = page.locator('[data-testid="setup-end-date"]').or(
    page.locator('input[type="date"]')
  )

  if (await dateInput.isVisible()) {
    await dateInput.fill(endDate.toISOString().split('T')[0])
  }

  // Submit form
  const submitButton = page.locator('[data-testid="setup-submit"]').or(
    page.locator('button[type="submit"]')
  )
  await submitButton.click()

  // Wait for setup to complete
  await page.waitForSelector('h1')
}

/**
 * Utility to wait for toast notifications and get their content
 */
export async function waitForToast(page: Page, timeout: number = 5000): Promise<string | null> {
  try {
    const toast = page.locator('[data-testid="toast"]').or(
      page.locator('.toast').or(
        page.locator('[role="alert"]')
      )
    )

    await toast.waitFor({ timeout })

    const title = await toast.locator('[data-testid="toast-title"], .toast-title').textContent()
    const description = await toast.locator('[data-testid="toast-description"], .toast-description').textContent()

    return title || description || 'Toast appeared'
  } catch (error) {
    return null
  }
}

/**
 * Utility to dismiss toast notifications
 */
export async function dismissToast(page: Page): Promise<void> {
  const closeButton = page.locator('[data-testid="toast-close"], .toast-close, button[aria-label*="close"]')
  if (await closeButton.isVisible()) {
    await closeButton.click()
  }
}

/**
 * Waits for navigation to complete
 */
export async function waitForNavigation(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}

/**
 * Utility to check if app is in setup mode
 */
export async function isInSetupMode(page: Page): Promise<boolean> {
  return await page.locator('[data-testid="setup-form"]').isVisible()
}

/**
 * Utility to check if app is in configured mode
 */
export async function isInConfiguredMode(page: Page): Promise<boolean> {
  return await page.locator('h1').isVisible()
}