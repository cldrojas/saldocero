// lib/db/schema.ts
// Single source of truth for the client-side DDL.
//
// Turbopack (Next 16 dev) resolves `?raw` imports to undefined in silence, so
// we do NOT import schema.sql?raw here. The DDL is inlined below AND mirrored
// in lib/db/schema.sql (used by the server via fs and by external tooling).
// tests/unit/schema-sync.test.ts fails if these two drift apart.
export const SCHEMA = `
-- lib/db/schema.sql
-- Idempotente: CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,        -- UUID v4
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('daily','savings','investment','custom')),
  icon TEXT NOT NULL DEFAULT 'wallet',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  device_id TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,        -- UUID v4
  type TEXT NOT NULL CHECK(type IN ('expense','transfer','income','adjustment')),
  amount INTEGER NOT NULL,
  description TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  device_id TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(account_id, date);

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

CREATE TABLE IF NOT EXISTS recurring_events (
  id TEXT PRIMARY KEY,        -- UUID v4
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  amount INTEGER NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('monthly','weekly','bimonthly','once')),
  day_of_month INTEGER,
  day_of_week INTEGER,
  start_date TEXT,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  device_id TEXT DEFAULT NULL
);

-- sync_meta: singleton row for cross-device sync
CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY,
  updated_at TEXT,
  device_id TEXT,
  snapshot_hash TEXT
);
`