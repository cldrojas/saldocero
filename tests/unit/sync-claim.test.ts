// tests/unit/sync-claim.test.ts
// Tests del protocolo de claims por QR (tasks 5.2): emisión anónima (POST),
// consumo (GET, un solo uso), invalidación (DELETE idempotente) y purga (sweep).
//
// Opción B — claim AUTOCONTENIDO: el snapshot completo viaja inline (payload
// base64) en el sidecar `saldo-cero-claims/<token>.json` y el token del claim es
// la única capability. NO hay syncCode/SYNC_TOKEN, ni headers de auth, ni relay
// de snapshots (NFR-3, D-sign). El relay se simula en memoria con el MISMO
// contrato que el SDK real (@vercel/blob v2): get devuelve web Response, del
// lanza BlobNotFoundError, list devuelve { blobs, hasMore }. Incluye además la
// clase BlobNotFoundError real para que `err instanceof BlobNotFoundError`
// funcione en la ruta DELETE.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { POST } from '@/app/api/sync/claim/route'
import { GET, DELETE } from '@/app/api/sync/claim/[token]/route'
import { claimPath, sha256Hex, sweepClaims, bytesToBase64 } from '@/lib/blob-relay'

// ─── In-memory @vercel/blob mock (mismo patrón que sync-protocol.test.ts) ──
const memoryBlobs = vi.hoisted(() => {
  const store = new Map<string, { data: Uint8Array; uploadedAt: string }>()
  class BlobNotFoundError extends Error {
    constructor(message = 'Blob not found') {
      super(message)
      this.name = 'BlobNotFoundError'
    }
  }
  return {
    store,
    BlobNotFoundError,
    put: vi.fn(async (pathname: string, body: unknown) => {
      const data =
        body instanceof Uint8Array || body instanceof Buffer ? body : new TextEncoder().encode(String(body))
      const uploadedAt = new Date().toISOString()
      store.set(pathname, { data, uploadedAt })
      return { url: `https://fake.blob.vercel-storage.com/${pathname}`, pathname, size: data.length, uploadedAt }
    }),
    head: vi.fn(async (pathname: string) => {
      const entry = store.get(pathname)
      if (!entry) throw Object.assign(new Error('Blob not found'), { status: 404 })
      return { url: `https://fake.blob.vercel-storage.com/${pathname}`, pathname, size: entry.data.length, uploadedAt: entry.uploadedAt }
    }),
    get: vi.fn(async (pathname: string) => {
      const entry = store.get(pathname)
      if (!entry) throw Object.assign(new Error('Blob not found'), { status: 404 })
      return new Response(entry.data as unknown as BodyInit)
    }),
    list: vi.fn(async ({ prefix }: { prefix?: string }) => {
      const blobs = [...store.entries()]
        .filter(([pathname]) => !prefix || pathname.startsWith(prefix))
        .map(([pathname, entry]) => ({
          pathname,
          url: `https://fake.blob.vercel-storage.com/${pathname}`,
          downloadUrl: `https://fake.blob.vercel-storage.com/${pathname}?download=1`,
          size: entry.data.length,
          uploadedAt: new Date(entry.uploadedAt),
          etag: 'etag',
        }))
      return { blobs, hasMore: false }
    }),
    del: vi.fn(async (pathname: string | string[]) => {
      const paths = Array.isArray(pathname) ? pathname : [pathname]
      for (const p of paths) {
        if (!store.delete(p)) throw new BlobNotFoundError()
      }
    }),
    _reset: () => store.clear(),
  }
})

