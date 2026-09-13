# Design: qr-sync-export

**Change ID**: `qr-sync-export`
**Estado**: En diseño — listo para `sdd-tasks`
**Complementa**: `multi-device-blob-sync` (archivado 2026-09-11). El sync manual pull → merge → push sobre Vercel Blob relay **no cambia**.

---

## Propósito / Balance

Completar el sync manual multi-dispositivo con un flujo **QR asistido**: Device A emite un **claim token de un solo uso** (TTL 15 min) vía endpoint y muestra un QR con una short URL; Device B lo escanea (o tipea el token), consume el claim y **auto-rellena su `syncCode`**, importando el snapshot remoto tras un merge idempotente.

**Balance perseguido**:

| Eje | Postura | Racional |
|-----|---------|----------|
| Seguridad vs. fricción | Capability token opaco, SIN `SYNC_TOKEN` nunca | El claim autoriza una sola descarga del snapshot; el token de despliegue queda fuera del QR/claim/response |
| Simplicidad vs. durabilidad | Sidecars en Vercel Blob, no sistema de estado adicional | Sin KV/Redis nuevo; el namespace blob existente se reutiliza con prefijo aislado |
| Atomicidad vs. testeabilidad | `status: open/consumed` en el sidecar + limpieza perezosa | Determinismo de códigos de error (`claim_expired` / `claim_consumed` / `claim_not_found`) y carrera testeable en mock; costo = tombstones limpios por lazy sweep |
| UX vs. alcance | Cámara + fallback tipado **obligatorio** | La cámara es mejora progresiva; el E2E y la accesibilidad corren por el input manual |

---

## Contexto

El sync actual (`lib/sync-client.ts`) opera sobre un singleton sql.js (`lib/db/client.ts`):
`syncNow(conf)` hace meta → (primer push | synced | pullMergePush). `pullMergePush` descarga bytes vía `GET /api/sync`, arma `remoteDb = initDb(bytes)`, guarda backup `pre-merge-*`, ejecuta **`mergeDatabases(localDb, remoteDb, deviceId)`** (pura, sincrónica, sin mutación de entradas — `lib/db/merge.ts`), hace `setDb(merged)` y re-pushea con `basedOnHash` (el server responde 409 si el remoto cambió y el cliente reintenta).

Las rutas relay viven en `app/api/sync/{route,meta/route}.ts` con `runtime = 'nodejs'` + `dynamic = 'force-dynamic'`, auth via `checkSyncAuth(req)` (`lib/sync-auth.ts`: headers `x-sync-code` + `x-sync-token`, `SYNC_CODE_RE = /^[a-zA-Z0-9-]{4,32}$/`). El namespace blob es `saldo-cero-<syncCode>.db` + `.db.json` (metadata `SnapshotMeta { hash, updatedAt, size }`), helpers en `lib/blob-relay.ts` (`putSnapshot`, `getSnapshotBytes`, `getSnapshotMeta`) con SDK `@vercel/blob` v2 (`access: 'public'`, `addRandomSuffix: false`). La UI de sync se monta en `app/page.tsx` **en ambos estados** (setup y no-setup), con `SyncSettings` + `SyncButton`.

El problema que resuelve este change: el `syncCode` + `SYNC_TOKEN` de despliegue deben copiarse/pegarse manualmente en Device B. Este change elimina el tecleo del `syncCode` (se auto-rellena vía claim) y mantiene `SYNC_TOKEN` como único dato que B debe conocer de antemano (policy heredada del QR previo o tecleado una vez).

**Hechos verificados en código** (fuentes: `lib/blob-relay.ts`, `lib/sync-client.ts`, `lib/db/merge.ts`, `lib/db/meta.ts`, `tests/unit/sync-protocol.test.ts`, `app/page.tsx`):
- `mergeDatabases` y `syncNow`/`pullMergePush` se **reutilizan sin cambios**.
- `app/sync-import/` **no existe** — debe crearse como página destino de la short URL del QR.
- El mock in-memory de `@vercel/blob` en `sync-protocol.test.ts` expone `put/head/get/_reset` — **hay que añadir `list` y `del`** para claim tests.
- No hay schema SQLite que tocar; `sync_meta` sigue siendo singleton `id=1`.

---

## Decisiones de Diseño

