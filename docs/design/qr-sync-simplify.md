# Design: QR Sync Simplificación — Claim autocontenido

**Change ID**: `qr-sync-simplify`
**Fuente**: `docs/requirements/qr-sync-simplify.md`
**Estado**: En diseño — listo para `sdd-tasks`
**Complementa / sustituye**: `qr-sync-export` (archivado 2026-09-11). Este change **reemplaza** el claim pointer-based por un claim autocontenido y **elimina** el sync LWW por código.

---

## Sección A: Contexto y decisiones

### A1. Contexto del problema

El change `qr-sync-export` construyó un flujo QR que **apunta** a un snapshot remoto: el `POST /api/sync/claim` exige `x-sync-code` + `x-sync-token`, escribe un sidecar con `{ syncCode, hash, createdAt, expiresAt }` y Device B consume el snapshot vía `getSnapshotBytes(syncCode)`. Problemas detectados (ver propuesta):

1. **Export exige setup previo** — `checkSyncAuth` + 404 `snapshot_not_found` si Device 1 nunca hizo un push. El QR es inútil en el momento donde más falta (arrancar un segundo dispositivo).
2. **`SYNC_TOKEN` sin sentido para el usuario** — el cambio anterior ya nunca lo viajaba en el QR, pero el claim *requería* que A tuviera la config completa de almacenamiento de despliegue para emitir.
3. **El claim apunta, no contiene** — el sidecar referencia el snapshot remoto por `syncCode`. Si el snapshot se mueve o borra, el claim queda roto; y la emisión depende de que exista un namespace `saldo-cero-<code>.db` poblado.

### A2. Decisión central (Opción B)

**El claim es autocontenido: el payload del snapshot viaja INLINE en el sidecar.** El QR transporta únicamente el token opaco de 128 bits que autoriza descargar ese payload una vez. No hay `syncCode` que compartir, no hay `SYNC_TOKEN`, no hay setup previo.

> **"El QR es el transporte."** — El token del claim (capability) ES la autorización. Como el payload viaja inline en el sidecar, el claim no depende de ningún snapshot remoto ni de config de despliegue en el dispositivo origen.

### A3. Decisiones clave

| # | Decisión | Alternativa descartada | Justificación |
|---|----------|------------------------|---------------|
| D1 | `ClaimMeta` autocontenido: `{ payload, hash, createdAt, expiresAt, status }` | Sidecar pointer con `syncCode` (qr-sync-export) | Elimina dependencia del namespace remoto; el claim es una unidad atómica (crear → consumir → purgar). |
| D2 | `POST /api/sync/claim` **anónimo** (sin `checkSyncAuth`) | Requerir credenciales | El export no requiere setup previo; el 401 era justamente el Problema 1. Riesgo de abuso mitigado por límite de payload y TTL (D6). |
| D3 | Límite de payload **3 MiB decoded** (`MAX_CLAIM_PAYLOAD_BYTES`) | Sin límite / límite base64 crudo | Los snapshots reales de Saldo Cero (SQLite compacto) rondan decenas de KiB. 3 MiB (≈4 MiB base64) es generoso y evita claims abusivos. Verificación server-side **antes** de escribir el sidecar. |
| D4 | QR shape: `https://<origin>/sync-import?claim=<token>` (solo `claim`) | Mantener `?c=<syncCode>&claim=<token>` | El `syncCode` ya no se transmite (no existe en el modelo nuevo). URL más corta → menor densidad del QR, escaneo más robusto. |
| D5 | **Eliminación total del sync LWW por código**: rutas `/api/sync*` (menos claim), `lib/sync-auth.ts`, `SyncButton`, UI code/token, `syncNow`/`fetchRemoteMeta` | Conservar el sync por código y convivir | La propuesta recomienda la eliminación; evita dos modelos de sincronización paralelos (mantenimiento, confusión de UI, tests duplicados). |
| D6 | Lifecycle del sidecar: TTL 15 min, single-use (`status: consumed`), lazy sweep en cada POST, `DELETE` idempotente | Cron job para purga | Mismos mecanismos que `qr-sync-export` (probados); solo cambia el contenido del sidecar. |
| D7 | **404 anti-enumeración** para todo token inválido/vencido/usado | Diff de códigos por estado | El GET es anónimo y el token es secreto; distinguir estados filtraría qué tokens están "activos". Se conserva de `qr-sync-export`. |
| D8 | `applyClaimImport` → **`applyQrImport`** | Mantener nombre | El rework cambia el contrato (payload inline, sin auto-fill de syncCode); el nombre nuevo refleja el flujo real. |
| D9 | El `createdAt` del claim se muestra como fecha del snapshot en el preview de import | `updatedAt` del snapshot remoto (qr-sync-export) | Ya no hay snapshot remoto; `createdAt` del sidecar es la única fecha fiel de "cuándo se exportó". |
| D10 | Sin reintroducir `syncCode`/hint en el claim en v1 | Incluir metadatos de origen | El QR + fallback tipable ya resuelven el flujo; añadir syncCode re-abre el acoplamiento al modelo viejo. |
| D11 | Rate limiting en POST anónimo = hardening futuro (nota, no implementación) | Implementar ahora | No hay infraestructura de rate limiting en el repo; se documenta como riesgo/nota para futuras versiones. |