vi.mock('@vercel/blob', () => ({
  put: memoryBlobs.put,
  head: memoryBlobs.head,
  get: memoryBlobs.get,
  list: memoryBlobs.list,
  del: memoryBlobs.del,
  BlobNotFoundError: memoryBlobs.BlobNotFoundError,
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────
const DB_BYTES = new TextEncoder().encode('{"version":1,"budget":50000,"expenses":[]}')
const DB_HASH = sha256Hex(DB_BYTES)
const DB_B64 = bytesToBase64(DB_BYTES)

type ClaimBody = { token: string; hash: string; expiresAt: number }

function claimRequest(method: 'POST' | 'GET' | 'DELETE', token?: string): Request {
  if (method === 'POST') {
    return new Request('http://localhost/api/sync/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: DB_B64 }),
    })
  }
  return new Request(`http://localhost/api/sync/claim/${token}`, { method })
}

function routeCtx(token: string) {
  return { params: Promise.resolve({ token }) }
}

/** Emite un claim vía la ruta POST real (anónimo, sin headers de auth). */
async function issueClaim(overrides?: { expiresAt?: number; status?: 'open' | 'consumed' }): Promise<ClaimBody> {
  const res = await POST(claimRequest('POST'))
  expect(res.status).toBe(200)
  const json = (await res.json()) as ClaimBody
  if (overrides) {
    // Reescritura del sidecar para escenarios de TTL/estado sin tocar timers.
    const entry = memoryBlobs.store.get(claimPath(json.token))
    expect(entry).toBeTruthy()
    const next = { ...(JSON.parse(new TextDecoder().decode(entry!.data)) as object), ...overrides }
    memoryBlobs.store.set(claimPath(json.token), {
      data: new TextEncoder().encode(JSON.stringify(next)),
      uploadedAt: entry!.uploadedAt,
    })
  }
  return json
}

async function claimFetch(method: 'GET' | 'DELETE', token: string) {
  const res = await (method === 'GET'
    ? GET(claimRequest(method, token), routeCtx(token))
    : DELETE(claimRequest(method, token), routeCtx(token)))
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as Record<string, unknown>) }
}

