# Propuesta: qr-sync-simplify (QR self-contained — "el QR es el transporte")

## Intención

Eliminar **por completo** el flag-tea (token de despliegue `SYNC_TOKEN`) y el `syncCode` de la sincronización por QR. La UX debe ser extremadamente simple:

- **Device 1**: "Compartir via QR" → sube su budget al blob → genera URL/QR.
- **Device 2**: escanea el QR → los datos se importan/actualizan. Punto.

**Opción B elegida (decisión tomada, no se revisa)**: el QR es el transporte **self-contained**. El claim deja de ser un *puntero* a un namespace de `syncCode` que ya debía estar subido al relay y pasa a **contener los bytes del snapshot inline**. No hay `syncCode` como requisito de UI, no hay `SYNC_TOKEN` compartido, no hay setup previo en ningún dispositivo. La clave poseída (**claim token**, 128-bit opaco) ES la autorización.

Este documento **reemplaza/extiende la parte QR** del change `qr-sync-export` (descrito en `docs/requirements/qr-sync-export.md`) y redefine su superficie de producto.

---

## Problema

1. **Export exige setup previo**: `POST /api/sync/claim` valida `checkSyncAuth` (headers `x-sync-code` + `x-sync-token`) y responde `404 snapshot_not_found` si Device 1 nunca subió un snapshot al namespace `saldo-cero-<code>.db`. Un usuario que quiere pasar sus datos a otro teléfono **no puede** si nunca configuró el código ni el token.
2. **El token no tiene sentido para el usuario final**: `SYNC_TOKEN` es una variable de despliegue del servidor. Pedirle al usuario que lo teclee (o mostrarle el banner "Configura tu token de despliegue en Settings") es fricción ajena a su problema ("quiero mis datos en el otro teléfono").
3. **El claim apunta, no contiene**: el sidecar `ClaimMeta { syncCode, hash, createdAt, expiresAt, status }` referencia el snapshot remoto; si el snapshot se mueve/borra, el claim queda huérfano (`snapshot_not_found`), aunque el dato existió al emitir el QR.
4. **Superficie con estado fantasma**: `localStorage['saldo-cero-sync-code']` / `['saldo-cero-sync-token']`, diálogo de reemplazo de código, banner de token ausente… todo eso es complejidad que desaparece si el QR transporta el dato completo.

## Alcance

### In Scope

| Ítem | Descripción |
|------|-------------|
| Claim self-contained | `ClaimMeta` nuevo con `payload` (bytes del snapshot en base64) inline; sin dependencia del namespace `saldo-cero-<code>.db` ni de un snapshot previo |
| `POST /api/sync/claim` | Emisión **anónima** (sin `checkSyncAuth`), con body `{ bytes }`, límite de tamaño, deja de requerir `syncCode`/`SYNC_TOKEN` |
| `GET /api/sync/claim/<token>` | Consumo sin headers (token = capability); TTL 15 min; single-use; devuelve `{ bytes, hash, createdAt }` sin código ni token |
| `DELETE /api/sync/claim/<token>` | Invalidación temprana (botón "Done"), se conserva |
| QR payload | `https://<origin>/sync-import?claim=<token>` (sin parámetro `c`), corto y robusto; fallback tipable (token) para E2E/accessibilidad |
| UI Export | "Compartir via QR" **siempre disponible** (con o sin sync configurado): exporta la DB local directo al blob |
| UI Import | Escanear / tipear token → preview (fecha + hash corto) → confirmar → merge → listo |
| Depuración de superficie | Quitar de la UI: inputs `syncCode` + `syncToken`, banner "token de despliegue", diálogo replace de código, auto-fill de syncCode |
| i18n | Limpiar claves obsoletas (`token_banner`, `replace_confirm`, etc.) y ajustar claves restantes (es/en) |
| Tests | Unit `tests/unit/sync-claim.test.ts` (nuevo shape self-contained) + E2E `tests/ui/sync-qr.spec.ts` (flujo sin setup) actualizados |

