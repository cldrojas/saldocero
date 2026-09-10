// lib/db/meta.ts
// sync_meta operations. The meta row is a singleton (always id=1) and is only
// read/written through this module. Blob relay comes later — this file only
// does local meta read/write.
import type { Database } from 'sql.js'
import { getDb } from './client'

export type Meta = {
  id: number
  updated_at: string | null
  device_id: string | null
  snapshot_hash: string | null
}

export type MetaRead = {
  updated_at: string
  device_id: string
}

function selectMeta(db: Database): Meta | null {
  const result = db.exec('SELECT id, updated_at, device_id, snapshot_hash FROM sync_meta WHERE id = 1')
  const row = result[0]?.values[0]
  if (!row) return null
  return {
    id: row[0] as number,
    updated_at: row[1] as string | null,
    device_id: row[2] as string | null,
    snapshot_hash: row[3] as string | null,
  }
}

/**
 * Reads the singleton sync_meta row. Returns empty defaults if no row exists.
 */
export async function getMeta(): Promise<MetaRead> {
  const db = await getDb()
  const meta = selectMeta(db)
  return {
    updated_at: meta?.updated_at ?? '',
    device_id: meta?.device_id ?? '',
  }
}

/**
 * Creates or updates the singleton sync_meta row (id=1).
 * Provided fields are stored as-is; omitted fields keep their previous value.
 */
export async function setMeta(fields: Partial<Meta>): Promise<void> {
  const db = await getDb()
  const existing = selectMeta(db)

  if (existing) {
    const updatedAt = fields.updated_at !== undefined ? fields.updated_at : existing.updated_at
    const deviceId = fields.device_id !== undefined ? fields.device_id : existing.device_id
    const snapshotHash = fields.snapshot_hash !== undefined ? fields.snapshot_hash : existing.snapshot_hash
    db.run(
      'UPDATE sync_meta SET updated_at = ?, device_id = ?, snapshot_hash = ? WHERE id = 1',
      [updatedAt, deviceId, snapshotHash]
    )
  } else {
    db.run(
      'INSERT INTO sync_meta (id, updated_at, device_id, snapshot_hash) VALUES (1, ?, ?, ?)',
      [fields.updated_at ?? null, fields.device_id ?? null, fields.snapshot_hash ?? null]
    )
  }
}