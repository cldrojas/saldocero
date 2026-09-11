// lib/sync-client.ts
// Client-side sync orchestration: pull → merge → push against the Batch 3
// relay routes (/api/sync, /api/sync/meta). Works on the process-wide
// sql.js singleton (getDb) and swaps it after a merge via setDb().
import type { Database } from 'sql.js'
import { getDb, initDb, setDb, exportDb } from '@/lib/db/client'
import { saveBackup, saveToIndexedDB } from '@/lib/db/persistence'
import { setMeta, getActiveDeviceId } from '@/lib/db/meta'
import { mergeDatabases } from '@/lib/db/merge'

export interface SyncConfig {
  syncCode: string
  syncToken: string
}

export interface RemoteMeta {
  hash: string
  size: number
  updatedAt: string
}

export type SyncResult =
  | { action: 'synced'; hash: string; updatedAt: string }
  | { action: 'pushed'; hash: string; updatedAt: string }
  | { action: 'merged'; hash: string; updatedAt: string }
  | { action: 'error'; error: string }

export class SyncAuthError extends Error {
  override name = 'SyncAuthError'
}

const CODE_KEY = 'saldo-cero-sync-code'
const TOKEN_KEY = 'saldo-cero-sync-token'

/**
 * Reads the persisted sync credentials, or null if not configured yet.
 */
export function getSyncConfig(): SyncConfig | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null
  const syncCode = localStorage.getItem(CODE_KEY)
  const syncToken = localStorage.getItem(TOKEN_KEY)
  if (!syncCode || !syncToken) return null
  return { syncCode, syncToken }
}

/**
 * Persists the sync credentials on this device.
 */
export function setSyncConfig(config: SyncConfig): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return
  localStorage.setItem(CODE_KEY, config.syncCode)
  localStorage.setItem(TOKEN_KEY, config.syncToken)
}

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

function authHeaders(conf: SyncConfig): Record<string, string> {
  return {
    'x-sync-code': conf.syncCode,
    'x-sync-token': conf.syncToken,
    'Content-Type': 'application/json',
  }
}

async function fetchJson(
  url: string,
  opts?: RequestInit
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(url, opts)
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

/**
 * Reads the remote snapshot metadata.
 * 404 → null (no snapshot upstream yet); 401 → SyncAuthError.
 */
export async function fetchRemoteMeta(conf: SyncConfig): Promise<RemoteMeta | null> {
  const { status, data } = await fetchJson('/api/sync/meta', {
    method: 'GET',
    headers: authHeaders(conf),
  })
  if (status === 401) throw new SyncAuthError('unauthorized')
  if (status === 404) return null
  if (status !== 200) throw new Error(`http-${status}`)
  return data as RemoteMeta
}

async function markSynced(conf: SyncConfig, hash: string, updatedAt: string): Promise<void> {
  await setMeta({
    snapshot_hash: hash,
    updated_at: updatedAt,
    device_id: getActiveDeviceId(),
  })
}

/**
 * pull → merge → push. Persists a pre-merge backup, swaps the singleton with
 * the converged database, and stamps sync_meta. On a 409 conflict it
 * re-reads the remote metadata and retries once (idempotent re-merge).
 */
async function pullMergePush(conf: SyncConfig, baseRemote: RemoteMeta): Promise<SyncResult> {
  const pull = await fetchJson('/api/sync', { headers: authHeaders(conf) }).catch(() => null)
  if (!pull) return { action: 'error', error: 'network' }
  if (pull.status !== 200) return { action: 'error', error: `http-${pull.status}` }

  const remote = pull.data as { bytes: string; hash: string; updatedAt: string }
  const remoteDb = await initDb(base64ToBytes(remote.bytes))

  const localDb = await getDb()
  const localBytes = exportDb(localDb)
  try {
    await saveBackup(localBytes, `pre-merge-${Date.now()}`)
  } catch {
    // El backup es best-effort: un fallo de IndexedDB no debe bloquear el sync
  }

  const merged = mergeDatabases(localDb, remoteDb, getActiveDeviceId())
  setDb(merged)
  const mergedBytes = exportDb(merged)

  const post = await fetchJson('/api/sync', {
    method: 'POST',
    headers: authHeaders(conf),
    body: JSON.stringify({ bytes: bytesToBase64(mergedBytes), basedOnHash: baseRemote.hash }),
  }).catch(() => null)
  if (!post) return { action: 'error', error: 'network' }

  if (post.status === 200) {
    const data = post.data as { hash: string; updatedAt: string }
    await saveToIndexedDbSafe(merged)
    await markSynced(conf, data.hash, data.updatedAt)
    return { action: 'merged', hash: data.hash, updatedAt: data.updatedAt }
  }

  if (post.status === 409) {
    try {
      const fresh = await fetchRemoteMeta(conf)
      if (fresh) return pullMergePush(conf, fresh)
    } catch {
      // sin metadata fresca → reportamos conflicto
    }
    return { action: 'error', error: 'conflict' }
  }

  return { action: 'error', error: `http-${post.status}` }
}

async function saveToIndexedDbSafe(db: Database): Promise<void> {
  try {
    await saveToIndexedDB(db)
  } catch {
    // Persistir el snapshot es best-effort
  }
}

/**
 * Runs the full sync cycle against the relay:
 *  1. meta → 404: primer push (POST sin basedOnHash)
 *  2. meta hash == local hash: 'synced' sin tocar el relay
 *  3. hash distinto: pull → merge → push (con retry 409)
 *
 * Nunca lanza por errores HTTP/red: devuelve { action: 'error' }.
 */
export async function syncNow(conf: SyncConfig): Promise<SyncResult> {
  try {
    const db = await getDb()
    const localBytes = exportDb(db)
    const localHash = await sha256Hex(localBytes)

    let remote: RemoteMeta | null
    try {
      remote = await fetchRemoteMeta(conf)
    } catch (err) {
      return { action: 'error', error: err instanceof SyncAuthError ? 'auth' : 'network' }
    }

    if (!remote) {
      const post = await fetchJson('/api/sync', {
        method: 'POST',
        headers: authHeaders(conf),
        body: JSON.stringify({ bytes: bytesToBase64(localBytes) }),
      }).catch(() => null)
      if (!post) return { action: 'error', error: 'network' }

      if (post.status === 200) {
        const data = post.data as { hash: string; updatedAt: string }
        await saveToIndexedDbSafe(db)
        await markSynced(conf, data.hash, data.updatedAt)
        return { action: 'pushed', hash: data.hash, updatedAt: data.updatedAt }
      }

      if (post.status === 409) {
        // Otro dispositivo pusheó entre nuestra lectura de meta y el POST
        try {
          const fresh = await fetchRemoteMeta(conf)
          if (fresh) return pullMergePush(conf, fresh)
        } catch {
          // seguimos con el conflicto
        }
        return { action: 'error', error: 'conflict' }
      }

      return { action: 'error', error: `http-${post.status}` }
    }

    if (remote.hash === localHash) {
      return { action: 'synced', hash: localHash, updatedAt: remote.updatedAt }
    }

    return pullMergePush(conf, remote)
  } catch (err) {
    return { action: 'error', error: err instanceof SyncAuthError ? 'auth' : 'network' }
  }
}