### Out of Scope

| Ítem | Razón |
|------|-------|
| Sync automático en background / bidireccional contínuo | Decisión de producto: el QR es un transporte puntual; el sync continuo queda fuera (se recomienda eliminar el flujo LWW por código — ver Impacto) |
| Multi-usuario / roles | Local-first de un solo dueño con sus propios dispositivos |
| Encriptación adicional (end-to-end) | El transporte es HTTPS + store blob privado + token-capability; E2E explícito queda fuera de alcance (anotado como trabajo futuro opcional) |
| Compresión del payload | El `.db` sql.js ya es binario; la compresión (p.ej. gzip) reduce tamaño pero añade complejidad; se menciona como optimización futura si el límite de tamaño incomoda |
| Rate limiting / Turnstile en `POST /claim` | Mitigación contra abuso del issue anónimo; recomendado, se documenta como hardening futuro (el límite de tamaño + sweep ya acotan el daño) |
| Migración de datos de sync legacy (`localStorage['daily-budget-data']`) | Flow `POST /api/sync/import` es independiente del QR; su destino sigue al del flujo LWW |

---

## Modelo de datos del claim (sidecar self-contained)

### Schema previo (implementado en `qr-sync-export`)

```
saldo-cero-claims/<token>.json   (ClaimMeta — "puntero")
{
  syncCode:   string,     // referencia al namespace saldo-cero-<code>.db
  hash:       string,     // sha256 del snapshot referenciado
  createdAt:  number,
  expiresAt:  number,     // createdAt + 15*60*1000
  status:     'open' | 'consumed'
}
```

Depende de que el snapshot exista en `saldo-cero-<syncCode>.db` (escenario previo "snapshot previo subido").

### Schema nuevo (self-contained)

```
saldo-cero-claims/<token>.json   (ClaimMeta — "contenedor")
{
  payload:    string,     // base64 RFC 4648 de exportDb(localDb) — LOS DATOS viajan aquí
  hash:       string,     // sha256Hex(payload decodificado) — verificación de integridad
  createdAt:  number,
  expiresAt:  number,     // createdAt + 15*60*1000  (TTL: se conserva)
  status:     'open' | 'consumed'   (single-use: se conserva)
}
```

**Justificación del cómo**:

- **Se guarda como JSON base64 en blob** bajo `saldo-cero-claims/<token>.json` (el mismo prefijo de claims existente): reutiliza `put/get/del/list` de `lib/blob-relay.ts`, el store privado ya configurado (`BLOB_ACCESS = 'private'`) y el sweep perezoso ya implementado. No se introduce almacenamiento nuevo.
- **TTL 15 min y single-use se mantienen** (decisiones D3-D4 del design anterior): el QR sigue siendo un cupón efímero de un solo uso; la foto del QR es inútil tras el consumo o la expiración.
- **Límite de tamaño**: la respuesta de `GET /claim/<token>` debe viajar en el cuerpo de una Function de Vercel (mismo límite que hoy acota `GET /api/sync`). Se fija **`MAX_CLAIM_PAYLOAD_BYTES = 3 MiB` (decodificado)** → sidecar ≈ 4 MiB en base64, por debajo del límite de cuerpo de respuesta de las Functions (~4.5 MB). Una base local con meses de transacciones pesa típicamente KB — 3 MiB es holgado y a la vez acota el abuso del issue anónimo. Sobrepasar el límite → `413 claim_too_large`. *(Ajustable — ver Decisiones Abiertas.)*
- **Sin `syncCode`**: el claim es transporte puro. No hay código que auto-rellenar y, por tanto, no hay código que pueda quedar obsoleto. Ver Decisiones Abiertas sobre re-introducir un hint generado server-side para un hipotético sync futuro.

---

## Approach

### Arquitectura condensada

