// tests/unit/sync-client.test.ts
// Tests del cliente de claims por QR (Opción B): helpers base64/SHA-256,
// buildClaimUrl, createClaim/fetchClaim (mapeo de errores) e importFromClaim
// (integración real con merge + IndexedDB sobre el singleton de sql.js).
// No hay syncConfig/fetchRemoteMeta/syncNow/SyncAuthError: esos símbolos se
// eliminaron con el flujo legacy de syncCode/SYNC_TOKEN.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { resetDb, getDb, exportDb, getSql } from '@/lib/db/client'
import { getMeta } from '@/lib/db/meta'
import { SCHEMA } from '@/lib/db/schema'
import {
  sha256Hex,
  bytesToBase64,
  base64ToBytes,
  buildClaimUrl,
  createClaim,
  fetchClaim,
  importFromClaim,
} from '@/lib/sync-client'

// localStorage para el deviceId estable (applyQrImport lo usa por defecto,
// pero en los tests pasamos deviceId explícito; limpiamos igual por higiene)
beforeEach(() => {
  localStorage.clear()
  return resetDb()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createStorageMock(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, v) },
  } as unknown as Storage
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────
describe('helpers', () => {
  it('bytesToBase64 roundtrip', () => {
    const input = new Uint8Array([72, 101, 108, 108, 111])
    const encoded = bytesToBase64(input)
    expect(encoded).toBe('SGVsbG8=')
    expect(base64ToBytes(encoded)).toEqual(input)
  })

  it('base64ToBytes handle ascii', () => {
    const input = new Uint8Array([65, 66, 67])
    expect(base64ToBytes(bytesToBase64(input))).toEqual(input)
  })

  it('sha256Hex returns consistent 64-char hex', async () => {
    const input = new Uint8Array([1, 2, 3])
    const hash = await sha256Hex(input)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(await sha256Hex(input)).toBe(hash)
  })

  it('buildClaimUrl embeds only the claim token (D4: sin param `c`)', () => {
    expect(buildClaimUrl('https://app.example', 'abc-123')).toBe(
      'https://app.example/sync-import?claim=abc-123'
    )
    expect(buildClaimUrl('http://x', 'a b')).toBe('http://x/sync-import?claim=a%20b')
  })
})

// ─── createClaim ────────────────────────────────────────────────────────────
describe('createClaim', () => {
  it('200 → { ok: true, token, hash, expiresAt }', async () => {
    const payload = new Uint8Array([1, 2, 3])
    const hash = await sha256Hex(payload)
    vi.stubGlobal('fetch', mockFetch(200, { token: 'tok-1', hash, expiresAt: 123456 }))
    const result = await createClaim(payload)
    expect(result).toEqual({ ok: true, token: 'tok-1', hash, expiresAt: 123456 })
  })

  it('413 → too_large', async () => {
    vi.stubGlobal('fetch', mockFetch(413, { error: 'claim_too_large' }))
    expect(await createClaim(new Uint8Array([1]))).toEqual({ ok: false, error: 'too_large' })
  })

  it('400 → bad-request', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { error: 'bad-request' }))
    expect(await createClaim(new Uint8Array([1]))).toEqual({ ok: false, error: 'bad-request' })
  })

  it('500 → server', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { error: 'claim_issue_failed' }))
    expect(await createClaim(new Uint8Array([1]))).toEqual({ ok: false, error: 'server' })
  })

  it('network error → network (nunca lanza)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    expect(await createClaim(new Uint8Array([1]))).toEqual({ ok: false, error: 'network' })
  })
})

// ─── fetchClaim ─────────────────────────────────────────────────────────────
describe('fetchClaim', () => {
  it('200 → { ok: true, bytes, hash, createdAt }', async () => {
    const payload = new Uint8Array([72, 105])
    const hash = await sha256Hex(payload)
    vi.stubGlobal('fetch', mockFetch(200, { bytes: bytesToBase64(payload), hash, createdAt: 999 }))
    const result = await fetchClaim('tok-1')
    expect(result).toEqual({ ok: true, bytes: payload, hash, createdAt: 999 })
  })

  it('404 claim_expired → expired', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { error: 'claim_expired' }))
    expect(await fetchClaim('t')).toEqual({ ok: false, error: 'expired' })
  })

  it('404 claim_consumed → consumed', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { error: 'claim_consumed' }))
    expect(await fetchClaim('t')).toEqual({ ok: false, error: 'consumed' })
  })

  it('404 sin error específico → not_found', async () => {
    vi.stubGlobal('fetch', mockFetch(404, { error: 'claim_not_found' }))
    expect(await fetchClaim('t')).toEqual({ ok: false, error: 'not_found' })
  })

  it('network error → network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    expect(await fetchClaim('t')).toEqual({ ok: false, error: 'network' })
  })
})

// ─── importFromClaim ────────────────────────────────────────────────────────
describe('importFromClaim', () => {
  it('importa, mergea y estampa sync_meta (integración real con singleton)', async () => {
    // Local: schema real, sin filas.
    const localBytes = exportDb(await getDb())

    // Remoto: schema real + cuenta 'a1'.
    const sql = await getSql()
    const remoteSql = new sql.Database()
    remoteSql.run(SCHEMA)
    remoteSql.run(
      "INSERT INTO accounts (id, name, type, created_at, updated_at, device_id) " +
      "VALUES ('a1', 'Acme', 'daily', datetime('now'), datetime('now'), 'dev-b')"
    )
    const remoteBytes = new Uint8Array(remoteSql.export())
    const remoteHash = await sha256Hex(remoteBytes)
    const createdAt = Date.now()

    vi.stubGlobal('fetch', mockFetch(200, {
      bytes: bytesToBase64(remoteBytes),
      hash: remoteHash,
      createdAt,
    }))

    const result = await importFromClaim('tok-1', { deviceId: 'dev-a' })
    expect(result).toEqual({ ok: true, bytes: remoteBytes, hash: remoteHash, createdAt })

    // El singleton fue conmutado al DB mergeado: la cuenta remota llegó, con
    // device_id stampado por el dispositivo que importó.
    const db = await getDb()
    const rows = db.exec("SELECT id, name, device_id FROM accounts WHERE id = 'a1'")
    expect(rows[0]?.values).toContainEqual(['a1', 'Acme', 'dev-a'])

    // sync_meta quedó estampado con el hash del claim importado.
    const meta = await getMeta()
    expect(meta.snapshot_hash).toBe(remoteHash)
    expect(meta.device_id).toBe('dev-a')

    // El local (schema sin filas) sigue intacto como data de base del merge.
    expect(localBytes.length).toBeGreaterThan(0)
  })

  it('network error en el fetch → { ok: false, error: network } sin tocar la DB', async () => {
    const before = exportDb(await getDb())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const result = await importFromClaim('tok-1', { deviceId: 'dev-a' })
    expect(result).toEqual({ ok: false, error: 'network' })
    const after = exportDb(await getDb())
    expect(Buffer.from(after)).toEqual(Buffer.from(before))
  })
})