# Migración descriptiva: Offline-First UI

**Change ID**: `offline-first-ui`
**Fecha**: 2026-09-12
PRD: `docs/requirements/offline-first-ui.md`
Design: `docs/design/offline-first-ui-design.md` (sedes: `docs/design/qr-sync-simplify-design.md`, `docs/design/sqlite-local-design.md`)

---

## Resumen

La UI pivota a **offline-first de verdad**: el snapshot sql.js (`export()` → bytes) se vuelve la **única fuente de verdad** y se **autoguarda** a IndexedDB tras cada mutación (debounce 300 ms + flush inmediato en day-rollover/`clearData`/`pagehide`). Se elimina por completo el stack server muerto (`app/actions/*`, `lib/db/better-sqlite3`, `lib/sync-client` QR → `applyQrImport`, `data/saldo-cero.db`) y se introduce el primer mecanismo de **upgrade de schema client-side** (`PRAGMA user_version` + upgrade path idempotente en `initDb`) para que snapshots viejos dejen de crashear `loadState` en silencio. **Ningún dato de usuario se destruye**: los datos viven en IndexedDB; el `server.db` era un espejo descartable.

---

## Schema previo

### A. Server (`better-sqlite3`, `data/saldo-cero.db`)

Acedido vía `lib/db/index.ts` (`getDb()`) y `app/actions/*`. Abre la DB y aplica `lib/db/schema.sql` (`CREATE TABLE IF NOT EXISTS`) — **idempotente pero sin versionado**: no hay `PRAGMA user_version`, no hay camino de upgrade, el DDL es el que esté en disco al momento de crear la DB.

Tablas presentes (si la DB se creó con el `schema.sql` vigente): `accounts`, `transactions`, `budgets`, `recurring_events`, `sync_meta`, más índices.

**Limitaciones que motivan el cambio:**
- Sin `user_version` ni upgrade path: una DB creada con un `schema.sql` más antiguo (sin `recurring_events`/`sync_meta`, sin `deleted_at`/`deleted_at`, sin `device_id`) **no se actualiza** nunca.
- `PRAGMA foreign_keys` **OFF** por defecto en better-sqlite3 conexiones nuevas que no lo setean explícitamente (el código actual nº lo hace de forma garantizada).
- **Muerto para la UI**: `hooks/use-budget-commits.ts` y `hooks/use-budget.tsx` ya leen exclusivamente del snapshot sql.js client-side; `app/actions/*` son Server Actions que la UI ya no invoca.
- En Vercel (serverless) la DB no puede abrirse: `ENOENT: mkdir '/var/task/data'`.

### B. Client (sql.js + IndexedDB)

`lib/db/client.ts` (`initDb`, `getDb`) abre un snapshot con `new SQL.Database(data)` **sin aplicar schema** (`if (!data) db.exec(SCHEMA)`), y `loadFromIndexedDB`/`saveToIndexedDB` guardan el snapshot bajo `saldo-cero-db/snapshots/last`.

**Problemas del shape previo:**
- **Snapshots viejos embeben su propio DDL**: un snapshot guardado con un `SCHEMA` anterior (sin `recurring_events`/`sync_meta`, sin columnas `deleted_at`/`device_id`) se reabre tal cual → `loadState`/`setMeta` crashean por columnas/tablas faltantes (UI en blanco).
- **`user_version` nunca se manejó** → no hay upgrade path; es snapshot-shaped, no version-shaped.
- `foreign_keys` desactivado (sql.js lo trae OFF; solo se setea si `SCHEMA` lo declara, y no lo hace por conexión).

---

## Schema nuevo

**Un solo modelo**: el snapshot sql.js client-side es la única fuente de verdad; `lib/db/schema.ts` es el shape canónico (misma DDL que `lib/db/schema.sql`).

### Schema canónico (5 tablas, `lib/db/schema.ts`)

```sql
accounts(id TEXT PK, name, type CHECK IN ('daily','savings','investment','custom'),
  icon DEFAULT 'wallet', hidden DEFAULT 0, created_at, updated_at, deleted_at, device_id)
transactions(id TEXT PK, type CHECK IN ('expense','transfer','income','adjustment'), amount,
  description, account_id → accounts.id, date, created_at, updated_at, deleted_at, device_id)
budgets(id TEXT PK DEFAULT 'default', start_amount, start_date, end_date, auto_save,
  mode CHECK IN ('daily','track'), is_setup, updated_at, device_id)  -- + deleted_at si aplica
recurring_events(id TEXT PK, description, type CHECK IN ('income','expense'), amount,
  frequency, day_of_month, day_of_week, start_date, end_date, active, created_at,
  updated_at, deleted_at, device_id)
sync_meta(id INTEGER PK, updated_at, device_id, snapshot_hash)
```