```
Device A (compartir)                          Device B (escanear)
─────────────────────────────────────────────────────────────────────
1. Usuario: "Compartir via QR" (sin config previa)
2. Client: exportDb(localDb) → base64 → POST /api/sync/claim
   body { bytes: "<b64>" }    (SIN headers auth)
   └─► Server: valida tamaño → sweepClaims → randomUUID() → token
       └─► Blob put: saldo-cero-claims/<token>.json
           { payload, hash, createdAt, expiresAt, status:'open' }
       └─► Returns: { token, hash, expiresAt }
3. QR canvas: "https://<origin>/sync-import?claim=<token>"
4. Countdown 15 min; "Done" → DELETE sidecar (invalidación temprana)

                                               5. Device B escanea QR / tipea token
                                               6. GET /api/sync/claim/<token> (NO auth)
                                                  └─► Server: lee sidecar → TTL check
                                                      └─► marca consumed (single-use)
                                                  └─► Returns: { bytes, hash, createdAt }
                                               7. Client: initDb(base64ToBytes) →
                                                  backup pre-claim → mergeDatabases(local, remote)
                                                  → persistencia → listo
```

### Detalles clave

- **Claim token**: `crypto.randomUUID()` (128-bit opaco), validado con `requireClaimToken` contra path traversal. El token ES la capability: quien lo posee (el QR, la foto, el pegado manual) puede consumir ese claim una vez.
- **Issue anónimo**: `POST /claim` deja de llamar a `checkSyncAuth`. No hay secreto compartido que demostrar. Superficie de abuso (cualquiera puede escribir un claim) acotada por el límite de tamaño (3 MiB), el TTL (se purga solo) y el token opaco (no se puede leer sin saber el token). Rate limiting opcional queda como hardening futuro.
- **Merge inmutable**: `mergeDatabases(localDb, remoteDb, deviceId)` (`lib/db/merge.ts`) **no cambia**. `applyClaimImport` (rebautizable a `applyQrImport`) la reutiliza tal cual. Backup `pre-claim-*` (best-effort) antes de mutar el singleton se conserva.
- **Sin auto-fill ni replace**: se elimina el `localStorage['saldo-cero-sync-code']` del flujo de import y el diálogo de reemplazo. El import es unidireccional: lo que haya en Device 2 se **fusiona** con el snapshot recibido.
- **Rendimiento**: una sola ida y vuelta en consume (read sidecar → TTL → mark → response). No hay segunda llamada a un namespace de snapshot.

---

## Requisitos Funcionales

### FR-S1: Compartir sin setup (`POST /api/sync/claim`, anónimo)
El endpoint **DEBE** aceptar una petición **sin headers de auth** con `body { bytes: string }` (base64 del `exportDb` local), validar `bytes` <= `MAX_CLAIM_PAYLOAD_BYTES`, hacer lazy sweep de claims vencidos/usados, emitir `crypto.randomUUID()` y escribir el sidecar self-contained `{ payload, hash, createdAt, expiresAt, status:'open' }`.

Respuesta **DEBE** ser `{ token, hash, expiresAt }`. **Sin** `syncCode`, **sin** headers.

Si `bytes` excede el límite → `413 { error: 'claim_too_large' }`. Si el body es inválido/vacío → `400 { error: 'bad-request' }`.

#### Escenario: compartir sin haber sincronizado nunca
- GIVEN Device 1 con datos locales y **sin** sync configurado (sin `syncCode`, sin `SYNC_TOKEN`)
- WHEN el usuario pulsa "Compartir via QR" (botón siempre activo)
- THEN `POST /api/sync/claim` responde 200 `{ token, hash, expiresAt }` y el sidecar contiene los bytes completos
- AND el cliente renderiza el QR `https://<origin>/sync-import?claim=<token>`

#### Escenario: base local demasiado grande
- GIVEN `exportDb` > límite configurado
- WHEN se intenta compartir
- THEN responde `413 claim_too_large` y la UI muestra mensaje claro ("Tu base local supera el límite de compartir por QR", i18n)

