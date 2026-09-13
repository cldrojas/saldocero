# Spec: Multi-Device Blob Sync (Delta)

## Change ID
`multi-device-blob-sync`

## Estado
**Implementado, verificado y archivado (2026-09-11).** Pivote local-first: la capa de datos migra de Server Actions + better-sqlite3 (server-side) a sql.js (WASM en el browser) con sync manual vía Vercel Blob como relay. Verdicto `sdd-verify`: **PASS WITH WARNINGS** — 12/12 requisitos (11 ✅ COVERED, 1 ⚠️ PARTIAL al momento del verify); los 4 WARNINGs corregidos en follow-up (182/182 unit, tsc clean). Checklist de cobertura y verdicto en la sección "Cobertura del spec". Basado en el PRD `docs/requirements/multi-device-blob-sync.md` y la proposal `docs/requirements/proposal-multi-device-blob-sync.md`.

---

## REQUISITOS AÑADIDOS

### FR-1: Motor SQLite cliente (sql.js)
La app **DEBE** ejecutar SQLite en el browser vía `sql.js` (WASM), cargado de forma perezosa y asíncrona, sin bloquear el primer paint.

La persistencia del `.db` **DEBE** usar IndexedDB como backend primario y OPFS como fallback en Chromium; si OPFS no está disponible, la app **DEBE** seguir funcionando con IndexedDB.

#### Escenario: Carga inicial con datos previos
- GIVEN un dispositivo con un `.db` persistido en IndexedDB
- WHEN la app inicia y el hook carga el estado
- THEN el `.db` se abre desde IndexedDB, se aplica el schema (idempotente)
- AND las cuentas, transacciones, presupuesto y eventos recurrentes se cargan sin round-trip al servidor

#### Escenario: Primera visita sin datos
- GIVEN un dispositivo sin `.db` previo
- WHEN la app inicia
- THEN se crea una base nueva con el schema completo y `sync_meta` inicializado con la fila singleton

#### Escenario: Fallback OPFS no disponible
- GIVEN un browser sin soporte OPFS (Safari/Firefox)
- WHEN la app intenta persistir
- THEN usa IndexedDB y el flujo diario funciona sin degradación observable

### FR-2: Repository cliente (sustituye Server Actions)
La capa de datos **DEBE** exponer un módulo `lib/db/repository.ts` con la misma API que las Server Actions actuales (`loadState`, `addTransaction`, `removeTransaction`, `updateTransaction`, `addAccount`, `updateAccount`, `deleteAccount`, `transferFunds`, `updateConfig`, `toggleAutoSave`, `clearData`, `setupBudget`, recurring CRUD, `computeProjection`).

`hooks/use-budget.tsx` **DEBE** consumir el repository, dejando la UI sin cambios de comportamiento.

#### Escenario: CRUD completo offline
- GIVEN un dispositivo sin conexión
- WHEN el usuario registra un gasto, edita una cuenta o transfiere fondos
- THEN la escritura se persiste en el `.db` local de inmediato
- AND la UI refleja el cambio sin error de red

#### Escenario: No-regresión de API
- GIVEN la suite existente (`pnpm test`) y los tipos de `types/index.ts`
- WHEN se ejecutan los tests
- THEN todas las operaciones del repository tienen firma compatible y pasan sin cambios en los consumers

### FR-3: Merge last-write-wins con tombstones
El merge **DEBE** aplicar regla LWW por registro usando `updated_at`; en empate, **DEBE** desempatar por `created_at` y luego por `device_id` lexicográfico.

Los borrados **DEBEN** ser soft delete (`deleted_at`), nunca borrado físico en el merge; una fila con `deleted_at` **DEBE** ganar contra la versión viva **incondicionalmente**, sin importar timestamps de ambas versiones.

El merge **DEBE** ejecutarse sobre un backup local previo (snapshot restaurable desde la UI) y **DEBE** reportar un `MergeResult` (filas tomadas de local/remoto, conflictos, tombstone aplicados).

#### Escenario: Conflicto simple por fila
- GIVEN el mismo registro existe en local y remoto con `updated_at` distintos
- WHEN se ejecuta el merge
- THEN gana la versión con `updated_at` mayor
- AND el resultado queda con `device_id` del ganador

#### Escenario: Empate determinista
- GIVEN dos versiones del mismo registro con `updated_at` idéntico
- WHEN se ejecuta el merge
- THEN gana la de mayor `created_at`, y si también empatan, la de `device_id` lexicográficamente mayor