---

## Sección B: Approach

### B1. Modelo de datos (sidecar en Vercel Blob)

Namespace de claims **sin cambios**: `saldo-cero-claims/<token>.json` (`CLAIM_PREFIX` + `claimPath(token)`).

**Schema previo (qr-sync-export)** — `ClaimMeta` pointer-based:
```ts
type ClaimMeta = {
  syncCode: string          // ← se elimina
  hash: string
  createdAt: string
  expiresAt: number
  status: 'open' | 'consumed'
}
```

**Schema nuevo** — `ClaimMeta` payload-based:
```ts
type ClaimMeta = {
  payload: string           // snapshot completo, base64 (inline)
  hash: string              // sha256 del payload decoded
  createdAt: string
  expiresAt: number
  status: 'open' | 'consumed'
}
```

Cambios: se **elimina** `syncCode`; se **añade** `payload` (bytes b64 del snapshot). `hash` ahora es el sha256 del payload decoded (se calcula en el cliente al exportar y se re-verifica en el consumo).

### B2. API surface

**Nuevo / modificado**

| Endpoint | Método | Auth | Contrato |
|----------|--------|------|----------|
| `/api/sync/claim` | POST | **anónimo** | Req `{ bytes: string }` (base64). Flujo: validar body → `base64ToBytes` → `length > MAX_CLAIM_PAYLOAD_BYTES` → **413 `claim_too_large`**; `sweepClaims(Date.now())`; `token = crypto.randomUUID()`; `putClaim({ payload: bytes, hash, createdAt: now, expiresAt: now+15min, status: 'open' }, token)`. 200 `{ token, hash, expiresAt }`. Error de blob → 500 `claim_issue_failed`. Body inválido (sin `bytes` / base64 corrupto / vacío) → 400 `bad-request`. |
| `/api/sync/claim/[token]` | GET | capability (token) | `requireClaimToken` → 404 `claim_not_found`; `getClaim` null → 404; `expiresAt <= Date.now()` → 404 `claim_expired`; `status === 'consumed'` → 404 `claim_consumed`; `markClaimConsumed(token)` **antes** de responder; 200 `{ bytes: payload, hash, createdAt }`. Sin `syncCode`, sin `updatedAt` (D9). |
| `/api/sync/claim/[token]` | DELETE | capability (token) | `requireClaimToken` → 404; `deleteClaim` idempotente → 204. Invalidación temprana (botón Done / cierre). |

**Eliminado**

| Ruta / archivo | Razón |
|----------------|-------|
| `app/api/sync/route.ts` (GET/POST) | Sync LWW por código (D5) |
| `app/api/sync/meta/route.ts` | Ídem |
| `app/api/sync/import/route.ts` | Ídem (primer push del legacy `.db`) |
| `lib/sync-auth.ts` | Auth del sync por código (D5) |

### B3. Librería cliente (`lib/sync-client.ts`)

**Mantener** (helpers puros): `bytesToBase64`, `base64ToBytes`, `sha256Hex` — necesarios para el encode/verify del payload.