#### Escenario: issue sin body
- WHEN `POST /claim` sin `{ bytes }` válido
- THEN `400 bad-request`, sin sidecar creado

### FR-S2: Escanear sin setup (`GET /api/sync/claim/<token>`)
El endpoint **DEBE** consumir el claim **sin headers** (el token es la capability). Al recibir la petición, el servidor **DEBE**:
1. `requireClaimToken(token)` → si malformado → 404 `claim_not_found` (sin tocar blob)
2. Leer el sidecar `saldo-cero-claims/<token>.json`
3. Si no existe → 404 `claim_not_found`; si `expiresAt <= now` → 404 `claim_expired`; si `status === 'consumed'` → 404 `claim_consumed`
4. Marcar `consumed` (single-use, D4 del design anterior)
5. Responder `200 { bytes, hash, createdAt }` — la `payload` del sidecar **es** el dato; **no** hay llamada a un namespace de snapshot

#### Escenario: import exitoso en Device 2
- GIVEN sidecar self-contained válido
- WHEN Device 2 escanea el QR (o pega el token) → `GET /claim/<token>`
- THEN responde 200 con `{ bytes, hash, createdAt }`, el sidecar queda `consumed`
- AND Device 2 hace `mergeDatabases(local, remote)` → backup + persistencia → listo, sin banner, sin config pendiente

#### Escenario: claim expirado / consumido / desconocido / carrera
- Expired → 404 `claim_expired`; consumed (replay/foto) → 404 `claim_consumed`; desconocido o malformado → 404 `claim_not_found`
- Carrera concurrente (dos dispositivos escanean el mismo QR): peor caso = ambos leen `open`, ambos marcan `consumed`, **ambos reciben los mismos bytes** (el merge es idempotente → sin corrupción); el test de carrera exige 1×200 / 1×404 como contrato

**(FR-S2 mantiene FR-2 del change anterior, cambiando únicamente la fuente de los bytes: sidecar en lugar de snapshot.)**

### FR-S3: Claim self-contained (el QR es el transporte)
El sidecar **NO DEBE** depender de `saldo-cero-<syncCode>.db` ni de un snapshot previo: `getSnapshotBytes`/`getSnapshotMeta` dejan de ser parte del flujo de claim. El QR **DEBE** codificar `https://<origin>/sync-import?claim=<token>` (sin parámetro `c`); el fallback tipable **DEBE** seguir funcionando con solo el token. Longitud ≈ 50–60 chars → QR de baja densidad, escaneo robusto.

#### Escenario: deep link sin código
- GIVEN Device 2 escanea el QR con cámara genérica
- THEN se abre `/sync-import?claim=<token>`, el modal de import recibe solo el token y ejecuta el flujo íntegro sin conocer ningún código

### FR-S4: Ciclo de vida del claim (se conserva de `qr-sync-export`)
- **TTL** 15 min verificado server-side (`expiresAt = createdAt + 15*60*1000`); expirados los limpia el lazy sweep en el siguiente `POST /claim`.
- **Single-use**: marcar `status:'consumed'` antes de responder (D4).
- **Invalidación temprana**: `DELETE /api/sync/claim/<token>` (idempotente, 204) desde el botón "Done"/"Invalidar" del modal export; cerrar por Escape/backdrop **no** invalida.
- **Countdown** 15:00→00:00 visible en el modal export; componente separado (sin interpolación dentro de `t()`).

### FR-S5: Conflicto de datos (Device 2 ya tiene datos)
Cuando Device 2 ya tiene una base local, el import **DEBE**:
1. Guardar backup best-effort `pre-claim-<timestamp>`
2. Fusionar con `mergeDatabases(local, remote)` (pura, idempotente, union por `id` con resolución por `updated_at` — lógica existente, **sin cambios**)
3. Persistir el resultado en IndexedDB + refrescar UI
4. Mostrar **preview antes de confirmar** ("Snapshot del {fecha}", "Hash: {8 chars}").

