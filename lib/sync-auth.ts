// ─── Auth del relay (FR-6 / D8) ──────────────────────────────────────────
// El token NUNCA es `NEXT_PUBLIC_*`: vive en env server (`SYNC_TOKEN`).
// El sync code (corto, compartible entre dispositivos propios) dimensiona
// el namespace `saldo-cero-<syncCode>.db`.

export const SYNC_CODE_RE = /^[a-zA-Z0-9-]{4,32}$/

/**
 * Devuelve el sync code si la petición trae credenciales válidas; null → 401.
 * El formato del código valida antes de tocar el namespace (FR-6, NFR-4).
 */
export function checkSyncAuth(req: Request): string | null {
  const code = req.headers.get('x-sync-code')
  const token = req.headers.get('x-sync-token')
  if (!code || !SYNC_CODE_RE.test(code)) return null
  if (!token || token !== process.env.SYNC_TOKEN) return null
  return code
}

export function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}

export function notFound(): Response {
  return Response.json({ error: 'not-found' }, { status: 404 })
}

export function badRequest(message = 'bad-request'): Response {
  return Response.json({ error: message }, { status: 400 })
}

export function conflict(remoteHash: string, remoteUpdatedAt: string): Response {
  return Response.json(
    { error: 'conflict', remoteHash, remoteUpdatedAt },
    { status: 409 }
  )
}