import { checkSyncAuth, unauthorized } from '@/lib/sync-auth'
import { getSnapshotMeta, putClaim, sweepClaims } from '@/lib/blob-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CLAIM_TTL_MS = 15 * 60 * 1000

// POST /api/sync/claim → 200 { token, syncCode, hash, expiresAt } | 401 | 404 | 500
//
// Emite un claim de exportación por QR (token de un solo uso con TTL de 15 min).
// Antes de emitir purga claims vencidos/usados (best-effort) sobre el namespace
// de claims. El claim queda "open" hasta que el import lo consume o expira.
export async function POST(req: Request): Promise<Response> {
  const syncCode = checkSyncAuth(req)
  if (!syncCode) return unauthorized()

  try {
    const meta = await getSnapshotMeta(syncCode)
    if (!meta) {
      return Response.json({ error: 'snapshot_not_found' }, { status: 404 })
    }

    await sweepClaims(Date.now())

    const token = crypto.randomUUID()
    const now = Date.now()
    const expiresAt = now + CLAIM_TTL_MS
    await putClaim(
      { syncCode, hash: meta.hash, createdAt: now, expiresAt, status: 'open' },
      token
    )

    return Response.json({ token, syncCode, hash: meta.hash, expiresAt }, { status: 200 })
  } catch {
    // falla de blob/red → error genérico, sin filtrar nada
    return Response.json({ error: 'claim_issue_failed' }, { status: 500 })
  }
}