**No** hay diálogo de reemplazo de `syncCode` (el código deja de existir en el producto). El overwrite total (reemplazar en vez de fusionar) queda fuera de alcance por decisión — ver Decisiones Abiertas.

#### Escenario: Device 2 con datos y Device 1 con datos → ambos conservan
- GIVEN ambos dispositivos tienen transacciones propias
- WHEN Device 2 importa el QR
- THEN el resultado es la unión idempotente de ambas bases; nada se pierde (backup local previo accesible en Settings → Backups)

### FR-S6: Seguridad (token = capability, sin secreto compartido)
- Token de claim = `crypto.randomUUID()` (128 bits, opaco, no JWT).
- **`SYNC_TOKEN` y `syncCode` DEBEN desaparecer** del claim, del QR, del lado server y de la UI de sync.
- Todos los fallos de lectura responden **404** (no 403) para impedir enumeración.
- El sidecar vive en store blob **privado** (`BLOB_ACCESS='private'`); jamás se expone una URL pública del blob.
- Límite de tamaño en `POST` (3 MiB) como tope del issue anónimo; la capa adyacente (auth de la propia app, CORS del deploy) actúa como mitigación secundaria.
- Test unitario **DEBE** escanear el sidecar y las respuestas para verificar la ausencia de `sync-token`/`sync-code` (heredero del NFR-3 del change anterior).

### FR-S7: Internacionalización (i18n)
Todas las cadenas nuevas **DEBEN** usar claves fijas en `contexts/language-context.tsx` (es/en) bajo los namespaces existentes. Se **DEBEN eliminar** claves obsoletas: `sync.import.token_banner`, `sync.claim.replace_confirm`, y cualquier clave de código/token de import/export si queda huérfana. Se **DEBEN mantener** `sync.export.*` (title, countdown, claim_token_label, done), `sync.import.*` (title, camera_tab, manual_tab, enter_token, button, preview_title/date/hash, confirm, cancel) y `sync.claim.*` (error_expired/consumed/not_found). Se **DEBE añadir** `sync.claim.error_too_large`. Prohibido interpolar contenido dinámico dentro de `t()` (countdown y fechas se renderizan en componentes).

---

## Requisitos No Funcionales

### NFR-S1: Sin migración de la DB local (local-first intacto)
El schema SQLite (`accounts`, `transactions`, `recurring_events`, `budgets`, `sync_meta`) **NO se modifica**; `mergeDatabases` y `sync_meta` (singleton `id=1`) quedan intactos. La regla del repo exige un archivo de **migración descriptiva** porque el *modelo de datos del claim* cambia (ver Estrategia de datos); se materializa en la fase design bajo `docs/migrations/2026-09-12-qr-sync-simplify.md`.

### NFR-S2: Rendimiento
- `GET /claim/<token>` **DEBE** completar en una sola ida y vuelta (read sidecar → TTL → mark → response), sin llamadas encadenadas al namespace de snapshot.
- Cuerpo máximo de respuesta: `MAX_CLAIM_PAYLOAD_BYTES` en base64 (≈4 MiB) con tope explícito y error `claim_too_large`.
- Target: < 500 ms p95 en Vercel Functions (blob en misma región).

### NFR-S3: Privacidad
- Los bytes viajan únicamente en el sidecar del store **privado**, accesibles solo por las rutas server-side; el cliente nunca recibe una URL de Blob.
- La capacidad de leer un claim es la posesión del token. Sin autenticación compartida, sin logs de payload (solo `hash`/`size`/timestamps si se logea).
- Una vez consumido o expirado, el sidecar se purga (sweep) — el dato no queda colgado.

### NFR-S4: Rollback
Estrategia completa en "Plan de Rollback". La variable clave: como el claim es **idempotente por diseño** (sidecars autónomos sin estado compartido), revertir a la implementación anterior deja los claims self-contained como basura limpia por `sweepClaims`, y **no** hay datos de usuario que restaurar en el relay (la fuente de verdad sigue siendo local en cada dispositivo).

