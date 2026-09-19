import { createHash } from 'node:crypto'
import { put, get, list, del, type GetBlobResult } from '@vercel/blob'

// ─── Claim relay for QR export over Vercel Blob ────────────────────────────
// Opción B: the claim is SELF-CONTAINED — the full snapshot (base64) is stored
// inline in the claim sidecar (`saldo-cero-claims/<token>.json`), together with
// its SHA-256 hash, creation timestamp and an expiry window (TTL 15 min). There
// is no syncCode/SYNC_TOKEN: the claim token (capability) is the only
// authorization to consume it.
//
// @vercel/blob v2 note: `get` returns `GetBlobResult | null` (with `.stream`)
// and both `get` and `put` require `access`. The access MUST match the store
// type (public|private); using 'public' on a private store makes Vercel throw
// "Cannot use public access on a private store". The relay uses a private
// store: the client never receives Blob URLs — everything flows through the
// /api/sync/claim* routes server-side. The relay exposes bytes (Uint8Array) and
// base64 so routes do not depend on the SDK's shapes.

// Store access type. 'private' is compatible with private stores (default on
// current plans); kept as a constant so changes land in a single place.
export const BLOB_ACCESS = 'private' as const

// ─── QR export claims ───────────────────────────────────────────────────────
// A claim is a single-use, self-contained coupon: sidecar JSON in its own
// namespace (`saldo-cero-claims/<token>.json`) with the snapshot payload
// inline, its hash for integrity verification and an expiry window. The import
// leaves no orphan snapshots because the payload travels with the claim.

export const CLAIM_PREFIX = 'saldo-cero-claims/'

export function claimPath(token: string): string {
  return `${CLAIM_PREFIX}${token}.json`
}

/** Validates that the claim token is a canonical v4 UUID. */
export function requireClaimToken(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)
}

export interface ClaimMeta {
  payload: string // full snapshot in base64 (self-contained)
  hash: string
  createdAt: number // epoch ms — kept as number in the contract
  expiresAt: number
  status: 'open' | 'consumed'
}

export async function putClaim(meta: ClaimMeta, token: string): Promise<void> {
  await put(claimPath(token), JSON.stringify(meta), {
    access: BLOB_ACCESS,
    allowOverwrite: true,
    addRandomSuffix: false,
  })
}

function isClaimMeta(value: unknown): value is ClaimMeta {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.payload === 'string' && // requires payload → rejects legacy sidecars without it
    typeof v.hash === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.expiresAt === 'number' &&
    (v.status === 'open' || v.status === 'consumed')
  )
}

/** Claim metadata, or null if it does not exist, is corrupted or is legacy. */
export async function getClaim(token: string): Promise<ClaimMeta | null> {
  const bytes = await getOrNull(claimPath(token))
  if (!bytes) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isClaimMeta(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Marks a claim as consumed (single use). */
export async function markClaimConsumed(token: string): Promise<ClaimMeta | null> {
  const meta = await getClaim(token)
  if (!meta) return null
  const consumed: ClaimMeta = { ...meta, status: 'consumed' }
  await putClaim(consumed, token)
  return consumed
}

export async function deleteClaim(token: string): Promise<void> {
  await del(claimPath(token))
}

/**
 * Sweeps claims and deletes the ones that are no longer useful. Returns the
 * number of purged claims. Best-effort per item: one failure does not stop the
 * cleanup.
 */
export async function sweepClaims(now: number): Promise<number> {
  let purged = 0
  let result
  try {
    result = await list({ prefix: CLAIM_PREFIX })
  } catch {
    return 0
  }
  for (const blob of result.blobs) {
    try {
      const token = blob.pathname.split('/').pop()?.replace(/\.json$/, '')
      if (!token) continue
      const claim = await getClaim(token)
      if (!claim || claim.status === 'consumed' || claim.expiresAt <= now) {
        await deleteClaim(token)
        purged += 1
      }
    } catch {
      // best-effort: continue with the next item
    }
  }
  return purged
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export const bytesToBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
export const base64ToBytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))

/** Test mocks return a web Response; the real SDK returns a GetBlobResult. */
async function resultToBytes(res: Response | GetBlobResult): Promise<Uint8Array> {
  if ('stream' in res && res.stream) {
    return new Uint8Array(await new Response(res.stream).arrayBuffer())
  }
  if ('arrayBuffer' in res) {
    return new Uint8Array(await res.arrayBuffer())
  }
  return new Uint8Array()
}

async function getOrNull(pathname: string): Promise<Uint8Array | null> {
  try {
    const res = await get(pathname, { access: BLOB_ACCESS })
    if (!res) return null // real SDK: missing → null (does not throw)
    return await resultToBytes(res)
  } catch {
    return null
  }
}