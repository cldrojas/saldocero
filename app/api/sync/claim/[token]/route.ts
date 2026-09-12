import { BlobNotFoundError } from '@vercel/blob'
import {
  bytesToBase64,
  deleteClaim,
  getClaim,
  getSnapshotBytes,
  getSnapshotMeta,
  markClaimConsumed,
  requireClaimToken,
} from '@/lib/blob-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

function claimNotFound(): Response {
  return Response.json({ error: 'claim_not_found' }, { status: 404 })
}

// GET /api/sync/claim/[token] → 200 { bytes, hash, updatedAt, syncCode } | 404 | 500
//
// Consumo del claim (token-capability, SIN headers). Todo token válido recibe
// 404 salvo el 200 de éxito, para no permitir enumeración (D-sign). El claim es
// de un solo uso: se marca "consumed" antes de devolver los bytes.
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const token = (await ctx.params).token
  if (!requireClaimToken(token)) return claimNotFound()

  try {
    const claim = await getClaim(token)
    if (!claim) return claimNotFound()
    if (claim.expiresAt <= Date.now()) {
      // sidecar intacto; sweepClaims lo purga más tarde
      return Response.json({ error: 'claim_expired' }, { status: 404 })
    }
    if (claim.status === 'consumed') {
      return Response.json({ error: 'claim_consumed' }, { status: 404 })
    }

    await markClaimConsumed(token)

    const bytes = await getSnapshotBytes(claim.syncCode)
    if (!bytes) {
      return Response.json({ error: 'snapshot_not_found' }, { status: 404 })
    }

    const meta = await getSnapshotMeta(claim.syncCode)
    return Response.json(
      {
        bytes: bytesToBase64(bytes),
        hash: claim.hash,
        updatedAt: meta?.updatedAt ?? null,
        syncCode: claim.syncCode,
      },
      { status: 200 }
    )
  } catch {
    return Response.json({ error: 'claim_consume_failed' }, { status: 500 })
  }
}

// DELETE /api/sync/claim/[token] → 204 | 404 | 500
//
// Invalidación manual del claim. Idempotente: borrar un claim inexistente en
// blob (BlobNotFoundError) también responde 204 (no es un error para el caller).
export async function DELETE(_req: Request, ctx: RouteContext): Promise<Response> {
  const token = (await ctx.params).token
  if (!requireClaimToken(token)) return claimNotFound()

  try {
    await deleteClaim(token)
  } catch (err) {
    if (err instanceof BlobNotFoundError) return new Response(null, { status: 204 })
    return Response.json({ error: 'claim_delete_failed' }, { status: 500 })
  }

  return new Response(null, { status: 204 })
}