**D1 — Claims como sidecars en Vercel Blob, no en memoria.**
Los claims viven en `saldo-cero-claims/<token>.json` (namespace aislado del de snapshots `saldo-cero-<code>.db`). Se descartan Map in-memory (serverless multi-instance), KV/Redis (nuevo servicio) y base de datos (sin modelo de datos). El blob ya persiste y replica; la limpieza es lazy.

**D2 — Token opaco de 128 bits.**
`crypto.randomUUID()` (v4) generado server-side en runtime node. No es JWT, no lleva payload sensible. Solo 36 chars seguros para pathname (`[0-9a-f-]`), validados en el route con regex para impedir path traversal.

**D3 — TTL 15 min, verificado server-side.**
`expiresAt = createdAt + 15 * 60 * 1000` en el sidecar. El `GET /claim` lo valida contra el reloj del servidor. El countdown del modal es **solo UX**; la guardia definitiva es server-side. Expired sidecar → `404 claim_expired` y el sidecar **no** se borra ahí (lo limpia el lazy sweep), preservando la distinción de estado.

**D4 — Single-use con marcado `status: consumed` (no delete puro).**
Para que los códigos de error del spec (FR-2: `claim_consumed` vs `claim_not_found`) sean **deterministas** y testeables, el consumo **no borra** el sidecar: lo **marca** `status: 'consumed'` (overwrite atómico `allowOverwrite: true`) y luego devuelve el snapshot. Re-intento → `404 claim_consumed`. La invalidación temprana (`DELETE /claim/<token>`, botón "Done") sí hace `del`. El lazy sweep purga sidecars `consumed` **o** expirados.
**Desviación explícita del spec**: el spec dice "delete-on-read"; se reemplaza por "mark + sweep" porque (1) preserva la semántica single-use (una sola importación exitosa), (2) hace distinguibles consumed/not_found — imposible tras un delete real — y (3) la carrera concurrente deja de depender de atomicidad de `del`. Coste: tombstones temporales hasta el siguiente `POST /claim` (o invalidación). La carrera misma es **benigna**: ambos lectores obtienen **el mismo snapshot**, y el merge es idempotente; el peor caso = dos 200 con bytes idénticos (no hay fuga extra: ambos ya poseen el token/capability).

**D5 — Auth asimétrica.**
- `POST /claim`: **requiere** headers `x-sync-code` + `x-sync-token` (vía `checkSyncAuth`); sin credenciales → 401, sin sidecar.
- `GET /claim/<token>`: **sin** headers — el token en la URL **es** la capability. Token desconocido, consumido o expirado → `404` (no 403) para evitar enumeración.
- `DELETE /claim/<token>`: token-capability también (mismo conjunto de poseedores que el GET), eliminación temprana.

**D6 — QR payload = short URL, `SYNC_TOKEN` nunca.**
Payload: `https://<origin>/sync-import?c=<syncCode>&claim=<token>`. Helper puro `buildClaimUrl(origin, syncCode, token)` (testable). `c` y `claim` son URL-safe por construcción (`SYNC_CODE_RE`, UUID) — se aplica `encodeURIComponent` defensivo igualmente. Longitud ≈ 120–140 chars → QR v10–15, escaneo robusto, abrible por cámara genérica. **`SYNC_TOKEN` jamás** entra en QR, sidecar, ni respuesta de consume (NFR-3; check en unit test).

**D7 — Superficie cliente en `lib/sync-client.ts` (`createClaim` + familia de import).**
`createClaim(conf)` → `POST /claim` con auth headers. El import se separa en **dos** pasos para respetar el preview-before-confirm del FR-6 sin re-consumir el claim (single-use):
- `fetchClaim(token)` → consume UN solo `GET /claim` y devuelve `{ syncCode, hash, updatedAt, bytes }` (bytes ya en memoria para la preview).
- `applyClaimImport(data, { replaceCode })` → `mergeDatabases` + backup `pre-merge` + `setDb` + persistencia + `setMeta` + auto-fill `syncCode` (con reemplazo controlado por el dialog del FR-6).
- `importFromClaim(token, opts)` = convenience (fetch + apply) para el flujo cámara.
`pullMergePush` y `syncNow` **no se modifican**; se reutiliza su patrón de persistencia (`saveBackup`, `saveToIndexedDbSafe`, `markSynced`) extraído a helpers internos reutilizables.

