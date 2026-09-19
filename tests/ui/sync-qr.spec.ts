// tests/ui/sync-qr.spec.ts
// E2E of the QR claim export/import (qr-sync-simplify, Opción B — self-contained
// claim, "el QR es el transporte"). Port a la era localStorage: el import aplica
// vía applyJsonImport → replaceAll (persiste en localStorage) y, como el file
// import, se verifica tras un reload (el state de React del dispositivo no
// observa la escritura directa). Escenarios:
//   1. flujo feliz: A exporta por QR → B importa por deep-link (?claim=) y converge
//   2. import manual desde B fresh: el token del claim es la única capability
//   3. invalidación temprana: tras "Listo / Invalidar", reusar el token da 404
//   4. claim de un solo uso: tras consumirlo (preview), reintentar da claim_consumed
//   5. claim demasiado grande (413) → error too_large en el export
//
// El relay se simula en memoria (contrato idéntico a /api/sync/claim y
// /api/sync/claim/[token]; POST anónimo, GET un solo uso, DELETE idempotente,
// TTL 15 min) compartido entre A y B vía page.route(). Sin SYNC_TOKEN ni
// syncCode: possession del token del claim es la única capability.
//
// NOTA: un E2E contra el relay real de Vercel Blob requiere
// BLOB_READ_WRITE_TOKEN en .env.local (ver .env.example) — ver el test
// 'qr: relay real de Vercel Blob (requiere BLOB_READ_WRITE_TOKEN)' abajo,
// que corre solo con ese token configurado. Los tests por defecto usan el
// stub in-memory y no requieren ninguna credencial.
import { test, expect, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { waitForAppReady } from './test-utils'

// El claim QR es anónimo (Opción B, era localStorage): no necesita credenciales
// Supabase. Fuerza el idioma español antes de que cargue la app, igual que
// import-json.spec.ts, sin tocar e2e-constants.ts (que exige E2E_USER_*).
async function forceSpanish(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('language', 'es')
  })
}

const EXPENSE_DESC = 'Café qr e2e'
const CLAIM_TTL_MS = 15 * 60 * 1000

const claims = new Map<
  string,
  { status: 'open' | 'consumed'; bytes: string; hash: string; createdAt: number; expiresAt: number }
>()

// Fuerza el 413 en el POST de claims para ejercitar el camino too_large.
let forceTooLarge = false

function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function installRelayStub(page: Page): Promise<void> {
  // POST /api/sync/claim — anónimo (sin credenciales): emite un claim
  // autocontenido cuyo payload viaja inline en el sidecar.
  await page.route('**/api/sync/claim', async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') {
      await route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'method_not_allowed' }),
      })
      return
    }
    const body = req.postDataJSON() as { bytes?: string } | null
    if (!body || typeof body.bytes !== 'string' || !body.bytes) {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'bad-request' }),
      })
      return
    }
    if (forceTooLarge) {
      await route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'claim_too_large' }),
      })
      return
    }
    const hash = sha256hex(Buffer.from(body.bytes, 'base64'))
    const now = Date.now()
    const token = randomUUID()
    claims.set(token, {
      status: 'open',
      bytes: body.bytes,
      hash,
      createdAt: now,
      expiresAt: now + CLAIM_TTL_MS,
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token, hash, expiresAt: now + CLAIM_TTL_MS }),
    })
  })

  // GET / DELETE /api/sync/claim/<token> — un solo uso; 404 uniforme por razón.
  // El GET consume el claim ANTES de responder (markClaimConsumed).
  await page.route('**/api/sync/claim/*', async (route) => {
    const req = route.request()
    const token = new URL(req.url()).pathname.split('/').pop() ?? ''
    const claim = claims.get(token)

    if (req.method() === 'DELETE') {
      if (!claim) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'claim_not_found' }),
        })
        return
      }
      claims.delete(token)
      await route.fulfill({ status: 204, body: '' })
      return
    }

    if (!claim) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'claim_not_found' }),
      })
      return
    }
    if (claim.expiresAt <= Date.now()) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'claim_expired' }),
      })
      return
    }
    if (claim.status === 'consumed') {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'claim_consumed' }),
      })
      return
    }
    claim.status = 'consumed'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bytes: claim.bytes, hash: claim.hash, createdAt: claim.createdAt }),
    })
  })
}

