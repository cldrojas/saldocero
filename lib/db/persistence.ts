// lib/db/persistence.ts
// IndexedDB persistence layer for the client-side sql.js database.
// Stores the exported snapshot (Uint8Array) — the sync unit.
import type { Database } from 'sql.js'

const DB_NAME = 'saldo-cero-db'
const DB_VERSION = 1
const STORE_NAME = 'snapshots'
const SNAPSHOT_KEY = 'last'
const BACKUP_PREFIX = 'backup:'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

function withStore<T>(
  idb: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, mode)
    const request = operation(tx.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB operation failed'))
  })
}

/**
 * Persists the current database snapshot (db.export()) to IndexedDB.
 */
export async function saveToIndexedDB(db: Database): Promise<void> {
  const data = db.export()
  const idb = await openDb()
  try {
    await withStore(idb, 'readwrite', (store) => store.put(data, SNAPSHOT_KEY))
  } finally {
    idb.close()
  }
}

/**
 * Loads the last persisted snapshot, or null if none exists.
 */
export async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  const idb = await openDb()
  try {
    const result = await withStore<Uint8Array | undefined>(idb, 'readonly', (store) => store.get(SNAPSHOT_KEY))
    return result ?? null
  } finally {
    idb.close()
  }
}

/**
 * Wipes the snapshot store. Intended for testing and logout.
 */
export async function clearIndexedDB(): Promise<void> {
  const idb = await openDb()
  try {
    await withStore(idb, 'readwrite', (store) => store.delete(SNAPSHOT_KEY))
  } finally {
    idb.close()
  }
}

/** Backups are stored as { bytes, at } wrappers so we can list them with timestamps. */
interface BackupRecord {
  bytes: Uint8Array
  at: string
}

/**
 * Stores a labelled backup snapshot (e.g. 'pre-merge'). Reusing a label
 * replaces the previous backup with that label.
 */
export async function saveBackup(bytes: Uint8Array, label: string): Promise<void> {
  const record: BackupRecord = { bytes, at: new Date().toISOString() }
  const idb = await openDb()
  try {
    await withStore(idb, 'readwrite', (store) => store.put(record, `${BACKUP_PREFIX}${label}`))
  } finally {
    idb.close()
  }
}

/**
 * Lists all backups with their label and creation timestamp.
 */
export async function listBackups(): Promise<Array<{ label: string; at: string }>> {
  const idb = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const result: Array<{ label: string; at: string }> = []
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current) {
          resolve(result)
          return
        }
        if (typeof current.key === 'string' && current.key.startsWith(BACKUP_PREFIX)) {
          const record = current.value as BackupRecord
          result.push({ label: current.key.slice(BACKUP_PREFIX.length), at: record.at })
        }
        current.continue()
      }
      cursor.onerror = () => reject(cursor.error ?? new Error('listBackups failed'))
    })
  } finally {
    idb.close()
  }
}

/**
 * Loads the raw bytes of a labelled backup. Throws if the label does not exist.
 */
export async function restoreBackup(label: string): Promise<Uint8Array> {
  const idb = await openDb()
  try {
    const record = await withStore<BackupRecord | undefined>(
      idb,
      'readonly',
      (store) => store.get(`${BACKUP_PREFIX}${label}`) as IDBRequest<BackupRecord | undefined>
    )
    if (!record) {
      throw new Error(`Backup not found: ${label}`)
    }
    return record.bytes
  } finally {
    idb.close()
  }
}