**D8 — `components/sync/sync-qr-modal.tsx`: un modal, dos modos.**
- **Export**: canvas via `qrcode`, countdown 15:00→00:00 (componente separado, **sin interpolación en `t()`** — FR-7), token tipable bajo el QR, botón "Done/Invalidar" → `DELETE /claim` y cierre. Cerrar por Escape/backdrop **no** invalida (reabrir comparte el mismo QR mientras viva el TTL).
- **Import**: pestañas Cámara (`html5-qrcode`, default si `mediaDevices` disponible) + Manual (input `claim`, siempre visible). Tras `fetchClaim` → preview (fecha + hash corto) → "Confirmar e importar" (merge) o "Cancelar". Maneja: `syncCode` distinto → dialog replace (ConfirmDialog); falta `SYNC_TOKEN` → banner.
Se monta en `components/sync/sync-settings.tsx` con dos botones ("Share via QR" / "Scan QR or enter code").

**D9 — i18n con claves fijas `sync.export.*`, `sync.import.*`, `sync.claim.*` (es/en).**
Listado exacto de claves en la tabla del FR-7 del spec. Prohibido interpolar contenido dinámico dentro de `t()`; countdown y números se renderizan en componentes.

**D10 — Dependencias**: `qrcode` (generar), `html5-qrcode` (escanear) en `dependencies`; `@types/qrcode` en `devDependencies`. Ninguna otra dependencia nueva.

**D11 — Tests**:
- Unit: `tests/unit/sync-claim.test.ts` (mock in-memory de `@vercel/blob` ampliado con `list` y `del`, espejo de `sync-protocol.test.ts`).
- E2E: `tests/ui/sync-qr.spec.ts` (Playwright `:3100`, import por fallback tipado — obligatorio; cámara opcional en CI).

**D12 — Sin migración de schema.**
Ningún cambio a SQLite → **no** se crea archivo en `docs/migrations/`. Los claims son sidecars. Rollback = revertir `app/api/sync/claim/**`, `app/sync-import`, helpers de `blob-relay.ts`/`sync-client.ts`, modal, claves i18n, deps y tests (plan detallado en la propuesta; no se reimplementa).

---

## Restricciones

| Restricción | Origen | Implicación de diseño |
|-------------|--------|----------------------|
| `SYNC_TOKEN` nunca en claim/QR/response | NFR-3 (decisión fija) | Sidecar solo `{ syncCode, hash, createdAt, expiresAt, status }` |
| `mergeDatabases` pura y sincrónica, sin cambios | change anterior (FR-3) | `applyClaimImport` la invoca tal cual |
| `POST /claim` requiere auth existente; `GET/DELETE /claim/<token>` capability | NFR-3 / propuesta | Auth asimétrica (D5) |
| Single round-trip en consume, <500ms p95 | NFR-2 | Un solo `GET /claim`: mark-status + `getSnapshotBytes` + response; sin encadenados |
| Fallback tipado siempre funcional | NFR-4 | Pestaña Manual SIEMPRE presente + probada en E2E |
| `app/sync-import/` es ruta nueva pública | FR-4 | Página cliente con `useSearchParams` envuelta en `<Suspense>` (requisito Next App Router) |
| Runtime nodejs + force-dynamic en rutas | convención repo | Se replica en `claim/route.ts` y `claim/[token]/route.ts` |
| Sin interpolación en `t()` | FR-7 | Countdown fuera de i18n |
| Regex de syncCode existente | `lib/sync-auth.ts` | Reutilizado; el code no se re-validan en el nuevo código |

---

## Arquitectura