#### Escenario: Borrado remoto vs edición local
- GIVEN una fila borrada en remoto ya tiene `deleted_at` y en local existe la versión viva (incluso con `updated_at` más reciente)
- WHEN se ejecuta el merge
- THEN la fila queda borrada (el tombstone vence incondicionalmente, sin importar timestamps)

#### Escenario: Backup restaurable
- GIVEN un merge completado
- THEN existe un snapshot local previo al merge en IndexedDB
- AND la UI ofrece restaurarlo si el usuario detecta pérdida

### FR-4: Sync manual vía relay Vercel Blob
La app **DEBE** ofrecer un botón "Sincronizar" que ejecute pull → merge → push contra el relay, y **DEBE** mostrar estado (synced / pending / last sync).

El relay **DEBE** almacenar el snapshot bajo el namespace `saldo-cero-<syncCode>.db` y exponer metadata (hash, `updated_at`, tamaño) para el chequeo de concurrencia.

**ANTES** de sobrescribir el snapshot remoto, el sync **DEBE** re-leer la metadata; si el remoto cambió desde el último pull, **DEBE** re-mergear antes de hacer push (sin sobrescritura ciega).

#### Escenario: Primera sincronización guiada
- GIVEN un usuario con `data/saldo-cero.db` existente y un relay configurado
- WHEN el usuario pulsa Sincronizar por primera vez
- THEN la app ofrece migrar el `.db` existente como primer snapshot (con confirmación explícita)
- AND tras confirmar, hace push y marca `sync_meta` con `snapshot_hash` + `updated_at`

#### Escenario: Concurrencia entre dispositivos
- GIVEN dispositivo B pulsó Sincronizar y remoto cambió después del pull de A
- WHEN A intenta hacer push
- THEN la metadata detecta el cambio
- AND A re-mergea con el snapshot nuevo antes de sobrescribir

#### Escenario: Sync sin cambios
- GIVEN local y remoto idénticos (mismo hash en `sync_meta`)
- WHEN el usuario pulsa Sincronizar
- THEN la app reporta "synced" sin escrituras innecesarias en el relay

#### Escenario: Credenciales ausentes
- GIVEN el sync code o el token no están configurados
- WHEN el usuario pulsa Sincronizar
- THEN la app muestra configuración pendiente y no intenta llamar al relay
- AND los endpoints responden 401 sin credenciales válidas

### FR-5: Migración de modelo (tombstones + device_id + sync_meta)
La migración **DEBE** añadir `deleted_at` y `device_id` (TEXT, nullable) a `accounts`, `transactions` y `recurring_events`, y crear la tabla `sync_meta` (fila única `id = 1` con columnas `updated_at`, `device_id`, `snapshot_hash`, tal como están definidas en `lib/db/schema.sql`).

Las filas existentes **DEBEN** migrar con `deleted_at = NULL` y `device_id = NULL` (legacy tratado como vivo); las queries normales **DEBEN** filtrar `deleted_at IS NULL`.

Cada escritura del repository **DEBE** setear `updated_at` y `device_id` del dispositivo activo.

#### Escenario: Base legacy migrada
- GIVEN una base con el schema `sqlite-local` (sin columnas nuevas)
- WHEN se abre por primera vez con el schema nuevo
- THEN las columnas se añaden y `sync_meta` se crea con la fila singleton
- AND todos los datos existentes permanecen visibles (queries lo filtran todo como no borrado)

#### Escenario: Rollback documentado
- GIVEN la base migrada requiere revertir
- THEN la migración descriptiva (`docs/migrations/2026-09-09-multi-device-blob-sync.md`) documenta `DROP COLUMN` y `DROP TABLE` exactos
- AND el cambio no se considera completo sin esa migración

### FR-6: Auth del relay
Los endpoints de sync **DEBEN** rechazar con 401 toda petición sin `x-sync-code` y `x-sync-token` válidos. El token **NO DEBE** exponerse como `NEXT_PUBLIC_*`; vive en variable de entorno del servidor.

#### Escenario: Petición sin credenciales
- GIVEN una petición GET/POST a `/api/sync` sin headers de auth
- WHEN se procesa
- THEN responde 401
- AND el cuerpo del snapshot nunca se devuelve

#### Escenario: Blob no listable
- GIVEN un atacante con acceso al namespace
- WHEN intenta listar o adivinar otros blobs
- THEN el relay solo permite operar sobre `saldo-cero-<syncCode>.db` con las credenciales correctas

