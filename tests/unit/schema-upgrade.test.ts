// tests/unit/schema-upgrade.test.ts
// initDb debe migrar un snapshot v1 (legacy): columnas deleted_at/device_id en
// accounts+transactions, tablas recurring_events/sync_meta, user_version = 2,
// foreign_keys = ON. RED: hoy initDb abre el snapshot tal cual (sin upgrade).
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Database, SqlJsStatic } from 'sql.js'
import { getSql, initDb } from '@/lib/db/client'
import { loadState } from '@/lib/db/repository'

// Shape v1 (pre-offline-first): sin deleted_at/device_id, sin recurring_events
// ni sync_meta. Debe ser legacy-parseable por loadState una vez migrada.
const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('daily','savings','investment','custom')),
  icon TEXT NOT NULL DEFAULT 'wallet',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('expense','transfer','income','adjustment')),
  amount INTEGER NOT NULL,
  description TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

let SQL: SqlJsStatic
const openDbs: Database[] = []

function createLegacyDb(): Database {
  const db = new SQL.Database()
  db.exec(LEGACY_SCHEMA)
  db.run(
    `INSERT INTO budgets (id, start_amount, auto_save, mode, is_setup)
     VALUES ('default', 10000, 1, 'daily', 1)`
  )
  db.run(
    `INSERT INTO accounts (id, name, type, icon, hidden)
     VALUES ('daily', 'Daily Budget', 'daily', 'wallet', 0)`
  )
  db.run(
    `INSERT INTO transactions (id, type, amount, description, account_id, date)
     VALUES ('tx-1', 'income', 10000, 'Initial deposit', 'daily', '2026-01-01')`
  )
  return db
}

function tableColumns(db: Database, table: string): string[] {
  const res = db.exec(`PRAGMA table_info(${table})`)[0]
  if (!res) return []
  return res.values.map((row) => String(row[1]))
}

function userVersion(db: Database): number {
  const res = db.exec('PRAGMA user_version')[0]
  return Number(res?.values[0]?.[0] ?? 0)
}

function foreignKeysOn(db: Database): boolean {
  const res = db.exec('PRAGMA foreign_keys')[0]
  return Number(res?.values[0]?.[0] ?? 0) === 1
}

afterEach(() => {
  while (openDbs.length) openDbs.pop()?.close()
})

beforeAll(async () => {
  SQL = await getSql()
})

describe('initDb: migra un snapshot v1 (legacy) a user_version 2', () => {
  it('agrega deleted_at/device_id nullable en accounts, transactions, budgets y recurring_events', async () => {
    const legacy = createLegacyDb()
    openDbs.push(legacy)
    const db = await initDb(legacy.export())
    openDbs.push(db)

    for (const table of ['accounts', 'transactions', 'budgets', 'recurring_events']) {
      const cols = tableColumns(db, table)
      expect(cols).toContain('deleted_at')
      expect(cols).toContain('device_id')
    }

    // las filas existentes reciben NULL en las columnas nuevas
    const rows = db.exec("SELECT deleted_at, device_id FROM accounts WHERE id = 'daily'")[0]?.values
    expect(rows?.[0]).toEqual([null, null])
  })

  it('crea la tabla recurring_events usable (INSERT + query)', async () => {
    const legacy = createLegacyDb()
    openDbs.push(legacy)
    const db = await initDb(legacy.export())
    openDbs.push(db)

    expect(() =>
      db.run(
        `INSERT INTO recurring_events (id, description, type, amount, frequency)
         VALUES ('r1', 'Sueldo', 'income', 100000, 'monthly')`
      )
    ).not.toThrow()

    const rows = db.exec("SELECT id, frequency, active FROM recurring_events WHERE id = 'r1'")[0]?.values
    expect(rows?.[0]).toEqual(['r1', 'monthly', 1])
  })

  it('crea la tabla sync_meta usable (setMeta sobre la instancia migrada)', async () => {
    const legacy = createLegacyDb()
    openDbs.push(legacy)
    const db = await initDb(legacy.export())
    openDbs.push(db)

    expect(() =>
      db.run(
        `INSERT INTO sync_meta (id, updated_at, device_id, snapshot_hash)
         VALUES (1, '2026-09-12T00:00:00Z', 'device-a', 'deadbeef')`
      )
    ).not.toThrow()

    const meta = db.exec('SELECT updated_at, device_id FROM sync_meta WHERE id = 1')[0]?.values
    expect(meta?.[0]).toEqual(['2026-09-12T00:00:00Z', 'device-a'])
  })

  it('sella user_version = 2', async () => {
    const legacy = createLegacyDb()
    openDbs.push(legacy)
    const db = await initDb(legacy.export())
    openDbs.push(db)

    expect(userVersion(db)).toBe(2)
  })

  it('loadState funciona sobre el snapshot migrado (no petó por columns faltantes)', async () => {
    const legacy = createLegacyDb()
    openDbs.push(legacy)
    const db = await initDb(legacy.export())
    openDbs.push(db)

    const state = loadState(db)
    expect(state.budget.start_amount).toBe(10000)
    expect(state.accounts[0]).toMatchObject({ id: 'daily', name: 'Daily Budget', balance: 10000 })
    expect(state.transactions[0]).toMatchObject({ description: 'Initial deposit', amount: 10000 })
  })

  it('es idempotente: re-migrar un snapshot ya migrado no cambia el shape', async () => {
    const legacy = createLegacyDb()
    openDbs.push(legacy)
    const first = await initDb(legacy.export())
    openDbs.push(first)

    const second = await initDb(first.export())
    openDbs.push(second)

    expect(userVersion(second)).toBe(2)
    for (const table of ['accounts', 'transactions', 'budgets', 'recurring_events']) {
      expect(tableColumns(second, table)).toContain('deleted_at')
    }
    expect(() =>
      second.run(
        `INSERT INTO recurring_events (id, description, type, amount, frequency)
         VALUES ('r2', 'Alquiler', 'expense', 50000, 'monthly')`
      )
    ).not.toThrow()
    // datos migrados intactos
    const rows = second.exec("SELECT start_amount FROM budgets WHERE id = 'default'")[0]?.values
    expect(rows?.[0]?.[0]).toBe(10000)
  })

  it('habilita foreign_keys = ON: insert huérfano rechazado, insert válido pasa', async () => {
    const legacy = createLegacyDb()
    openDbs.push(legacy)
    const db = await initDb(legacy.export())
    openDbs.push(db)

    expect(foreignKeysOn(db)).toBe(true)

    expect(() =>
      db.run(
        `INSERT INTO transactions (id, type, amount, description, account_id, date)
         VALUES ('tx-orphan', 'expense', 50, 'Ghost', 'ghost', '2026-09-12')`
      )
    ).toThrow()

    expect(() =>
      db.run(
        `INSERT INTO transactions (id, type, amount, description, account_id, date)
         VALUES ('tx-ok', 'expense', 50, 'Coffee', 'daily', '2026-09-12')`
      )
    ).not.toThrow()
  })
})