```
                          ┌──────────────────────────────────────────────┐
                          │              Vercel Blob                     │
                          │  saldo-cero-<code>.db        (snapshot)      │
                          │  saldo-cero-<code>.db.json    (meta)         │
                          │  saldo-cero-claims/<token>.json  (claim)     │
                          └──────────────────────────────────────────────┘
                                       ▲                   ▲  ▲  ▲
                  blob-relay (putSnapshot / getSnapshotBytes / claim helpers)
                                       │                   │
   ┌──────────────┐        ┌───────────┴─────────┐   ┌─────┴──────────────────┐
   │ Device A (B) │        │  app/api/sync/      │   │  app/api/sync/claim/   │
   │ UI (React)   │───────▶│  route.ts(GET/POST) │   │  route.ts: POST (issue)│
   │ sync-qr-modal│◀───────│  meta/route.ts      │   │  [token]/route.ts:     │
   │ sync-settings│        │  import/route.ts    │   │    GET (consume)       │
   └──────────────┘        └─────────────────────┘   │    DELETE (invalidate) │
                                                      └──────────────────────┘
        ┌────────────────────────────────────────────────────────────────────┐
        │ lib/sync-client.ts                                                 │
        │   createClaim / fetchClaim / applyClaimImport / importFromClaim    │
        │   syncNow · pullMergePush  (sin cambios)                           │
        │ lib/db: client.ts · merge.ts (pura) · meta.ts · persistence.ts     │
        └────────────────────────────────────────────────────────────────────┘
```

Flujo de capas:
1. **UI Export** (`sync-settings` → `sync-qr-modal` export) llama `createClaim(conf)`.
2. **Server issue** (`claim/route.ts` POST): auth → sweep → `randomUUID()` → `putClaim` → `200 { token, syncCode, hash, expiresAt }`.
3. **UI Export** renderiza QR con `buildClaimUrl(origin, syncCode, token)` + countdown.
4. **UI Import** (`sync-qr-modal` import, o página `/sync-import` antropada por cámara) → `fetchClaim(token)`.
5. **Server consume** (`claim/[token]/route.ts` GET): valida formato token → lee sidecar → clasifica 404 (`claim_not_found` / `claim_expired` / `claim_consumed`) → marca `consumed` → `getSnapshotBytes(syncCode)` → `200 { bytes, hash, updatedAt, syncCode }`.
6. **UI Import** muestra preview → `applyClaimImport(data, { replaceCode })` → merge idempotente → persistencia + `setMeta` → auto-fill `syncCode`.
7. **Invalidación**: "Done" → `DELETE /claim/<token>` → `del` (no se puede consumir más).

---

## Módulos y Firmas

### `lib/blob-relay.ts` (modificado — nuevos exports)

```ts
import { put, get, head, list, del, type GetBlobResult } from '@vercel/blob'

export const CLAIM_PREFIX = 'saldo-cero-claims/'
export function claimPath(token: string): string            // `saldo-cero-claims/<token>.json`
export function requireClaimToken(token: string): boolean   // /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface ClaimMeta {
  syncCode: string
  hash: string
  createdAt: number      // Date.now()
  expiresAt: number      // createdAt + 15*60*1000
  status: 'open' | 'consumed'
}

export async function putClaim(meta: ClaimMeta, token: string): Promise<void>
  // put(claimPath(token), JSON.stringify(meta), { access:'public', allowOverwrite:true, addRandomSuffix:false })

export async function getClaim(token: string): Promise<ClaimMeta | null>
  // getOrNull(claimPath(token)) → JSON.parse + type guard (hash string, numbers, status enum)

export async function markClaimConsumed(token: string): Promise<ClaimMeta | null>
  // getClaim → null? return null → put({...meta, status:'consumed'}) → return updated meta

export async function deleteClaim(token: string): Promise<void>
  // del([claimPath(token)])  — invalidación temprana

export async function sweepClaims(now: number): Promise<number>
  // list({ prefix: CLAIM_PREFIX }) → para cada blob con pathname: getClaim → si consumed o expired → deleteClaim
  // devuelve cantidad purgada. Usado por POST /claim antes de emitir uno nuevo.
```

Notas: `list` y `del` deben auto-inyectarse igual que `put/get/head` (el mock de tests los expone). `resultToBytes`/`getOrNull` existentes se reutilizan para leer el sidecar. `sweepClaims` tolera errores por item (best-effort).

### `app/api/sync/claim/route.ts` (nuevo — POST)

```ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface ClaimIssueBody {}            // sin body; credenciales en headers

export async function POST(req: Request): Promise<Response>
  // 1. checkSyncAuth(req) → null → unauthorized() 401
  // 2. meta = await getSnapshotMeta(syncCode)  → null → 404 (claim sin snapshot no existe)
  // 3. await sweepClaims(Date.now())            → lazy sweep (FR-3)
  // 4. token = crypto.randomUUID()
  // 5. await putClaim({ syncCode, hash: meta.hash, createdAt, expiresAt: createdAt+15min, status:'open' }, token)
  // 6. 200 { token, syncCode, hash: meta.hash, expiresAt }
  // errores blob → 500 { error: 'claim_issue_failed' }
```

