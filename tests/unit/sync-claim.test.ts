// tests/unit/sync-claim.test.ts
// Tests del protocolo de claims por QR (tasks 5.2): emisión (POST), consumo
// (GET, un solo uso), invalidación (DELETE idempotente) y purga (sweep).
//
// El relay se simula en memoria con el MISMO contrato que el SDK real
// (@vercel/blob v2): get devuelve web Response, del lanza BlobNotFoundError,
// list devuelve { blobs, hasMore }. Incluye además la clase BlobNotFoundError
// real para que `err instanceof BlobNotFoundError` funcione en la ruta DELETE.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { POST } from '@/app/api/sync/claim/route'
import { GET, DELETE } from '@/app/api/sync/claim/[token]/route'
import {
  claimPath,
  snapshotPath,
  putSnapshot,
  sha256Hex,
  sweepClaims,
} from '@/lib/blob-relay'

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
const SYNC_CODE = 'qr-claim'
const SYNC_TOKEN = 'test-token'
const AUTH_HEADERS = { 'x-sync-code': SYNC_CODE, 'x-sync-token': SYNC_TOKEN }

const DB_BYTES = new TextEncoder().encode('{"version":1,"budget":50000,"expenses":[]}')
const DB_HASH = sha256Hex(DB_BYTES)

type ClaimBody = { token: string; syncCode: string; hash: string; expiresAt: number }

/** Sube snapshot + metadata (lo que haría un push previo al claim). */
async function uploadSnapshot(syncCode = SYNC_CODE): Promise<void> {
  await putSnapshot(syncCode, DB_BYTES, DB_HASH)
}

/** Emite un claim vía la ruta POST real (requiere snapshot + auth). */
async function issueClaim(body?: {
  syncCode?: string
  hash?: string
  expiresAt?: number
  status?: 'open' | 'consumed'
}): Promise<ClaimBody> {
  const res = await POST(new Request('http://localhost/api/sync/claim', { method: 'POST', headers: AUTH_HEADERS }))
  expect(res.status).toBe(200)
  const json = (await res.json()) as ClaimBody
  if (body) {
    // Reescritura del sidecar para escenarios de TTL/estado sin tocar timers.
    const entry = memoryBlobs.store.get(claimPath(json.token))
    expect(entry).toBeTruthy()
    const next = { ...(JSON.parse(new TextDecoder().decode(entry!.data)) as object), ...body }
    memoryBlobs.store.set(claimPath(json.token), {
      data: new TextEncoder().encode(JSON.stringify(next)),
      uploadedAt: entry!.uploadedAt,
    })
  }
  return json
}

function claimRequest(method: 'GET' | 'DELETE', token: string): Request {
  return new Request(`http://localhost/api/sync/claim/${token}`, { method })
}

function routeCtx(token: string) {
  return { params: Promise.resolve({ token }) }
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
  process.env.SYNC_TOKEN = SYNC_TOKEN
  vi.mocked(memoryBlobs.put).mockClear()
})

afterEach(() => {
  delete process.env.SYNC_TOKEN
})

