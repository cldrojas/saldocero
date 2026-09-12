import { base64ToBytes, putClaim, sha256Hex, sweepClaims } from '@/lib/blob-relay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CLAIM_TTL_MS = 15 * 60 * 1000
const MAX_CLAIM_PAYLOAD_BYTES = 3 * 1024 * 1024 // 3 MiB decoded

// POST /api/sync/claim → 200 { token, hash, expiresAt } | 400 | 413 | 500
//
// Emite un claim de exportación por QR (token-capability autocontenido).
// Opción B: el snapshot completo viaja inline en el sidecar del claim
// (`payload` base64), así que NO se necesitan syncCode/SYNC_TOKEN ni headers
// (NFR-3, D4). Antes de emitir purga claims vencidos/usados (best-effort).
// El claim queda "open" hasta que el import lo consume o expira.
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => null)) as { bytes?: unknown } | null
    const raw = body?.bytes
    if (typeof raw !== 'string' || raw.length === 0) {
      return Response.json({ error: 'bad-request' }, { status: 400 })
    }

    const bytes = base64ToBytes(raw)
    if (bytes.length === 0) {
      // base64 inválido/espacio en blanco → decodifica vacío → 400
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
    // falla de blob/red → error genérico, sin filtrar nada
    return Response.json({ error: 'claim_issue_failed' }, { status: 500 })
  }
}