// tests/ui/sync-qr.spec.ts
// E2E del QR claim export/import (qr-sync-export, task 5.4). Escenarios:
//   1. flujo feliz: A exporta por QR (deep-link) → B importa y converge
//   2. import manual obligatorio en B sin token configurado (banner) → converge
//   3. invalidación temprana: tras "Listo / Invalidar", reusar el token da 404
//   4. conflicto de sync code: replace dialog (cancelar → no aplica; confirmar → aplica)
//
// El relay se simula en memoria (contrato idéntico a /api/sync, /api/sync/meta,
// /api/sync/claim y /api/sync/claim/[token]; 401 con credenciales, token de un
// solo uso con TTL) compartido entre A y B vía page.route().
import { test, expect, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'

const SYNC_CODE = 'e2e-qr'
const OTHER_CODE = 'e2e-other'
const SYNC_TOKEN = 'token-e2e'
const EXPENSE_DESC = 'Café qr e2e'
const CLAIM_TTL_MS = 15 * 60 * 1000

const relay = new Map<string, { bytes: string; hash: string; updatedAt: string }>()
const claims = new Map<
  string,
  { status: 'open' | 'consumed'; syncCode: string; hash: string; expiresAt: number }
>()

function nowStamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function isoStamp(): string {
  return new Date().toISOString()
}

function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function installRelayStub(page: Page): Promise<void> {
  const credentials = (route: { request: () => { headers: () => Record<string, string> } }) => {
    const h = route.request().headers()
    return { code: h['x-sync-code'], token: h['x-sync-token'] }
  }

  await page.route('**/api/sync/meta', async (route) => {
    const { code, token } = credentials(route)
    if (!code || !token) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
      return
    }
    const snap = relay.get(code)
    if (!snap) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hash: snap.hash,
        size: Buffer.from(snap.bytes, 'base64').length,
        updatedAt: snap.updatedAt,
      }),
    })
  })

  await page.route('**/api/sync', async (route) => {
    const req = route.request()
    const { code, token } = credentials(route)
    if (!code || !token) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
      return
    }

    if (req.method() === 'GET') {
      const snap = relay.get(code)
      if (!snap) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bytes: snap.bytes, hash: snap.hash, updatedAt: snap.updatedAt }),
      })
      return
    }

    const body = req.postDataJSON() as { bytes?: string; basedOnHash?: string }
    if (!body?.bytes) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' })
      return
    }
    const snap = relay.get(code)
    if (snap && body.basedOnHash && body.basedOnHash !== snap.hash) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: '{}' })
      return
    }
    const hash = sha256hex(Buffer.from(body.bytes, 'base64'))
    const updatedAt = nowStamp()
    relay.set(code, { bytes: body.bytes, hash, updatedAt })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hash, updatedAt }),
    })
  })

  // POST /api/sync/claim → emite claim (requiere credenciales de A)
  await page.route('**/api/sync/claim', async (route) => {
    const req = route.request()
    const { code, token } = credentials(route)
    if (!code || !token) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) })
      return
    }
    const snap = relay.get(code)
    if (!snap) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'snapshot_not_found' }) })
      return
    }
    const claimToken = randomUUID()
    claims.set(claimToken, {
      status: 'open',
      syncCode: code,
      hash: snap.hash,
      expiresAt: Date.now() + CLAIM_TTL_MS,
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: claimToken, syncCode: code, hash: snap.hash, expiresAt: Date.now() + CLAIM_TTL_MS }),
    })
  })

  // GET/DELETE /api/sync/claim/<token> → consume de un solo uso / invalidación
  await page.route('**/api/sync/claim/*', async (route) => {
    const req = route.request()
    const token = new URL(req.url()).pathname.split('/').pop() ?? ''
    const claim = claims.get(token)

    if (req.method() === 'DELETE') {
      claims.delete(token)
      await route.fulfill({ status: 204, body: '' })
      return
    }

    if (!claim) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'claim_not_found' }) })
      return
    }
    if (claim.expiresAt <= Date.now()) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'claim_expired' }) })
      return
    }
    if (claim.status === 'consumed') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'claim_consumed' }) })
      return
    }
    const snap = relay.get(claim.syncCode)
    if (!snap) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'snapshot_not_found' }) })
      return
    }
    claim.status = 'consumed'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bytes: snap.bytes, hash: claim.hash, updatedAt: isoStamp(), syncCode: claim.syncCode }),
    })
  })
}

