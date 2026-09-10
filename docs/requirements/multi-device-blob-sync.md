# PRD: Sync Multi-dispositivo Local-First con Vercel Blob como Relay

## 1. Resumen Ejecutivo

### 1.1 Propósito
Convertir Saldo Cero en una app **local-first multi-dispositivo** donde el archivo SQLite `.db` **vive en el dispositivo** (navegador/teléfono) y se sincroniza entre dispositivos con **un clic** usando **Vercel Blob como relay** (no como fuente de verdad). El usuario opera 100% offline en el día a día; el sync es bajo demanda, con regla **last-write-wins por registro** y tombstones para propagar borrados.

Este PRD **reemplaza la decisión diferida** del change `sqlite-local` (D7: "sync multi-dispositivo deferred") y activa el camino que quedó apuntado en su sección 2.3: *"El archivo .db es portable, exportable, y sienta las bases para un sync futuro"*.

### 1.2 Change ID
`multi-device-blob-sync`

### 1.3 Estado
**Propuesto.** Sin implementar. Se apoya en `sqlite-local` (implementado: Server Actions + better-sqlite3, schema de 4 tablas). Introduce un pivote de capa de datos (server-side → client-side WASM) y una migración de modelo (tombstones + device_id).

---

## 2. Planteamiento del Problema

### 2.1 Estado Actual
- La app opera con **Server Actions + better-sqlite3** apuntando a `data/saldo-cero.db` en el filesystem del servidor (`lib/db/index.ts` + `app/actions/*`).
- Ese modelo **no sobrevive en Vercel**: el filesystem de las funciones serverless es **efímero** — los bytes de `.db` se pierden entre invocaciones.
- El README y el PRD `sqlite-local` asumen "el Mac del usuario"; no hay camino definido para teléfono/dispositivo.
- El usuario usa la app **~3 sesiones al día** en promedio, hoy en un solo dispositivo, con intención de **multi-dispositivo con sync manual**.

### 2.2 Pain Points
1. **El `.db` no sobrevive en Vercel**: cualquier despliegue serio pierde los datos (filesystem efímero).
2. **Datos atrapados en un dispositivo**: cambiar de móvil a desktop significa arrancar de cero o copiar el `.db` a mano.
3. **Sin forma de fusionar copias**: si dos dispositivos editan en paralelo y se copia el archivo, uno pisa al otro silenciosamente (sincronización zombie).
4. **Borrados no sincronizables**: el hard delete actual no deja rastro; un merge no puede "propagar una baja" sin colisiones.
5. **Privacidad con servidor central**: mover todo a un backend tipo Supabase/Turso centraliza datos personales financieros; el usuario quiere **privacidad por defecto** (filosofía del README).

### 2.3 Oportunidad
- **Vercel Blob** ya está en el stack (misma plataforma, mismo deploy): actúa como **caja de intercambio** — guarda un archivo `.db` por namespace, sin ser base de datos. A $0/mes para este volumen.
- **sql.js (WASM)** permite ejecutar SQLite **dentro del navegador** con el mismo `schema.sql` que ya existe — el código SQL no cambia.
- Con `updated_at` (ya presente en el schema) + tombstones se implementa un merge **last-write-wins** suficiente para volumen personal (decenas de transacciones/mes, 1 usuario, ~3 sesiones/día).
- El merge es determinista y testeable; no se necesita CRDT/OT para este caso de uso.

---

## 3. Historias de Usuario

### US-1: La app funciona local en el dispositivo, sin red
**Como** usuario de Saldo Cero
**Quiero** que la app lea y escriba mi SQLite **en el dispositivo** (navegador/teléfono)
**Para que** registrar gastos funcione siempre, incluso sin conexión, y sin depender del filesystem de Vercel

