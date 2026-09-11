import { test, expect } from '@playwright/test'

// El tema inicial es determinístico: ThemeProvider usa defaultTheme="dark",
// así que el server renderiza dark y el cliente hidrata igual.
test.describe('Theme Toggle', () => {
  test('should toggle between light and dark modes without hydration mismatches', async ({ page }) => {
    await page.goto('/')

    const html = page.locator('html')

    // Initial theme: dark (defaultTheme del ThemeProvider)
    await expect(html).toHaveClass(/dark/)

    // Theme toggle button (data-testid, no depende del idioma)
    const themeButton = page.getByTestId('theme-toggle')
    await expect(themeButton).toBeVisible()

    // Click to toggle to light mode
    await themeButton.click()
    await expect(html).toHaveClass(/light/)

    // Click again to toggle back to dark
    await themeButton.click()
    await expect(html).toHaveClass(/dark/)
  })

  test('should maintain theme state across page reloads', async ({ page }) => {
    await page.goto('/')

    const html = page.locator('html')
    const themeButton = page.getByTestId('theme-toggle')

    // Toggle to light mode
    await themeButton.click()
    await expect(html).toHaveClass(/light/)

    // Reload: next-themes persiste en localStorage (storageKey="theme")
    await page.reload()
    await expect(html).toHaveClass(/light/)
  })

  test('should show correct icon for current theme', async ({ page }) => {
    await page.goto('/')

    const themeButton = page.getByTestId('theme-toggle')

    // En dark mode, muestra icono de sun (acción: pasar a light)
    await expect(themeButton.locator('svg.lucide-sun')).toBeVisible()

    // Toggle a light: muestra moon (acción: pasar a dark)
    await themeButton.click()
    await expect(themeButton.locator('svg.lucide-moon')).toBeVisible()
  })
})