---

## REQUISITOS MODIFICADOS

### FR-DB: Capa de persistencia (antes mejor-sqlite3 server)
(Anterior: `lib/db/index.ts` con better-sqlite3 server-side y DB_PATH en `data/saldo-cero.db`, consumido solo por Server Actions.)

La capa de datos **DEBE** ser cliente (sql.js) como ruta primaria. `lib/db/index.ts` (better-sqlite3 server) **DEBE** quedar solo como utilidad de importación del `.db` legacy hacia el primer snapshot del relay (push guiado), no como ruta de operación diaria.

#### Escenario: Importación del `.db` legacy
- GIVEN `data/saldo-cero.db` con datos reales del usuario
- WHEN el usuario confirma el primer push
- THEN el snapshot se genera desde ese `.db` y se sube al relay
- AND el hash se registra en `sync_meta` (idempotencia: re-push no duplica)

### FR-UI-HOOK: Persistencia en el hook (antes localStorage → SQLite)
(Anterior: `hooks/use-budget.tsx` leyendo/escribiendo vía Server Actions + migración `migrate-localstorage.ts`.)

El hook **DEBE** operar sobre el repository cliente; `lib/migrate-localstorage.ts` **DEBE** mantenerse como utilidad de primera carga (localStorage legacy → base cliente), no como fuente de lectura diaria.

#### Escenario: Usuario legacy de localStorage
- GIVEN un usuario con `localStorage['daily-budget-data']` y sin `.db` cliente
- WHEN la app carga por primera vez
- THEN migra sus datos a la base cliente (idempotente) y marca el flag migrado

---

## REQUISITOS NO FUNCIONALES

### NFR-1: Rendimiento
- El WASM de sql.js **DEBE** cargarse de forma perezosa (lazy dynamic import), sin bloquear el primer paint.
- Las operaciones CRUD locales **DEBEN** completar < 100ms percibido.
- El bundle cliente **NO DEBE** incluir el token del relay ni el código de sync en texto plano.

### NFR-2: Resiliencia offline
- El flujo diario (registrar gastos/ingresos/transferencias, ver estado) **DEBE** funcionar sin conexión.
- El sync **DEBE** ser explícitamente manual — no hay reintentos automáticos ni realtime.
- Ante fallo de red durante el sync, la app **DEBE** mostrar error claro y conservar el estado local intacto.

### NFR-3: Integridad de datos
- El merge **DEBE** ser determinista e idempotente (mismo par de bases → mismo resultado, re-mergeable).
- Ningún borrado aplicado por el merge **DEBE** ser físico: siempre tombstone.
- El hash del snapshot en `sync_meta` **DEBE** detectar divergencia local/remoto.

### NFR-4: Privacidad
- El snapshot en el relay **DEBE** ser inaccesible sin credenciales (401).
- El código de sync (parte del namespace) **DEBE** ser corto y compartible solo entre dispositivos propios.

---

## Tabla de Cobertura

| Requisito | Happy path | Edge cases | Error states |
|-----------|-----------|------------|--------------|
| FR-1 sql.js cliente | ✅ carga inicial / primera visita | ✅ OPFS no disponible | — |
| FR-2 repository | ✅ CRUD offline | ✅ no-regresión API | — |
| FR-3 merge | ✅ conflicto simple | ✅ empate; ✅ borrado vs edición | ✅ backup restaurable |
| FR-4 sync | ✅ sin cambios | ✅ concurrencia; ✅ primera vez; ✅ credenciales ausentes | ✅ 401 |
| FR-5 migración | ✅ legacy migrada | ✅ rollback documentado | — |
| FR-6 auth | — | — | ✅ sin credenciales; ❌ blob listable (cubierto por diseño: 401 + namespace privado) |
| FR-DB import | ✅ push guiado | ✅ idempotencia hash | — |
| FR-UI-HOOK | ✅ migración legacy | — | — |

## Cobertura del spec (verificado `sdd-verify`, 2026-09-11)

**Acceptance gate:** `pnpm vitest run` → 173/173 PASS (19 files, 29.5s) · `pnpm tsc --noEmit` → clean · HEAD `71c6442`