---

## Impacto en el change anterior (`qr-sync-export`)

### Lo que se elimina / degrada

| Superficie actual (`qr-sync-export`) | Acción |
|--------------------------------------|--------|
| `checkSyncAuth` en `POST /api/sync/claim` | **Eliminar** — issue anónimo con límite de tamaño |
| `syncCode` en `ClaimMeta`, en el QR (`?c=`) y en la respuesta de consume | **Eliminar** — claim self-contained |
| Requisito de "snapshot previo subido" (`getSnapshotMeta` → 404) en el issue | **Eliminar** — el payload viaja en el sidecar |
| Inputs `syncCode` + `syncToken` del panel Settings (`sync-settings.tsx`) | **Eliminar** de la UI (ver convivencia del LWW) |
| Banner "Configura tu token de despliegue en Settings" (`sync.import.token_banner`) | **Eliminar** |
| Diálogo "Reemplazar syncCode" (`sync.claim.replace_confirm`) | **Eliminar** |
| Auto-fill de `localStorage['saldo-cero-sync-code']` | **Eliminar** |
| `getSyncConfig`/`setSyncConfig`/`createClaim` con headers | **Degradar/eliminar** según destino del LWW (abajo) |
| Claves i18n de token/replace | **Eliminar**; añadir `sync.claim.error_too_large` |

### Lo que se conserva (sin cambios funcionales)

| Superficie | Por qué |
|------------|---------|
| Claim sidecar en blob (`putClaim/getClaim/markClaimConsumed/deleteClaim/sweepClaims`, `CLAIM_PREFIX`, `requireClaimToken`) | Infraestructura intacta; solo cambia la **forma** del meta (payload en vez de syncCode) |
| TTL 15 min + single-use (marca `consumed`) + lazy sweep | Decisiones D3/D4 del design anterior, validadas |
| `DELETE /claim/<token>` (invalidación temprana) + countdown + botón "Done" | FR-S4 |
| `mergeDatabases` + backup `pre-claim-*` + preview-confirm | FR-S5 |
| `GET /claim/<token>` sin headers con 404 clasificado | FR-S2/FR-S6 |
| Página deep-link `app/sync-import/page.tsx` (con `<Suspense>`) | Reutilizada; cambia solo el query param interpretado |
| Deps `qrcode` + `html5-qrcode`, modal export/import, fallback tipable | Se mantienen |
| `buildClaimUrl` | Cambia de *firma*: `buildClaimUrl(origin, token)` — sin `syncCode` |

### Convivencia con el sync LWW por syncCode (RECOMENDACIÓN)

**Recomendación: eliminar el sync por código (`syncCode` + `SYNC_TOKEN`) de la superficie de producto junto con este change.** Razones:

1. **Contradice la decisión**: el intent es "eliminar el flag-tea de la UI". Dejar el panel "Sincronizar" con campos código+token reintroduce exactamente la fricción que se quiere matar.
2. **No hay reemplazo sin token**: convertir el `syncCode` en capability (quitar `SYNC_TOKEN` de `checkSyncAuth`) debilita la seguridad — códigos de 4–32 chars elegidos por el usuario, adivinables y bruto-forceables sin rate limiting, sobre datos financieros personales. No se recomienda.
3. **El QR self-contained cubre el caso de uso** (llevar datos entre dispositivos propios), que es el único que el LWW servía en la práctica.
4. **Coste de eliminar es bajo**: las rutas `/api/sync` (GET/POST), `/api/sync/meta`, `/api/sync/import`, `lib/sync-auth.ts`, `syncNow`/`pullMergePush`, `SyncButton` y los tests asociados se retiran; `git` conserva el histórico para re-activarlas.

