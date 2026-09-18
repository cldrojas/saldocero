// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { Page } from '@playwright/test'
import { addDays } from 'date-fns'
import { toInt } from '@/types'

export interface TestBudgetConfig {
  startAmount: number
  endDate?: Date
  autoSave?: boolean
}

export interface TestAccountConfig {
  id: string
  name: string
  type: string
  balance: number
  icon: string
}

export interface TestAppState {
  budget: TestBudgetConfig
  accounts: TestAccountConfig[]
  transactions?: any[]
  isSetup: boolean
}

/**
 * Default test configuration for budget app
 */
export const DEFAULT_TEST_CONFIG: TestAppState = {
  budget: {
    startAmount: 1000,
    endDate: addDays(new Date(), 30),
    autoSave: true
  },
  accounts: [
    {
      id: 'daily',
      name: 'Daily Budget',
      type: 'daily',
      balance: 1000,
      icon: 'wallet'
    },
    {
      id: 'savings',
      name: 'Savings',
      type: 'savings',
      balance: 500,
      icon: 'piggybank'
    },
    {
      id: 'investment',
      name: 'Investment',
      type: 'investment',
      balance: 2000,
      icon: 'trending-up'
    }
  ],
  isSetup: true
}

/**
 * Clears all localStorage data for the app
 */
export async function clearAppData(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Clear localStorage data
    localStorage.removeItem('daily-budget-data')

    // Override localStorage methods to ensure they work in test environment
    const originalSetItem = localStorage.setItem
    const originalGetItem = localStorage.getItem
    const originalRemoveItem = localStorage.removeItem

    localStorage.setItem = function(key, value) {
      try {
        return originalSetItem.call(this, key, value)
      } catch (e) {
        console.warn('localStorage.setItem failed:', e)
        return undefined
      }
    }

    localStorage.getItem = function(key) {
      try {
        return originalGetItem.call(this, key)
      } catch (e) {
        console.warn('localStorage.getItem failed:', e)
        return null
      }
    }

    localStorage.removeItem = function(key) {
      try {
        return originalRemoveItem.call(this, key)
      } catch (e) {
        console.warn('localStorage.removeItem failed:', e)
        return undefined
      }
    }
  })
}

/**
 * Sets up the app with test data by manipulating localStorage
 */
export async function setupTestAppState(page: Page, config: TestAppState = DEFAULT_TEST_CONFIG): Promise<void> {
  const testData = {
    budget: {
      startAmount: toInt(config.budget.startAmount),
      startDate: new Date(),
      endDate: config.budget.endDate || addDays(new Date(), 30),
      autoSave: config.budget.autoSave || true
    },
    accounts: config.accounts.map(account => ({
      id: account.id,
      name: account.name,
      type: account.type,
      balance: toInt(account.balance),
      icon: account.icon
    })),
    transactions: config.transactions || [],
    dailyAllowance: toInt(config.budget.startAmount / 30), // Rough daily allowance
    remainingToday: toInt(config.budget.startAmount / 30),
    progress: 100,
    lastCheckedDay: new Date(),
    isSetup: config.isSetup,
    autoSave: config.budget.autoSave || true
  }

  // Use addInitScript to set localStorage before page loads
  await page.addInitScript((data) => {
    // Set localStorage data
    localStorage.setItem('daily-budget-data', JSON.stringify(data))

    // Override localStorage methods to ensure they work in test environment
    const originalSetItem = localStorage.setItem
    const originalGetItem = localStorage.getItem
    const originalRemoveItem = localStorage.removeItem

    localStorage.setItem = function(key, value) {
      try {
        return originalSetItem.call(this, key, value)
      } catch (e) {
        console.warn('localStorage.setItem failed:', e)
        return undefined
      }
    }

    localStorage.getItem = function(key) {
      try {
        return originalGetItem.call(this, key)
      } catch (e) {
        console.warn('localStorage.getItem failed:', e)
        return null
      }
    }

    localStorage.removeItem = function(key) {
      try {
        return originalRemoveItem.call(this, key)
      } catch (e) {
        console.warn('localStorage.removeItem failed:', e)
        return undefined
      }
    }
  }, testData)
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
 * Ensures the app is in a setup state (clears data and shows setup form)
 */
export async function ensureSetupState(page: Page): Promise<void> {
  await clearAppData(page)
  await page.reload()
  await waitForAppReady(page)

  // Verify we're in setup state
  await page.waitForSelector('[data-testid="setup-form"]')
}

/**
 * Ensures the app is in a configured state with test data
 */
export async function ensureConfiguredState(page: Page, config: TestAppState = DEFAULT_TEST_CONFIG): Promise<void> {
  await setupTestAppState(page, config)
  await page.reload()
  await waitForAppReady(page)

  // Verify we're in configured state (should see main app content)
  await page.waitForSelector('h1')
}

/**
 * Gets current app state from localStorage
 */
export async function getCurrentAppState(page: Page): Promise<any> {
  return await page.evaluate(() => {
    const data = localStorage.getItem('daily-budget-data')
    return data ? JSON.parse(data) : null
  })
}

/**
 * Fills out the setup form with test data
 */
export async function fillSetupForm(page: Page, config: TestBudgetConfig = DEFAULT_TEST_CONFIG.budget): Promise<void> {
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
 * Creates a fresh app state with custom configuration
 */
export async function createFreshAppState(page: Page, config: TestAppState): Promise<void> {
  await ensureSetupState(page)
  await fillSetupForm(page, config.budget)
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