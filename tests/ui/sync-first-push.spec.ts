import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'

// ─── Test 5.2: Primer push guiado desde dispositivo fresh ────────────────
// Verifica que un dispositivo fresh puede hacer setup, configurar sync,
// hacer su primer push guiado vía ConfirmDialog, y que el hash remoto
// queda registrado (idempotencia: un segundo sync produce pull-only sin
// error, el mismo hash remoto se conserva).

const SYNC_CODE = 'e2e-first-push'
const SYNC_TOKEN = 'tok-fp-1234'
const EXPENSE_DESC = 'Café e2e'

// ─── Relay in-memory stub ────────────────────────────────────────────────
// Mismo contrato que el relay real (Batch 3): el POST del primer push recibe
// { bytes } (base64 del snapshot sql.js), calcula sha256 y guarda; el GET
// devuelve { bytes, hash, updatedAt }; el hash se devuelve en el POST 200 y
// el cliente lo persiste en sync_meta (snapshot_hash).
// Nota: los route handlers de Playwright corren en el proceso Node del
// runner, no en el browser → node:crypto es correcto aquí (igual que 5.1).
type Snapshot = { bytes: string; hash: string; updatedAt: string }

const store = new Map<string, Snapshot>()

function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function nowStamp(): string {
  // '2026-09-11 10:30:00' UTC, mismo formato del server (datetime UTC).
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

// ─── Helpers (replicados de sync-dual-device; no compartibles sin vitest) ─

async function setupDevice(page: import('@playwright/test').Page) {
  await page.locator('#startAmount').fill('100000')
  // End date: abrir el DatePicker y elegir el último día habilitado del mes
  // (siempre futuro respecto de hoy → siempre seleccionable).
  await page.getByRole('button', { name: 'Selecciona una fecha' }).click()
  // react-day-picker (shadcn) renderiza cada día como <td role="gridcell"> sin
  // <button> anidado; los días fuera del mes/anteriores llegan [disabled].
  await page.locator('[role="gridcell"]:not([disabled])').last().click()
  await page.getByRole('button', { name: 'Comenzar ahora' }).click()
  // El FAB aparece cuando la app quedó en modo setup (isSetup === true).
  await expect(page.getByTitle('Agregar gasto')).toBeVisible()
}

async function addExpense(page: import('@playwright/test').Page) {
  await page.getByTitle('Agregar gasto').click()
  await expect(page.locator('#amount')).toBeVisible()
  await page.locator('#amount').fill('250')
  await page.locator('#description').fill(EXPENSE_DESC)
  // El submit del modal es el único botón accesible con texto "Agregar gasto"
  // (el FAB queda fuera del árbol de accesibilidad mientras el dialog está
  // abierto → getByRole sin strict violation, como en sync-dual-device).
  await page.getByRole('button', { name: 'Agregar gasto' }).click()
}

async function configureSync(page: import('@playwright/test').Page) {
  await page.locator('#sync-code').fill(SYNC_CODE)
  await page.locator('#sync-token').fill(SYNC_TOKEN)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Configuración guardada')).toBeVisible()
}

// ─── Registra el stub en el page ─────────────────────────────────────────
async function installRelayStub(page: import('@playwright/test').Page): Promise<void> {
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
    const snap = store.get(code)
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
      const snap = store.get(code)
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
    const snap = store.get(code)
    if (snap && body.basedOnHash && body.basedOnHash !== snap.hash) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: '{}' })
      return
    }
    const hash = sha256hex(Buffer.from(body.bytes, 'base64'))
    const updatedAt = nowStamp()
    store.set(code, { bytes: body.bytes, hash, updatedAt })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hash, updatedAt }),
    })
  })
}

test.describe('Primer push guiado desde dispositivo fresh', () => {
  test.beforeEach(async () => {
    store.clear()
  })

  test('fresh device → setup → datos → sync config → confirmar → push → hash idempotente', async ({
    page,
  }) => {
    await installRelayStub(page)

    // ── 1. Fresh device, setup completo ──────────────────────────────────
    await page.goto('/')
    await setupDevice(page)
    await addExpense(page)

    // ── 2. Configurar sync code/token ────────────────────────────────────
    await configureSync(page)

    // ── 3. Sección "primer push" visible ─────────────────────────────────
    const firstPushSection = page
      .locator('section')
      .filter({ hasText: 'Primera sincronización pendiente' })
    await expect(firstPushSection).toBeVisible()
    await expect(
      firstPushSection.getByRole('button', { name: 'Subir datos por primera vez' })
    ).toBeVisible()

    // ── 4. Click "Subir datos" → ConfirmDialog → confirmar ───────────────
    await firstPushSection.getByRole('button', { name: 'Subir datos por primera vez' }).click()
    // ConfirmDialog: el botón de confirmar es "Sí, continuar" (confirmText,
    // igual que 5.1).
    const confirmBtn = page.getByRole('button', { name: 'Sí, continuar' })
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    // ── 5. Verificar push exitoso ─────────────────────────────────────────
    await expect(page.getByText('Sincronizado').first()).toBeVisible()

    // ── 6. Verificar: el stub recibió el snapshot y tiene hash ────────────
    const meta = store.get(SYNC_CODE)
    expect(meta).toBeDefined()
    expect(meta!.hash).toMatch(/^[0-9a-f]{64}$/)
    const firstHash = meta!.hash

    // ── 7. Segundo sync: el hash remoto coincide → 'synced' (sin POST) ──
    //    Tras el push, sync_meta quedó con snapshot_hash y el local mantiene
    //    los mismos datos → remote.hash === localHash → syncNow retorna
    //    'synced' sin tocar el relay. El hash en store NO cambia.
    await page.reload()
    await page.getByTestId('sync-button').click()
    await expect(page.getByText('Sincronizado').first()).toBeVisible()
    expect(store.get(SYNC_CODE)!.hash).toBe(firstHash)
  })
})