**Alternativa** (si se quiere conservar sync bidireccional futuro): mantener las rutas LWW server-side pero sin exponerlas en UI, marcadas como "deprecadas", para re-habilitarlas detrás de un modo avanzado con un secreto generado por el *claim* (no el token de despliegue). — Ver **Decisiones Abiertas**: se necesita confirmación del usuario; por defecto la propuesta va por la eliminación.

---

## Estrategia de datos (incluye el contenido MÍNIMO de la migración descriptiva)

Regla del repo: TODO cambio de modelo de datos DEBE tener migración descriptiva en `docs/migrations/YYYY-MM-DD-<change-id>.md`. Este change modifica el **modelo del claim** (sidecar en blob, no SQLite) → **sí aplica migración descriptiva**. El archivo se materializa en la fase design copiando este contenido:

```
# Migración: qr-sync-simplify

Fecha: 2026-09-12
Change: `qr-sync-simplify`
PRD: docs/requirements/qr-sync-simplify.md

## Cambio de schema
Los claims de exportación por QR (sidecars en Vercel Blob) pasan de ser
"puntero a un namespace de syncCode" a "contenedor self-contained de los bytes".

### Schema previo (ClaimMeta, lib/blob-relay.ts)
saldo-cero-claims/<token>.json { syncCode, hash, createdAt, expiresAt, status }

### Schema nuevo (ClaimMeta, lib/blob-relay.ts)
saldo-cero-claims/<token>.json { payload: <base64>, hash, createdAt, expiresAt, status }

## Estrategia de datos
- Asunción: en producción no existen claims activos (feature nueva, nunca se lanzó
  uso real del QR); el namespace saldo-cero-claims/ puede considerarse vacío.
- Parte defensiva: `getClaim` valida la forma nueva con un type-guard que ahora
  exige `payload`. Un sidecar legacy (sin `payload`) se lee como `null` →
  `404 claim_not_found`; reside hasta que el lazy sweep en el siguiente
  `POST /claim` lo purgue (expiración ya aplicable o tipo desconocido).
- No hay datos de usuario en el relay que migrar: la fuente de verdad en cada
  dispositivo es la DB local (local-first).

## Rollback
- Revertir `ClaimMeta` a la forma con `syncCode`.
- Revertir que el issue requiera `checkSyncAuth` + snapshot previo.
- Los sidecars self-contained creados entre el deploy y el rollback serán
  invisibles para el lector legacy (no reconocen `payload`) y el lazy sweep los
  purga con su TTL; no hay reescritura necesaria.
```

---

## Plan de Rollback

1. Revertir `lib/blob-relay.ts`: `ClaimMeta` vuelve a `{ syncCode, hash, createdAt, expiresAt, status }`.
2. Revertir `app/api/sync/claim/route.ts`: `POST /claim` vuelve a `checkSyncAuth` + `getSnapshotMeta` (404 `snapshot_not_found`) + body sin payload.
3. Revertir `app/api/sync/claim/[token]/route.ts`: `GET` vuelve a `getSnapshotBytes(claim.syncCode)`.
4. Revertir `lib/sync-client.ts`: restaurar auto-fill `syncCode`, `buildClaimUrl(origin, syncCode, token)` y el contrato `ClaimFetchResult` con `syncCode`.
5. Revertir `components/sync/sync-settings.tsx` (botones + inputs), `sync-qr-modal.tsx` (banner, diálogo replace) y `app/sync-import/page.tsx`.
6. Revertir `contexts/language-context.tsx` (reintroducir claves token/replace; quitar `error_too_large`).
7. Si se eliminó el LWW: restaurar rutas `/api/sync*`, `lib/sync-auth.ts`, `SyncButton` y tests correspondientes desde el commit anterior.
8. Correr suite completa: `pnpm test` + `pnpm tsc --noEmit` → verde.

---

## Criterios de Aceptación