### `app/api/sync/claim/[token]/route.ts` (nuevo — GET + DELETE)

```ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response>
  // 1. token = (await ctx.params).token; requireClaimToken(token) falso → 404 { error:'claim_not_found' }
  // 2. claim = await getClaim(token)
  //    - null              → 404 { error:'claim_not_found' }
  //    - !claim.expired()  → 404 { error:'claim_expired',   message: i18n-server-agnostic (es/en en cliente) }
  //    - status==='consumed' → 404 { error:'claim_consumed' }
  // 3. await markClaimConsumed(token)   (single-use, D4)
  // 4. bytes = await getSnapshotBytes(claim.syncCode)
  //    - null → 404 { error:'snapshot_not_found' }   (claim válido pero snapshot ausente)
  // 5. 200 { bytes: bytesToBase64(bytes), hash: claim.hash,
  //         updatedAt: (await getSnapshotMeta(claim.syncCode))?.updatedAt,
  //         syncCode: claim.syncCode }

export async function DELETE(req: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response>
  // 1. token; requireClaimToken → falso → 404
  // 2. await deleteClaim(token)  (idempotente: borrar inexistente → ok)
  // 3. 204 (o 200 { error: null })  — invalidación temprana (FR-3)
```

**Importante**: el mensaje `claim_expired` del spec es una cadena i18n **cuyo texto completo vive en el cliente** (`sync.claim.error_expired`, es/en). El server solo devuelve el código `error`; el modal lo traduce con `t()`. Así se respeta FR-7 (sin cadenas hardcodeadas en el cliente y sin interpolación).

### `lib/sync-client.ts` (modificado — nuevos exports)

```ts
export type ClaimIssueResult =
  | { ok: true; token: string; syncCode: string; hash: string; expiresAt: number }
  | { ok: false; error: string }

export type ClaimFetchError =
  | 'claim_expired' | 'claim_consumed' | 'claim_not_found' | 'snapshot_not_found' | 'network' | `http-${number}`

export type ClaimFetchResult =
  | { ok: true; syncCode: string; hash: string; updatedAt: string; bytes: Uint8Array }
  | { ok: false; error: ClaimFetchError }

export function buildClaimUrl(origin: string, syncCode: string, token: string): string
  // `${origin}/sync-import?c=${encodeURIComponent(syncCode)}&claim=${encodeURIComponent(token)}`

export async function createClaim(conf: SyncConfig): Promise<ClaimIssueResult>
  // POST /api/sync/claim con authHeaders(conf) → 200 parse | 401 → SyncAuthError | otro → error `http-${status}`

export async function fetchClaim(token: string): Promise<ClaimFetchResult>
  // GET /api/sync/claim/<token> SIN headers → 200 → base64ToBytes(remote.bytes)
  // 404 → mapea data.error a ClaimFetchError; otros → network/`http-${status}`

export async function applyClaimImport(
  data: Extract<ClaimFetchResult, { ok: true }>,
  opts: { replaceCode: boolean }
): Promise<SyncResult>
  // 1. remoteDb = await initDb(data.bytes)
  // 2. localDb = await getDb(); saveBackup(exportDb(localDb), `pre-claim-${Date.now()}`)  (best-effort)
  // 3. merged = mergeDatabases(localDb, remoteDb, getActiveDeviceId())   ← pura, sin cambios
  // 4. setDb(merged); await saveToIndexedDbSafe(merged); await markSynced({syncCode, syncToken}, data.hash, data.updatedAt)
  //    (reutiliza helpers internos existentes; SyncResult 'merged')
  // 5. auto-fill: codeKey = 'saldo-cero-sync-code'
  //    - ausente                                   → localStorage.setItem(codeKey, data.syncCode)
  //    - presente e igual                          → no-op
  //    - presente y distinto && opts.replaceCode   → localStorage.setItem(codeKey, data.syncCode)
  //    - presente y distinto && !opts.replaceCode  → no-op (el dialog FR-6 decide)
  // 6. devuelve SyncResult (+ campo `syncCode` en el dial del que el modal lee para el toast)

export async function importFromClaim(token: string, opts: { replaceCode: boolean }): Promise<SyncResult | { action:'error'; error: ClaimFetchError }>
  // convenience: const data = await fetchClaim(token); if (!data.ok) return {action:'error', error:data.error}
  //              return applyClaimImport(data, opts)
```

