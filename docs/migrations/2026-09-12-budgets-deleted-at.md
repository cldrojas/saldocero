# Migration: budgets.deleted_at

- **Date**: 2026-09-12
- **Change**: Bugfix — `budgets` table missing `deleted_at` column in canonical SCHEMA
- **Change ID**: `budgets-deleted-at`
- **Status**: Applied (schema.ts + schema.sql)

## Problem

`mergeDatabases` crashed with `table budgets has no column named deleted_at` when importing a
snapshot via QR (QR claim sync). The v2 shape adds `deleted_at`/`device_id` to all writable
tables via `upgradeDb()` ALTERs, so real databases (local + remote) carry `budgets.deleted_at`.
But `merge.ts` builds the merged database with `db.exec(SCHEMA)` only — and the canonical
`budgets` table declared `device_id` but NOT `deleted_at`. Inserting a v2 winner row with a
column the merged table does not have → sql.js throws → `applyQrImport` rejects → import modal
stays open, device B never converges.

## Schema before

```sql
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY DEFAULT 'default',
  start_amount INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  auto_save INTEGER NOT NULL DEFAULT 1,
  mode TEXT CHECK(mode IN ('daily','track')) DEFAULT 'daily',
  is_setup INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  device_id TEXT DEFAULT NULL
);
```

## Schema after

```sql
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY DEFAULT 'default',
  start_amount INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  auto_save INTEGER NOT NULL DEFAULT 1,
  mode TEXT CHECK(mode IN ('daily','track')) DEFAULT 'daily',
  is_setup INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  device_id TEXT DEFAULT NULL
);
```

`budgets` now matches `accounts`, `transactions` and `recurring_events` (all writable tables
carry both `deleted_at` and `device_id`).

## Data strategy

- No data rewrite needed: existing databases already have `budgets.deleted_at` via the
  `upgradeDb()` ALTER (`ADDITIVE_COLUMNS` includes `['budgets','deleted_at']`).
- The fix only makes the canonical DDL match the v2 shape so fresh databases and
  `mergeDatabases()` outputs declare the column from the start.
- Backfilled: by definition, budgets in a v2 database have the column. `initDb()` on any
  existing legacy snapshot still runs `upgradeDb()` which adds the column if missing.

## Rollback

- Revert the single-line change in `lib/db/schema.ts` and `lib/db/schema.sql`
  (`deleted_at TEXT DEFAULT NULL` on `budgets`).
- No data-level rollback required: snapshots are v2-shaped regardless; the only regression
  would be the QR merge crash returning.

## Verification

- `pnpm exec playwright test tests/ui/sync-qr.spec.ts` — deep-link import and manual import
  now converge (device B shows the FAB `Agregar gasto` after import).
- `tests/unit/schema-sync.test.ts` keeps `schema.ts` and `schema.sql` in exact sync.
- Full gate: `pnpm tsc --noEmit` + `pnpm test` (Vitest).