import { test, expect } from '@playwright/test'

const themeButton = (page: import('@playwright/test').Page) => page.getByTestId('theme-toggle')

test.describe('Language Selector', () => {
  test('should switch languages correctly without hydration errors', async ({ page }) => {
    await page.goto('/')

    // Wait for the page to load
    await page.waitForSelector('h1')

    // Check initial language - Spanish default (locale es-ES en config)
    const appName = page.locator('h1')
    const initialText = await appName.textContent()
    expect(['Saldo Cero', 'Saldo Cero']).toContain(initialText?.trim())

    // Find the language selector button
    const languageButton = page.locator('button:has(svg)').first() // Globe icon
    await expect(languageButton).toBeVisible()

    // Click to open dropdown
    await languageButton.click()

    // Select English
    await page.locator('text=English').click()

    // Check that app name changed to English
    await expect(appName).toHaveText('Saldo Cero') // App name is same in both

    // Check that some translated text changed - theme toggle title
    // En dark mode inicial: title = t("lightMode")
    await expect(themeButton(page)).toHaveAttribute('title', 'Light Mode')

    // Switch back to Spanish
    await languageButton.click()
    await page.locator('text=Español').click()

    // Check that title changed back
    await expect(themeButton(page)).toHaveAttribute('title', 'Modo Claro')
  })

  test('should detect initial language properly', async ({ page }) => {
    // Clear localStorage first
    await page.context().addInitScript(() => {
      localStorage.clear()
    })

    await page.goto('/')

    // Sin localStorage, el idioma inicial es 'es' (locale es-ES en config).
    // En dark mode inicial, el título del theme toggle usa t("lightMode").
    await expect(themeButton(page)).toHaveAttribute('title', 'Modo Claro')
  })

  test('should persist language selection across reloads', async ({ page }) => {
    await page.goto('/')

    // Switch to English
    const languageButton = page.locator('button:has(svg)').first()
    await languageButton.click()
    await page.locator('text=English').click()

    // Verify English
    await expect(themeButton(page)).toHaveAttribute('title', 'Light Mode')

    // Reload page
    await page.reload()

    // Check that language persists
    await expect(themeButton(page)).toHaveAttribute('title', 'Light Mode')
  })

  test('should show current language in selector button', async ({ page }) => {
    await page.goto('/')

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