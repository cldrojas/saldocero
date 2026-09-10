import { describe, it, expect, beforeAll } from 'vitest'
import { Database } from 'sql.js'
import { mergeDatabases } from '@/lib/db/merge'
import { getSql } from '@/lib/db/client'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
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
  id TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS recurring_events (
  id TEXT PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS sync_meta (
  id INTEGER PRIMARY KEY,
  updated_at TEXT,
  device_id TEXT,
  snapshot_hash TEXT
);
`

let SQL: Awaited<ReturnType<typeof getSql>>

beforeAll(async () => {
  SQL = await getSql()
})

function createDb(): Database {
  const db = new SQL.Database()
  db.exec(SCHEMA)
  return db
}

function insertAccount(
  db: Database,
  opts: {
    id: string
    name: string
    type?: string
    icon?: string
    hidden?: number
    created_at: string
    updated_at: string
    deleted_at?: string | null
    device_id?: string | null
  }
) {
  db.run(
    `INSERT INTO accounts (id, name, type, icon, hidden, created_at, updated_at, deleted_at, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.name,
      opts.type ?? 'daily',
      opts.icon ?? 'wallet',
      opts.hidden ?? 0,
      opts.created_at,
      opts.updated_at,
      opts.deleted_at ?? null,
      opts.device_id ?? null,
    ]
  )
}

