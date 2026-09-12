import type { Page } from '@playwright/test'

/**
 * Fuerza el idioma español en la página ANTES de que cargue la app.
 * La app lee `localStorage.language` (language-context.tsx); sin esto,
 * Playwright arranca con navigator.language en-US y la UI sale en inglés.
 */
export async function forceSpanish(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('language', 'es')
  })
}