// ─── Helpers de UI (idioma es forzado en los contexts) ──────────────────────
// Mismo patrón que import-json.spec.ts: setup por la UI real y entrada vía el
// sheet de configuración (ConfigForm vive en el HeaderMenu).
async function setupDevice(page: Page): Promise<void> {
  await page.goto('/')
  await expect(
    page.getByText('Configura tu presupuesto', { exact: true })
  ).toBeVisible()
  await page.locator('#startAmount').fill('100000')
  await page.getByRole('button', { name: 'Selecciona una fecha' }).click()
  await page.locator('[role="gridcell"]:not([disabled])').last().click()
  await page.getByRole('button', { name: 'Comenzar ahora' }).click()
  await expect(page.getByTitle('Agregar gasto')).toBeVisible()
}

async function addExpense(page: Page, desc: string): Promise<void> {
  await page.getByTitle('Agregar gasto').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Monto').fill('1000')
  await dialog.getByLabel('Descripción').fill(desc)
  await dialog.getByRole('button', { name: 'Agregar gasto' }).click()
  await expect(page.getByText('Gasto registrado', { exact: true })).toBeVisible()
}

/** Abre el sheet de configuración (mobile) y vuelve el dialog del formulario. */
async function openConfigSheet(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const configButtons = page.getByRole('button', {
    name: 'Configuración de presupuesto',
  })
  await configButtons.first().click()
  await configButtons.last().click()

  const dialog = page.getByRole('dialog', {
    name: 'Configuración de presupuesto',
  })
  await expect(dialog.locator('form')).toBeVisible()
  return dialog
}

/** Device A: setup + gasto + claim QR (export) → devuelve el token. */
async function setupExporter(page: Page): Promise<string> {
  await setupDevice(page)
  await addExpense(page, EXPENSE_DESC)
  await page.getByRole('tab', { name: 'Historial' }).click()
  await expect(page.getByText(EXPENSE_DESC).first()).toBeVisible()

  const configDialog = await openConfigSheet(page)
  await configDialog.getByTestId('qr-export-button').click()
  const tokenEl = page.getByTestId('claim-token')
  await expect(tokenEl).toBeVisible()
  const token = (await tokenEl.inputValue()).trim()
  expect(token).toMatch(/^[0-9a-f-]{36}$/)
  return token
}

/** Device B: abre el modal import, escribe el token y dispara la búsqueda. */
async function importByToken(page: Page, token: string): Promise<void> {
  const configDialog = await openConfigSheet(page)
  await configDialog.getByTestId('qr-import-button').click()
  await expect(page.getByRole('heading', { name: 'Escanear QR o ingresar código' })).toBeVisible()
  const input = page.getByTestId('claim-token-input')
  await expect(input).toBeVisible()
  await input.fill(token)
  await page.getByTestId('claim-import-button').click()
}

// El setup de A (tablero + gasto + claim) en Next dev es lento; el import de B
// corre después dentro del mismo test → timeout amplio por test.
test.setTimeout(90_000)

test.beforeEach(() => {
  claims.clear()
  forceTooLarge = false
})

test('qr: A exporta por QR → B importa por deep-link y converge', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await forceSpanish(pageA)
  await forceSpanish(pageB)
  await installRelayStub(pageA)
  await installRelayStub(pageB)

  const token = await setupExporter(pageA)
  const deepLink = `/sync-import?claim=${encodeURIComponent(token)}`

  // B: el deep-link prefilla el token y corre el import automáticamente.
  await pageB.goto(deepLink)
  await expect(pageB.getByText('Vista previa del snapshot')).toBeVisible()
  await pageB.getByRole('button', { name: 'Confirmar e importar' }).click()

  // Al cerrar el modal, el deep-link navega a '/' donde B ya converge: la app
  // remonta y bootea desde el blob persistido en localStorage.
  await expect(pageB).toHaveURL(/\/$/)
  await expect(pageB.getByTitle('Agregar gasto')).toBeVisible()
  await pageB.getByRole('tab', { name: 'Historial' }).click()
  await expect(pageB.getByText(EXPENSE_DESC).first()).toBeVisible()

  // El claim queda consumido (un solo uso determinista).
  expect(claims.get(token)?.status).toBe('consumed')

  await contextA.close()
  await contextB.close()
})

