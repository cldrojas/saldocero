// tests/unit/sync-client.test.ts
// Tests of the QR claim client (Opción B): base64/SHA-256 helpers,
// buildClaimUrl, createClaim/fetchClaim (error mapping) and the apply pipeline
// (applyClaimToState / importFromClaim) that replaces the sql.js-era
// applyQrImport/mergeDatabases: decode → applyJsonImport → replace
// (useBudget().replaceAll), mocked here as a plain spy.
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { LegacyImportData } from '@/lib/import-json'
import {
  sha256Hex,
  bytesToBase64,
  base64ToBytes,
  buildClaimUrl,
  createClaim,
  fetchClaim,
  applyClaimToState,
  importFromClaim,
} from '@/lib/sync-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

// Shape canónico del blob `daily-budget-data` (mismo fixture que
// import-json.test.ts y el spec E2E de import legacy).
const SNAPSHOT: LegacyImportData = {
  budget: {
    startAmount: 50000,
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-09-30T00:00:00.000Z',
    mode: 'daily',
    autoSave: true,
    isSetup: true,
  },
  accounts: [
    { id: 'daily', name: 'Diario', type: 'daily', icon: 'wallet', hidden: false, balance: 34000 },
  ],
  transactions: [
    { id: 'tx-1', type: 'income', amount: 50000, description: 'Sueldo', account: 'daily', date: '2026-08-01' },
  ],
  dailyAllowance: 1000,
  remainingToday: 1000,
  progress: 100,
  lastCheckedDay: '2026-08-01T00:00:00.000Z',
  isSetup: true,
}

function snapshotBytes(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(SNAPSHOT))
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

  it('bytesToBase64 matches the Node/Buffer encoding (server parity)', () => {
    const input = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(bytesToBase64(input)).toBe(Buffer.from(input).toString('base64'))
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

  it('buildClaimUrl embeds only the claim token (sin param `c`)', () => {
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

  it('network error → network', async () => {
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

// ─── Apply pipeline (reemplaza importFromClaim/applyQrImport sql.js) ────────
describe('applyClaimToState', () => {
  it('decodes the UTF-8 payload and applies it via applyJsonImport + replace', () => {
    const bytes = snapshotBytes()
    const replace = vi.fn()

    const counts = applyClaimToState({ bytes, hash: 'h', createdAt: 1 }, replace)

    expect(counts).toEqual({ accounts: 1, transactions: 1 })
    // applyJsonImport validates the decoded text and delegates the parsed data
    // to the replace callback (useBudget().replaceAll in the app).
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({
        budget: expect.objectContaining({ startAmount: 50000, mode: 'daily' }),
        accounts: expect.arrayContaining([expect.objectContaining({ name: 'Diario' })]),
        transactions: expect.arrayContaining([expect.objectContaining({ id: 'tx-1' })]),
      })
    )
  })

  it('invalid JSON → throws { error: invalid-json } without calling replace', () => {
    const bytes = new TextEncoder().encode('{esto no es json')
    const replace = vi.fn()

    expect(() =>
      applyClaimToState({ bytes, hash: 'h', createdAt: 1 }, replace)
    ).toThrowError(expect.objectContaining({ error: 'invalid-json' }))
    expect(replace).not.toHaveBeenCalled()
  })

  it('valid JSON with wrong shape → throws { error: invalid-shape } without calling replace', () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ foo: 'bar' }))
    const replace = vi.fn()

    expect(() =>
      applyClaimToState({ bytes, hash: 'h', createdAt: 1 }, replace)
    ).toThrowError(expect.objectContaining({ error: 'invalid-shape' }))
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('importFromClaim', () => {
  it('fetches and applies: { ok: true, accounts, transactions, hash, createdAt }', async () => {
    const bytes = snapshotBytes()
    const hash = await sha256Hex(bytes)
    const createdAt = Date.now()
    const replace = vi.fn()

    vi.stubGlobal(
      'fetch',
      mockFetch(200, { bytes: bytesToBase64(bytes), hash, createdAt })
    )

    const result = await importFromClaim('tok-1', replace)
    expect(result).toEqual({ ok: true, accounts: 1, transactions: 1, hash, createdAt })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(
      (replace.mock.calls[0][0] as LegacyImportData).budget.startAmount
    ).toBe(50000)
  })

  it('network error on the fetch → { ok: false, error: network } sin tocar replace', async () => {
    const replace = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const result = await importFromClaim('tok-1', replace)
    expect(result).toEqual({ ok: false, error: 'network' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('invalid payload → { ok: false, error: invalid-shape } sin tocar replace', async () => {
    const replace = vi.fn()
    const bytes = new TextEncoder().encode(JSON.stringify({ foo: 'bar' }))
    vi.stubGlobal(
      'fetch',
      mockFetch(200, { bytes: bytesToBase64(bytes), hash: 'h', createdAt: 1 })
    )

    const result = await importFromClaim('tok-1', replace)
    expect(result).toEqual({ ok: false, error: 'invalid-shape' })
    expect(replace).not.toHaveBeenCalled()
  })

  it('404 claim_consumed → { ok: false, error: consumed }', async () => {
    const replace = vi.fn()
    vi.stubGlobal('fetch', mockFetch(404, { error: 'claim_consumed' }))

    const result = await importFromClaim('tok-1', replace)
    expect(result).toEqual({ ok: false, error: 'consumed' })
    expect(replace).not.toHaveBeenCalled()
  })
})