function insertTransaction(
  db: Database,
  opts: {
    id: string
    type?: string
    amount: number
    description: string
    account_id: string
    date: string
    created_at: string
    updated_at: string
    deleted_at?: string | null
    device_id?: string | null
  }
) {
  db.run(
    `INSERT INTO transactions (id, type, amount, description, account_id, date, created_at, updated_at, deleted_at, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.type ?? 'expense',
      opts.amount,
      opts.description,
      opts.account_id,
      opts.date,
      opts.created_at,
      opts.updated_at,
      opts.deleted_at ?? null,
      opts.device_id ?? null,
    ]
  )
}

function queryAll(db: Database, sql: string): Record<string, unknown>[] {
  const result = db.exec(sql)
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map((row) => {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => { obj[col] = row[i] })
    return obj
  })
}

describe('mergeDatabases', () => {
  describe('basic LWW conflict resolution', () => {
    it('local wins when local.updated_at > remote.updated_at', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'Local Name',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-local',
      })
      insertAccount(remote, {
        id: 'acc-1',
        name: 'Remote Name',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-10T08:00:00',
        device_id: 'device-remote',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT name FROM accounts WHERE id = \'acc-1\'')

      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Local Name')
    })

    it('remote wins when remote.updated_at > local.updated_at', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'Local Name',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-10T08:00:00',
        device_id: 'device-local',
      })
      insertAccount(remote, {
        id: 'acc-1',
        name: 'Remote Name',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-remote',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT name FROM accounts WHERE id = \'acc-1\'')

      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Remote Name')
    })
  })

  describe('tiebreaking', () => {
    it('breaks tie by created_at when updated_at is equal', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'Local Created Earlier',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-local',
      })
      insertAccount(remote, {
        id: 'acc-1',
        name: 'Remote Created Later',
        created_at: '2025-03-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-remote',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT name FROM accounts WHERE id = \'acc-1\'')

      expect(rows).toHaveLength(1)
      // Greater value wins at each tiebreak step: later created_at wins
      expect(rows[0].name).toBe('Remote Created Later')
    })

    it('breaks tie by device_id lexicographic when created_at is also equal', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'Local Device',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-z',
      })
      insertAccount(remote, {
        id: 'acc-1',
        name: 'Remote Device',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-a',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT name FROM accounts WHERE id = \'acc-1\'')

      expect(rows).toHaveLength(1)
      // Greater value wins at each tiebreak step: device-z > device-a lexicographically
      expect(rows[0].name).toBe('Local Device')
    })
  })

  describe('tombstone propagation', () => {
    it('deleted_at wins over null', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'To Delete',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        deleted_at: '2025-06-20T10:00:00',
        device_id: 'device-local',
      })
      insertAccount(remote, {
        id: 'acc-1',
        name: 'Active',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        deleted_at: null,
        device_id: 'device-remote',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT name, deleted_at FROM accounts WHERE id = \'acc-1\'')

      expect(rows).toHaveLength(1)
      expect(rows[0].deleted_at).not.toBeNull()
    })

    it('latest deleted_at wins when both are deleted', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'Older Delete',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        deleted_at: '2025-06-20T10:00:00',
        device_id: 'device-local',
      })
      insertAccount(remote, {
        id: 'acc-1',
        name: 'Newer Delete',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-25T12:00:00',
        deleted_at: '2025-06-25T14:00:00',
        device_id: 'device-remote',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT deleted_at FROM accounts WHERE id = \'acc-1\'')

      expect(rows).toHaveLength(1)
      expect(rows[0].deleted_at).toBe('2025-06-25T14:00:00')
    })
  })

  describe('idempotency', () => {
    it('merge is idempotent: merge(local, remote) === merge(merge(local, remote), remote)', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'Local',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-local',
      })
      insertAccount(remote, {
        id: 'acc-1',
        name: 'Remote',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-20T12:00:00',
        device_id: 'device-remote',
      })

      const merged1 = mergeDatabases(local, remote, 'device-local', SQL)
      const merged2 = mergeDatabases(merged1, remote, 'device-local', SQL)

      const rows1 = queryAll(merged1, 'SELECT name FROM accounts WHERE id = \'acc-1\'')
      const rows2 = queryAll(merged2, 'SELECT name FROM accounts WHERE id = \'acc-1\'')

      expect(rows1).toHaveLength(1)
      expect(rows2).toHaveLength(1)
      expect(rows1[0].name).toBe(rows2[0].name)
    })
  })

  describe('empty databases', () => {
    it('merging two empty databases produces an empty database', () => {
      const local = createDb()
      const remote = createDb()

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT * FROM accounts')
      expect(rows).toHaveLength(0)
    })

    it('local-only records survive merge with empty remote', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'Only Local',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-local',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT name FROM accounts WHERE id = \'acc-1\'')

      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Only Local')
    })

    it('remote-only records survive merge with empty local', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(remote, {
        id: 'acc-1',
        name: 'Only Remote',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-remote',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT name FROM accounts WHERE id = \'acc-1\'')

      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('Only Remote')
    })
  })

  describe('multi-table merge', () => {
    it('merges transactions across both databases', () => {
      const local = createDb()
      const remote = createDb()

      // Both share the account
      insertAccount(local, {
        id: 'acc-1',
        name: 'Daily',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
        device_id: 'device-local',
      })
      insertAccount(remote, {
        id: 'acc-1',
        name: 'Daily',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-01-01T00:00:00',
        device_id: 'device-remote',
      })

      insertTransaction(local, {
        id: 'tx-1',
        amount: 100,
        description: 'Local tx',
        account_id: 'acc-1',
        date: '2025-06-15',
        created_at: '2025-06-15T12:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: 'device-local',
      })
      insertTransaction(remote, {
        id: 'tx-2',
        amount: 200,
        description: 'Remote tx',
        account_id: 'acc-1',
        date: '2025-06-20',
        created_at: '2025-06-20T12:00:00',
        updated_at: '2025-06-20T12:00:00',
        device_id: 'device-remote',
      })

      const merged = mergeDatabases(local, remote, 'device-local', SQL)
      const rows = queryAll(merged, 'SELECT id FROM transactions ORDER BY id')

      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.id)).toEqual(['tx-1', 'tx-2'])
    })
  })

  describe('device_id propagation', () => {
    it('sets device_id on all records in merged result', () => {
      const local = createDb()
      const remote = createDb()

      insertAccount(local, {
        id: 'acc-1',
        name: 'Local',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: null,
      })
      insertAccount(remote, {
        id: 'acc-2',
        name: 'Remote',
        created_at: '2025-01-01T00:00:00',
        updated_at: '2025-06-15T12:00:00',
        device_id: null,
      })

      const merged = mergeDatabases(local, remote, 'device-merged', SQL)
      const rows = queryAll(merged, 'SELECT device_id FROM accounts ORDER BY id')

      expect(rows).toHaveLength(2)
      expect(rows.every((r) => r.device_id === 'device-merged')).toBe(true)
    })
  })
})
