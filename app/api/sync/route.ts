import { checkSyncAuth, unauthorized, notFound, badRequest, conflict } from '@/lib/sync-auth'
import {
  base64ToBytes,
  bytesToBase64,
  getSnapshotBytes,
  getSnapshotMeta,
  putSnapshot,
  sha256Hex,
} from '@/lib/blob-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SyncBody {
  bytes?: unknown
  basedOnHash?: unknown
}

// GET /api/sync → 200 { bytes, hash, updatedAt } | 401 | 404
export async function GET(req: Request) {
  const syncCode = checkSyncAuth(req)
  if (!syncCode) return unauthorized()

  const meta = await getSnapshotMeta(syncCode)
  if (!meta) return notFound()

  const bytes = await getSnapshotBytes(syncCode)
  if (!bytes) return notFound()

  return Response.json(
    { bytes: bytesToBase64(bytes), hash: meta.hash, updatedAt: meta.updatedAt },
    { status: 200 }
  )
}

// POST /api/sync → 200 { hash, updatedAt } | 400 | 401 | 409
//
// Concurrencia (D7/FR-4): ANTES de sobrescribir se re-lee la metadata. Si el
// remoto ya tiene snapshot y el cliente no declara basedOnHash, o declara uno
// distinto al actual → 409 con el hash remoto para que el cliente re-mergee.
// El primer push (sin snapshot remoto) NO requiere basedOnHash.
export async function POST(req: Request) {
  const syncCode = checkSyncAuth(req)
  if (!syncCode) return unauthorized()

  const body = (await req.json().catch(() => null)) as SyncBody | null
  if (!body || typeof body.bytes !== 'string') return badRequest()

  const bytes = base64ToBytes(body.bytes)
  const hash = sha256Hex(bytes)
  const basedOnHash = typeof body.basedOnHash === 'string' ? body.basedOnHash : null

  const remote = await getSnapshotMeta(syncCode)
  if (remote) {
    if (!basedOnHash || basedOnHash !== remote.hash) {
      return conflict(remote.hash, remote.updatedAt)
    }
  }

  const meta = await putSnapshot(syncCode, bytes, hash)
  return Response.json({ hash: meta.hash, updatedAt: meta.updatedAt }, { status: 200 })
}