**Criterios de aceptación:**
- [ ] El motor de datos es SQLite ejecutándose en el cliente (WASM); el `.db` se persiste en el dispositivo (IndexedDB/OPFS).
- [ ] El flujo diario completo (setup, gastos, ingresos, transferencias, proyección) funciona sin llamadas de red.
- [ ] El `schema.sql` actual se reutiliza sin cambios de DDL (salvo la migración FR-5).
- [ ] Los datos del `data/saldo-cero.db` existente se pueden migrar al dispositivo (FR-4).

### US-2: Sync entre dispositivos con un clic
**Como** usuario con la app en dos dispositivos
**Quiero** un botón "Sincronizar" que baje, fusione y suba mi `.db`
**Para que** al cerrar el móvil y abrir el desktop encuentre mis últimos movimientos

**Criterios de aceptación:**
- [ ] Un clic en "Sincronizar" hace `pull → merge → push` contra el relay (Vercel Blob).
- [ ] Al terminar, el `.db` local y el del relay contienen el mismo estado fusionado.
- [ ] Un cambio hecho en el dispositivo A aparece en B tras sincronizar desde B.
- [ ] La UI muestra estado de sync (sincronizado / pendiente / última sync).

### US-3: Merge sin pérdida de datos
**Como** usuario que edita en dos dispositivos a deshoras
**Quiero** que al sincronizar no se pierda ningún movimiento
**Para que** los registros de ambos dispositivos sobrevivan al merge

**Criterios de aceptación:**
- [ ] El merge es **por registro**: las filas que solo existen en un lado se conservan en el resultado.
- [ ] Las filas que existen en ambos lados se resuelven con **last-write-wins** usando `updated_at`.
- [ ] Un borrado hecho en un dispositivo se propaga a los demás (tombstone) sin resucitar la fila.
- [ ] Antes de fusionar se crea un **backup local** del estado previo (restaurable desde la UI).

### US-4: Migración del `.db` existente
**Como** usuario con datos en el `data/saldo-cero.db` actual
**Quiero** conservar mi historial al pasar a local-first
**Para que** no pierda cuentas, movimientos ni configuración

**Criterios de aceptación:**
- [ ] El primer "push" sube el `.db` existente al relay (import manual guiado).
- [ ] Un dispositivo nuevo detecta que existe un snapshot en el relay y puede inicializarse desde él.
- [ ] La migración es idempotente: repetir sync no duplica filas.

### US-5: Privacidad por defecto
**Como** usuario que considera sus finanzas privadas
**Quiero** que el relay no sea un backend accesible públicamente
**Para que** mis datos financieros no queden expuestos

**Criterios de aceptación:**
- [ ] El endpoint de sync exige una credencial (código de sync + token) y el blob no es listable.
- [ ] Sin credencial, una petición al relay devuelve 401.
- [ ] El uso diario de la app no envía datos a ningún servidor (solo el sync explícito).

### US-6: No-regresión del flujo actual
**Como** usuario de la app
**Quiero** que el cambio a local-first y sync no rompa lo que ya uso
**Para que** la transición sea transparente

**Criterios de aceptación:**
- [ ] `pnpm test` + `pnpm tsc --noEmit` en verde.
- [ ] La UI se comporta idéntica; los cálculos derivados (`lib/cashflow.ts`) siguen funcionando.
- [ ] Las Server Actions de datos ya no son la única vía; la capa cliente expone la misma API.

---

## 4. Requerimientos Funcionales

### FR-1: Motor SQLite en el cliente
- **Paquete**: `sql.js` (SQLite compilado a WASM) — compatible con el `schema.sql` existente. Alternativa evaluada: `wa-sqlite` (más rápido, pero requiere headers COOP/COEP que complican el deploy en Vercel; se descarta para MVP).
- **Persistencia local**: el `.db` exportado se guarda como blob en **IndexedDB** (universal). En navegadores Chromium con soporte, adicionalmente **OPFS** como respaldo del archivo real. El lector de persistencia elige el mejor mecanismo disponible con fallback a IndexedDB.
- **`lib/db/client.ts`**: factory que carga el WASM (lazy, `dynamic import`), abre/crea la base, aplica `schema.sql`, y expone `exportDb()/importDb()`.

