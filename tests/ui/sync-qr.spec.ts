// tests/ui/sync-qr.spec.ts
// E2E del QR claim export/import (qr-sync-simplify, Opción B — claim
// autocontenido, "el QR es el transporte"). Escenarios:
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
import { test, expect, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { forceSpanish } from './e2e-constants'

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
async function setupDevice(page: Page): Promise<void> {
  await page.goto('/')
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

/** Device A: setup + gasto + claim QR (export) → devuelve el token. */
async function setupExporter(page: Page): Promise<string> {
  await page.goto('/')
  await setupDevice(page)
  await addExpense(page, EXPENSE_DESC)
  await page.getByRole('tab', { name: 'Historial' }).click()
  await expect(page.getByText(EXPENSE_DESC).first()).toBeVisible()

  await page.getByTestId('qr-export-button').click()
  const tokenEl = page.getByTestId('claim-token')
  await expect(tokenEl).toBeVisible()
  const token = (await tokenEl.textContent())?.trim()
  expect(token).toMatch(/^[0-9a-f-]{36}$/)
  return token!
}

/** Device B: abre el modal import, escribe el token y dispara la búsqueda. */
async function importByToken(page: Page, token: string): Promise<void> {
  await page.getByTestId('qr-import-button').click()
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
  // token (capability), sin banners de token de despliegue.
  await pageB.goto('/')
  await importByToken(pageB, token)
  await expect(pageB.getByText('Vista previa del snapshot')).toBeVisible()
  await pageB.getByRole('button', { name: 'Confirmar e importar' }).click()

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
  forceTooLarge = true
  await page.getByTestId('qr-export-button').click()

  await expect(
    page.getByText('El snapshot supera el tamaño máximo permitido para QR.')
  ).toBeVisible()
})