beforeEach(() => {
  vi.clearAllMocks()
  memoryBlobs._reset()
  vi.mocked(memoryBlobs.put).mockClear()
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── POST /api/sync/claim ────────────────────────────────────────────────────
describe('POST /api/sync/claim', () => {
  it('400 bad-request sin body', async () => {
    const res = await POST(new Request('http://localhost/api/sync/claim', { method: 'POST' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-request' })
  })

  it('400 bad-request si bytes no es string', async () => {
    const res = await POST(
      new Request('http://localhost/api/sync/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bytes: 123 }),
      })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-request' })
  })

  it('400 bad-request si base64 es inválido (decodifica vacío)', async () => {
    const res = await POST(
      new Request('http://localhost/api/sync/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bytes: '!@#$' }),
      })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-request' })
  })

  it('413 claim_too_large si el payload decodificado supera 3 MiB', async () => {
    const res = await POST(
      new Request('http://localhost/api/sync/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bytes: 'A'.repeat(4 * 1024 * 1024 + 128) }),
      })
    )
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'claim_too_large' })
  })

  it('200 emite claim open con TTL de 15 min y sidecar autocontenido', async () => {
    const claim = await issueClaim()
    expect(claim.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(claim.hash).toBe(DB_HASH)
    expect(claim.expiresAt - Date.now()).toBeGreaterThan(14 * 60 * 1000)
    expect(claim.expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000)

    const sidecar = memoryBlobs.store.get(claimPath(claim.token))
    expect(sidecar).toBeTruthy()
    const parsed = JSON.parse(new TextDecoder().decode(sidecar!.data)) as {
      payload: string
      hash: string
      createdAt: number
      expiresAt: number
      status: string
    }
    expect(parsed).toMatchObject({ payload: DB_B64, hash: DB_HASH, status: 'open' })
    expect(typeof parsed.createdAt).toBe('number')
    expect(typeof parsed.expiresAt).toBe('number')
  })

  it('sweep de claims consumidos/vencidos antes de emitir uno nuevo', async () => {
    const consumed = await issueClaim()
    // Consumir el primer claim vía la ruta (queda 'consumed').
    await claimFetch('GET', consumed.token)

    const fresh = await issueClaim()
    expect(memoryBlobs.store.has(claimPath(consumed.token))).toBe(false)
    expect(memoryBlobs.store.has(claimPath(fresh.token))).toBe(true)
  })

  it('500 claim_issue_failed si falla el blob al persistir el claim', async () => {
    vi.mocked(memoryBlobs.put).mockRejectedValueOnce(new Error('boom'))
    const res = await POST(claimRequest('POST'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'claim_issue_failed' })
  })
})

// ─── GET /api/sync/claim/[token] ─────────────────────────────────────────────
describe('GET /api/sync/claim/[token]', () => {
  it('404 claim_not_found para token malformado (anti-enumeración)', async () => {
    const { status, body } = await claimFetch('GET', 'no-es-un-uuid')
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'claim_not_found' })
  })

  it('404 claim_not_found para UUID válido pero inexistente', async () => {
    const { status, body } = await claimFetch('GET', randomUUID())
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'claim_not_found' })
  })

  it('404 claim_expired para claim vencido (TTL)', async () => {
    const claim = await issueClaim({ expiresAt: Date.now() - 1000 })
    const { status, body } = await claimFetch('GET', claim.token)
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'claim_expired' })
  })

  it('404 claim_consumed en replay (un solo uso → determinista vía sidecar)', async () => {
    const claim = await issueClaim()
    await claimFetch('GET', claim.token) // primer consumo
    const replay = await claimFetch('GET', claim.token)
    expect(replay.status).toBe(404)
    expect(replay.body).toEqual({ error: 'claim_consumed' })
  })

  it('carrera: dos GETs concurrentes → exactamente un 200 y un 404 claim_consumed', async () => {
    const claim = await issueClaim()
    const path = claimPath(claim.token)
    const originalGet = vi.mocked(memoryBlobs.get).getMockImplementation()!

    // Interleaving controlado: el primer reader ve 'open'; cualquier lectura
    // posterior del sidecar ve 'consumed' (el consumo ocurre una sola vez
    // aunque dos devices escaneen el QR a la vez).
    let sidecarReads = 0
    vi.mocked(memoryBlobs.get).mockImplementation(async (pathname: string) => {
      if (pathname === path) {
        const entry = memoryBlobs.store.get(path)!
        const meta = JSON.parse(new TextDecoder().decode(entry.data)) as { status: 'open' | 'consumed' }
        sidecarReads += 1
        const status = sidecarReads === 1 ? 'open' : 'consumed'
        const data = new TextEncoder().encode(JSON.stringify({ ...meta, status }))
        memoryBlobs.store.set(path, { data, uploadedAt: entry.uploadedAt })
        return new Response(data as unknown as BodyInit)
      }
      return originalGet(pathname)
    })

    const [a, b] = await Promise.all([
      claimFetch('GET', claim.token),
      claimFetch('GET', claim.token),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 404])
    const loser = a.status === 404 ? a : b
    expect(loser.body).toEqual({ error: 'claim_consumed' })
  })

  it('200 entrega bytes+hash+createdAt autocontenidos y deja el claim consumed', async () => {
    const claim = await issueClaim()
    const { status, body } = await claimFetch('GET', claim.token)
    expect(status).toBe(200)
    expect(Buffer.from(body!.bytes as string, 'base64')).toEqual(Buffer.from(DB_BYTES))
    expect(body).toMatchObject({ hash: DB_HASH })
    expect(typeof body!.createdAt).toBe('number')

    const sidecar = JSON.parse(
      new TextDecoder().decode(memoryBlobs.store.get(claimPath(claim.token))!.data)
    ) as { status: string }
    expect(sidecar.status).toBe('consumed')
  })

  it('500 claim_consume_failed si falla el marcado de consumido', async () => {
    const claim = await issueClaim()
    // El siguiente put es el de markClaimConsumed (reescritura del sidecar).
    vi.mocked(memoryBlobs.put).mockRejectedValueOnce(new Error('boom'))
    const { status, body } = await claimFetch('GET', claim.token)
    expect(status).toBe(500)
    expect(body).toEqual({ error: 'claim_consume_failed' })
  })
})