### FR-2: La capa de datos pasa al cliente (reemplazo de Server Actions)
- Las Server Actions de datos (`app/actions/budget.ts`, `transactions.ts`, `accounts.ts`, `recurring.ts`, `projection.ts`) dejan de ser la ruta principal de lectura/escritura.
- Se crea **`lib/db/repository.ts`** (cliente) con la misma API funcional: `loadState`, `addTransaction`, `removeTransaction`, `updateTransaction`, `addAccount`, `updateAccount`, `deleteAccount`, `transferFunds`, `updateConfig`, `toggleAutoSave`, `clearData`, `setupBudget`, CRUD de `recurring_events`, `computeProjection`.
- `hooks/use-budget.tsx` y los hooks relacionados consumen el repository cliente; la UI no cambia de contrato.
- La migración de `localStorage` (`lib/migrate-localstorage.ts`) se mantiene como utilidad de primera carga si un dispositivo hereda datos legacy.

### FR-3: Sync con un clic vía Vercel Blob
- **API Routes** en Next.js (server-side, mínimo privilegio):
  - `GET /api/sync` → descarga el snapshot `.db` del blob (si existe) y lo devuelve.
  - `POST /api/sync` → recibe el `.db` y lo sube al blob (versión `latest`).
  - `GET /api/sync/meta` → metadata del snapshot (`updated_at`, `size`, `hash`) para decidir si hay novedades.
- **Namespace**: el blob guarda `saldo-cero-<syncCode>.db`, donde `<syncCode>` es un código corto generado por el usuario (ej. `rojo-42`). El código se comparte entre sus propios dispositivos.
- **Auth**: el cliente envía `x-sync-code` + `x-sync-token` (token estático generado junto al código, guardado en el dispositivo). Sin credencial → 401. El token vive en el cliente; **nunca** en bundle público como `NEXT_PUBLIC_*` — se guarda en el dispositivo (localStorage del propio usuario) y se envía solo al endpoint.
- **Versionado (nice to have)**: snapshots históricos `saldo-cero-<syncCode>-<yyyyMMddHHmmss>.db` para restauración manual.
- **Concurrencia**: antes de `POST`, el cliente re-lee `meta`; si el snapshot remoto cambió desde su última lectura, **re-mergea** antes de sobrescribir (evita pisar cambios concurrentes).

### FR-4: Algoritmo de merge last-write-wins con tombstones
- **`lib/db/merge.ts`** — función pura `mergeDatabases(local: Database, remote: Database, deviceId: string): MergeResult`.
- Reglas por tabla (`accounts`, `transactions`, `recurring_events`):
  1. **Solo en remote** → insertar en local.
  2. **Solo en local** → conservar (se incluirá en el próximo push).
  3. **En ambos** → gana la fila con mayor `updated_at` (last-write-wins). Empate (mismo `updated_at`, ids distintos de dispositivo) → gana la de mayor `created_at`, luego lexicográfico del `device_id` (determinista).
  4. **Tombstone** (`deleted_at IS NOT NULL`) → la fila se marca borrada y **no aparece** en queries normales; el tombstone se propaga a ambos lados.
- **`budgets`** (singleton `id='default'`): last-write-wins por `updated_at`; no aplica tombstone (la fila siempre existe).
- **`sync_meta`** (tabla nueva, ver FR-5): guarda `last_sync_at`, `device_id`, `last_snapshot_hash` para diagnóstico y para detectar cambios concurrentes.
- `MergeResult` expone: filas insertadas/actualizadas/borradas, conflictos resueltos, y un `ok` booleano. **Antes de mutar** el local se crea un backup (snapshot del `.db` previo en IndexedDB, restaurable).
- **Post-condición**: local queda fusionado; el push sube el resultado fusionado; el blob queda idéntico al local.

