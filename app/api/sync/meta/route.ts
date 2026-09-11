import { checkSyncAuth, unauthorized, notFound } from '@/lib/sync-auth'
import { getSnapshotMeta } from '@/lib/blob-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/sync/meta → 200 { hash, updatedAt, size } | 401 | 404
export async function GET(req: Request) {
  const syncCode = checkSyncAuth(req)
  if (!syncCode) return unauthorized()

  const meta = await getSnapshotMeta(syncCode)
  if (!meta) return notFound()

  return Response.json(meta, { status: 200 })
}