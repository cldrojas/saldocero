# Migración: multi-device-blob-sync

Fecha: 2026-09-09
Change: `multi-device-blob-sync`
PRD: `docs/requirements/multi-device-blob-sync.md`
Migración SQL: aplicada vía `lib/db/schema.sql` (cliente sql.js) o archivo de migración DDL al detectar versión (ver Estrategia de datos)

## Cambio de schema

La base deja de ser exclusivamente server-side (better-sqlite3) y pasa a ser **local-first en el dispositivo**, con sync entre dispositivos vía Vercel Blob. Para soportar el merge **last-write-wins con tombstones**, se añade:

1. Columna `deleted_at` (tombstone) en las 3 tablas de datos.
2. Columna `device_id` (traza de último escritor) en las mismas tablas.
3. Tabla nueva `sync_meta` (singleton) para metadata de sincronización.

### Schema previo (lib/db/schema.sql, change `sqlite-local`)

```
accounts(
  id TEXT PK, name TEXT NOT NULL, type TEXT NOT NULL CHECK(...),
  icon TEXT NOT NULL DEFAULT 'wallet', hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)

transactions(
  id TEXT PK, type TEXT NOT NULL CHECK(...), amount INTEGER NOT NULL,
  description TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
-- índice: idx_tx_date ON transactions(account_id, date)

budgets(
  id TEXT PK DEFAULT 'default', start_amount INTEGER NOT NULL DEFAULT 0,
  start_date TEXT, end_date TEXT, auto_save INTEGER NOT NULL DEFAULT 1,
  mode TEXT CHECK(mode IN ('daily','track')) DEFAULT 'daily',
  is_setup INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)

recurring_events(
  id TEXT PK, description TEXT NOT NULL, type TEXT NOT NULL CHECK(...),
  amount INTEGER NOT NULL, frequency TEXT NOT NULL CHECK(...),
  day_of_month INTEGER, day_of_week INTEGER, start_date TEXT, end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

### Schema nuevo (post-migración)

```
accounts(
  ... columnas previas ...,
  deleted_at TEXT,          -- NUEVO: tombstone para merge multi-dispositivo
  device_id TEXT            -- NUEVO: dispositivo que escribió por última vez
)

transactions(
  ... columnas previas ...,
  deleted_at TEXT,          -- NUEVO
  device_id TEXT            -- NUEVO
)

budgets(
  ... columnas previas ...   -- sin cambios: singleton, no requiere tombstone
)

recurring_events(
  ... columnas previas ...,
  deleted_at TEXT,          -- NUEVO
  device_id TEXT            -- NUEVO
)

sync_meta(                  -- NUEVA: metadata de sincronización
  id TEXT PK DEFAULT 'singleton',
  last_sync_at TEXT,
  device_id TEXT,
  last_snapshot_hash TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

## Estrategia de datos

1. **Aplicación de la migración**: `lib/db/schema.sql` se actualiza a `CREATE TABLE IF NOT EXISTS` con las columnas nuevas + `ALTER TABLE ... ADD COLUMN` guardados por detección de schema (PRAGMA table_info). En el primer arranque post-migración, todas las filas existentes quedan con `deleted_at = NULL` y `device_id = NULL` (datos legacy sin traza; el merge los trata como vivos con prioridad de timestamp `updated_at`).
2. **Backfill**: `sync_meta` se crea con una fila única (`id='singleton'`) cuando no existe; `last_sync_at` apunta al momento de la migración.
3. **Semántica nueva en la app**:
   - Los borrados pasan de hard delete a **soft delete** (`deleted_at = datetime('now')`). Las queries normales filtran `deleted_at IS NULL`.
   - Cada escritura setea `updated_at` y `device_id` del dispositivo activo.
   - `sync_meta.device_id` se usa para desempates deterministas en el merge.
4. **Migración de datos existente**: el `data/saldo-cero.db` server-side actual se convierte en el **primer snapshot** del relay (push guiado desde la UI); un dispositivo nuevo puede inicializarse desde él (pull + merge). Idempotente: hash del snapshot en `sync_meta` evita duplicados.

## Rollback

1. Revertir `lib/db/schema.sql` al schema de `sqlite-local` (sin columnas nuevas ni `sync_meta`).
2. En una base ya migrada: eliminar las columnas añadidas y la tabla `sync_meta`:

```sql
-- SQLite 3.35+ soporta DROP COLUMN
ALTER TABLE accounts DROP COLUMN deleted_at;
ALTER TABLE accounts DROP COLUMN device_id;
ALTER TABLE transactions DROP COLUMN deleted_at;
ALTER TABLE transactions DROP COLUMN device_id;
ALTER TABLE recurring_events DROP COLUMN deleted_at;
ALTER TABLE recurring_events DROP COLUMN device_id;
DROP TABLE IF EXISTS sync_meta;
```

3. Revertir la capa cliente (`lib/db/client.ts`, `repository.ts`, `merge.ts`, `persistence.ts`, `meta.ts`) y las API Routes de sync; restaurar Server Actions + better-sqlite3 como ruta única.
4. La app vuelve a operar sobre `data/saldo-cero.db` (comportamiento `sqlite-local`).