### FR-5: Migración de modelo (OBLIGATORIA)
- **Nuevas columnas** (para soportar merge y tombstones):
  - `accounts.deleted_at TEXT NULL`
  - `transactions.deleted_at TEXT NULL`
  - `recurring_events.deleted_at TEXT NULL`
  - `accounts.device_id TEXT NULL`, `transactions.device_id TEXT NULL`, `recurring_events.device_id TEXT NULL` (traza de último escritor; fallback si falta en el merge)
  - **Tabla nueva** `sync_meta (id TEXT PK DEFAULT 'singleton', last_sync_at TEXT, device_id TEXT, last_snapshot_hash TEXT, updated_at TEXT)`
- **Ruta migración descriptiva**: `docs/migrations/2026-09-09-multi-device-blob-sync.md` (schema previo, schema nuevo, estrategia de datos, rollback).
- **Regla**: este change no está completo sin su migración descriptiva.

---

## 5. Requerimientos No Funcionales

### NFR-1: Privacidad y seguridad
- El relay nunca es de acceso público: credencial por endpoint (401 sin ella), blob no listable.
- Sin red en el uso diario: la app no contacta servidores salvo sync explícito.
- El `.db` viaja por HTTPS; no se loguean contraseñas ni contenido del `.db`.
- El token de sync no se expone como `NEXT_PUBLIC_*`; se guarda en el dispositivo y se envía solo al endpoint.

### NFR-2: Consistencia
- **Source of truth = el dispositivo** (local-first). El blob es un relay de intercambio, nunca autoridad.
- Estado derivado (`dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay`) sigue siendo calculado (`lib/cashflow.ts`), nunca persistido ni sincronizado — se deriva del mismo set de datos.
- Merge determinista, idempotente y testeable.

### NFR-3: Performance
- Uso diario: 100% local, sin latencia de red (sql.js en WASM es más lento que better-sqlite3 pero irrelevante para decenas de filas).
- WASM se carga lazy (no bloquea la primera pintura).
- El sync transfiere un archivo pequeño (< 1MB en la práctica); aceptable bajo demanda en ~3 sesiones/día.

### NFR-4: Robustez / no pérdida de datos
- Backup local pre-merge obligatorio; restauración desde la UI.
- El `POST` al blob no sobrescribe ciegamente: re-check de `meta` + re-merge si cambió.
- El merge nunca borra filas sin dejar tombstone.

### NFR-5: Testeabilidad y no-regresión
- Unit: `merge.ts` (casos: solo-local, solo-remote, ambos-lados, tombstone, empate de timestamps), persistence en IndexedDB (mock), repository cliente.
- Integración: API routes de sync (auth, meta, subida/descarga), migración de `.db` existente.
- E2E (Playwright): setup → operar → sync en dispositivo A → sync en B → convergencia.
- Suite existente intacta: `pnpm test` + `pnpm tsc --noEmit`.

---

## 6. Restricciones de Diseño Técnico

### 6.1 Stack
- Next.js 16 + App Router, React 19, TypeScript, pnpm (ya en el repo).
- `sql.js` (nuevo) — SQLite WASM para el cliente.
- Vercel Blob (`@vercel/blob` — nuevo) para el relay.
- `@vercel/blob` API desde API Routes; sin cambiar el deploy.
- `vitest` / `playwright` (ya en el repo).

### 6.2 Estructura de archivos propuesta
```
lib/db/
  client.ts        // sql.js factory: init, open/create, applySchema, export/import
  repository.ts    // API de datos cliente (reemplaza el uso directo de Server Actions)
  merge.ts         // mergeDatabases() puro + MergeResult
  persistence.ts   // IndexedDB + OPFS wrapper
  meta.ts          // lectura/escritura de sync_meta
  schema.sql       // + nuevas columnas y tabla sync_meta (migración FR-5)
app/api/sync/
  route.ts         // GET  → descarga snapshot del blob
  meta/route.ts    // GET  → metadata del snapshot
  (POST en route.ts o sync/route.ts con method switch)
components/sync/
  sync-button.tsx  // botón "Sincronizar" + indicador de estado
  sync-settings.tsx // generar/guardar código de sync + token, primer push
lib/merge-tests      // fixtures de dos bases para tests unitarios
```

