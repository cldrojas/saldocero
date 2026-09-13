# Spec: QR Sync Export/Import (Delta)

## Change ID
`qr-sync-export`

## Estado
**En fase de especificación.** Complementa el change `multi-device-blob-sync` (archivado 2026-09-11) añadiendo un flujo QR asistido para el intercambio del `syncCode` + claim token sin teclear. El sync manual existente (pull → merge → push vía Vercel Blob relay) **no cambia**; este change añade un claim token de un solo uso (TTL 15 min) que Device A emite y Device B consume, auto-rellenando el `syncCode` en B. El token de despliegue `SYNC_TOKEN` **nunca viaja en el QR** ni en el claim.

---

## REQUISITOS AÑADIDOS

### FR-1: Emisión de claim (`POST /api/sync/claim`)
El endpoint **DEBE** emitir un claim token opaco de 128 bits (`crypto.randomUUID()`) y escribir un sidecar en Vercel Blob bajo la clave `saldo-cero-claims/<token>.json` que apunta al namespace blob existente (`saldo-cero-<syncCode>.db`).

La petición **DEBE** requerir los headers de auth existentes: `x-sync-code` y `x-sync-token`. Sin credenciales válidas **DEBE** responder 401.

La respuesta **DEBE** ser: `{ token, syncCode, hash, expiresAt }` donde `expiresAt = Date.now() + 15*60*1000` (15 minutos).

El sidecar **DEBE** contener: `{ syncCode, hash, createdAt, expiresAt }`. El sidecar **NO DEBE** contener los bytes del snapshot ni el `SYNC_TOKEN` de despliegue.

#### Escenario: Emisión exitosa con credenciales válidas
- GIVEN Device A tiene `syncCode` y `SYNC_TOKEN` configurados en `localStorage`
- WHEN el usuario pulsa "Share via QR" y el cliente llama `createClaim(conf)`
- THEN `POST /api/sync/claim` responde 200 con `{ token, syncCode, hash, expiresAt }`
- AND se crea `saldo-cero-claims/<token>.json` en Vercel Blob con los metadatos del claim
- AND el cliente renderiza el QR con payload `https://<origin>/sync-import?c=<syncCode>&claim=<token>`

#### Escenario: Petición sin credenciales
- GIVEN una petición POST a `/api/sync/claim` sin headers `x-sync-code` / `x-sync-token`
- WHEN se procesa
- THEN responde 401
- AND no se crea ningún sidecar

#### Escenario: Credenciales inválidas
- GIVEN headers presentes pero `x-sync-token` incorrecto para el `x-sync-code`
- WHEN se procesa
- THEN responde 401

---

### FR-2: Consumo de claim (`GET /api/sync/claim/<token>`)
El endpoint **DEBE** permitir el consumo del claim **sin headers de auth** (el token es la capability). Debe validar TTL (15 min), single-use (marcado `status: consumed` + sweep lazy; el sidecar puede permanecer hasta el sweep pero el consumo exitoso es único), y devolver el snapshot completo para que Device B ejecute el merge. *(El mecanismo exacto se detalla en el design, D4.)*

Al recibir la petición, el servidor **DEBE**:
1. Leer el sidecar `saldo-cero-claims/<token>.json`
2. Verificar `expiresAt > Date.now()` (TTL 15 min)
3. Si expirado o no existe → 404
4. Obtener `syncCode` del sidecar
5. **ANTES** de responder: marcar el sidecar como `status: 'consumed'` (single-use; el sweep lazy lo purga después)
6. Llamar `getSnapshotBytes(syncCode)` para obtener los bytes del `.db`
7. Responder: `{ bytes, hash, updatedAt, syncCode }`

Si el sidecar ya fue consumido (`status: consumed`) o expiró → 404.

#### Escenario: Consumo exitoso primer dispositivo
- GIVEN existe sidecar válido `saldo-cero-claims/<token>.json` con `expiresAt` futuro
- WHEN Device B escanea QR y llama `importFromClaim(token)` → `GET /api/sync/claim/<token>`
- THEN responde 200 con `{ bytes, hash, updatedAt, syncCode }`
- AND el sidecar es marcado `status: consumed` (single-use; el sweep lazy lo purga)
- AND Device B ejecuta `mergeDatabases(local, remote)` con los bytes recibidos
- AND `syncCode` se auto-guarda en `localStorage['saldo-cero-sync-code']` si no existía