Extracción interna (sin cambio de contrato público): `authHeaders`, `saveToIndexedDbSafe`, `markSynced`, `fetchJson` ya son módulo-privadas de `sync-client.ts` y se reutilizan tal cual.

### `components/sync/sync-qr-modal.tsx` (nuevo)

```tsx
'use client'
interface SyncQrModalProps {
  open: boolean
  mode: 'export' | 'import'
  onOpenChange: (open: boolean) => void
  syncCode: string   // export: el código de Device A
  // import: no precisa props — contesta a localStorage vía lib/sync-client
}

// Estado export: { claim: ClaimIssueResult | null, remainingMs: number }
// Estado import: tab: 'camera' | 'manual', preview: ClaimFetchResult | null,
//                replaceDialog: boolean, syncCodeMissing: boolean

export function SyncQrModal(props: SyncQrModalProps): JSX.Element
export function ClaimCountdown({ expiryMs, onExpire }: { expiryMs: number; onExpire: () => void }): JSX.Element
  // renderiza t('sync.export.countdown') como <span> Expira en {mm}:{ss} — el tiempo es máquina,
  // el texto es i18n (FR-7: no interpolación DENTRO de t()).

// Radix Dialog (ui/dialog.tsx) — focus trap / Escape / ARIA provistos por el primitivo.
// Import: html5-qrcode montado en <div ref>; decodedText → build → extraer claim →
//         importFromClaim(claim, { replaceCode:false }) → preview → confirm (applyClaimImport) o cancelar.
```

### `components/sync/sync-settings.tsx` (modificado)

Dos botones junto al flujo existente: `t('sync.export.title')` (abre modal export) y `t('sync.import.title')` (abre modal import). El modal import consulta `getSyncConfig()` para detectar conflicto de `syncCode` y banner de `SYNC_TOKEN` ausente.

### `app/sync-import/page.tsx` (nuevo)

```tsx
'use client'
// <Suspense> obligatorio: useSearchParams requiere boundary (Next App Router).
// Lee c + claim de la query. Si ambos presentes → auto-import (fetchClaim → preview → confirm)
// como modal import embebido a pantalla completa (reutiliza SyncQrModal en modo import).
// Si faltan → renderiza el import manual (input token).
```

### `contexts/language-context.tsx` (modificado)

Claves `sync.export.*`, `sync.import.*`, `sync.claim.*` es/en — listado exacto en FR-7 del spec.

---

## Protocolo Detallado

### Issue (Device A)

```
A ── POST /api/sync/claim ───────────────────────────────────────────────────▶
    headers: x-sync-code + x-sync-token
    (sin body)

Server:
  checkSyncAuth(req) → null ────────▶ 401 { error: 'unauthorized' }
  getSnapshotMeta(syncCode) → null ─▶ 404 { error: 'snapshot_not_found' }
  sweepClaims(now)                     (lazy purge, FR-3)
  token        = crypto.randomUUID()
  expiresAt    = Date.now() + 15*60*1000
  putClaim({ syncCode, hash, createdAt: Date.now(), expiresAt, status:'open' }, token)
◀── 200 { token, syncCode, hash, expiresAt }
```

### Consume (Device B)

```
B ── GET /api/sync/claim/<token> ────────────────────────────────────────────▶
    (sin headers)

Server:
  requireClaimToken(token)? false ───▶ 404 { error:'claim_not_found' }
  claim = getClaim(token)
    null                     ────────▶ 404 { error:'claim_not_found' }
    expiresAt <= now         ────────▶ 404 { error:'claim_expired' }   (sidecar intacto → sweep)
    status === 'consumed'    ────────▶ 404 { error:'claim_consumed' }
  markClaimConsumed(token)            (single-use, D4)
  bytes = getSnapshotBytes(claim.syncCode)
    null                     ────────▶ 404 { error:'snapshot_not_found' }
  meta = getSnapshotMeta(claim.syncCode)
◀── 200 { bytes: b64(bytes), hash: claim.hash, updatedAt: meta.updatedAt, syncCode: claim.syncCode }
```