// ─── Helpers de UI (idioma es forzado en los contexts) ──────────────────────
async function setupDevice(page: Page): Promise<void> {
  await page.locator('#startAmount').fill('100000')
  await page.getByRole('button', { name: 'Selecciona una fecha' }).click()
  await page.locator('[role="gridcell"]:not([disabled])').last().click()
  await page.getByRole('button', { name: 'Comenzar ahora' }).click()
  await expect(page.getByTitle('Agregar gasto')).toBeVisible()
}

async function addExpense(page: Page, desc: string): Promise<void> {
  await page.getByTitle('Agregar gasto').click()
  await page.locator('#amount').fill('1000')
  await page.locator('#description').fill(desc)
  await page.getByRole('button', { name: 'Agregar gasto' }).click()
}

async function configureSync(page: Page, code: string): Promise<void> {
  await page.locator('#sync-code').fill(code)
  await page.locator('#sync-token').fill(SYNC_TOKEN)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Configuración guardada')).toBeVisible()
}

async function firstPush(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Subir datos por primera vez' }).click()
  await page.getByRole('button', { name: 'Sí, continuar' }).click()
}

/** Device A: setup + gasto + sync + push + claim QR → devuelve el token. */
async function setupExporter(page: Page): Promise<string> {
  await page.goto('/')
  await setupDevice(page)
  await addExpense(page, EXPENSE_DESC)
  await page.getByRole('tab', { name: 'Historial' }).click()
  await expect(page.getByText(EXPENSE_DESC).first()).toBeVisible()

  await configureSync(page, SYNC_CODE)
  await firstPush(page)
  await expect(page.getByText('Sincronizado').first()).toBeVisible()

  await page.getByTestId('qr-export-button').click()
  const tokenEl = page.getByTestId('claim-token')
  await expect(tokenEl).toBeVisible()
  const token = (await tokenEl.textContent())?.trim()
  expect(token).toMatch(/^[0-9a-f-]{36}$/)
  return token!
}

/** Device B: abre el modal import y va a la pestaña manual. */
async function openManualImport(page: Page): Promise<void> {
  await page.getByTestId('qr-import-button').click()
  await expect(page.getByRole('heading', { name: 'Escanear QR o ingresar código' })).toBeVisible()
  await page.getByRole('tab', { name: 'Ingresar código' }).click()
}

async function importByToken(page: Page, token: string): Promise<void> {
  await openManualImport(page)
  await page.getByTestId('claim-token-input').fill(token)
  await page.getByTestId('claim-import-button').click()
}

// El setup de A (tablero + sync + push + claim) en Next dev es lento; el import
// de B corre después dentro del mismo test → timeout amplio por test.
test.setTimeout(90_000)

test.beforeEach(() => {
  relay.clear()
  claims.clear()
})

test('qr: A exporta por QR → B importa por deep-link y converge', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  for (const context of [contextA, contextB]) {
    await context.addInitScript(() => {
      localStorage.setItem('language', 'es')
    })
  }
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await installRelayStub(pageA)
  await installRelayStub(pageB)

  const token = await setupExporter(pageA)
  const deepLink = `/sync-import?c=${encodeURIComponent(SYNC_CODE)}&claim=${encodeURIComponent(token)}`

  // B: el deep-link prefilla el token y corre el import automáticamente.
  await pageB.goto(deepLink)
  await expect(pageB.getByText('Vista previa del snapshot')).toBeVisible()
  await pageB.getByRole('button', { name: 'Confirmar e importar' }).click()

  // Al cerrar el modal, el deep-link navega a '/' donde B ya converge.
  await expect(pageB).toHaveURL(/\/$/)
  await expect(pageB.getByTitle('Agregar gasto')).toBeVisible()
  await pageB.getByRole('tab', { name: 'Historial' }).click()
  await expect(pageB.getByText(EXPENSE_DESC).first()).toBeVisible()

  // El claim queda consumido (un solo uso determinista).
  expect(claims.get(token)?.status).toBe('consumed')

  await contextA.close()
  await contextB.close()
})