- [ ] **First-commit convention**: la fase de planning (`docs/plan` + este PRD) es el **primer commit** en rama fresca, tipo `docs(plan):`
- [ ] `POST /api/sync/claim` responde 200 `{ token, hash, expiresAt }` **sin headers**, body `{ bytes }`, y escribe sidecar self-contained `{ payload, hash, createdAt, expiresAt, status:'open' }`
- [ ] Issue funciona con cero setup: sin `syncCode`, sin `SYNC_TOKEN`, sin snapshot previo en el relay
- [ ] `POST /claim` sin body → 400; `bytes` > `MAX_CLAIM_PAYLOAD_BYTES` → 413 `claim_too_large`
- [ ] `GET /claim/<token>` sin headers → `200 { bytes, hash, createdAt }`; TTL 15 min; single-use (`consumed`); 404 clasificados `claim_expired`/`claim_consumed`/`claim_not_found`; carrera → 1×200/1×404 en test unitario
- [ ] QR payload = `https://<origin>/sync-import?claim=<token>` (sin `c`); fallback tipable con solo el token → E2E verde
- [ ] **Ausencia verificada por test**: ni el sidecar ni las respuestas contienen `sync-code` ni `sync-token` (heredero NFR-3)
- [ ] Botón "Compartir via QR" **siempre habilitado** (con o sin sync config); import sin banner de token ni diálogo de replace
- [ ] Import con Device 2 con datos: merge idempotente + backup `pre-claim-*` + preview-confirm; nada se pierde
- [ ] Countdown / botón "Done" → `DELETE` → 204 → siguiente GET `claim_consumed` (o 404); Escape no invalida
- [ ] i18n es/en: claves token/replace eliminadas; `sync.claim.error_too_large` presente; sin interpolación en `t()`
- [ ] Migración descriptiva `docs/migrations/2026-09-12-qr-sync-simplify.md` creada en la fase design con el contenido de "Estrategia de datos"
- [ ] `pnpm test` + `pnpm tsc --noEmit` → **PASS**, sin regresiones en `merge.test.ts`, `repository.test.ts`, `persistence.test.ts`, `schema-sync.test.ts`

---

## Abreviaturas / Decisiones Abiertas

| # | Decisión | Recomendación de esta propuesta | Impacto si se elige otra |
|---|----------|--------------------------------|--------------------------|
| 1 | **Límite máximo del payload del claim** | `MAX_CLAIM_PAYLOAD_BYTES = 3 MiB` decodificado (≈4 MiB base64), como tope del cuerpo de respuesta de Functions y del issue anónimo | Subirlo exige validar el límite del plan de Vercel; bajarlo puede dejar fuera bases grandes |
| 2 | **Destino del sync LWW por código (`syncCode`+`SYNC_TOKEN`)** | **Eliminarlo** de UI y rutas junto con este change (ver Impacto) | Alternativa: mantener rutas deprecadas server-side para un modo avanzado futuro |
| 3 | **Auth del `POST /claim` (issue anónimo)** | **Anónimo + límite de tamaño** + sweep; rate-limit/Turnstile como hardening futuro fuera de alcance | Si se exige auth umbral, la emisión ya no funciona "sin setup" y se reintroduce fricción |
| 4 | **¿Re-introducir `syncCode` (o un hint generado server-side) en el claim para un futuro sync bidireccional?** | **No en v1** — el QR es transporte puro; nada que auto-rellenar ni que pueda quedar obsoleto | Incluirlo re-activa el diálogo/auto-fill y la superficie de syncCode que se quiere eliminar |
| 5 | **Comportamiento cuando Device 2 ya tiene datos** | **Merge idempotente** (union) + backup `pre-claim-*`; sin overwrite total en v1 | Si se quiere "reemplazar" (overwrite), hay que añadir confirmación explícita y definir semántica de conflicto total |

---

*Documento generado como parte del flujo SDD para el change `qr-sync-simplify`. Reemplaza/extiende la parte QR de `qr-sync-export` (archivado previo: `docs/requirements/qr-sync-export.md`, `docs/design/qr-sync-export.md`).*