### Invalidate (Device A, "Done")

```
A ── DELETE /api/sync/claim/<token> ─────────────────────────────────────────▶
    (sin headers; capability)
Server: deleteClaim(token)   (idempotente)
◀── 204
```

### Concurrencia

`GET` concurrente sobre el mismo token: `getClaim`/`markClaimConsumed` no son CAS puros, pero el peor caso es que DOS peticiones lean `status:'open'` casi a la vez, ambas marquen `consumed` y ambas devuelvan 200 con **bytes idénticos**. El segundo merge es idempotente (`mergeDatabases` con la misma base → mismo resultado). Sin corrupción; el test unitario simula la carrera y **exige** un 200 y un 404 (mock con mutación síncrona de status en `markClaimConsumed`), reproduciendo el contrato esperado del spec.

---

## Schema / Migración

**NO APLICA.**

- Sin cambios a SQLite: `accounts`, `transactions`, `recurring_events`, `budgets`, `sync_meta` intactos.
- Los claims viven como sidecars `saldo-cero-claims/<token>.json` en Vercel Blob.
- Por regla del repo (migración solo para cambios de modelo de datos), **no** se crea `docs/migrations/YYYY-MM-DD-qr-sync-export.md` (NFR-1).
- `mergeDatabases` no cambia; `sync_meta` mantiene singleton `id=1`.

---

## Estructura de Archivos Final

```
app/
  api/sync/
    claim/
      route.ts                [NUEVO]  POST (issue) + lazy sweep
      [token]/route.ts        [NUEVO]  GET (consume) + DELETE (invalidate)
  sync-import/
    page.tsx                  [NUEVO]  destino de la short URL del QR (useSearchParams + Suspense)
components/sync/
  sync-qr-modal.tsx           [NUEVO]  wizard export/import (qrcode, html5-qrcode, countdown, preview)
  sync-settings.tsx           [MOD]    botones "Share via QR" / "Scan QR or enter code"
lib/
  blob-relay.ts               [MOD]    CLAIM_PREFIX, claimPath, putClaim/getClaim/markClaimConsumed/deleteClaim/sweepClaims
  sync-client.ts              [MOD]    buildClaimUrl, createClaim, fetchClaim, applyClaimImport, importFromClaim
contexts/
  language-context.tsx        [MOD]    claves sync.export.* / sync.import.* / sync.claim.* (es/en)
package.json                  [MOD]    + qrcode, html5-qrcode (deps), @types/qrcode (dev)
tests/
  unit/
    sync-claim.test.ts        [NUEVO]  protocolo claim (mock blob + list/del)
    sync-qr-modal.test.tsx    [NUEVO]  countdown, buildClaimUrl, preview/confirm (opcional, si hay harness react testing)
  ui/
    sync-qr.spec.ts           [NUEVO]  E2E fallback tipado, invalidación, conflicto syncCode
```

---

## Estrategia de Testing

**Patrón del mock** (`tests/unit/sync-claim.test.ts`): copia del harness de `sync-protocol.test.ts` (`vi.hoisted` + `vi.mock('@vercel/blob')`) **ampliado** con `list` (devuelve `{ pathname }[]` por prefijo) y `del` (borra del Map). El escenario de carrera usa mutación síncrona en `markClaimConsumed` para determinismo.

