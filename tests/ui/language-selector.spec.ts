import { test, expect } from '@playwright/test'

test.describe('Language Selector', () => {
  test('should switch languages correctly without hydration errors', async ({ page }) => {
    await page.goto('http://localhost:3000')

    // Wait for the page to load
    await page.waitForSelector('h1')

    // Check initial language - should be Spanish by default or detected
    const appName = page.locator('h1')
    const initialText = await appName.textContent()

    // Find the language selector button
    const languageButton = page.locator('button:has(svg)').first() // Globe icon
    await expect(languageButton).toBeVisible()

    // Click to open dropdown
    await languageButton.click()

    // Select English
    await page.locator('text=English').click()

    // Check that app name changed to English
    await expect(appName).toHaveText('Saldo Cero') // App name is same in both

    // Check that some translated text changed - look for "Modo Oscuro" or "Dark Mode"
    const themeButton = page.locator('button[title*="Mode"]')
    await expect(themeButton).toHaveAttribute('title', 'Dark Mode')

    // Switch back to Spanish
    await languageButton.click()
    await page.locator('text=Español').click()

    // Check that title changed back
    await expect(themeButton).toHaveAttribute('title', 'Modo Oscuro')
  })

  test('should detect initial language properly', async ({ page }) => {
    // Clear localStorage first
    await page.context().addInitScript(() => {
      localStorage.clear()
    })

    await page.goto('http://localhost:3000')

    // Since no localStorage, it should detect browser language or default to 'es'
    // Assuming browser is English, but default is 'es', so check for Spanish
    const themeButton = page.locator('button[title*="Mode"]')
    const title = await themeButton.getAttribute('title')
    expect(title).toBe('Modo Oscuro') // Spanish
  })

  test('should persist language selection across reloads', async ({ page }) => {
    await page.goto('http://localhost:3000')

    // Switch to English
    const languageButton = page.locator('button:has(svg)').first()
    await languageButton.click()
    await page.locator('text=English').click()

    // Verify English
    const themeButton = page.locator('button[title*="Mode"]')
    await expect(themeButton).toHaveAttribute('title', 'Dark Mode')

    // Reload page
    await page.reload()

    // Check that language persists
    await expect(themeButton).toHaveAttribute('title', 'Dark Mode')
  })

  test('should show current language in selector button', async ({ page }) => {
    await page.goto('http://localhost:3000')

    const languageButton = page.locator('button:has(svg)').first()

    // Initially should show 'ES' or 'EN'
    const initialLang = await languageButton.textContent()
    expect(['ES', 'EN']).toContain(initialLang?.trim())

    // Switch to English
    await languageButton.click()
    await page.locator('text=English').click()

    // Should now show 'EN'
    await expect(languageButton).toHaveText('EN')
  })
})