test('qr: import manual obligatorio sin token configurado (banner) y converge', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  await contextA.addInitScript(() => localStorage.setItem('language', 'es'))
  await contextB.addInitScript(() => localStorage.setItem('language', 'es'))
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await installRelayStub(pageA)
  await installRelayStub(pageB)

  const token = await setupExporter(pageA)

  // B fresh: NO configura sync → el banner avisa que falta el token de
  // despliegue, pero el import por claim no exige credenciales (capability).
  await pageB.goto('/')
  await expect(pageB.getByText('Configuración de sincronización')).toBeVisible()
  await importByToken(pageB, token)
  await expect(pageB.getByText('Configura tu token de despliegue en Settings para sincronizar')).toBeVisible()
  await expect(pageB.getByText('Vista previa del snapshot')).toBeVisible()
  await pageB.getByRole('button', { name: 'Confirmar e importar' }).click()

  await expect(pageB.getByTitle('Agregar gasto')).toBeVisible()
  await pageB.getByRole('tab', { name: 'Historial' }).click()
  await expect(pageB.getByText(EXPENSE_DESC).first()).toBeVisible()

  await contextA.close()
  await contextB.close()
})

test('qr: invalidación temprana del claim → reintento da 404 claim_not_found', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  for (const context of [contextA, contextB]) {
    await context.addInitScript(() => localStorage.setItem('language', 'es'))
  }
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await installRelayStub(pageA)
  await installRelayStub(pageB)

  const token = await setupExporter(pageA)
  // El countdown del QR está visible mientras el claim vive.
  await expect(pageA.getByTestId('claim-countdown')).toBeVisible()

  // A invalida tempranamente el claim.
  await pageA.getByRole('button', { name: 'Listo / Invalidar' }).click()
  await expect(pageA.getByTestId('claim-token')).not.toBeVisible()
  expect(claims.has(token)).toBe(false)

  // B intenta importar el token invalidado → 404 claim_not_found.
  await pageB.goto('/')
  await importByToken(pageB, token)
  await expect(pageB.getByText('Código de claim no encontrado.')).toBeVisible()

  await contextA.close()
  await contextB.close()
})

test('qr: conflicto de sync code → cancelar no aplica, confirmar reemplaza y converge', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  for (const context of [contextA, contextB]) {
    await context.addInitScript(() => localStorage.setItem('language', 'es'))
  }
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await installRelayStub(pageA)
  await installRelayStub(pageB)

  const token = await setupExporter(pageA)
  // A ya no se necesita: cerrarla evita que Playwright capture su diálogo en
  // los error-contexts (el countdown la mantiene "activa") y elimina ruido.
  await contextA.close()

  // B ya tiene OTRO sync code configurado → el import dispara el replace dialog.
  await pageB.goto('/')
  await configureSync(pageB, OTHER_CODE)

  await importByToken(pageB, token)
  await expect(pageB.getByText('Vista previa del snapshot')).toBeVisible()
  await pageB.getByRole('button', { name: 'Confirmar e importar' }).click()
  await expect(pageB.getByText('Este dispositivo ya tiene un código de sync distinto')).toBeVisible()

  // Cancelar: el modal sigue en preview y NO aplica el import.
  // El ConfirmDialog renderiza con role="alertdialog" (no "dialog") y su
  // overlay bloquea el pointer del modal import → scoping directo.
  // Cancelar: el modal sigue en preview y NO aplica el import.
  // El ConfirmDialog renderiza con role="alertdialog". Radix monta dialogs
  // anidados vía portales y el pointer-action de Playwright es flaky con el
  // overlay apilado → se activa el botón vía evento DOM real (el handler React
  // corre igual, el estado del dialog se actualiza como con un click humano).
  await expect(pageB.getByRole('alertdialog')).toBeVisible()
  const clickAlertButton = (label: string) =>
    pageB.evaluate((lbl) => {
      const root = document.querySelector('[role="alertdialog"]')
      const btn = root && [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === lbl)
      if (btn) (btn as HTMLButtonElement).click()
      return !!btn
    }, label)

  expect(await clickAlertButton('Cancelar')).toBe(true)
  await expect(pageB.getByText('Vista previa del snapshot')).toBeVisible()
  expect(
    await pageB.evaluate(() => localStorage.getItem('saldo-cero-sync-code'))
  ).toBe(OTHER_CODE)

  // Confirmar: reemplaza el sync code y converge.
  await pageB.getByRole('button', { name: 'Confirmar e importar' }).click()
  await expect(pageB.getByRole('alertdialog')).toBeVisible()
  expect(await clickAlertButton('Sí, continuar')).toBe(true)
  await expect(pageB.getByTitle('Agregar gasto')).toBeVisible()
  expect(
    await pageB.evaluate(() => localStorage.getItem('saldo-cero-sync-code'))
  ).toBe(SYNC_CODE)
  await pageB.getByRole('tab', { name: 'Historial' }).click()
  await expect(pageB.getByText(EXPENSE_DESC).first()).toBeVisible()

  await contextA.close()
  await contextB.close()
})