// ─── POST /api/sync/claim ────────────────────────────────────────────────────
describe('POST /api/sync/claim', () => {
  it('401 sin credenciales', async () => {
    await uploadSnapshot()
    const res = await POST(new Request('http://localhost/api/sync/claim', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('401 con token incorrecto', async () => {
    await uploadSnapshot()
    const res = await POST(
      new Request('http://localhost/api/sync/claim', {
        method: 'POST',
        headers: { 'x-sync-code': SYNC_CODE, 'x-sync-token': 'wrong' },
      })
    )
    expect(res.status).toBe(401)
  })

  it('200 emite claim open con TTL de 15 min y sidecar persistido', async () => {
    await uploadSnapshot()
    const claim = await issueClaim()
    expect(claim.syncCode).toBe(SYNC_CODE)
    expect(claim.hash).toBe(DB_HASH)
    expect(claim.expiresAt - Date.now()).toBeGreaterThan(14 * 60 * 1000)
    expect(claim.expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000)

    const sidecar = memoryBlobs.store.get(claimPath(claim.token))
    expect(sidecar).toBeTruthy()
    const parsed = JSON.parse(new TextDecoder().decode(sidecar!.data)) as {
      syncCode: string
      hash: string
      status: string
    }
    expect(parsed).toMatchObject({ syncCode: SYNC_CODE, hash: DB_HASH, status: 'open' })
    // NFR-3: el secret nunca viaja en la respuesta ni en el sidecar.
    expect(JSON.stringify(claim)).not.toContain(SYNC_TOKEN)
  })

  it('404 snapshot_not_found si no hubo push previo', async () => {
    const res = await POST(new Request('http://localhost/api/sync/claim', { method: 'POST', headers: AUTH_HEADERS }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'snapshot_not_found' })
  })

  it('sweep de claims consumidos/vencidos antes de emitir uno nuevo', async () => {
    await uploadSnapshot()
    const consumed = await issueClaim()
    // Consumir el primer claim vía la ruta (queda 'consumed').
    await claimFetch('GET', consumed.token)

    const fresh = await issueClaim()
    expect(memoryBlobs.store.has(claimPath(consumed.token))).toBe(false)
    expect(memoryBlobs.store.has(claimPath(fresh.token))).toBe(true)
  })

  it('500 claim_issue_failed si falla el blob al persistir el claim', async () => {
    await uploadSnapshot()
    vi.mocked(memoryBlobs.put).mockRejectedValueOnce(new Error('boom'))
    const res = await POST(new Request('http://localhost/api/sync/claim', { method: 'POST', headers: AUTH_HEADERS }))
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
    await uploadSnapshot()
    const claim = await issueClaim({ expiresAt: Date.now() - 1000 })
    const { status, body } = await claimFetch('GET', claim.token)
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'claim_expired' })
  })

  it('404 claim_consumed en replay (un solo uso → determinista vía sidecar)', async () => {
    await uploadSnapshot()
    const claim = await issueClaim()
    await claimFetch('GET', claim.token) // primer consumo
    const replay = await claimFetch('GET', claim.token)
    expect(replay.status).toBe(404)
    expect(replay.body).toEqual({ error: 'claim_consumed' })
  })

  it('200 entrega bytes+hash+syncCode y deja el claim consumed', async () => {
    await uploadSnapshot()
    const claim = await issueClaim()
    const { status, body } = await claimFetch('GET', claim.token)
    expect(status).toBe(200)
    expect(Buffer.from(body!.bytes as string, 'base64')).toEqual(Buffer.from(DB_BYTES))
    expect(body).toMatchObject({ hash: DB_HASH, syncCode: SYNC_CODE })
    expect(typeof body!.updatedAt).toBe('string')

    const sidecar = JSON.parse(
      new TextDecoder().decode(memoryBlobs.store.get(claimPath(claim.token))!.data)
    ) as { status: string }
    expect(sidecar.status).toBe('consumed')
    // NFR-3: la respuesta no expone el secret.
    expect(JSON.stringify(body)).not.toContain(SYNC_TOKEN)
  })

  it('404 snapshot_not_found si el snapshot desapareció después de emitir', async () => {
    await uploadSnapshot()
    const claim = await issueClaim()
    memoryBlobs.store.delete(snapshotPath(SYNC_CODE))
    const { status, body } = await claimFetch('GET', claim.token)
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'snapshot_not_found' })
  })

  it('500 claim_consume_failed si falla el marcado de consumido', async () => {
    await uploadSnapshot()
    const claim = await issueClaim()
    // El siguiente put es el de markClaimConsumed (reescritura del sidecar).
    vi.mocked(memoryBlobs.put).mockRejectedValueOnce(new Error('boom'))
    const { status, body } = await claimFetch('GET', claim.token)
    expect(status).toBe(500)
    expect(body).toEqual({ error: 'claim_consume_failed' })
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
    await uploadSnapshot()
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
    await uploadSnapshot()
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
    await uploadSnapshot()
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