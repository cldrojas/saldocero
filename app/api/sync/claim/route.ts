import { base64ToBytes, putClaim, sha256Hex, sweepClaims } from '@/lib/blob-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CLAIM_TTL_MS = 15 * 60 * 1000
const MAX_CLAIM_PAYLOAD_BYTES = 3 * 1024 * 1024 // 3 MiB decoded

// POST /api/sync/claim → 200 { token, hash, expiresAt } | 400 | 413 | 500
//
// Issues a QR export claim (self-contained token-capability). Opción B: the
// full snapshot travels inline in the claim sidecar (`payload` base64), so no
// syncCode/SYNC_TOKEN or headers are needed. Before issuing, expired/used
// claims are swept (best-effort). The claim stays "open" until the import
// consumes it or it expires.
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => null)) as { bytes?: unknown } | null
    const raw = body?.bytes
    if (typeof raw !== 'string' || raw.length === 0) {
      return Response.json({ error: 'bad-request' }, { status: 400 })
    }

    const bytes = base64ToBytes(raw)
    if (bytes.length === 0) {
      // invalid/whitespace base64 → decodes empty → 400
      return Response.json({ error: 'bad-request' }, { status: 400 })
    }
    if (bytes.length > MAX_CLAIM_PAYLOAD_BYTES) {
      return Response.json({ error: 'claim_too_large' }, { status: 413 })
    }

    await sweepClaims(Date.now())

    const token = crypto.randomUUID()
    const now = Date.now()
    const expiresAt = now + CLAIM_TTL_MS
    const hash = sha256Hex(bytes)
    await putClaim(
      { payload: raw, hash, createdAt: now, expiresAt, status: 'open' },
      token
    )

    return Response.json({ token, hash, expiresAt }, { status: 200 })
  } catch {
    // blob/network failure → generic error, nothing leaked
    return Response.json({ error: 'claim_issue_failed' }, { status: 500 })
  }
}