#### Escenario: Claim expirado (TTL)
- GIVEN sidecar existe pero `expiresAt < Date.now()`
- WHEN `GET /api/sync/claim/<token>`
- THEN responde 404 con cuerpo `{ error: "claim_expired", message: "El código QR ha expirado (15 min). Genera uno nuevo desde el dispositivo origen." }`
- AND sidecar permanece (lazy sweep lo limpiará en siguiente POST /claim)

#### Escenario: Claim ya consumido (replay / foto de QR)
- GIVEN sidecar fue consumido previamente (marcado `consumed` tras primer GET)
- WHEN segundo `GET /api/sync/claim/<token>` (mismo token)
- THEN responde 404 con `{ error: "claim_consumed", message: "Este código QR ya fue usado. Genera uno nuevo desde el dispositivo origen." }`

#### Escenario: Claim desconocido
- GIVEN token no existe en blob
- WHEN `GET /api/sync/claim/<token>`
- THEN responde 404 con `{ error: "claim_not_found" }`

#### Escenario: Carrera concurrente (dos dispositivos escanean el mismo QR casi simultáneo)
- GIVEN sidecar válido existe
- WHEN Device B1 y Device B2 llaman `GET /api/sync/claim/<token>` concurrentemente
- THEN uno recibe 200 con snapshot + sidecar borrado
- AND el otro recibe 404 `claim_consumed`
- **Nota**: La atomicidad la garantiza Vercel Blob (`delete` antes de `get` en el handler). Test unitario en `sync-claim.test.ts` simula la carrera con mock in-memory.

---

### FR-3: Ciclo de vida del sidecar (claim registry)
Los sidecars **VIVEN** en el namespace `saldo-cero-claims/` separado del namespace de snapshots (`saldo-cero-<code>.db`).

- **Creación**: `POST /claim` → `put(saldo-cero-claims/<token>.json, { syncCode, hash, createdAt, expiresAt })`
- **Consumo**: `GET /claim/<token>` → `delete(sidecar)` atómico → `getSnapshotBytes(syncCode)` → respuesta
- **Expiración**: TTL 15 min verificado en `GET` (server-side). Expirados **NO** se limpian inmediatamente.
- **Limpieza perezosa (lazy sweep)**: En cada `POST /claim` nuevo, **ANTES** de crear el sidecar, el handler **DEBE** listar y borrar sidecars con `expiresAt < Date.now()` del mismo namespace. Job cron opcional queda fuera de scope.
- **Invalidación temprana (client-side)**: Device A puede invalidar su claim pulsando "Done" en el modal export → `DELETE /api/sync/claim/<token>` (nuevo endpoint o reutilizar GET con método DELETE) → sidecar borrado antes de TTL. Server-side TTL sigue guardando.

#### Escenario: Lazy sweep en nueva emisión
- GIVEN existen 3 sidecars expirados en `saldo-cero-claims/`
- WHEN Device A emite nuevo claim (`POST /claim`)
- THEN handler borra los 3 expirados antes de escribir el nuevo
- AND respuesta incluye el nuevo token

#### Escenario: Invalidación temprana por usuario
- GIVEN Device A muestra modal QR con countdown activo
- WHEN usuario pulsa "Done" / "Invalidar"
- THEN cliente hace `DELETE /api/sync/claim/<token>` → sidecar borrado
- AND modal se cierra; QR ya no válido aunque TTL no haya expirado

---

### FR-4: Payload del QR (short URL)
El QR **DEBE** codificar una URL corta del formato:
```
https://<origin>/sync-import?c=<syncCode>&claim=<token>
```

Donde:
- `<origin>` = `window.location.origin` del dispositivo A (p. ej. `https://saldo-cero.vercel.app`)
- `c` = `syncCode` (código alfanumérico corto, p. ej. `abc123`)
- `claim` = token opaco de 128 bits (36 chars UUID v4)

