import { base64ToBytes, putClaim, sha256Hex, sweepClaims } from '@/lib/blob-relay'
import { ClaimThrottle } from '@/lib/claim-throttle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CLAIM_TTL_MS = 15 * 60 * 1000
const MAX_CLAIM_PAYLOAD_BYTES = 3 * 1024 * 1024 // 3 MiB decoded

// Abuse controls for the ANONYMOUS claim endpoint (R1-001 native-review fix).
// All state is in-memory: per-INSTANCE, best-effort semantics — NOT a global
// limit across serverless instances — and intentionally dependency-free.
// Per IP: token bucket (10/60 s) + at most 3 claims in flight (TTL window).
const claimThrottle = new ClaimThrottle({
  capacity: 10,
  refillWindowMs: 60_000,
  maxInFlightPerIp: 3,
  inFlightWindowMs: CLAIM_TTL_MS,
})

// Sweep cadence: sweepClaims lists the whole claim prefix and GETs every blob,
// so it must not run per request. Bounded to once per minute per instance.
const SWEEP_MIN_INTERVAL_MS = 60_000
let lastSweepAt = 0

function clientIp(req: Request): string {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (first) return first
  return (req.headers.get('x-real-ip') ?? 'unknown').trim() || 'unknown'
}

// POST /api/sync/claim → 200 { token, hash, expiresAt } | 400 | 413 | 429 | 500
//
// Issues a QR export claim (self-contained token-capability). Opción B: the
// full snapshot travels inline in the claim sidecar (`payload` base64), so no
// syncCode/SYNC_TOKEN or headers are needed. Before issuing, expired/used
// claims are swept (best-effort). The claim stays "open" until the import
// consumes it or it expires.
export async function POST(req: Request): Promise<Response> {
  try {
    const ip = clientIp(req)
    const now = Date.now()

    // Rate limit BEFORE reading the body: a throttled client must not make us
    // parse a ~4 MiB base64 payload.
    const decision = claimThrottle.tryConsume(ip, now)
    if (!decision.allowed) {
      return Response.json(
        { error: 'rate_limited' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((decision.retryAfterMs ?? 5_000) / 1000)),
          },
        }
      )
    }

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

    // Best-effort sweep, bounded to once per minute per instance instead of
    // once per request (kills the O(n) blob-operation amplification).
    // lastSweepAt is updated BEFORE the await so concurrent requests in the
    // same instance cannot re-enter the sweep while it is in flight.
    if (now - lastSweepAt >= SWEEP_MIN_INTERVAL_MS) {
      lastSweepAt = now
      await sweepClaims(now)
    }

    const token = crypto.randomUUID()
    const expiresAt = now + CLAIM_TTL_MS
    const hash = sha256Hex(bytes)
    await putClaim(
      { payload: raw, hash, createdAt: now, expiresAt, status: 'open' },
      token
    )
    claimThrottle.recordIssue(ip, now) // in-flight accounting (post-success)

    return Response.json({ token, hash, expiresAt }, { status: 200 })
  } catch {
    // blob/network failure → generic error, nothing leaked
    return Response.json({ error: 'claim_issue_failed' }, { status: 500 })
  }
}