// tests/ui/test-utils.ts
// Helpers E2E post-pivote: el seed se escribe DIRECTO en SQLite (e2e-db.ts),
// ya no en localStorage (que quedó solo para preferencias UI como language).
import type { Page } from '@playwright/test'
import { addDays } from 'date-fns'
import {
  DEFAULT_E2E_STATE,
  type E2EAppState,
  clearDb,
  seedDb,
} from './e2e-db'

export type TestAppState = E2EAppState
export { DEFAULT_E2E_STATE } from './e2e-db'

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

export interface TestTransactionConfig {
  id: string
  type: string
  amount: number
  description: string
  account: string
  date: Date
}

/**
 * Default test configuration for budget app (SQLite seed).
 */
export const DEFAULT_TEST_CONFIG: TestAppState = DEFAULT_E2E_STATE

function toE2EState(
  budget: TestBudgetConfig,
  accounts: TestAccountConfig[],
  transactions: TestTransactionConfig[] | undefined,
  isSetup: boolean
): E2EAppState {
  return {
    budget: {
      startAmount: budget.startAmount,
      endDate: budget.endDate || addDays(new Date(), 30),
      autoSave: budget.autoSave !== false,
    },
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: a.balance,
      icon: a.icon,
    })),
    transactions: transactions?.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      description: t.description,
      account: t.account,
      date: t.date,
    })),
    isSetup,
  }
}

/**
 * Clears ALL app data: la DB de test se vacía (source of truth financiera)
 * y el estado de la UI se deja sin sesión previa.
 */
export async function clearAppData(_page: Page): Promise<void> {
  clearDb()
}

/**
 * Seeds la app con datos de prueba escribiendo directamente en SQLite.
 * Los tests no dependen de localStorage para datos de dominio.
 */
export async function setupTestAppState(
  _page: Page,
  config: Partial<TestAppState> = {}
): Promise<void> {
  const full: TestAppState = {
    budget: config.budget ?? DEFAULT_TEST_CONFIG.budget,
    accounts: config.accounts ?? DEFAULT_TEST_CONFIG.accounts,
    transactions: config.transactions,
    isSetup: config.isSetup ?? DEFAULT_TEST_CONFIG.isSetup,
  }
  seedDb(toE2EState(full.budget, full.accounts, full.transactions, full.isSetup))
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
  await page.goto('/')
  await waitForAppReady(page)

  // Verify we're in setup state
  await page.waitForSelector('[data-testid="setup-form"]')
}

/**
 * Ensures the app is in a configured state with test data
 */
export async function ensureConfiguredState(
  page: Page,
  config: Partial<TestAppState> = {}
): Promise<void> {
  await setupTestAppState(page, config)
  await page.goto('/')
  await waitForAppReady(page)

  // Verify we're in configured state (should see main app content)
  await page.waitForSelector('h1')
}

/**
 * Gets current app state from SQLite (via the same file the server uses).
 * Retorna el estado persistido en la DB de test.
 */
export async function getCurrentAppState(_page: Page): Promise<any> {
  // La DB se lee desde el proceso del test (misma ruta que el webServer).
  // Switchea según necesidad; para lectura simple, se exporta desde e2e-db.
  const { E2E_DB_PATH } = await import('./e2e-db')
  const Database = (await import('better-sqlite3')).default
  const db = new Database(E2E_DB_PATH)
  try {
    const budget = db.prepare(`SELECT * FROM budgets WHERE id = 'default'`).get()
    const accounts = db.prepare(
      `SELECT a.*, COALESCE(SUM(t.amount), 0) AS balance
       FROM accounts a
       LEFT JOIN transactions t ON t.account_id = a.id
       GROUP BY a.id
       ORDER BY a.type`
    ).all()
    const transactions = db.prepare(`SELECT * FROM transactions ORDER BY date DESC`).all()
    return { budget, accounts, transactions }
  } finally {
    db.close()
  }
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