**Reglas estrictas**:
- **NUNCA** incluye `SYNC_TOKEN` en el QR ni en el claim
- URL debe ser abrible por apps de cámara genéricas (iOS Camera, Google Lens, etc.)
- Longitud típica ≈ 120–140 chars → cabe en QR versión 10–15 (baja densidad, escaneo robusto)
- Fallback tipable: el token `claim` solo (sin URL) **DEBE** poder ingresarse manualmente en Device B (input texto en modal import). El `syncCode` se auto-rellena desde la respuesta del claim.

#### Escenario: QR escaneado por cámara genérica
- GIVEN Device A muestra QR en modal export
- WHEN usuario abre cámara de iOS/Android y apunta al QR
- THEN el SO reconoce URL y ofrece abrir en navegador
- AL abrir → carga `/sync-import?c=abc123&claim=xyz...` → modal import en Device B

#### Escenario: Fallback tipable (E2E y accesibilidad)
- GIVEN usuario no puede/camera no funciona
- WHEN usuario copia el token `claim` (mostrado bajo el QR como texto seleccionable) y lo pega en input "Enter claim token" del modal import
- THEN `importFromClaim(token)` funciona idéntico a ruta cámara

---

### FR-5: UX Export (Device A — "Share via QR")
En `components/sync/sync-settings.tsx` **DEBE** aparecer botón "Share via QR" (icono + texto, i18n `sync.export.title`) junto al botón "Sincronizar" existente.

Al pulsar, se abre `components/sync/sync-qr-modal.tsx` en modo **export** con:
1. **Canvas QR** generado por `qrcode` (librería) con la URL del FR-4
2. **Countdown visible** 15:00 → 00:00 (actualizado cada segundo), i18n `sync.export.countdown`
3. **Token tipable** bajo el QR (monospace, seleccionable, `sync.export.claim_token_label`)
4. **Botón "Done" / "Invalidar"** (i18n `sync.export.done`) que:
   - Llama `DELETE /api/sync/claim/<token>` (invalidación temprana server-side)
   - Cierra modal
   - Limpia estado local del claim en cliente
5. **Auto-cierre** al llegar countdown a 0 (TTL server-side sigue guardando)

El modal **DEBE** ser accesible (ARIA labels, focus trap, Escape para cerrar).

#### Escenario: Flujo export completo
- GIVEN Device A en SyncSettings con sync configurado
- WHEN pulsa "Share via QR"
- THEN modal abre → QR renderizado → countdown inicia 15:00
- WHEN usuario espera 30 seg y pulsa "Done"
- THEN claim invalidado server-side → modal cierra
- AND nuevo "Share via QR" generará claim distinto

#### Escenario: Usuario cierra modal sin consumir (Escape / backdrop)
- GIVEN modal export abierto
- WHEN usuario pulsa Escape o click fuera
- THEN modal cierra **SIN** invalidar claim server-side (TTL 15 min sigue corriendo)
- **Razón**: permitir que usuario reabra modal y siga compartiendo mismo QR si vuelve rápido

---

### FR-6: UX Import (Device B — "Scan QR or enter code")
En `components/sync/sync-settings.tsx` **DEBE** aparecer botón "Scan QR or enter code" (i18n `sync.import.title`) junto a "Share via QR".

Al pulsar, se abre `sync-qr-modal.tsx` en modo **import** con dos pestañas/estados:
1. **Cámara** (default si `navigator.mediaDevices.getUserMedia` disponible): usa `html5-qrcode` para escanear. Al detectar QR válido (URL con params `c` y `claim`), extrae `claim` y llama `importFromClaim(claim)`.
2. **Entrada manual** (SIEMPRE visible, accesible, requerida para E2E Playwright): input texto `claim` + botón "Importar". i18n `sync.import.enter_token`, `sync.import.button`.

**Preview antes de confirmar**: tras `GET /claim/<token>` exitoso (antes del merge), el modal **DEBE** mostrar:
- "Snapshot from {fecha formateada de `updatedAt`}"
- "Hash: {primeros 8 chars de `hash`}"
- Botones: "Confirmar e importar" / "Cancelar"

