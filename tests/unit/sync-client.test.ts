import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { resetDb, initDb, getDb, exportDb, getSql } from '@/lib/db/client'
import { sha256Hex, bytesToBase64, base64ToBytes } from '@/lib/sync-client'
import { getSyncConfig, setSyncConfig, fetchRemoteMeta, syncNow, SyncAuthError } from '@/lib/sync-client'
import type { SyncConfig, RemoteMeta, SyncResult } from '@/lib/sync-client'

// localStorage mock para tests de config (localStorage ya existe en jsdom,
// pero lo limpiamos manualmente para evitar residuos entre tests)
beforeEach(() => {
  localStorage.clear()
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

const TEST_DB_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'wallet', hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT DEFAULT NULL, device_id TEXT DEFAULT NULL);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, type TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT NOT NULL, account_id TEXT NOT NULL, date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT DEFAULT NULL, device_id TEXT DEFAULT NULL);
CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL, period TEXT NOT NULL DEFAULT 'monthly', category TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT DEFAULT NULL, device_id TEXT DEFAULT NULL);
CREATE TABLE IF NOT EXISTS recurring_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT NOT NULL, account_id TEXT NOT NULL, frequency TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT DEFAULT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT DEFAULT NULL, device_id TEXT DEFAULT NULL);
CREATE TABLE IF NOT EXISTS sync_meta (id INTEGER PRIMARY KEY CHECK (id = 1), updated_at TEXT NOT NULL DEFAULT (datetime('now')), device_id TEXT NOT NULL DEFAULT 'local', snapshot_hash TEXT DEFAULT NULL);
`

/** Push a known database state into the singleton so exportDb works reliably */
async function seedDb(): Promise<void> {
  await initDb(new TextEncoder().encode(TEST_DB_SCHEMA))
}

const VALID_CONF: SyncConfig = { syncCode: 'test-code', syncToken: 'test-token' }

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

  it('sha256Hex is deterministic', async () => {
    const a = await sha256Hex(new Uint8Array([10, 20, 30]))
    const b = await sha256Hex(new Uint8Array([10, 20, 30]))
    expect(a).toBe(b)
  })
})

// ─── Sync config ────────────────────────────────────────────────────────────
describe('sync config', () => {
  it('getSyncConfig returns null when empty', () => {
    expect(getSyncConfig()).toBeNull()
  })

  it('setSyncConfig + getSyncConfig roundtrip', () => {
    setSyncConfig({ syncCode: 'code123', syncToken: 'tok456' })
    expect(getSyncConfig()).toEqual({ syncCode: 'code123', syncToken: 'tok456' })
  })
})

// ─── fetchRemoteMeta ────────────────────────────────────────────────────────
describe('fetchRemoteMeta', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('200 → RemoteMeta', async () => {
    const remote: RemoteMeta = { hash: 'abc123', size: 1024, updatedAt: '2025-09-09T12:00:00Z' }
    vi.stubGlobal('fetch', mockFetch(200, remote))
    const result = await fetchRemoteMeta(VALID_CONF)
    expect(result).toEqual(remote)
  })

  it('404 → null (no snapshot upstream)', async () => {
    vi.stubGlobal('fetch', mockFetch(404, null))
    const result = await fetchRemoteMeta(VALID_CONF)
    expect(result).toBeNull()
  })

  it('401 → throws SyncAuthError', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthorized' }))
    await expect(fetchRemoteMeta(VALID_CONF)).rejects.toBeInstanceOf(SyncAuthError)
  })
})

// ─── syncNow ────────────────────────────────────────────────────────────────
describe('syncNow', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('first push (404 → POST 200 → pushed)', async () => {
    await seedDb()
    const localBytes = exportDb(await getDb())
    const localHash = await sha256Hex(localBytes)
    const remoteHash = 'remote-hash-1'
    const remoteAt = '2025-09-09T12:00:00Z'

    let fetchCall = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => {
      fetchCall++
      // First call: GET /api/sync/meta → 404
      if (fetchCall === 1) {
        return { ok: false, status: 404, json: async () => null }
      }
      // Second call: POST /api/sync → 200
      return {
        ok: true, status: 200,
        json: async () => ({ hash: remoteHash, updatedAt: remoteAt }),
      }
    }))

    const result = await syncNow(VALID_CONF)
    expect(result).toEqual({ action: 'pushed', hash: remoteHash, updatedAt: remoteAt })
  })

  it('synced when hash identical (GET meta 200, same hash)', async () => {
    await seedDb()
    const localBytes = exportDb(await getDb())
    const localHash = await sha256Hex(localBytes)

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ hash: localHash, size: localBytes.length, updatedAt: '2025-01-01T00:00:00Z' }),
    })))

    const result = await syncNow(VALID_CONF)
    expect(result).toEqual({ action: 'synced', hash: localHash, updatedAt: '2025-01-01T00:00:00Z' })
  })

  it('pull + merge + push (hash diverges)', async () => {
    // Seed empty local
    await seedDb()
    const localBytes = exportDb(await getDb())
    const localHash = await sha256Hex(localBytes)

    // Create a different remote db and get its bytes
    const remoteDbSchema = TEST_DB_SCHEMA + `INSERT INTO accounts (id,name,type) VALUES ('a1','Acme','daily');`
    const sql = await getSql()
    const remoteSql = new sql.Database()
    remoteSql.run(remoteDbSchema)
    const remoteBytes = new Uint8Array(remoteSql.export())
    const remoteHash = await sha256Hex(remoteBytes)
    const remoteAt = '2025-09-10T10:00:00Z'

    vi.stubGlobal('fetch', mockFetch(200, {
      bytes: bytesToBase64(remoteBytes),
      hash: remoteHash,
      updatedAt: remoteAt,
    }))

    const result = await syncNow(VALID_CONF)
    expect(['pushed', 'merged']).toContain(result.action)
    expect((result as { hash: string }).hash).toBeTruthy()
  })

  it('409 conflict → retry → 200', async () => {
    await seedDb()
    const localBytes = exportDb(await getDb())

    const sql = await getSql()
    const remoteSql = new sql.Database()
    remoteSql.run(TEST_DB_SCHEMA + `INSERT INTO accounts (id,name,type) VALUES ('a1','Acme','daily');`)
    const remoteBytes = new Uint8Array(remoteSql.export())
    const remoteHash = await sha256Hex(remoteBytes)
    const remoteAt = '2025-09-10T10:00:00Z'

    let postCount = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/sync/meta') {
        return { ok: true, status: 200, json: async () => ({ hash: remoteHash, size: remoteBytes.length, updatedAt: remoteAt }) }
      }
      // GET /api/sync
      if (url === '/api/sync') {
        return { ok: true, status: 200, json: async () => ({ bytes: bytesToBase64(remoteBytes), hash: remoteHash, updatedAt: remoteAt }) }
      }
      // POST /api/sync → 409 first time, 200 second time
      postCount++
      if (postCount === 1) {
        return { ok: false, status: 409, json: async () => ({ error: 'conflict', remoteHash, remoteUpdatedAt: remoteAt }) }
      }
      return { ok: true, status: 200, json: async () => ({ hash: remoteHash, updatedAt: remoteAt }) }
    }))

    const result = await syncNow(VALID_CONF)
    expect(result.action).toBe('merged')
  })

  it('401 → error auth', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthorized' }))
    const result = await syncNow(VALID_CONF)
    expect(result).toEqual({ action: 'error', error: 'auth' })
  })

  it('network error → error network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const result = await syncNow(VALID_CONF)
    expect(result).toEqual({ action: 'error', error: 'network' })
  })
})
