// lib/db/merge.ts
// Last-write-wins (LWW) merge with tombstones for the client-side sql.js DB.
// Pure, deterministic and idempotent. Synchronous: sql.js is synchronous WASM.
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { SCHEMA } from './schema'
import { getSqlSync } from './client'

const WRITABLE_TABLES = ['accounts', 'transactions', 'budgets', 'recurring_events'] as const

type Row = Record<string, unknown>

function rowsOf(db: Database, table: string, pk: string): Map<string, Row> {
  const map = new Map<string, Row>()
  const result = db.exec(`SELECT * FROM ${table}`)
  if (!result.length) return map

  const { columns, values } = result[0]
  for (const valuesRow of values) {
    const row: Row = {}
    columns.forEach((col, i) => {
      row[col] = valuesRow[i]
    })
    map.set(String(row[pk]), { ...row })
  }
  return map
}

/**
 * Decides which of two replicas of the same record wins.
 * Tiebreak order: deleted_at (tombstone wins over a live record) →
 * updated_at → created_at → device_id (lexicographic, greater wins).
 */
function pickWinner(local: Row, remote: Row): Row {
  const localDeleted = local.deleted_at
  const remoteDeleted = remote.deleted_at

  // Tombstone propagation: a deleted record beats a live one,
  // regardless of timestamps.
  if (localDeleted == null && remoteDeleted != null) return remote
  if (localDeleted != null && remoteDeleted == null) return local

  const updatedLocal = String(local.updated_at ?? '')
  const updatedRemote = String(remote.updated_at ?? '')
  if (updatedLocal > updatedRemote) return local
  if (updatedLocal < updatedRemote) return remote

  const createdLocal = String(local.created_at ?? '')
  const createdRemote = String(remote.created_at ?? '')
  if (createdLocal > createdRemote) return local
  if (createdLocal < createdRemote) return remote

  const deviceLocal = String(local.device_id ?? '')
  const deviceRemote = String(remote.device_id ?? '')
  if (deviceLocal > deviceRemote) return local
  if (deviceLocal < deviceRemote) return remote

  return local
}

function insertRow(db: Database, table: string, row: Row) {
  const cols = Object.keys(row)
  const colList = cols.join(', ')
  const placeholders = cols.map(() => '?').join(', ')
  const params = cols.map((col) => {
    const value = row[col]
    if (typeof value === 'bigint') return Number(value)
    return value ?? null
  })
  db.run(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`, params as SqlValue[])
}

/**
 * Merges two databases into a new database, keeping one LWW row per record
 * (by primary key). Records present on only one side are carried over.
 * `device_id` is stamped on every merged record so the result is attributable
 * to the device performing the sync.
 *
 * Idempotent: merge(merge(local, remote), remote) produces the same rows.
 *
 * `sql` is the resolved sql.js namespace. It is optional — when omitted the
 * process-wide singleton from client.ts is used. Passing it explicitly is
 * recommended in test/embedded contexts where a validated instance exists.
 */
export function mergeDatabases(
  local: Database,
  remote: Database,
  deviceId: string,
  sql?: SqlJsStatic
): Database {
  const SQL = sql ?? getSqlSync()
  const merged = new SQL.Database()
  merged.exec(SCHEMA)

  for (const table of WRITABLE_TABLES) {
    const pk = 'id'
    const localRows = rowsOf(local, table, pk)
    const remoteRows = rowsOf(remote, table, pk)

    const ids = new Set<string>([...localRows.keys(), ...remoteRows.keys()])
    for (const id of ids) {
      const localRow = localRows.get(id)
      const remoteRow = remoteRows.get(id)
      const winner = localRow && remoteRow
        ? pickWinner(localRow, remoteRow)
        : (localRow ?? remoteRow!)
      winner.device_id = deviceId
      insertRow(merged, table, winner)
    }
  }

  return merged
}