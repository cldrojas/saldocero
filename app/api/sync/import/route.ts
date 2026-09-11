import fs from 'fs'
import path from 'path'
import { checkSyncAuth, unauthorized, notFound, conflict } from '@/lib/sync-auth'
import { getSnapshotMeta, putSnapshot, sha256Hex } from '@/lib/blob-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// El import lee el .db legacy del server (better-sqlite3) y lo sube como
// primer snapshot del relay (FR-DB). Ruta igual que lib/db/index.ts.
function legacyDbPath(): string {
  return (
    process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'saldo-cero.db')
  )
}

/**
 * POST /api/sync/import → 200 { hash, updatedAt } | 401 | 404 | 409
 *
 * Primer push guiado del `.db` legacy (migración one-shot, D10). Idempotente
 * por hash: si el remoto ya tiene el MISMO contenido → 200 sin re-subir. Si el
 * remoto tiene un snapshot DISTINTO → 409 con remoteHash (no clobber; el
 * usuario decide merge/overwrite en la UI del primer push).
 */
export async function POST(req: Request) {
  const syncCode = checkSyncAuth(req)
  if (!syncCode) return unauthorized()

  const dbPath = legacyDbPath()
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(fs.readFileSync(dbPath))
  } catch {
    return notFound()
  }

  const hash = sha256Hex(bytes)
  const remote = await getSnapshotMeta(syncCode)
  if (remote) {
    if (remote.hash !== hash) {
      return conflict(remote.hash, remote.updatedAt)
    }
    return Response.json({ hash, updatedAt: remote.updatedAt, idempotent: true }, { status: 200 })
  }

  const meta = await putSnapshot(syncCode, bytes, hash)
  return Response.json({ hash: meta.hash, updatedAt: meta.updatedAt }, { status: 200 })
}