Al confirmar:
- Ejecuta `mergeDatabases(localDb, remoteBytes, deviceId)` **SIN CAMBIOS** (reutiliza lógica existente FR-3 del change anterior)
- Guarda resultado en IndexedDB + actualiza `sync_meta` (`snapshot_hash`, `updated_at`, `device_id`)
- **Auto-fill `syncCode`**: si `localStorage['saldo-cero-sync-code']` no existe, lo setea con `syncCode` de la respuesta del claim
- **Banner `SYNC_TOKEN`**: si `localStorage['saldo-cero-sync-token']` ausente, muestra banner persistente "Configura tu token de despliegue en Settings para sincronizar" (i18n `sync.import.token_banner`) con enlace a Settings

**Conflicto de config previa**: si Device B ya tiene `syncCode` distinto al del claim, **DEBE** mostrar diálogo de confirmación "Este dispositivo ya tiene un código de sync distinto (actual: `xxx`, nuevo: `yyy`). ¿Reemplazar?" antes de auto-fill.

#### Escenario: Import por cámara (happy path)
- GIVEN Device B sin sync configurado, modal import abierto en pestaña cámara
- WHEN escanea QR de Device A → extrae `claim` → `importFromClaim(claim)`
- THEN preview muestra "Snapshot from 12 sep 2026, hash: a1b2c3d4"
- WHEN pulsa "Confirmar e importar"
- THEN merge ejecuta → datos fusionados → `syncCode` auto-guardado → modal cierra → SyncSettings muestra "Sincronizado" con el nuevo código

#### Escenario: Import por fallback tipable (E2E)
- GIVEN Device B en modal import, pestaña "Entrada manual"
- WHEN usuario pega token `claim` y pulsa "Importar"
- THEN mismo flujo que cámara: preview → confirm → merge → auto-fill

#### Escenario: Device B ya tiene syncCode distinto
- GIVEN Device B tiene `syncCode = "old123"` en localStorage
- WHEN claim responde con `syncCode = "new456"`
- THEN modal muestra diálogo: "Código de sync actual: old123. Nuevo: new456. ¿Reemplazar?"
- SI confirma → auto-fill con new456
- SI cancela → import aborta, syncCode permanece old123

#### Escenario: Falta SYNC_TOKEN tras import
- GIVEN Device B importa claim exitosamente pero `saldo-cero-sync-token` ausente
- THEN SyncSettings muestra banner amarillo "Configura tu token de despliegue en Settings para sincronizar" con botón "Ir a Settings"
- AND botón "Sincronizar" queda deshabilitado hasta que token exista

---

### FR-7: Internacionalización (i18n)
Todas las cadenas nuevas **DEBEN** usar claves fijas en `contexts/language-context.tsx` bajo el namespace `sync.export.*`, `sync.import.*`, `sync.claim.*` para **es** y **en**.

**Prohibido**: interpolar contenido dinámico dentro de `t()` (p. ej. `t('sync.export.countdown', { time: '14:59' })` ❌). El countdown se renderiza como componente separado, no via i18n.

Claves mínimas requeridas:
| Clave | es | en |
|-------|-----|-----|
| `sync.export.title` | Compartir vía QR | Share via QR |
| `sync.export.countdown` | Expira en {mm}:{ss} | Expires in {mm}:{ss} |
| `sync.export.claim_token_label` | Código de claim (tipable) | Claim code (typeable) |
| `sync.export.done` | Listo / Invalidar | Done / Invalidate |
| `sync.import.title` | Escanear QR o ingresar código | Scan QR or enter code |
| `sync.import.camera_tab` | Cámara | Camera |
| `sync.import.manual_tab` | Ingresar código | Enter code |
| `sync.import.enter_token` | Pega el claim token aquí | Paste claim token here |
| `sync.import.button` | Importar | Import |
| `sync.import.preview_title` | Vista previa del snapshot | Snapshot preview |
| `sync.import.preview_date` | Snapshot del {date} | Snapshot from {date} |
| `sync.import.preview_hash` | Hash: {shortHash} | Hash: {shortHash} |
| `sync.import.confirm` | Confirmar e importar | Confirm and import |
| `sync.import.cancel` | Cancelar | Cancel |
| `sync.import.token_banner` | Configura tu token de despliegue en Settings para sincronizar | Configure your deployment token in Settings to sync |
| `sync.claim.error_expired` | El código QR ha expirado (15 min). Genera uno nuevo desde el dispositivo origen. | QR code expired (15 min). Generate a new one from the source device. |
| `sync.claim.error_consumed` | Este código QR ya fue usado. Genera uno nuevo desde el dispositivo origen. | This QR code was already used. Generate a new one from the source device. |
| `sync.claim.error_not_found` | Código de claim no encontrado. | Claim code not found. |
| `sync.claim.replace_confirm` | Este dispositivo ya tiene un código de sync distinto (actual: {current}, nuevo: {new}). ¿Reemplazar? | This device already has a different sync code (current: {current}, new: {new}). Replace? |