### 6.3 Decisiones de diseño

| # | Decisión | Opción elegida | Alternativa | Rationale |
|---|----------|---------------|-------------|-----------|
| SD-1 | Motor SQLite | **sql.js (WASM) en cliente** | better-sqlite3 server-side (actual), wa-sqlite | El `.db` debe vivir en el dispositivo; mejor-sqlite3 no corre en browser; wa-sqlite exige COOP/COEP |
| SD-2 | Relay | **Vercel Blob** | Turso, Supabase Storage, VPS propio | Ya está en el stack; $0/mes para este volumen; sin infra extra; latencia irrelevante en sync bajo demanda |
| SD-3 | Persistencia local | **IndexedDB + OPFS (fallback)** | localStorage JSON, single OPFS | SQLite es binario; IndexedDB es universal; OPFS como refuerzo en Chromium |
| SD-4 | Estrategia de conflicto | **Last-write-wins por registro + tombstones** | CRDT/OT, cola de operaciones | Volumen personal (1 usuario, decenas de filas/mes); determinista y portable |
| SD-5 | Trigger de sync | **Manual con botón** | Realtime, automático por intervalo | El usuario pidió "un clic"; 3 sesiones/día no justifican realtime |
| SD-6 | Auth del relay | **Código de sync + token estático** | Login completo, RLS de Supabase | Mínima ceremonia; solo el usuario conoce su código; el token vive en su dispositivo |
| SD-7 | Borrado | **Soft delete (tombstone)** | Hard delete | Indispensable para propagar bajas entre dispositivos sin resucitar filas |
| SD-8 | budgets | **Singleton last-write-wins por updated_at** | Por-dispositivo con conflicto complejo | Una sola config de presupuesto; el más reciente gana |
| SD-9 | Source of truth | **El dispositivo** | El relay, un backend central | Filosofía local-first del README; privacidad por defecto |

### 6.4 Flujo de datos (sync)
```
Dispositivo A (cliente)
  sql.js (WASM) ──► IndexedDB/OPFS (.db local)
        │
        └── Botón "Sincronizar" ──► POST /api/sync (token+code) ──► Vercel Blob
                                                                    saldo-cero-<code>.db
Dispositivo B (cliente)
  Botón "Sincronizar" ──► GET /api/sync (token+code) ──► Blob
        │
        ▼
  mergeDatabases(local, remote) ──► backup local ──► aplicar merge ──► guardar local
        │
        └── POST /api/sync (resultado fusionado) ──► Blob (actualizado)
```

### 6.5 Detalle del merge (pseudo-código)
```
para cada tabla T en [accounts, transactions, recurring_events]:
  para cada fila r en remote[T]:
    si r.id no está en local[T] → insertar r (con device_id si falta)
    si r.id está en local[T]:
      si r.deleted_at y local.deleted_at → conservar la más reciente
      si solo r.deleted_at → marcar local borrada (tombstone remoto propaga)
      si solo local.deleted_at → conservar local (tombstone local propaga en push)
      si ambas vivas:
        ganador = max(updated_at)   # empate: max(created_at), luego device_id lexicográfico
        actualizar local con fila ganadora
budgets: fila ganadora por max(updated_at)
sync_meta: actualizar last_sync_at, device_id, last_snapshot_hash
```

---

## 7. Fuera de Alcance

| Ítem | Razón | Trabajo futuro |
|------|-------|----------------|
| CRDT / OT / fusiones semánticas avanzadas | Sobrepasa el need (1 usuario, volumen bajo) | Solo si hay multi-usuario/edición concurrente real |
| Sync automático / realtime | El usuario pidió sync manual con clic | Fase futura (intervalo o realtime) si el número de sesiones crece |
| Encriptación del `.db` en reposo | El OS protege el dispositivo; el tráfico HTTPS cubre el tránsito | Evaluación si se comparte el relay |
| Multi-usuario / multi-tenant | App personal por filosofía | No planificado |
| Backend central (Supabase/Turso/Néon) | Contradice local-first; relay Blob es suficiente | Solo si se necesitan features server-side |
| VPS propio para sync | Mantenimiento 24/7 desproporcionado para 3 sesiones/día | Permanecer en Blob |

