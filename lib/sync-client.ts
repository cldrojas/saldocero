// lib/sync-client.ts
// Client-side claim orchestration for QR sync (Opción B — self-contained
// claim). Port to the localStorage era: NO sql.js/IndexedDB. The snapshot
// payload is the UTF-8 text of the `daily-budget-data` blob; the import apply
// step delegates to the existing lib/import-json pipeline (applyJsonImport →
// useBudget().replaceAll → localStorage), exactly like import-json-modal.
// There is no syncCode/SYNC_TOKEN: the claim token is the only capability.
import { applyJsonImport } from '@/lib/import-json'
import type { LegacyImportData } from '@/lib/import-json'

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Base64 (RFC 4648) encoding without btoa: btoa/atob hang in the jsdom test
 * environment on Node 24, and native browser implementations differ across
 * platforms. This version is portable, deterministic and produces the same
 * output as btoa (compatible with `bytesToBase64` from blob-relay on the
 * server).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63]
  }
  const rem = bytes.length - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + '=='
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + '='
  }
  return out
}

export function base64ToBytes(base64: string): Uint8Array {
  let acc = 0
  let bits = 0
  const out: number[] = []
  for (const ch of base64) {
    if (ch === '=') break
    const idx = B64_CHARS.indexOf(ch)
    if (idx === -1) continue
    acc = (acc << 6) | idx
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

/**
 * SHA-256 hex digest of a byte array (Web Crypto — client-side equivalent of
 * the server's sha256Hex in blob-relay).
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto (crypto.subtle) unavailable')
  const digest = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function fetchJson(
  url: string,
  opts?: RequestInit
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, opts)
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

// ---------------------------------------------------------------------------
// Claim-based QR export/import (Opción B — self-contained claim). Device A
// exports its snapshot bytes as an anonymous claim (POST /api/sync/claim) and
// renders them as a QR; device B redeems the claim by token
// (GET /api/sync/claim/[token]) with no auth headers — the token itself is the
// capability and the payload travels inline in the sidecar.
// ---------------------------------------------------------------------------

export type ClaimIssueResult =
  | { ok: true; token: string; hash: string; expiresAt: number }
  | { ok: false; error: 'too_large' | 'bad-request' | 'network' | 'server' }

export type ClaimFetchError = 'expired' | 'consumed' | 'not_found' | 'network'

export type ClaimFetchResult =
  | { ok: true; bytes: Uint8Array; hash: string; createdAt: number }
  | { ok: false; error: ClaimFetchError }

export interface QrImportData {
  bytes: Uint8Array
  hash: string
  createdAt: number
}

/**
 * Builds the deep link embedded in the export QR: a GET against the sync-import
 * page with only the claim token as query param (no `c` param — D4).
 */
export function buildClaimUrl(origin: string, token: string): string {
  return `${origin}/sync-import?claim=${encodeURIComponent(token)}`
}

/**
 * Issues an anonymous self-contained claim with the given snapshot bytes.
 * The snapshot rides inline (base64 payload); the server returns the token,
 * hash and expiry. Never throws: returns a tagged result instead.
 */
export async function createClaim(bytes: Uint8Array): Promise<ClaimIssueResult> {
  const res = await fetchJson('/api/sync/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bytes: bytesToBase64(bytes) }),
  }).catch(() => null)
  if (!res) return { ok: false, error: 'network' }
  if (res.status === 413) return { ok: false, error: 'too_large' }
  if (res.status === 400) return { ok: false, error: 'bad-request' }
  if (res.status !== 200) return { ok: false, error: 'server' }
  const data = res.data as { token: string; hash: string; expiresAt: number }
  return { ok: true, token: data.token, hash: data.hash, expiresAt: data.expiresAt }
}

/**
 * Redeems a claim by capability token. No auth headers: possession of the token
 * (or the QR that encodes it) is sufficient. 404 bodies carry the precise
 * failure reason mapped onto ClaimFetchError.
 */
export async function fetchClaim(token: string): Promise<ClaimFetchResult> {
  const res = await fetchJson(`/api/sync/claim/${encodeURIComponent(token)}`).catch(() => null)
  if (!res) return { ok: false, error: 'network' }
  if (res.status === 200) {
    const data = res.data as { bytes: string; hash: string; createdAt: number }
    return {
      ok: true,
      bytes: base64ToBytes(data.bytes),
      hash: data.hash,
      createdAt: data.createdAt,
    }
  }
  if (res.status === 404) {
    const rawError = (res.data as { error?: string } | null)?.error
    if (rawError === 'claim_expired') return { ok: false, error: 'expired' }
    if (rawError === 'claim_consumed') return { ok: false, error: 'consumed' }
    return { ok: false, error: 'not_found' }
  }
  return { ok: false, error: 'network' }
}

/**
 * Decodes a redeemed claim payload (base64 → UTF-8 text of the
 * `daily-budget-data` blob).
 */
export function decodeClaimText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/**
 * Applies a redeemed claim to this device through the existing import
 * pipeline: decode → applyJsonImport (validate) → `replace` (useBudget's
 * replaceAll), which persists the blob to localStorage and updates React
 * state. Replaces the reference's sql.js applyQrImport/mergeDatabases step.
 * Throws `{ error: 'invalid-json' | 'invalid-shape' }` on invalid payloads,
 * matching applyJsonImport's contract; the state is untouched in that case.
 */
export function applyClaimToState(
  data: QrImportData,
  replace: (data: LegacyImportData) => void
): { accounts: number; transactions: number } {
  return applyJsonImport(decodeClaimText(data.bytes), replace)
}

export type ClaimApplyResult =
  | { ok: true; accounts: number; transactions: number; hash: string; createdAt: number }
  | { ok: false; error: ClaimFetchError | 'invalid-json' | 'invalid-shape' | 'apply-failed' }

/**
 * Convenience wrapper: fetches the claim and applies it with the given replace
 * callback. Fetch errors are folded into a tagged { ok: false } result; apply
 * errors (invalid payload) are folded too. Never throws.
 */
export async function importFromClaim(
  token: string,
  replace: (data: LegacyImportData) => void
): Promise<ClaimApplyResult> {
  const data = await fetchClaim(token)
  if (!data.ok) return data
  try {
    const counts = applyClaimToState(data, replace)
    return { ok: true, ...counts, hash: data.hash, createdAt: data.createdAt }
  } catch (err) {
    const rawError = (err as { error?: 'invalid-json' | 'invalid-shape' } | null)?.error
    return { ok: false, error: rawError ?? 'apply-failed' }
  }
}