**`PRAGMA user_version = 2`** — marcador de shape. Cualquier snapshot con `user_version < 2` entra al upgrade path.

### Upgrade path en `initDb` (idempotente, `lib/db/client.ts`)

```ts
export async function initDb(data?: Uint8Array): Promise<Database> {
  const SQL = await getSql()
  let db = data ? new SQL.Database(data) : new SQL.Database()
  // 1. Aplicar DDL solo si la DB está vacía (sin snapshot)
  if (!data) db.exec(SCHEMA)
  // 2. Upgrade idempotente: lleva snapshots viejos a v2
  applySchemaUpgrade(db, data)   // nuevo
  return db
}

function applySchemaUpgrade(db: Database, hadSnapshot: boolean): void {
  if (hadSnapshot) {
    // a. user_version < 2 → aplicar upgrade de schema (guarded)
    const version = (db.exec("PRAGMA user_version")[0]?.values?.[0]?.[0]) as number ?? 0
    if (version < 2) {
      upgradeFromLegacyShape(db)   // guarded DDL, ver abajo
    }
  }
  // b. PRAGMA foreign_keys = ON (por conexión; sql.js lo trae OFF)
  db.exec("PRAGMA foreign_keys = ON")
  // c. Sellado de versión
  if (version !== 2) db.exec("PRAGMA user_version = 2")
}
```

**`upgradeFromLegacyShape`** — DDL guarded e idempotente (nunca crashea si una columna/tabla ya existe):

```sql
-- Tablas faltantes en snapshots viejos
CREATE TABLE IF NOT EXISTS recurring_events (...)   -- DDL canónico
CREATE TABLE IF NOT EXISTS sync_meta (...)          -- DDL canónico

-- Columnas faltantes (guard por columna vía PRAGMA table_info)
-- accounts:    deleted_at, device_id
-- transactions: deleted_at, device_id
-- budgets:     deleted_at, device_id
-- recurring_events: deleted_at, device_id
ALTER TABLE <tabla> ADD COLUMN deleted_at TEXT DEFAULT NULL;   -- solo si no existe
ALTER TABLE <tabla> ADD COLUMN device_id  TEXT DEFAULT NULL;   -- solo si no existe
```

**Invariante**: `initDb` es **idempotente** — correrlo 2× sobre el mismo snapshot produce el mismo schema, `user_version = 2`, y no re-ejecuta `ALTER`s ya aplicados ni `CHECK`-crashea. Las bases nuevas se crean ya en v2 (el `CREATE TABLE IF NOT EXISTS` con el DDL canónico es un no-op para ellas).

---

## Estrategia de datos

**Antes → Después** (sin pérdida de datos de usuario):

| Origen | Antes | Después |
|--------|-------|---------|
| `localStorage['daily-budget-data']` (legacy pre-Batch) | Migra a sql.js vía `initDb` al boot (`lib/migrate-localstorage.ts`) | **Sin cambios** — el path legacy se conserva tal cual (una vez por dispositivo) |
| Snapshot IndexedDB (Batch 4/5 — shape v1) | Se reabre tal cual → crasheos si las columnas `deleted_at`/`device_id`/`recurring_events`/`sync_meta` no existen | `initDb` aplica `upgradeFromLegacyShape` (guarded ALTERs + `CREATE IF NOT EXISTS`) → snapshot usable, `user_version = 2` |
| Snapshot IndexedDB (esta rama — ya shape v2) | `user_version = 0`, pero con todas las columnas/tablas | `user_version` absent → upgrade es **no-op** (DDL guarded no toca nada existente) → sella `user_version = 2` |
| Mutaciones regulares (addTransaction, setup, transfer, edit) | **Solo en memoria** — IndexedDB jamás se actualizaba → tras reload se restaura el snapshot viejo | `use-budget-commits` → `autosave.schedule()` (debounce 300 ms) → `exportDb → saveToIndexedDB` |
| Day-rollover (`lastCheckedDay` cambia) y `clearData` | Aplican en memoria + `localStorage` en el mejor caso | `autosave.flushNow()` → persistencia **inmediata** (sin ventana de pérdida) |
| `restoreBackup` (snapshot completo) | No-op: descarga bytes, los descarta, muestra toast de éxito falso | → `initDb(bytes) → setDb → saveToIndexedDB` → reload (fix D1) |
| `server.db` (better-sqlite3, espejo) | Espejo redundante, nunca fuente | **Retirado** — los datos del usuario viven en IndexedDB; el espejo se descarta |
| `localStorage['daily-budget-data']` tras migrar | Se conserva como backup | Se conserva (no destructivo) |

