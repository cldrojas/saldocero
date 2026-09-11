import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { POST } from '@/app/api/sync/import/route'
import { POST as POST_SYNC, GET as GET_SYNC } from '@/app/api/sync/route'
import { GET as GET_META } from '@/app/api/sync/meta/route'
import { sha256Hex, bytesToBase64 } from '@/lib/blob-relay'

// ─── In-memory @vercel/blob mock (mismo contrato que sync-protocol.test.ts) ──
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
    _reset: () => store.clear(),
  }
})

vi.mock('@vercel/blob', () => ({
  put: memoryBlobs.put,
  head: memoryBlobs.head,
  get: memoryBlobs.get,
}))

// ─── Helpers ──────────────────────────────────────────────────────────────
const CODE = 'demo-import-01'
const TOKEN = 'test-sync-token'
const DELTA = new TextEncoder().encode('legacy-seed-cambios') // para el push remoto que provoca 409

function authHeaders(code = CODE, token = TOKEN) {
  return { 'content-type': 'application/json', 'x-sync-code': code, 'x-sync-token': token }
}
function makePost(path: string, headers: Record<string, string>, body: unknown): Request {
  return new Request(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}
async function json(resp: Response) {
  return (await resp.json()) as Record<string, unknown>
}

// ─── Suite ────────────────────────────────────────────────────────────────
describe('sync import (primer push del .db legacy)', () => {
  let legacyDir: string
  let legacyPath: string
  let legacyBytes: Uint8Array
  let legacyHash: string

  beforeAll(() => {
    legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saldo-cero-legacy-'))
    legacyPath = path.join(legacyDir, 'saldo-cero.db')
    // .db legacy sintético: un SQLite real (better-sqlite3) con datos plausibles
    const db = new Database(legacyPath)
    db.exec(`
      CREATE TABLE budget (id INTEGER PRIMARY KEY, limit_amount REAL, updated_at TEXT);
      INSERT INTO budget VALUES (1, 500.0, '2026-01-01T00:00:00.000Z');
    `)
    db.close()
    legacyBytes = new Uint8Array(fs.readFileSync(legacyPath))
    legacyHash = sha256Hex(legacyBytes)
  })

  afterAll(() => {
    fs.rmSync(legacyDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.stubEnv('SYNC_TOKEN', TOKEN)
    vi.stubEnv('SQLITE_DB_PATH', legacyPath)
    memoryBlobs._reset()
    memoryBlobs.put.mockClear()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('401 sin credenciales', async () => {
    const resp = await POST(makePost('/api/sync/import', {}, {}))
    expect(resp.status).toBe(401)
  })

  it('401 con token incorrecto', async () => {
    const resp = await POST(makePost('/api/sync/import', authHeaders(CODE, 'wrong'), {}))
    expect(resp.status).toBe(401)
  })

  it('404 si no existe el archivo legacy', async () => {
    vi.stubEnv('SQLITE_DB_PATH', path.join(legacyDir, 'no-existe.db'))
    const resp = await POST(makePost('/api/sync/import', authHeaders(), {}))
    expect(resp.status).toBe(404)
  })

  it('primer import → 200 con hash del archivo y round-trip consistente', async () => {
    const resp = await POST(makePost('/api/sync/import', authHeaders(), {}))
    expect(resp.status).toBe(200)
    const body = await json(resp)
    expect((body as { hash?: string }).hash).toBe(legacyHash)

    // metadata coincide con el archivo
    const metaResp = await GET_META(
      new Request('http://localhost/api/sync/meta', { method: 'GET', headers: authHeaders() })
    )
    expect(metaResp.status).toBe(200)
    const meta = await json(metaResp)
    expect((meta as { size?: number }).size).toBe(legacyBytes.length)

    // snapshot devuelve exactamente los bytes del .db legacy
    const getResp = await GET_SYNC(
      new Request('http://localhost/api/sync', { method: 'GET', headers: authHeaders() })
    )
    expect(getResp.status).toBe(200)
    const got = await json(getResp)
    const gotBytes = Buffer.from((got as { bytes: string }).bytes, 'base64')
    expect(Buffer.from(gotBytes).equals(Buffer.from(legacyBytes))).toBe(true)
  })

  it('re-import del mismo archivo → 200 idempotente, sin sobrescribir (put no se llama de nuevo)', async () => {
    const first = await POST(makePost('/api/sync/import', authHeaders(), {}))
    expect(first.status).toBe(200)
    const putsAfterFirst = memoryBlobs.put.mock.calls.length

    const again = await POST(makePost('/api/sync/import', authHeaders(), {}))
    expect(again.status).toBe(200)
    const body = await json(again)
    expect((body as { hash?: string }).hash).toBe(legacyHash)
    expect(memoryBlobs.put.mock.calls.length).toBe(putsAfterFirst) // no-op
  })

  it('409 si el remoto ya tiene un snapshot distinto (no clobber del relay)', async () => {
    // otro dispositivo ya hizo primer push con datos diferentes
    const push = await POST_SYNC(
      makePost('/api/sync', authHeaders(), { bytes: bytesToBase64(DELTA) })
    )
    expect(push.status).toBe(200)
    const pushed = await json(push)

    const resp = await POST(makePost('/api/sync/import', authHeaders(), {}))
    expect(resp.status).toBe(409)
    const body = await json(resp)
    expect((body as { remoteHash?: string }).remoteHash).toBe(
      (pushed as { hash?: string }).hash
    )

    // el snapshot remoto no fue tocado
    const getResp = await GET_SYNC(
      new Request('http://localhost/api/sync', { method: 'GET', headers: authHeaders() })
    )
    const got = await json(getResp)
    expect((got as { hash?: string }).hash).toBe((pushed as { hash?: string }).hash)
  })
})