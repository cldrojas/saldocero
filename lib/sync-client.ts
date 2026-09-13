// lib/sync-client.ts
// Client-side claim orchestration for QR sync (Opción B — claim autocontenido).
// No hay syncCode/SYNC_TOKEN ni relay de snapshots: el snapshot viaja inline en
// el sidecar del claim (payload base64) y el token del claim es la única
// capability (NFR-3). Works on the process-wide sql.js singleton (getDb) and
// swaps it after a merge via setDb().
import type { Database } from 'sql.js'
import { getDb, initDb, setDb, exportDb } from '@/lib/db/client'
import { saveBackup, saveToIndexedDB } from '@/lib/db/persistence'
import { setMeta, getActiveDeviceId } from '@/lib/db/meta'
import { mergeDatabases } from '@/lib/db/merge'

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Base64 (RFC 4648) encoding sin btoa: btoa/atob de jsdom cuelgan en el
 * entorno de test con Node 24, y en browsers la implementación nativa
 * difiere entre plataformas. Esta versión es portable y determinista y
 * produce la misma salida que btoa (compatible con `bytesToBase64` del
 * servidor en blob-relay).
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
  if (!subtle) throw new Error('Web Crypto (crypto.subtle) no disponible')
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
// Claim-based QR export/import (Opción B — claim autocontenido). Device A
// exports its snapshot bytes as a claim (POST /api/sync/claim, anónimo) and
// renders them as a QR; device B redeems the claim by token
// (GET /api/sync/claim/[token]) with no auth headers — the token itself is
// the capability and el payload viaja inline en el sidecar.
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
 * page with only the claim token as query param (sin param `c` — D4).
 */
export function buildClaimUrl(origin: string, token: string): string {
  return `${origin}/sync-import?claim=${encodeURIComponent(token)}`
}

/**
 * Issues an anonymous self-contained claim with the given snapshot bytes.
 * El snapshot viaja inline (payload base64); el servidor devuelve el token,
 * el hash y la expiración. Nunca lanza: devuelve un resultado etiquetado.
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

async function saveToIndexedDbSafe(db: Database): Promise<void> {
  try {
    await saveToIndexedDB(db)
  } catch {
    // Persistir el snapshot es best-effort
  }
}

/**
 * Applies a redeemed claim to this device: best-effort pre-import backup,
 * local ↔ remote merge (pure), singleton swap, IndexedDB persistence, and
 * sync_meta stamp (hash + createdAt). No toda la ruta implementa auto-fill de
 * sync código (ya no existe): el claim es autocontenido.
 */
export async function applyQrImport(
  data: QrImportData,
  opts: { deviceId?: string }
): Promise<void> {
  const deviceId = opts.deviceId ?? getActiveDeviceId()
  const remoteDb = await initDb(data.bytes)

  const localDb = await getDb()
  const localBytes = exportDb(localDb)
  try {
    await saveBackup(localBytes, `pre-claim-${Date.now()}`)
  } catch {
    // El backup es best-effort: un fallo de IndexedDB no debe bloquear el import
  }

  const merged = mergeDatabases(localDb, remoteDb, deviceId)
  setDb(merged)
  await saveToIndexedDbSafe(merged)

  await setMeta({
    snapshot_hash: data.hash,
    updated_at: new Date(data.createdAt).toISOString(),
    device_id: deviceId,
  })
}

/**
 * Convenience wrapper: fetches the claim, then applies it. Errors are folded
 * into a tagged { ok: false } result, never thrown.
 */
export async function importFromClaim(
  token: string,
  opts: { deviceId?: string }
): Promise<ClaimFetchResult> {
  const data = await fetchClaim(token)
  if (!data.ok) return data
  try {
    await applyQrImport(data, opts)
  } catch {
    return { ok: false, error: 'network' }
  }
  return data
}