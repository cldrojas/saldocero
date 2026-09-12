import { createHash } from 'node:crypto'
import { put, get, list, del, type GetBlobResult } from '@vercel/blob'

// ─── Relay de claims de exportación por QR sobre Vercel Blob ─────────────
// Opción B: el claim es AUTOCONTENIDO — el snapshot completo (en base64) se
// guarda inline en el sidecar JSON del claim (`saldo-cero-claims/<token>.json`),
// junto con su hash SHA-256, el timestamp de creación y una ventana de
// expiración (TTL 15 min). No hay syncCode ni SYNC_TOKEN: el token del claim
// (capability) es la única autorización para consumirlo (D-sign, NFR-3).
//
// Nota @vercel/blob v2: `get` devuelve `GetBlobResult | null` (con `.stream`)
// y tanto `get` como `put` exigen `access`. El access DEBE coincidir con el
// tipo de store (public|private); si se usa 'public' en un store privado,
// Vercel lanza "Cannot use public access on a private store". El relay usa
// store privado: el cliente nunca recibe URLs de Blob — todo pasa por las
// rutas /api/sync/claim* server-side. El relay expone bytes (Uint8Array) y
// base64 para que las rutas no dependan de la forma del SDK.

// Tipo de acceso del store. 'private' es lo compatible con tiendas privadas
// (default en plans actuales); dejar constante para cambios en un solo punto.
export const BLOB_ACCESS = 'private' as const

// ─── Claims de exportación por QR ─────────────────────────────────────────
// El claim es un cupón de un solo uso y autocontenido: sidecar JSON en su
// propio namespace (`saldo-cero-claims/<token>.json`) con el payload del
// snapshot inline, su hash para verificar la integridad y una ventana de
// expiración. El import no deja snapshots huérfanos porque el payload viaja
// con el claim (D10/D11).

export const CLAIM_PREFIX = 'saldo-cero-claims/'

export function claimPath(token: string): string {
  return `${CLAIM_PREFIX}${token}.json`
}

/** Valida que el token del claim sea un UUID v4 canónico. */
export function requireClaimToken(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)
}

export interface ClaimMeta {
  payload: string // snapshot completo en base64 (autocontenido)
  hash: string
  createdAt: number // epoch ms — se conserva como number en el contrato
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
    typeof v.payload === 'string' && // exige payload → rechaza sidecars legacy sin él
    typeof v.hash === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.expiresAt === 'number' &&
    (v.status === 'open' || v.status === 'consumed')
  )
}

/** Metadata del claim, o null si no existe, está corrupto o es legacy. */
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

/** Marca un claim como consumido (un solo uso). */
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
 * Barre los claims y borra los que ya no sirven. Devuelve la cantidad de
 * claims purgados. Best-effort por item: una falla no detiene la limpieza.
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
      // best-effort: seguir con el siguiente item
    }
  }
  return purged
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export const bytesToBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
export const base64ToBytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))

/** El mock de tests devuelve un web Response; el SDK real un GetBlobResult. */
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
    if (!res) return null // SDK real: no existe → null (no lanza)
    return await resultToBytes(res)
  } catch {
    return null
  }
}