**Backup QR / import** (flujo preexistente, intacto): `applyQrImport` → `mergeDatabases` + `saveToIndexedDB` sigue siendo el camino de sync multi-dispositivo. **No se toca** en este change.

---

## Ejecución (DDL / cambio de datos)

Lista de operaciones estructuradas (aunque no hay DDL "manual" — el upgrade es **código**, no archivo SQL aplicado a mano):

| # | Operación | Tipo | Idempotente | Notas |
|---|-----------|------|-------------|-------|
| 1 | `PRAGMA user_version = 2` sellado en `initDb` | código (`lib/db/client.ts`) | Sí | Marca shape v2; es el "detector" de upgrade |
| 2 | `upgradeFromLegacyShape`: `CREATE TABLE IF NOT EXISTS recurring_events/sync_meta` | código | Sí | Cubre snapshots pre-Batch sin esas tablas |
| 3 | ALTERs guarded (`deleted_at`, `device_id` en accounts/transactions/budgets/recurring_events) | código | Sí | Guard por `PRAGMA table_info`; nunca re-ejecuta |
| 4 | `PRAGMA foreign_keys = ON` por conexión | código | Sí | No afecta datos; integridad referencial real |
| 5 | Eliminar `lib/db/index.ts` + `app/actions/*` + `data/saldo-cero.db` | borrado | — | El espejo server se retira; datos del usuario intactos en IndexedDB |
| 6 | `data/saldo-cero.db` no se borra en el commit (ver Rollback) | — | — | Se documenta; limpieza por separado si se decide |

---

## Rollback

Revertir el change a su estado previo (commit padre):

1. **`git revert` / `checkout` de los archivos de código**: vuelven `lib/db/index.ts`, `app/actions/*`, la persistencia vía `saveToIndexedDB` sólo desde migración/QR, y `lib/sync-client.ts` CLI. Los snapshots IndexedDB quedan intactos (el upgrade es aditivo: columnas/tablas extra no molestan al código viejo, que ya las ignoraba o las leía).

2. **`server.db`**: el código server retirado vuelve a leer `data/saldo-cero.db` si existe. **Recomendación**: **no borrar** `data/saldo-cero.db` en el commit de eliminación; tras rollback el espejo sigue disponible. Como era un espejo (nunca fuente), no hay pérdida de datos de usuario: los cambios del usuario están en IndexedDB/localStorage.

3. **Snapshots convertidos a v2**: son legibles por código v1 (el DDL viejo con `user_version=0` re-ejecuta `CREATE TABLE IF NOT EXISTS` y convive con columnas extra — sql.js no valida el shape contra un schema fijo). Sin embargo, el código v1 **no conoce** `user_version`; si un snapshot v2 trae columnas que v1 no declara en su `SELECT *... extract`, las ignora. No hay corrupción de datos.

4. **`user_version=2` en snapshots re-abiertos por v1**: el código v1 no lee `user_version`; el snapshot sigue funcionando (sql.js no lo valida). No requiere limpieza.

5. **Datos del usuario**: nunca se tocan. El único borrado de datos de este change es **código** (stack server muerto que la UI no usa). `localStorage` y snapshots IndexedDB se conservan como fuente de verdad; el sync por QR/`applyQrImport` sigue como camino multi-dispositivo.

---

## Equivalencia con el change

| Este documento | Artefacto del change |
|----------------|----------------------|
| `Resumen` | PRD `offline-first-ui` (pivot offline-first, autosave real) |
| `Schema previo` (server + snapshot sin versionado) | Contexto del PRD: stack server muerto + snapshots que crashean |
| `Schema nuevo` + `PRAGMA user_version=2` + upgrade en `initDb` | D5/D11 del design (upgrade path, schema-sync, `user_version`) |
| `Estrategia de datos` | D2/D6 del design (autosave: debounce 300 ms + flush inmediato; `saveToIndexedDB` único punto) |
| `Ejecución` / `Rollback` | C4 (nada que migrar server-side re-ejecutable se hace a mano — el upgrade es código guarded idempotente) |
| Migración de `sdd-verify` | `sdd-verify` confirma `user_version=2` + snapshot persistido tras reload + `pnpm tsc/test` verdes |