---

## 8. Criterios de Aceptación

### Must Have
- [ ] SQLite en el cliente (sql.js): `.db` persiste en IndexedDB/OPFS; flujo diario funciona offline.
- [ ] API Routes de sync (`GET/POST /api/sync`, `GET /api/sync/meta`) con auth (401 sin credencial).
- [ ] Botón "Sincronizar" en la UI: pull → merge → push; estado visible (sincronizado/pendiente/última sync).
- [ ] Merge last-write-wins por registro con tombstones; backup local pre-merge; `MergeResult` reportado.
- [ ] Migración de modelo aplicada (columnas `deleted_at`/`device_id` + tabla `sync_meta`).
- [ ] Migración de datos existente: el `data/saldo-cero.db` actual puede convertirse en primer snapshot del relay.
- [ ] `docs/migrations/2026-09-09-multi-device-blob-sync.md` creado (OBLIGATORIO).
- [ ] `pnpm test` + `pnpm tsc --noEmit` en verde.

### Should Have
- [ ] Import guiado del `.db` existente (primer push con confirmación).
- [ ] Restauración de backup local desde la UI.
- [ ] Snapshots históricos versionados en el blob (restauración manual).
- [ ] Indicador de conflictos resueltos (cuántas filas se fusionaron).

### Nice to Have
- [ ] Cifrado del `.db` antes del push al blob (password del usuario).
- [ ] Sync automático al volver a la pestaña (`visibilitychange`) si el usuario lo pide.
- [ ] Export/import manual de archivo `.db` (alternativa sin relay).

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Pérdida de datos en merge | Media | Crítico | Backup local pre-merge + restauración desde UI; merge determinista testeado; nunca borrar sin tombstone |
| Sobrescribir snapshot concurrente en el blob | Media | Alta | Re-check de `meta` antes de `POST`; re-merge si el remoto cambió; hash de snapshot |
| Blob expuesto (privacidad) | Baja | Crítica | Endpoint autenticado; blob no listable; token nunca en bundle público; 401 sin credencial |
| sql.js pesado / lento en móviles | Media | Media | WASM lazy-load; volumen de datos pequeño; medición en e2e |
| OPFS no disponible en Safari/Firefox | Media | Baja | Fallback a IndexedDB universal |
| Migración del `.db` existente duplica datos | Media | Media | Primer push guiado con confirmación; idempotencia por hash/`sync_meta`; test de migración |
| Regresión del flujo diario al cambiar de capa | Alta | Alta | Repository cliente con misma API; suite existente; fase de verificación dedicada |
| Transacciones con `updated_at` iguales en ambos lados (empate) | Baja | Baja | Desempate determinista: `created_at`, luego `device_id` lexicográfico |

---

## 10. Plan de Rollback

1. Revertir `hooks/use-budget.tsx` y hooks al consumo de Server Actions (capa server-side previa).
2. Eliminar `lib/db/client.ts`, `lib/db/repository.ts`, `lib/db/merge.ts`, `lib/db/persistence.ts`, `lib/db/meta.ts`.
3. Eliminar `app/api/sync/` y `components/sync/`.
4. Revertir `lib/db/schema.sql` (quitar columnas `deleted_at`/`device_id` y tabla `sync_meta`).
5. Desinstalar `sql.js` y `@vercel/blob`; restaurar `better-sqlite3` como única capa (si es necesario volver al estado `sqlite-local`).
6. Eliminar cualquier blob/namespace creado en Vercel Blob.
7. Correr suite completa. La app vuelve a operar sobre `data/saldo-cero.db` (comportamiento `sqlite-local`).

---

## 11. Dependencias

