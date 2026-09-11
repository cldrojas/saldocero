// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  saveToIndexedDB,
  loadFromIndexedDB,
  clearIndexedDB,
  saveBackup,
  listBackups,
  restoreBackup,
} from '@/lib/db/persistence'

const DB_NAME = 'saldo-cero-db'

function resetIndexedDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

describe('persistence (IndexedDB — snapshot + backups)', () => {
  beforeEach(async () => {
    await resetIndexedDB()
  })

  afterEach(async () => {
    await resetIndexedDB()
  })

  it('round-trip: saveToIndexedDB → loadFromIndexedDB devuelve los mismos bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 255])
    // saveToIndexedDB recibe un Database; para probar la capa usamos un stub mínimo
    const fakeDb = { export: () => bytes } as unknown as import('sql.js').Database
    await saveToIndexedDB(fakeDb)
    const loaded = await loadFromIndexedDB()
    expect(loaded).not.toBeNull()
    expect(Array.from(loaded!)).toEqual([1, 2, 3, 4, 255])
  })

  it('loadFromIndexedDB devuelve null si no hay snapshot', async () => {
    expect(await loadFromIndexedDB()).toBeNull()
  })

  it('clearIndexedDB elimina el snapshot', async () => {
    const fakeDb = { export: () => new Uint8Array([9]) } as unknown as import('sql.js').Database
    await saveToIndexedDB(fakeDb)
    await clearIndexedDB()
    expect(await loadFromIndexedDB()).toBeNull()
  })

  it('saveBackup/restoreBackup guardan y restauran bytes por label', async () => {
    const bytes = new Uint8Array([10, 20, 30])
    await saveBackup(bytes, 'pre-merge-2026-09-11T10:00:00Z')
    const restored = await restoreBackup('pre-merge-2026-09-11T10:00:00Z')
    expect(Array.from(restored)).toEqual([10, 20, 30])
  })

  it('saveBackup reemplaza el backup con el mismo label', async () => {
    await saveBackup(new Uint8Array([1]), 'pre-merge')
    await saveBackup(new Uint8Array([2, 2]), 'pre-merge')
    expect(Array.from(await restoreBackup('pre-merge'))).toEqual([2, 2])
  })

  it('listBackups devuelve label y timestamp de cada backup', async () => {
    await saveBackup(new Uint8Array([1]), 'pre-merge-1')
    await saveBackup(new Uint8Array([2]), 'pre-merge-2')
    const backups = await listBackups()
    expect(backups).toHaveLength(2)
    const labels = backups.map((b) => b.label).sort()
    expect(labels).toEqual(['pre-merge-1', 'pre-merge-2'])
    for (const b of backups) {
      expect(b.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  it('restoreBackup con label desconocido lanza error', async () => {
    await expect(restoreBackup('no-existe')).rejects.toThrow()
  })
})