test('qr: import manual desde B fresh — el token del claim es la única capability', async ({
  browser,
}) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await forceSpanish(pageA)
  await forceSpanish(pageB)
  await installRelayStub(pageA)
  await installRelayStub(pageB)

  const token = await setupExporter(pageA)

  // B fresh: sin credenciales ni config previa — el claim se redime solo con el
  // token (capability).
  await pageB.goto('/')
  await importByToken(pageB, token)
  await expect(pageB.getByText('Vista previa del snapshot')).toBeVisible()
  await pageB.getByRole('button', { name: 'Confirmar e importar' }).click()
  await expect(pageB.getByText('Sincronizado', { exact: true })).toBeVisible()

  // Era localStorage: el state de React de B no observa la escritura directa
  // del import (mismo patrón que el file import) → reload para verificar la
  // persistencia del blob.
  await pageB.setViewportSize({ width: 1280, height: 720 })
  await pageB.reload()
  await waitForAppReady(pageB)
  await expect(pageB.getByTitle('Agregar gasto')).toBeVisible()
  await pageB.getByRole('tab', { name: 'Historial' }).click()
  await expect(pageB.getByText(EXPENSE_DESC).first()).toBeVisible()

  await contextA.close()
  await contextB.close()
})

test('qr: invalidación temprana del claim → el reintento da 404 claim_not_found', async ({
  browser,
}) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await forceSpanish(pageA)
  await forceSpanish(pageB)
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

test('qr: el claim es de un solo uso → reintentarlo da claim_consumed', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await forceSpanish(pageA)
  await forceSpanish(pageB)
  await installRelayStub(pageA)
  await installRelayStub(pageB)

  const token = await setupExporter(pageA)
  await contextA.close()

  // B consume el claim con el primer fetch (el preview ya lo marca consumido).
  await pageB.goto('/')
  await importByToken(pageB, token)
  await expect(pageB.getByText('Vista previa del snapshot')).toBeVisible()
  expect(claims.get(token)?.status).toBe('consumed')

  // B cancela el preview (sin aplicar) e intenta de nuevo con el mismo token.
  await pageB.getByRole('button', { name: 'Cancelar' }).click()
  await pageB.getByTestId('claim-import-button').click()
  await expect(
    pageB.getByText('Este código QR ya fue usado. Genera uno nuevo desde el dispositivo origen.')
  ).toBeVisible()

  await contextB.close()
})

test('qr: claim demasiado grande → el export muestra error too_large', async ({ page }) => {
  await forceSpanish(page)
  await installRelayStub(page)

  await setupDevice(page)
  const configDialog = await openConfigSheet(page)
  forceTooLarge = true
  await configDialog.getByTestId('qr-export-button').click()

  await expect(
    page.getByText('El snapshot supera el tamaño máximo permitido para QR.')
  ).toBeVisible()
})

// ─── Relay real de Vercel Blob ──────────────────────────────────────────────
// El stub in-memory cubre el contrato completo de /api/sync/claim*. Un E2E
// contra el relay real requiere BLOB_READ_WRITE_TOKEN en el entorno (ver
// .env.example); sin él, el GET falla con 500 y el test es puro ruido.
// Habilitar solo cuando el token esté disponible en CI/desarrollo.
test.skip('qr: relay real de Vercel Blob (requiere BLOB_READ_WRITE_TOKEN)', async ({
  page,
}) => {
  await forceSpanish(page)
  await setupDevice(page)

  const configDialog = await openConfigSheet(page)
  await configDialog.getByTestId('qr-export-button').click()
  await expect(page.getByTestId('claim-token')).toBeVisible()
  const token = (await page.getByTestId('claim-token').inputValue()).trim()
  expect(token).toMatch(/^[0-9a-f-]{36}$/)
})