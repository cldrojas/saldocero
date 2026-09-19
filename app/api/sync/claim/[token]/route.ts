import { BlobNotFoundError } from '@vercel/blob'
import { deleteClaim, getClaim, markClaimConsumed, requireClaimToken } from '@/lib/blob-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

function claimNotFound(): Response {
  return Response.json({ error: 'claim_not_found' }, { status: 404 })
}

// GET /api/sync/claim/[token] → 200 { bytes, hash, createdAt } | 404 | 500
//
// Claim consumption (token-capability, NO headers). Every invalid token
// receives 404 except the successful 200, so tokens cannot be enumerated. The
// claim is single-use and self-contained: it is marked "consumed" BEFORE the
// bytes are returned (they travel inline in the sidecar, no snapshot relay).
export async function GET(_req: Request, ctx: RouteContext): Promise<Response> {
  const token = (await ctx.params).token
  if (!requireClaimToken(token)) return claimNotFound()

  try {
    const claim = await getClaim(token)
    if (!claim) return claimNotFound()
    if (claim.expiresAt <= Date.now()) {
      // sidecar intact; sweepClaims purges it later
      return Response.json({ error: 'claim_expired' }, { status: 404 })
    }
    if (claim.status === 'consumed') {
      return Response.json({ error: 'claim_consumed' }, { status: 404 })
    }

    await markClaimConsumed(token)

    return Response.json(
      { bytes: claim.payload, hash: claim.hash, createdAt: claim.createdAt },
      { status: 200 }
    )
  } catch {
    return Response.json({ error: 'claim_consume_failed' }, { status: 500 })
  }
}

// DELETE /api/sync/claim/[token] → 204 | 404 | 500
//
// Manual claim invalidation. Idempotent: deleting a claim that does not exist
// in blob (BlobNotFoundError) also answers 204 (not an error for the caller).
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