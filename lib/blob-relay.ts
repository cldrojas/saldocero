import { createHash } from 'node:crypto'
import { put, get, head, type GetBlobResult } from '@vercel/blob'

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