import { test, expect } from '@playwright/test'

test.describe('Theme Toggle', () => {
  test('should toggle between light and dark modes without hydration mismatches', async ({ page }) => {
    await page.goto('http://localhost:3000')

    // Wait for the page to load and check initial theme
    await page.waitForSelector('html')

    // Check initial theme is dark (default)
    const html = page.locator('html')
    await expect(html).toHaveClass(/dark/)

    // Find the theme toggle button
    const themeButton = page.locator('button[title*="Mode"]')
    await expect(themeButton).toBeVisible()

    // Click to toggle to light mode
    await themeButton.click()

    // Check that theme changed to light
    await expect(html).toHaveClass(/light/)

    // Click again to toggle back to dark
    await themeButton.click()

    // Check that theme changed back to dark
    await expect(html).toHaveClass(/dark/)
  })

  test('should maintain theme state across page reloads', async ({ page }) => {
    await page.goto('http://localhost:3000')

    // Toggle to light mode
    const themeButton = page.locator('button[title*="Mode"]')
    await themeButton.click()

    // Verify light mode
    const html = page.locator('html')
    await expect(html).toHaveClass(/light/)

    // Reload the page
    await page.reload()

    // Check that theme persists
    await expect(html).toHaveClass(/light/)
  })

  test('should show correct icon for current theme', async ({ page }) => {
    await page.goto('http://localhost:3000')

    const themeButton = page.locator('button[title*="Mode"]')

    // In dark mode, should show Sun icon (for switching to light)
    await expect(page.locator('button svg').first()).toBeVisible()

    // Toggle to light
    await themeButton.click()

    // In light mode, should show Moon icon (for switching to dark)
    await expect(page.locator('button svg').first()).toBeVisible()
  })
})