// ─── NFR-3: sin syncCode ni SYNC_TOKEN en el protocolo ───────────────────────
describe('NFR-3: sin syncCode/SYNC_TOKEN (grep estructural + assert stricto)', () => {
  it('el sidecar, la respuesta del POST y la del GET no exponen syncCode ni token de despliegue', async () => {
    const claim = await issueClaim()
    // Respuesta del POST: solo { token, hash, expiresAt } — sin syncCode.
    expect(claim).not.toHaveProperty('syncCode')
    expect(claim).not.toHaveProperty('syncToken')

    const sidecar = JSON.parse(
      new TextDecoder().decode(memoryBlobs.store.get(claimPath(claim.token))!.data)
    ) as Record<string, unknown>
    expect(sidecar).not.toHaveProperty('syncCode')
    expect(sidecar).not.toHaveProperty('sync_token')
    expect(sidecar).not.toHaveProperty('syncToken')

    const { body } = await claimFetch('GET', claim.token)
    expect(body).not.toHaveProperty('syncCode')
    expect(body).not.toHaveProperty('sync_token')
    expect(body).not.toHaveProperty('syncToken')
    expect(body).not.toHaveProperty('token') // el GET solo devuelve bytes/hash/createdAt
  })
})

// ─── DELETE /api/sync/claim/[token] ──────────────────────────────────────────
describe('DELETE /api/sync/claim/[token]', () => {
  it('404 claim_not_found para token malformado', async () => {
    const { status, body } = await claimFetch('DELETE', 'no-es-un-uuid')
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'claim_not_found' })
  })

  it('204 invalida (borra el sidecar)', async () => {
    const claim = await issueClaim()
    const { status } = await claimFetch('DELETE', claim.token)
    expect(status).toBe(204)
    expect(memoryBlobs.store.has(claimPath(claim.token))).toBe(false)
  })

  it('204 idempotente si el claim ya no existe (BlobNotFoundError)', async () => {
    const { status } = await claimFetch('DELETE', randomUUID())
    expect(status).toBe(204)
  })

  it('500 claim_delete_failed si falla el blob con error no-NotFound', async () => {
    vi.mocked(memoryBlobs.del).mockRejectedValueOnce(new Error('boom'))
    const { status, body } = await claimFetch('DELETE', randomUUID())
    expect(status).toBe(500)
    expect(body).toEqual({ error: 'claim_delete_failed' })
  })
})

// ─── sweepClaims ─────────────────────────────────────────────────────────────
describe('sweepClaims', () => {
  it('sweep directo purga claims vencidos y conserva los open vigentes', async () => {
    const open = await issueClaim()
    // El último POST también corre un sweep interno, así que el expired debe
    // emitirse DESPUÉS del open para que el sweep final lo encuentre.
    const expired = await issueClaim({ expiresAt: Date.now() - 1000 })

    const purged = await sweepClaims(Date.now())
    expect(purged).toBe(1)
    expect(memoryBlobs.store.has(claimPath(open.token))).toBe(true)
    expect(memoryBlobs.store.has(claimPath(expired.token))).toBe(false)
  })

  it('el sweep se combina con el de cada POST: consumido no sobrevive', async () => {
    const open = await issueClaim()
    const expired = await issueClaim({ expiresAt: Date.now() - 1000 })
    const consumed = await issueClaim()
    await claimFetch('GET', consumed.token)

    const purged = await sweepClaims(Date.now())
    // `expired` ya fue purgado por el sweep implícito del POST que emitió
    // `consumed`; el sweep final purga el consumido.
    expect(purged).toBe(1)
    expect(memoryBlobs.store.has(claimPath(open.token))).toBe(true)
    expect(memoryBlobs.store.has(claimPath(consumed.token))).toBe(false)
  })
})