---

## REQUISITOS NO FUNCIONALES

### NFR-1: Sin migración de schema (no data-model change)
**DECLARACIÓN EXPLÍCITA**: Este change **NO REQUIERE** archivo de migración descriptiva (`docs/migrations/YYYY-MM-DD-qr-sync-export.md`) porque:
- Los claims viven como sidecars en Vercel Blob (`saldo-cero-claims/<token>.json`), **no en SQLite**
- El schema de la base de datos (`accounts`, `transactions`, `recurring_events`, `budgets`, `sync_meta`) **no se modifica**
- `mergeDatabases` (FR-3 del change anterior) **no cambia**
- Por la regla del repo (migración solo para cambios de modelo de datos), este change queda exento

### NFR-2: Rendimiento (single round-trip claim consume)
- `GET /api/sync/claim/<token>` **DEBE** completar en una sola ida-y-vuelta: read sidecar → TTL check → delete sidecar → get snapshot bytes → response
- Sin llamadas encadenadas adicionales
- Target: < 500ms p95 en Vercel Edge/Functions (blob relay en misma región)

### NFR-3: Seguridad (capability token opaco)
- Claim token = `crypto.randomUUID()` (128 bits, opaco, no JWT, sin payload sensible)
- **NUNCA** incluye `SYNC_TOKEN` de despliegue en claim, sidecar, QR, ni respuesta de consumo
- Capability-based: posesión del token = autorización para consumir ese snapshot una vez
- Namespace de claims separado (`saldo-cero-claims/`) de namespace de snapshots (`saldo-cero-<code>.db`)
- Blob relay usa `access: 'public'` + `addRandomSuffix: false` para URLs predecibles, pero **auth en endpoints** (401 sin credenciales en POST, capability token en GET) aísla el acceso

### NFR-4: Resiliencia y UX degradada
- Cámara no disponible / permisos denegados → fallback tipable **SIEMPRE** funcional (probado en E2E)
- Claim expirado mid-scan → 404 con mensaje amigable (FR-2 escenario TTL)
- Red falla durante `GET /claim` → error claro, estado local intacto, usuario reintenta
- Invalidación temprana (botón "Done") opcional; TTL server-side es guardia definitiva

---

## PRUEBAS (Acceptance Criteria)

### Unit tests: `tests/unit/sync-claim.test.ts`
Espejo de `tests/unit/sync-protocol.test.ts` usando mock blob in-memory (`Map<string, { bytes, meta }>`). Cobertura:
- `POST /claim` → emite token, escribe sidecar, retorna payload correcto
- `GET /claim/<token>` → TTL válido → delete sidecar → retorna snapshot bytes + meta
- TTL expirado → 404 `claim_expired`
- Claim ya consumido → 404 `claim_consumed`
- Claim desconocido → 404 `claim_not_found`
- Carrera concurrente (dos `GET` simultáneos) → uno 200, otro 404
- Lazy sweep: `POST /claim` borra sidecars expirados antes de crear nuevo
- Invalidación temprana `DELETE /claim/<token>` → sidecar borrado, siguiente GET → 404

### E2E tests: `tests/ui/sync-qr.spec.ts` (Playwright, puerto 3100)
- **Import por fallback tipable** (obligatorio, cámara opcional en CI):
  1. Device A: genera claim vía UI → obtiene token
  2. Device B: abre `/sync-import`, pega token en input manual → preview visible → confirm
  3. Verifica: merge completado, `syncCode` auto-guardado en localStorage, banner token si ausente