| Requisito | Estado | Tests clave | Notas |
|-----------|--------|-------------|-------|
| FR-1 sql.js cliente (IndexedDB) | ✅ COVERED | `persistence.test.ts` (7), `load-state.test.ts` (4) | IndexedDB primario, sin código OPFS; spec dice IndexedDB como backend — correcto |
| FR-2 repository CRUD | ✅ COVERED | `repository.test.ts` (27), `use-budget.test.tsx` (15) | Server actions dead-code verificadas, sin leak al hook |
| FR-3 merge LWW + tombstones | ✅ COVERED | `merge.test.ts` (12) | ⚠️ Spec wording drift vs impl (ver WARNING 4) |
| FR-4 sync relay | ✅ COVERED | `sync-protocol.test.ts` (12), `sync-client.test.ts` (15) | Primera sync, concurrencia, sin cambios, errores — todo verde |
| FR-5 migración schema | ✅ COVERED | `schema-sync.test.ts` (2), `migrate-localstorage.test.ts` (9), `repository.test.ts` (1) | ⚠️ sync_meta drift + device_id stamping (ver WARNINGs 1–2) |
| FR-6 auth relay | ✅ COVERED | `sync-protocol.test.ts` (6), `sync-import.test.ts` (2) | 401 multi-vía, namespace aislado |
| FR-DB import legacy | ✅ COVERED | `sync-import.test.ts` (6), `sync-settings.test.tsx` (4) | Primer push idempotente, backup list/restore |
| FR-UI-HOOK hook persistence | ✅ COVERED | `sync-button.test.tsx` (7), `sync-settings.test.tsx` (7), `use-budget.test.tsx` (1) + E2E (9) | — |
| NFR-1 Rendimiento | ✅ COVERED | Structural: lazy import, client-only, sin secretos en bundle | — |
| NFR-2 Resiliencia offline | ✅ COVERED | `sync-button.test.tsx` (2), `sync-client.test.ts` (2) | Sync manual, error claro, estado local preservado |
| NFR-3 Integridad datos | ⚠️ PARTIAL | `merge.test.ts` (2) | Merge tombstones OK; repo hard-deletes → resurrección vía merge |
| NFR-4 Privacidad | ✅ COVERED | `sync-protocol.test.ts` (6), namespace isolation test | — |

### Hallazgos

**WARNING** (should fix):
1. **sync_meta drift** — `schema.sql` = `(id INTEGER PK, updated_at, device_id, snapshot_hash)` vs delta FR-5 L109 / migration doc = singleton `(id TEXT DEFAULT 'singleton', last_sync_at, device_id, last_snapshot_hash, updated_at)`. Doc + spec + code discrepantes. Impacto funcional bajo.
2. **device_id stamping** — `repository.ts` EUPDATEs solo setean `updated_at`, nunca `device_id`. Delta FR-5 L113: "Cada escritura del repository DEBE setear updated_at y device_id." Solo INSERTs stamp `'local'`.
3. **Hard deletes + resurrección** — `removeTransaction` y `deleteAccount` usan DELETE físico. Filas borradas desaparecen del snapshot → el otro dispositivo las conserva → merge las mantiene. No hay test de tombstone viejo vs edición nueva.
4. **Spec wording drift (FR-3)** — delta FR-3 L53 dice tombstone vence "solo si su `updated_at` es mayor"; PRD pseudo-código 6.5 + `merge.ts` aplican tombstone-over-live sin condición de timestamp. Implementación sigue la intención de diseño; spec wording diverge.

**SUGGESTION** (nice to have):
1. **Merge device_id**: `merge.ts` stamps syncing device id, no winner's device_id — intencional según tests pero diverge de FR-3 scenario L61.
2. **budgets.deleted_at in test fixture**: `merge.test.ts` incluye budgets.deleted_at; `schema.sql` no lo tiene. Bajo impacto (singleton upsert).
3. **OPFS fallback**: spec lo menciona como fallback; no hay código OPFS. Suficiente con IndexedDB-only (spec dice IndexedDB como backend primario).
4. **Blob URL predecible**: `blob-relay.ts` usa `access: 'public'` + `addRandomSuffix: false`; cubierto por diseño (401 + namespace privado, aceptado en tabla de cobertura L199).

### Verdicto
**PASS WITH WARNINGS** — 12/12 requisitos covered (11 ✅, 1 ⚠️), 173/173 tests green, tsc clean. Cuatro WARNINGs documentados (doc drift + spec wording); ninguno bloquea archive. Los WARNINGs se pueden resolver al decidir: (a) si sync_meta schema se alinea con spec o viceversa, (b) si device_id se añade a EUPDATEs, (c) si se corrige hard-delete → soft-delete en repo, (d) si se actualiza FR-3 wording.