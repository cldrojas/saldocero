import { createHash } from 'node:crypto'
import { put, get, head, list, del, type GetBlobResult } from '@vercel/blob'

// ─── Relay de snapshots sobre Vercel Blob ────────────────────────────────
// El blob del .db es un RELAY — no es la fuente de verdad (D3). Cada sync
// code tiene su namespace: `saldo-cero-<syncCode>.db` + un sidecar JSON con
// la metadata (hash SHA-256, tamaño, updatedAt) para el chequeo de
// concurrencia sin descargar el snapshot completo (D7/D14).
//
// Nota @vercel/blob v2: `get` devuelve `GetBlobResult | null` (con `.stream`)
// y tanto `get` como `put` exigen `access`. El relay expone bytes
// (Uint8Array) para que las rutas no dependan de la forma del SDK.

const SNAPSHOT_EXT = '.db'
const META_EXT = '.db.json'

export const snapshotPath = (syncCode: string) => `saldo-cero-${syncCode}${SNAPSHOT_EXT}`
export const metaPath = (syncCode: string) => `saldo-cero-${syncCode}${META_EXT}`

// ─── Claims de exportación por QR ─────────────────────────────────────────
// El claim es un cupón de un solo uso: sidecar JSON en su propio namespace
// (`saldo-cero-claims/<token>.json`) con una ventana de expiración, para que
// el import quizás-configure-luego (QR escaneado en otro dispositivo) no deje
// snapshots huérfanos (D10/D11).

export const CLAIM_PREFIX = 'saldo-cero-claims/'

export function claimPath(token: string): string {
  return `${CLAIM_PREFIX}${token}.json`
}

/** Valida que el token del claim sea un UUID v4 canónico. */
export function requireClaimToken(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)
}

export interface ClaimMeta {
  syncCode: string
  hash: string
  createdAt: number
  expiresAt: number
  status: 'open' | 'consumed'
}

export async function putClaim(meta: ClaimMeta, token: string): Promise<void> {
  await put(claimPath(token), JSON.stringify(meta), {
    access: 'public',
    allowOverwrite: true,
    addRandomSuffix: false,
  })
}

function isClaimMeta(value: unknown): value is ClaimMeta {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.syncCode === 'string' &&
    typeof v.hash === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.expiresAt === 'number' &&
    (v.status === 'open' || v.status === 'consumed')
  )
}

/** Metadata del claim, o null si no existe o está corrupto. */
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

export interface SnapshotMeta {
  hash: string
  updatedAt: string
  size: number
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export const bytesToBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
export const base64ToBytes = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'))

async function headOrNull(pathname: string) {
  try {
    return await head(pathname, {})
  } catch {
    return null
  }
}

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
    const res = await get(pathname, { access: 'public' })
    if (!res) return null // SDK real: no existe → null (no lanza)
    return await resultToBytes(res)
  } catch {
    return null
  }
}

/** Metadata del snapshot remoto, o null si nunca se subió uno. */
export async function getSnapshotMeta(syncCode: string): Promise<SnapshotMeta | null> {
  const bytes = await getOrNull(metaPath(syncCode))
  if (!bytes) return null
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SnapshotMeta
    if (typeof parsed.hash !== 'string' || typeof parsed.size !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

/** Bytes del snapshot remoto, o null si no existe. */
export async function getSnapshotBytes(syncCode: string): Promise<Uint8Array | null> {
  return getOrNull(snapshotPath(syncCode))
}

/**
 * Sube snapshot + sidecar de metadata. Requiere re-check de concurrencia por
 * el caller (D7): esta función siempre sobreescribe; la protección 409 vive
 * en la ruta `/api/sync`.
 */
export async function putSnapshot(
  syncCode: string,
  bytes: Uint8Array,
  hash: string
): Promise<SnapshotMeta> {
  const dbPath = snapshotPath(syncCode)
  // Buffer: aceptado por PutBody y `instanceof Uint8Array` (compat mock/tests)
  await put(dbPath, Buffer.from(bytes), {
    access: 'public',
    allowOverwrite: true,
    addRandomSuffix: false,
  })

  // PutBlobResult v2 no expone uploadedAt/size → head para la metadata
  const uploaded = await headOrNull(dbPath)
  const { uploadedAt, size } = uploaded ?? {
    uploadedAt: new Date().toISOString(),
    size: bytes.length,
  }
  const updatedAt = typeof uploadedAt === 'string' ? uploadedAt : uploadedAt.toISOString()
  const meta: SnapshotMeta = { hash, updatedAt, size }

  await put(metaPath(syncCode), JSON.stringify(meta), {
    access: 'public',
    allowOverwrite: true,
    addRandomSuffix: false,
  })
  return meta
}