**Eliminar**: `SyncConfig`, `RemoteMeta`, `SyncResult`, `SyncAuthError`, `getSyncConfig`, `setSyncConfig`, `getSyncCode`, `fetchRemoteMeta`, `syncNow`, `pullMergePush` (si está exportado), y las claves `saldo-cero-sync-code` / `saldo-cero-sync-token`.

**Rework**:
```ts
// QR payload (D4)
buildClaimUrl(origin: string, token: string): string   // `https://<origin>/sync-import?claim=<token>`, encodeURIComponent defensivo

// Emisión (anónima, D2)
createClaim(bytes: Uint8Array): Promise<ClaimIssueResult>
//  POST /api/sync/claim { bytes: bytesToBase64(bytes) }
//  → { token, hash, expiresAt } | (413) ClaimIssueError 'too_large' | (400) 'bad-request' | (network) 'network'

// Consumo
fetchClaim(token: string): Promise<ClaimFetchResult>
//  GET /api/sync/claim/<token> → { bytes, hash, createdAt } | ClaimFetchError 'expired'|'consumed'|'not_found'|'network'

// Aplicación (D8)
applyQrImport(data: QrImportData, opts: { deviceId: string }): Promise<void>
//  base64ToBytes → initDb(bytes) → backup 'pre-claim-*' → mergeDatabases(localDb, remoteDb, deviceId)
//  → setDb + saveToIndexedDB + markSynced (sin syncCode de por medio)
```

Contrato de tipos:
```ts
type ClaimIssueResult =
  | { ok: true; token: string; hash: string; expiresAt: number }
  | { ok: false; error: 'too_large' | 'bad-request' | 'network' | 'server' }

type ClaimFetchResult =
  | { ok: true; bytes: Uint8Array; hash: string; createdAt: string }
  | { ok: false; error: 'expired' | 'consumed' | 'not_found' | 'network' | 'server' }

