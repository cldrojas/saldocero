// lib/db/client.ts
// Singleton client-side sql.js (WASM) database layer.
import type { Database, SqlJsStatic } from 'sql.js'
import { SCHEMA } from './schema'

let sqlPromise: Promise<SqlJsStatic> | null = null
let sqlSynced: SqlJsStatic | null = null
let dbPromise: Promise<Database> | null = null

/**
 * Lazily resolves the sql.js WASM module (WASM ~1MB, loaded on first use).
 * Dynamically imported so the WASM payload is code-split and only fetched
 * when the db layer is actually touched.
 */
export function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = import('sql.js').then(async (mod) => {
      // Browser: Next.js sirve el WASM desde /public (copiado desde
      // node_modules/sql.js/dist/sql-wasm.wasm); sin locateFile el bundle
      // intenta fetchear el .wasm relativo y falla. Node (unit tests): sql.js
      // resuelve el .wasm desde node_modules con el locateFile por defecto,
      // así que NO lo sobrescribimos.
      const isNode = typeof process !== 'undefined' && !!process.versions?.node
      const sql = isNode
        ? await mod.default()
        : await mod.default({ locateFile: () => '/sql-wasm.wasm' })
      sqlSynced = sql
      return sql
    })
  }
  return sqlPromise!
}

/**
 * Synchronous access to the sql.js constructor.
 * Throws if getSql() has not been awaited yet. Use after initDb()/getDb().
 */
export function getSqlSync(): SqlJsStatic {
  if (!sqlSynced) throw new Error('sql.js not initialized — await getSql()/initDb() first')
  return sqlSynced
}

/**
 * Initializes a database from a Uint8Array snapshot (the sync unit) or from
 * an empty database with the canonical schema applied.
 */
export async function initDb(data?: ArrayLike<number>): Promise<Database> {
  const SQL = await getSql()
  const db = data ? new SQL.Database(data) : new SQL.Database()
  if (!data) db.exec(SCHEMA)
  return db
}

/**
 * Returns the process-wide singleton database, creating and applying the
 * schema on first access.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = initDb()
  return dbPromise
}

/**
 * Exports the current database as a Uint8Array snapshot (the sync unit).
 */
export function exportDb(db: Database): Uint8Array {
  return db.export()
}

/**
 * Swaps the process-wide singleton database. Used after a merge so the rest
 * of the app reads the converged database.
 */
export function setDb(db: Database): void {
  dbPromise = Promise.resolve(db)
}

/**
 * Resets the singleton so the next getDb() creates a fresh database.
 * Used by logout/restore flows and tests.
 */
export function resetDb(): void {
  dbPromise = null
}