- **Export countdown + invalidación**: Device A abre modal, espera 2s, pulsa "Done" → claim invalidado, segundo Device B intenta importar → 404 consumed
- **Conflicto syncCode previo**: Device B con `syncCode` distinto importa claim → diálogo replace → confirma → syncCode actualizado

### Acceptance gate
```
pnpm test        # vitest run → todas las suites green (unit + E2E)
pnpm tsc --noEmit  # clean, sin errores de tipos
```
Sin regresiones en tests de `multi-device-blob-sync` (`sync-protocol.test.ts`, `merge.test.ts`, `repository.test.ts`, etc.).

---

## Tabla de Cobertura (Delta)

| Requisito | Happy path | Edge cases | Error states |
|-----------|-----------|------------|--------------|
| FR-1 Claim issue | ✅ credenciales válidas | ✅ invalidación temprana | ✅ 401 sin credenciales / inválidas |
| FR-2 Claim consume | ✅ primer dispositivo | ✅ carrera concurrente; ✅ invalidación temprana | ✅ 404 expirado / consumido / no encontrado |
| FR-3 Sidecar lifecycle | ✅ creación + consumo | ✅ lazy sweep en POST | ✅ TTL server-side; ✅ single-use atómico |
| FR-4 QR payload | ✅ URL corta cámara genérica | ✅ fallback tipable | — |
| FR-5 UX Export | ✅ modal QR + countdown + Done | ✅ cierre sin invalidar (Escape) | — |
| FR-6 UX Import | ✅ cámara + manual → preview → merge | ✅ syncCode distinto → diálogo; ✅ falta SYNC_TOKEN → banner | ✅ claim errores (expired/consumed/not_found) |
| FR-7 i18n | ✅ claves fijas es/en | — | — |
| NFR-1 No migración | ✅ declaración explícita | — | — |
| NFR-2 Rendimiento | ✅ single round-trip | — | — |
| NFR-3 Seguridad | ✅ token opaco, sin SYNC_TOKEN | ✅ namespace aislado | ✅ 401 / capability-based |
| NFR-4 Resiliencia | ✅ fallback tipable | ✅ cámara denegada | ✅ red falla, estado local intacto |

---

## Cobertura del Spec (para `sdd-verify` futuro)

| Requisito | Estado Esperado | Tests Clave | Notas |
|-----------|----------------|-------------|-------|
| FR-1 Claim issue | ✅ COVERED | `sync-claim.test.ts` (issue + auth) | 401 verificado |
| FR-2 Claim consume | ✅ COVERED | `sync-claim.test.ts` (consume, TTL, replay, race) | Carrera simulada en mock |
| FR-3 Sidecar lifecycle | ✅ COVERED | `sync-claim.test.ts` (lazy sweep, early invalidate) | DELETE atómico verificado |
| FR-4 QR payload | ✅ COVERED | `sync-qr-modal.test.tsx` (unit) + `sync-qr.spec.ts` (E2E) | URL format + fallback |
| FR-5 UX Export | ✅ COVERED | `sync-qr-modal.test.tsx` (countdown, Done, Escape) | Countdown timer mock |
| FR-6 UX Import | ✅ COVERED | `sync-qr.spec.ts` (manual fallback, preview, replace dialog, token banner) | E2E typed flow obligatorio |
| FR-7 i18n | ✅ COVERED | `language-context.test.tsx` (keys exist es/en) | No dynamic content in t() |
| NFR-1 No migración | ✅ COVERED | Declaración en spec + ausencia migration file | Regla repo satisfecha |
| NFR-2 Rendimiento | ✅ COVERED | Structural: single round-trip, no secretos en bundle | — |
| NFR-3 Seguridad | ✅ COVERED | `sync-claim.test.ts` (token opaque, no SYNC_TOKEN leak) | Capability-based |
| NFR-4 Resiliencia | ✅ COVERED | `sync-qr.spec.ts` (camera denied → manual works) | Fallback probado |

---

*Documento generado como parte del flujo SDD para el change `qr-sync-export`. Delta spec complementaria a `multi-device-blob-sync` (archivado 2026-09-11).*