type QrImportData = Extract<ClaimFetchResult, { ok: true }>
```

### B4. Componentes UI

**Eliminar**: `components/sync/sync-button.tsx`.

**`components/sync/sync-settings.tsx`**:
- Quitar: inputs `sync code` / `sync token`, guardado vía `setSyncConfig`, sección "primera sincronización pendiente" (`needsFirstPush`), botón Sync y su lógica `syncNow`.
- Mantener: botones "Compartir vía QR" / "Escanear QR o ingresar código" (abren `SyncQrModal`), lista de backups + restaurar, sección de meta local (actualizada a solo lectura), `key={qrMode ?? 'closed'}` para remount limpio en cada apertura.
- Estado que desaparece: `config`, `token`, `saved`, `confirmOpen` (si solo servía al primer push), `busy`/`result` del `syncNow`. Estado que permanece: `backups`, `code`/`qrMode` del modal, `restoredLabel`.

**`components/sync/sync-qr-modal.tsx`**:
- **Export**: sin cambios estructurales del modal previo (canvas `qrcode`, countdown mm:ss, token tipable, "Done" → DELETE, Escape NO invalida). Cambia: el payload del QR es `buildClaimUrl(origin, token)` (D4) y la emisión es **anónima** — no se pide config previa; si `createClaim` falla con `too_large` se muestra error amigable y se sugiere export en el otro dispositivo.
- **Import**: tab Cámara + tab Manual (ambas presentes). Cambia:
  - El parsing del QR extrae solo `claim` (sin `c`).
  - El preview muestra `createdAt` formateado del sidecar + primeros 8 chars del hash (D9).
  - **Desaparecen**: banner `SYNC_TOKEN` (ya no existe el concepto), diálogo de "reemplazar syncCode" (no hay syncCode que reemplazar).
  - El merge llama a `applyQrImport` y recarga la página tras un merge exitoso (comportamiento previo del `SyncButton`).

**`app/sync-import/page.tsx`**: deep link simplificado a `?claim=<token>` (D4). Sin `c`. Sin `initialToken` dual: se lee `claim` y se lanza `importFromClaim` (o el equivalente named `importQrClaim`) directo; bare visit → modal genérico de import.

**`app/page.tsx`**: quitar `SyncButton` del layout de settings (líneas ~7/101/126); el botón de sync se fusiona en el nuevo flujo QR dentro de `SyncSettings`.

### B5. i18n (`contexts/language-context.tsx`)

**Eliminar claves**:
- `sync.import.token_banner` (EN 231 / ES 457)
- `sync.claim.replace_confirm` (EN 235 / ES 461)

**Añadir claves**:
| Clave | es | en |
|-------|-----|-----|
| `sync.claim.error_too_large` | El snapshot supera el tamaño máximo permitido para QR. | The snapshot exceeds the maximum QR size allowed. |

**Mantener**: `sync.export.*` (title, countdown, claim_token_label, done), `sync.import.*` (title, camera_tab, manual_tab, enter_token, button, preview_title, preview_date, preview_hash, confirm, cancel), `sync.claim.*` (error_expired, error_consumed, error_not_found, error_too_large). Si `sync.import.preview_date` interpola fecha, se renderiza como componente separado (regla de no interpolación en `t()`).

### B6. Eliminación y plan de archivos

**Archivos eliminados**
- `lib/sync-auth.ts`
- `components/sync/sync-button.tsx`
- `app/api/sync/route.ts`, `app/api/sync/meta/route.ts`, `app/api/sync/import/route.ts` (la carpeta `app/api/sync/` conserva `claim/`)

**Archivos modificados**
- `lib/blob-relay.ts` — `ClaimMeta` payload-based; se elimina `getSnapshotBytes`/`getSnapshotMeta`/relay de snapshots si no tienen otros consumidores (verificar `repository.ts`); `sweepClaims` inalterado.
- `lib/sync-client.ts` — rework (B3).
- `app/api/sync/claim/route.ts` — POST anónimo + límite 3 MiB (B2).
- `app/api/sync/claim/[token]/route.ts` — GET devuelve payload inline + `createdAt`; DELETE idéntico.
- `components/sync/sync-settings.tsx` — rework (B4).
- `components/sync/sync-qr-modal.tsx` — rework export e import (B4).
- `app/sync-import/page.tsx` — solo `?claim=` (B4).
- `app/page.tsx` — sin `SyncButton`.
- `contexts/language-context.tsx` — claves (B5).

**Tests**

| Test | Acción | Razón |
|------|--------|-------|
| `tests/unit/sync-protocol.test.ts` | **Eliminar** | Protocolo LWW por código (D5) |
| `tests/unit/sync-import.test.ts` | **Eliminar** | Rutas `/api/sync/import` + `/api/sync` + `/api/sync/meta` eliminadas |
| `tests/unit/sync-button.test.tsx` | **Eliminar** | `SyncButton` eliminado |
| `tests/unit/sync-claim.test.ts` | **Rework** | POST anónimo + inline (2/4/413/400), GET payload inline + `createdAt`, carrera, TTL, consumed, swept, early DELETE, NFR (sin `syncCode`, sin `SYNC_TOKEN`) |
| `tests/unit/sync-client.test.ts` | **Rework** | Mantener helpers (roundtrip, sha256); eliminar config/syncNow/fetchRemoteMeta; añadir `buildClaimUrl`, `createClaim` (413 too_large), `fetchClaim` (mapeo de 404s), `applyQrImport` (backup + merge + persistencia) |
| `tests/unit/sync-settings.test.tsx` | **Rework** | Quitar tests de code/token + primer push; mantener/adaptar backups → restaurar y apertura de modal QR |
| `tests/ui/sync-qr.spec.ts` | **Rework** | Stub del relay: `POST /api/sync/claim` anónimo guarda `{payload}` → `GET /claim/<token>` devuelve inline (sin credenciales); flujo tipable (A exporta → B pega token → preview `createdAt` → confirm → merge → reload); invalidación "Done" → 404 consumed; oversize → error amigable |
| `tests/ui/sync-first-push.spec.ts` | **Eliminar** | Escenario de primer push por código (D5) |
| `tests/ui/sync-dual-device.spec.ts` | **Eliminar** | Escenario dual-device por código (D5) |

> El modelo de "segundo dispositivo" ya lo cubre `sync-qr.spec.ts` (A exporta → B importa y converge). El merge real (convergencia de datos) sigue cubierto por `tests/unit/merge.test.ts` y `repository.test.ts` — sin cambios.

### B7. Estrategia de datos (ver migración)

Los claims existentes (pointer-based con `syncCode`) quedan **inválidos**: el schema nuevo no tiene `syncCode`, y el GET fallaría en el type guard. Los sidecars apuntados no contienen payload. Estrategia: lazy purge al primer `POST /claim` (la expiración TTL los deja inalcanzables de todos modos: `expiresAt` ya pasó). Sin backfill. Los sidecars huérfanos `saldo-cero-claims/*` son purgados por el sweep. Los namespaces `saldo-cero-<code>.db` existentes quedan **huérfanos** (ver migración) y se documentan como residuo limpiable.

---

## Sección C: Riesgos, seguridad y testing

### C1. Seguridad

- **POST anónimo (D2)** — abuso vector: cualquiera puede crear claims de hasta 3 MiB. Mitigación: límite estricto de payload (D3), TTL 15 min, sweep lazy que purga lo vencido (los claimed no consumidos no expiran por tamaño sino por tiempo). **Nota**: rate limiting y/o autenticación del POST quedan como hardening futuro (D11).
- **GET anónimo** — el token es un secreto de 128 bits (`crypto.randomUUID`). 404 uniforme anti-enumeración (D7). El QR contiene solo el token; la URL completa es la capability.
- **Validación de payload**: el `bytes` recibido se decodifica y se verifica sha256 en el cliente al importar (el `hash` viaja en el claim y se compara tras decode; mismatch → error sin aplicar merge). Método `BLOB_ACCESS = 'private'` (fix previo) — los sidecars no son legibles sin auth de almacenamiento.
- **Nunca** viajan `SYNC_TOKEN` ni `syncCode` en el claim, sidecar, QR o respuesta (el concepto ya no existe).

### C2. Pruebas (acceptance gate)

```
pnpm test         # vitest run → unit + E2E verdes
pnpm tsc --noEmit # sin errores de tipos
```

Cobertura clave de `tests/unit/sync-claim.test.ts`:
- POST anónimo 200 → sidecar con `payload` inline; 400 body inválido; 413 > 3 MiB (decoded); 500 fallo de blob.
- GET: 200 con `{ bytes, hash, createdAt }` (sin `syncCode`); replay → 404 `claim_consumed`; expirado → 404 `claim_expired`; desconocido → 404 `claim_not_found`; token inválido (regex UUID) → 404 `claim_not_found`.
- Carrera (2 GETs concurrentes con mock): 1×200, 1×404.
- Sweep lazy en POST limpia sidecars vencidos antes de escribir.
- Early DELETE → 204 → siguiente GET → 404. DELETE idempotente.
- NFR-3: el sidecar y la respuesta NO contienen `syncCode` ni token de despliegue.

### C3. Riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Payload 3 MiB insuficiente en DBs muy cargadas | Claims imposibles para usuarios con datos masivos | Umbral por encima de snapshots reales (10-50 KiB típicos); error claro `too_large`; el sync por código ya no existe, así que el QR es la única vía → considerar subir a 5 MiB si la evidencia de telemetría lo pide |
| POST anónimo abusado (spam de claims) | Costo de almacenamiento menor (TTL 15 min + sweep) y CPU | TTL + sweep + límite; rate limiting futuro (D11) |
| Sidecars huérfanos del schema viejo | Residuo en blob | Sweep lazy los purga por `expiresAt` |
| Regresión de merge al eliminar `syncNow` | Convergencia rota | `mergeDatabases`/`repository` intactos; `applyQrImport` reutiliza el mismo camino; tests de merge sin cambios |
| Componentes UI quedan con imports rotos tras eliminar `SyncButton`/config | Compile error | Orden de aplicación: eliminar librería y rutas primero, luego UI, luego tests; gate `tsc` al final |

### C4. Preguntas abiertas

1. ¿Se mantiene el nombre `sync-import` para la ruta del deep link, o se prefiere `/qr-import`? (La propuesta conserva `/sync-import` por simplicidad; el design asume que se conserva.)
2. ¿El preview de import debe mostrar además el **tamaño** del snapshot (derivable de `bytes.length`), o solo fecha + hash? (Design asume fecha + hash, igual que v1.)

---

*Documento generado como parte del flujo SDD para el change `qr-sync-simplify`. Complementa `docs/migrations/2026-09-12-qr-sync-simplify.md`.*