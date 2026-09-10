# Spec: Multi-Device Blob Sync (Delta)

## Change ID
`multi-device-blob-sync`

## Estado
**En especificación.** Pivote local-first: la capa de datos migra de Server Actions + better-sqlite3 (server-side) a sql.js (WASM en el browser) con sync manual vía Vercel Blob como relay. Basado en el PRD `docs/requirements/multi-device-blob-sync.md` y la proposal `docs/requirements/proposal-multi-device-blob-sync.md`.

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

Los borrados **DEBEN** ser soft delete (`deleted_at`), nunca borrado físico en el merge; una fila con `deleted_at` **DEBE** ganar contra la versión viva solo si su `updated_at` es mayor.

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
- GIVEN una fila borrada en remoto (`deleted_at` reciente) y editada en local (`updated_at` menor)
- WHEN se ejecuta el merge
- THEN la fila queda borrada (tombstone con `updated_at` mayor vence)

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
- AND tras confirmar, hace push y marca `sync_meta` con hash + `last_sync_at`

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
La migración **DEBE** añadir `deleted_at` y `device_id` (TEXT, nullable) a `accounts`, `transactions` y `recurring_events`, y crear la tabla `sync_meta` (singleton con `last_sync_at`, `device_id`, `last_snapshot_hash`, `updated_at`).

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

## Siguiente paso
Listo para **design** (`sdd-design`). Si el design ya existe, listo para **tasks** (`sdd-tasks`).