| Dependencia | Fuente | Propósito |
|-------------|--------|-----------|
| `sql.js` | npm (nueva) | SQLite WASM para el cliente |
| `@vercel/blob` | npm (nueva) | Relay de snapshots `.db` |
| `lib/db/schema.sql` + `lib/db/index.ts` | Repo actual | Base a adaptar (server → client) |
| `app/actions/*` | Repo actual | API a replicar en `lib/db/repository.ts` |
| `lib/cashflow.ts` | Repo actual | Campos derivados (inalterado) |
| `hooks/use-budget.tsx` | Repo actual | Hook a adaptar al repository cliente |
| `docs/migrations/*.md` | Regla interna del repo | Migración descriptiva obligatoria (FR-5) |
| Vitest / Playwright | `package.json` | Unit e integración e2e |
| Vercel Blob (cuenta) | Plataforma | Requiere habilitar Blob en el proyecto (Hobby es suficiente) |

---

## 12. Métricas de Éxito

| Métrica | Objetivo | Medición |
|---------|----------|----------|
| Uso diario offline | 100% de operaciones sin red | Test e2e con network blocked |
| Convergencia entre dispositivos | A y B idénticos tras sync | E2E: operar en A, sync en B, comparar estado |
| Pérdida de datos | 0 filas perdidas en merge | Suite de tests de `merge.ts` con fixtures de divergencia |
| Privacidad del relay | 401 sin credencial | Test de integración de API routes |
| Regresión | 100% pass | `pnpm test` + `pnpm tsc --noEmit` |
| Costo | $0/mes en Hobby (Blob) | Facturación Vercel |
| Carga inicial percibida | < 1s | DevTools / percepción (WASM lazy) |

---

## 13. Fases de Implementación

| Fase | Entregables | Esfuerzo est. |
|------|-------------|---------------|
| **1. Capa cliente SQLite** | `lib/db/client.ts`, `persistence.ts`; `sql.js` instalado; `schema.sql` adaptado a la migración | 1.5 días |
| **2. Repository cliente + adaptación de hooks** | `lib/db/repository.ts` (misma API de Server Actions); `use-budget` y hooks apuntando al repository | 1.5 días |
| **3. Merge + tombstones** | `lib/db/merge.ts` + fixtures; columnas `deleted_at`/`device_id`; tabla `sync_meta`; backup pre-merge | 1 día |
| **4. Relay + API + UI** | API Routes (`/api/sync`, `/api/sync/meta`); `@vercel/blob`; botón "Sincronizar"; settings del código/token; primer push guiado | 1 día |
| **5. Migración existente + tests + verificación** | Import del `data/saldo-cero.db`; tests unit/integración/e2e; migración descriptiva; no-regresión | 1-2 días |

**Total estimado: ~6 días**

---

## 14. Documentos Relacionados

- **PRD actual (supersede decisión D7)**: `docs/requirements/sqlite-local.md` — el `.db` portable que este PRD conecta al relay
- **PRD previo (archivado)**: `docs/archive/multi-device-sync.md` — intento Supabase centralizado, descartado por esta dirección local-first
- **Migración SQLite local**: `docs/migrations/2026-08-31-sqlite-local.md`
- **Migración descriptiva de este change**: `docs/migrations/2026-09-09-multi-device-blob-sync.md` (OBLIGATORIO)
- **Modelo actual**: `types/index.ts`, `hooks/use-budget.tsx`, `lib/db/schema.sql`
- **Utilidad de cálculo**: `lib/cashflow.ts`, `docs/cashflow.md`

---

## 15. Aprobación

| Rol | Nombre | Estado | Fecha |
|-----|--------|--------|-------|
| Product Owner | — | Pendiente | — |
| Tech Lead | — | Pendiente | — |
| QA Lead | — | Pendiente | — |

---

*Documento generado como parte del flujo SDD para el change `multi-device-blob-sync`. Pivote: Server Actions + better-sqlite3 (server) → sql.js (dispositivo) + Vercel Blob (relay).*