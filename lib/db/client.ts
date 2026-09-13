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

// Columnas que se agregan al migrar un snapshot viejo (v1, pre-offline-first)
// al schema canónico v2. Guarded: antes de cada ALTER se verifica PRAGMA
// table_info para no romper snapshots que ya están en v2 (idempotencia).
const ADDITIVE_COLUMNS: Array<[table: string, column: string]> = [
  ['accounts', 'deleted_at'],
  ['accounts', 'device_id'],
  ['transactions', 'deleted_at'],
  ['transactions', 'device_id'],
  ['budgets', 'deleted_at'],
  ['budgets', 'device_id'],
  ['recurring_events', 'deleted_at'],
  ['recurring_events', 'device_id'],
]

/**
 * Upgrades any database (fresh or legacy snapshot) to the v2 shape:
 *   - aplica el SCHEMA canónico (idempotente: CREATE TABLE/INDEX IF NOT
 *     EXISTS) para crear recurring_events y sync_meta si el snapshot las
 *     trae sin ellas;
 *   - agrega las columnas v2 faltantes (deleted_at/device_id) con ALTER
 *     guarded por table_info;
 *   - sella user_version = 2;
 *   - habilita foreign_keys = ON (sql.js arranca con FKs OFF).
 */
function upgradeDb(db: Database): void {
  db.exec(SCHEMA)
  for (const [table, column] of ADDITIVE_COLUMNS) {
    const info = db.exec(`PRAGMA table_info(${table})`)[0]
    const hasColumn = info ? info.values.some((row) => String(row[1]) === column) : false
    if (!hasColumn) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT DEFAULT NULL`)
    }
  }
  db.exec('PRAGMA user_version = 2')
  db.exec('PRAGMA foreign_keys = ON')
}

/**
 * Initializes a database from a Uint8Array snapshot (the sync unit) or from
 * an empty database with the canonical schema applied. In both cases the
 * result is upgraded/migrated to the v2 shape (ver upgradeDb).
 */
export async function initDb(data?: ArrayLike<number>): Promise<Database> {
  const SQL = await getSql()
  const db = data ? new SQL.Database(data) : new SQL.Database()
  if (!data) db.exec(SCHEMA)
  upgradeDb(db)
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