| Test | Cobertura (FR/NFR) | Verificación clave |
|------|--------------------|--------------------|
| `POST /claim` con credenciales válidas emite token + sidecar + payload | FR-1 | 200 `{ token, syncCode, hash, expiresAt }`, sidecar `status:open`, expiresAt = +15min |
| `POST /claim` sin credenciales | FR-1 | 401, **sin** sidecar creado |
| `POST /claim` con token incorrecto | FR-1 | 401 |
| `POST /claim` con sync code inválido | FR-1 | 401 (SYNC_CODE_RE) |
| `POST /claim` sin snapshot existente | FR-1 | 404 `snapshot_not_found` |
| Lazy sweep en POST: purga sidecars expirados/consumed antes de emitir | FR-3 | `sweepClaims` llamado; counts verificados |
| `GET /claim/<token>` consume open claim | FR-2 | 200 bytes+hash+updatedAt+syncCode; status→consumed |
| Replay (segundo GET) | FR-2 | 404 `claim_consumed` |
| TTL expirado | FR-2 | 404 `claim_expired`; sidecar **permanece** (sweep lo limpia) |
| Token desconocido → 404 `claim_not_found` (no 403) | FR-2/NFR-3 | status code y error code |
| Token malformado (path traversal) | NFR-3 | 404 antes de tocar blob |
| Carrera concurrente (2 GET simultáneos) | FR-2 | un 200, un 404 `claim_consumed` |
| `DELETE /claim/<token>` invalida temprano | FR-3 | siguiente GET → 404 consumed; DELETE idempotente |
| `SYNC_TOKEN` NO en sidecar ni en response | NFR-3 | escaneo del JSON + shape del response |
| `buildClaimUrl` formato | FR-4 | `https://<origin>/sync-import?c=…&claim=…`, encodeURIComponent |
| `markClaimConsumed` single-use flag | FR-3/D4 | status transiciona open→consumed |

**E2E** (`tests/ui/sync-qr.spec.ts`, Playwright `:3100`, locale `es` vía init-script como `sync-dual-device.spec.ts`): el relay en memoria se **extiende** con las rutas `POST/GET/DELETE /api/sync/claim*` (contrato idéntico a la implementación). Escenarios:
1. **Import por fallback tipado** (obligatorio): A genera claim vía UI → obtiene token → B en `/sync-import` manual pega token → preview ("Snapshot del …", "Hash: a1b2c3d4") → confirmar → merge, `localStorage['saldo-cero-sync-code']` auto-rellenado, banner SYNC_TOKEN si ausente.
2. **Export countdown + invalidación**: A abre modal, espera 2s, pulsa "Done" → B reintenta → 404 consumed.
3. **Conflicto syncCode previo**: B con `saldo-cero-sync-code` distinto → dialog replace → confirmar → code actualizado.
4. **Cámara**: skippable (CI sin webcam); el fallback manual cubre NFR-4.

**Gate de aceptación**: `pnpm test` (vitest run) + `pnpm tsc --noEmit` limpios; sin regresiones en `sync-protocol.test.ts`, `merge.test.ts`, `repository.test.ts`.

---

## Riesgos Específicos

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| Carrera concurrente en consume (dos lectores del mismo QR) | Baja | Media | D4: peor caso = dos 200 con bytes idénticos (merge idempotente); test de carrera en mock exige 1×200/1×404; token es capability → sin fuga nueva |
| Replay por foto del QR | Media | Baja | TTL 15 min + single-use (`status:consumed`) + botón "Done" para invalidación temprana; después del consumo la foto es inútil |
| Claims no consumidos acumulan tombstones | Media | Baja | Lazy sweep en cada `POST /claim` (purga `consumed` y `expired`); volumen trivial |
| Cámara no disponible / permisos iOS Safari | Alta | Media | Fallback tipado **obligatorio** y probado E2E; pestaña Manual siempre visible; `html5-qrcode` degrada si `mediaDevices` ausente |
| Config B incompleta post-import (falta `SYNC_TOKEN`) | Media | Alta | Claim response incluye `syncCode` → auto-fill; banner "Configura tu token de despliegue" si `saldo-cero-sync-token` ausente; "Sincronizar" deshabilitado hasta configurar |
| Página `/sync-import` pública malformada (rata la de `useSearchParams`) | Baja | Baja | `<Suspense>` requerido por Next; page degrada a input manual si faltan `c`/`claim` |
| Fuga de `SYNC_TOKEN` por error | N/A (decisión fija) | Crítico | **Nunca** en QR, sidecar ni response (D6/NFR-3). Test unitario escanea sidecar y response; code review checklist |
| `del`/`list` de SDK v2 con auth en entorno de test | Media | Baja | Mock local expone `list`+`del`; integración real cubierta por el mismo contrato (`@vercel/blob` v2 ya en uso) |

---

*Documento generado como parte del flujo SDD para el change `qr-sync-export`. Espeja la estructura de `docs/archive/multi-device-blob-sync-design.md`. Complementa `docs/requirements/qr-sync-export.md` y `docs/requirements/spec-qr-sync-export.md`.*