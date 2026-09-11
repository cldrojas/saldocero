// tests/ui/sync-dual-device.spec.ts
// E2E dual-device del cambio multi-device-blob-sync (task 5.1).
//
// Escenario: dispositivo A opera la UI real (setup + gasto) y hace el primer
// push; el dispositivo B (fresh, sin setup) configura el mismo sync code/token,
// descarga y hace merge, recarga, y CONVERGE: ve el presupuesto y el gasto de A.
//
// El relay se simula en memoria (contrato idéntico a /api/sync + /api/sync/meta,
// Batch 3) y se comparte entre ambos browser contexts vía page.route(). No hay
// dependencia del server DB ni de Vercel Blob.
import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'

const SYNC_CODE = 'e2e-device'
const SYNC_TOKEN = 'token-e2e'
const EXPENSE_DESC = 'Café e2e'

// ─── Relay stub en memoria (compartido en el proceso del test) ──────────────
// Contrato replicado:
//   GET  /api/sync/meta → 200 {hash,size,updatedAt} | 404 | 401
//   GET  /api/sync      → 200 {bytes,hash,updatedAt} | 404 | 401
//   POST /api/sync      → 200 {hash,updatedAt} | 409 (basedOnHash desactualizado) | 401
// Headers: x-sync-code + x-sync-token (cualquier token no vacío es válido; la
// autenticación real se cubre en los tests de integración de Batch 3).
const relay = new Map<string, { bytes: string; hash: string; updatedAt: string }>()

function nowStamp(): string {
  // '2026-09-11 10:30:00' UTC, mismo formato del server (datetime UTC).
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function installRelayStub(page: Page): Promise<void> {
  const credentials = (route: { request: () => { headers: () => Record<string, string> } }) => {
    // Playwright normaliza los nombres de header a minúscula.
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

    // POST: primer push (sin basedOnHash) o push con re-check 409
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
}

// ─── Helpers de UI (idioma es forzado en los contexts) ──────────────────────
async function setupDevice(page: Page): Promise<void> {
  await page.locator('#startAmount').fill('100000')
  // End date: abrir el DatePicker y elegir el último día habilitado del mes
  // (siempre futuro respecto de hoy → siempre seleccionable).
  await page.getByRole('button', { name: 'Selecciona una fecha' }).click()
  // react-day-picker (shadcn) renderiza cada día como <td role="gridcell"> sin
  // <button> anidado; los días fuera del mes/anteriores llegan [disabled].
  await page.locator('[role="gridcell"]:not([disabled])').last().click()
  await page.getByRole('button', { name: 'Comenzar ahora' }).click()
  // El FAB aparece solo cuando la app quedó en modo setup (isSetup === true).
  await expect(page.getByTitle('Agregar gasto')).toBeVisible()
}

async function addExpense(page: Page, desc: string): Promise<void> {
  await page.getByTitle('Agregar gasto').click()
  await page.locator('#amount').fill('1000')
  await page.locator('#description').fill(desc)
  // El submit del modal es el único botón con texto "Agregar gasto".
  await page.getByRole('button', { name: 'Agregar gasto' }).click()
}

async function configureSync(page: Page): Promise<void> {
  await page.locator('#sync-code').fill(SYNC_CODE)
  await page.locator('#sync-token').fill(SYNC_TOKEN)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Configuración guardada')).toBeVisible()
}

async function firstPush(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Subir datos por primera vez' }).click()
  await page.getByRole('button', { name: 'Sí, continuar' }).click()
}

test('dual-device: A opera y hace push → B configure, descarga, merge y converge', async ({ browser }) => {
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

  // ─── Dispositivo A: setup + gasto → primer push ────────────────────────
  await pageA.goto('/')
  await setupDevice(pageA)
  await addExpense(pageA, EXPENSE_DESC)
  await pageA.getByRole('tab', { name: 'Historial' }).click()
  await expect(pageA.getByText(EXPENSE_DESC).first()).toBeVisible()

  await configureSync(pageA)
  await firstPush(pageA)
  await expect(pageA.getByText('Sincronizado').first()).toBeVisible()
  // El stub recibió el snapshot de A.
  expect(relay.get(SYNC_CODE)?.hash).toBeTruthy()

  // ─── Dispositivo B: fresh (sin setup) → converge ───────────────────────
  await pageB.goto('/')
  // B no configuró nada todavía: la UI de sync debe ser accesible igualmente
  // (FR-4: la sincronización no depende de haber hecho setup primero).
  await expect(pageB.getByText('Configuración de sincronización')).toBeVisible()

  await configureSync(pageB)
  // El SyncButton se montó sin config (disabled). Tras guardarla, recargamos
  // para que re-monte en estado 'pending' y quede habilitado.
  await pageB.reload()
  // B hace sync: pull (descarga los datos de A) → merge → push. El SyncButton
  // recarga la página automáticamente tras un merge (componentes/sync/sync-button.tsx).
  await pageB.getByTestId('sync-button').click()
  await expect(pageB.getByTestId('sync-button')).toBeVisible()

  // Tras el reload, el snapshot persistido en IndexedDB debe restaurarse en
  // boot: B ve el presupuesto de A y el gasto sincronizado (convergencia).
  await expect(pageB.getByTitle('Agregar gasto')).toBeVisible()
  await pageB.getByRole('tab', { name: 'Historial' }).click()
  await expect(pageB.getByText(EXPENSE_DESC).first()).toBeVisible()

  await contextA.close()
  await contextB.close()
})