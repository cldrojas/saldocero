// lib/db/persistence.ts
// IndexedDB persistence layer for the client-side sql.js database.
// Stores the exported snapshot (Uint8Array) — the sync unit.
import type { Database } from 'sql.js'

const DB_NAME = 'saldo-cero-db'
const DB_VERSION = 1
const STORE_NAME = 'snapshots'
const SNAPSHOT_KEY = 'last'

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