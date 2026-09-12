import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET, POST } from '@/app/api/sync/route'
import { GET as GET_META } from '@/app/api/sync/meta/route'
import { sha256Hex } from '@/lib/blob-relay'

// ─── In-memory @vercel/blob mock (design: "blob mock en memoria") ─────────
const memoryBlobs = vi.hoisted(() => {
  const store = new Map<string, { data: Uint8Array; uploadedAt: string }>()
  return {
    store,
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
    // Replica la forma real de @vercel/blob v2: { blobs: [...], hasMore }.
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
    // Replica el SDK real: borrar inexistente lanza BlobNotFoundError (la ruta
    // DELETE lo captura y devuelve 204).
    del: vi.fn(async (pathname: string | string[]) => {
      for (const p of Array.isArray(pathname) ? pathname : [pathname]) {
        if (!store.delete(p)) {
          throw Object.assign(new Error('Blob not found'), { name: 'BlobNotFoundError', status: 404 })
        }
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
}))

// ─── Helpers ──────────────────────────────────────────────────────────────
const CODE_A = 'demo-codigo-01'
const CODE_B = 'otro-codigo-02'
const TOKEN = 'test-sync-token'
const bytesToBase64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const base64ToBytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

function authHeaders(code = CODE_A, token = TOKEN, extra: Record<string, string> = {}) {
  return { 'content-type': 'application/json', 'x-sync-code': code, 'x-sync-token': token, ...extra }
}
function makeGet(path: string, headers: Record<string, string>): Request {
  return new Request(`http://localhost${path}`, { method: 'GET', headers })
}
function makePost(path: string, headers: Record<string, string>, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
async function json(resp: Response) {
  return (await resp.json()) as Record<string, unknown>
}

// ─── Tests ────────────────────────────────────────────────────────────────
describe('sync protocol (auth)', () => {
  beforeEach(() => {
    vi.stubEnv('SYNC_TOKEN', TOKEN)
    memoryBlobs._reset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('401 sin credenciales en GET /api/sync', async () => {
    const resp = await GET(makeGet('/api/sync', {}))
    expect(resp.status).toBe(401)
    const body = await json(resp)
    expect((body as { bytes?: unknown }).bytes).toBeUndefined()
  })

  it('401 sin credenciales en GET /api/sync/meta', async () => {
    const resp = await GET_META(makeGet('/api/sync/meta', {}))
    expect(resp.status).toBe(401)
  })

  it('401 sin credenciales en POST /api/sync', async () => {
    const resp = await POST(makePost('/api/sync', {}, { bytes: '' }))
    expect(resp.status).toBe(401)
  })

  it('401 con token incorrecto', async () => {
    const headers = authHeaders(CODE_A, 'wrong-token')
    const resp = await GET(makeGet('/api/sync', headers))
    expect(resp.status).toBe(401)
  })

  it('401 con sync code en formato inválido', async () => {
    const headers = authHeaders('not valid!!', TOKEN)
    const resp = await GET_META(makeGet('/api/sync/meta', headers))
    expect(resp.status).toBe(401)
  })

  it('404 si aún no hay snapshot (meta y snapshot)', async () => {
    const headers = authHeaders()
    expect((await GET_META(makeGet('/api/sync/meta', headers))).status).toBe(404)
    expect((await GET(makeGet('/api/sync', headers))).status).toBe(404)
  })

  it('400 si POST no trae bytes', async () => {
    const resp = await POST(makePost('/api/sync', authHeaders(), { basedOnHash: 'x' }))
    expect(resp.status).toBe(400)
  })
})

describe('sync protocol (round-trip)', () => {
  let snapshot: Uint8Array

  beforeEach(() => {
    vi.stubEnv('SYNC_TOKEN', TOKEN)
    memoryBlobs._reset()
    snapshot = new TextEncoder().encode(
      'fakemagic\0SQLite format 3\0' + 'seed-data-' + Math.random() + '\0'
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('primer push → meta + snapshot devuelven el mismo hash y bytes', async () => {
    const hash = sha256Hex(snapshot)
    const post = await POST(
      makePost('/api/sync', authHeaders(), { bytes: bytesToBase64(snapshot) })
    )
    expect(post.status).toBe(200)
    const posted = await json(post)
    expect((posted as { hash?: string }).hash).toBe(hash)
    expect(typeof (posted as { updatedAt?: string }).updatedAt).toBe('string')

    // meta
    const metaResp = await GET_META(makeGet('/api/sync/meta', authHeaders()))
    expect(metaResp.status).toBe(200)
    const meta = await json(metaResp)
    expect((meta as { hash?: string }).hash).toBe(hash)
    expect((meta as { size?: number }).size).toBe(snapshot.length)

    // snapshot
    const getResp = await GET(makeGet('/api/sync', authHeaders()))
    expect(getResp.status).toBe(200)
    const got = await json(getResp)
    expect((got as { hash?: string }).hash).toBe(hash)
    expect(
      Buffer.from(base64ToBytes((got as { bytes: string }).bytes)).equals(Buffer.from(snapshot))
    ).toBe(true)
  })

  it('re-push idéntico con basedOnHash correcto → 200 (idempotente)', async () => {
    const hash = sha256Hex(snapshot)
    await POST(makePost('/api/sync', authHeaders(), { bytes: bytesToBase64(snapshot) }))
    const again = await POST(
      makePost('/api/sync', authHeaders(), { bytes: bytesToBase64(snapshot), basedOnHash: hash })
    )
    expect(again.status).toBe(200)
    const metaResp = await GET_META(makeGet('/api/sync/meta', authHeaders()))
    expect((await json(metaResp)) as { hash?: string }).toEqual(expect.objectContaining({ hash }))
  })

  it('409 si el remoto cambió desde el último pull del cliente', async () => {
    // A hace primer push
    await POST(makePost('/api/sync', authHeaders(CODE_A), { bytes: bytesToBase64(snapshot) }))
    // B (otro dispositivo) sobreescribe con basedOnHash viejo → conflicto real
    const other = new TextEncoder().encode('other-device-data')
    const conflict = await POST(
      makePost('/api/sync', authHeaders(CODE_A), {
        bytes: bytesToBase64(other),
        basedOnHash: 'hash-que-ya-no-existe',
      })
    )
    expect(conflict.status).toBe(409)
    const body = await json(conflict)
    const remoteHash = (body as { remoteHash?: string }).remoteHash
    expect(remoteHash).toBe(sha256Hex(snapshot))
    // El snapshot remoto NO fue sobrescrito ciegamente
    const getResp = await GET(makeGet('/api/sync', authHeaders(CODE_A)))
    expect((await json(getResp)) as { hash?: string }).toEqual(
      expect.objectContaining({ hash: remoteHash })
    )
  })

  it('409 si un POST sin basedOnHash intenta sobrescribir un snapshot existente', async () => {
    await POST(makePost('/api/sync', authHeaders(CODE_A), { bytes: bytesToBase64(snapshot) }))
    const blind = await POST(
      makePost('/api/sync', authHeaders(CODE_A), {
        bytes: bytesToBase64(new TextEncoder().encode('blind-overwrite')),
      })
    )
    expect(blind.status).toBe(409)
  })

  it('los namespaces por sync code están aislados', async () => {
    await POST(makePost('/api/sync', authHeaders(CODE_A), { bytes: bytesToBase64(snapshot) }))
    const metaB = await GET_META(makeGet('/api/sync/meta', authHeaders(CODE_B)))
    expect(metaB.status).toBe(404)
    const getB = await GET(makeGet('/api/sync', authHeaders(CODE_B)))
    expect(getB.status).toBe(404)
  })
})