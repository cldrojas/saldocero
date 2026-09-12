import { defineConfig, devices } from '@playwright/test'
import { E2E_DB_PATH } from './tests/ui/e2e-db'

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 30_000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    baseURL: 'http://localhost:3100',
    // Locale fijo para que navigator.language coincida con el SSR ('es') y no
    // rompa la hidratación del language selector en los E2E.
    locale: 'es-ES',
    // ColorScheme fijo (light) para que next-themes resuelva el mismo tema en
    // server y cliente (el server usa defaultTheme="dark" + enableSystem).
    colorScheme: 'light',
  },
  webServer: {
    // Dev server dedicado para E2E: puerto propio (3100) y DB de test aislada.
    // No pisa el dev server del usuario en :3000 ni su DB real.
    command: 'pnpm exec next dev -p 3100',
    env: {
      SQLITE_DB_PATH: E2E_DB_PATH,
      NEXT_DIST_DIR: '.next-e2e',
    },
    port: 3100,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})