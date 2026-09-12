// lib/db/index.ts
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.SQLITE_DB_PATH ||
  path.join(process.cwd(), 'data', 'saldo-cero.db')

// Guard global para sobrevivir HMR en dev
declare global {
  var __db: Database.Database | undefined
}

function getDb(): Database.Database {
  if (globalThis.__db) return globalThis.__db

  // Asegurar que el directorio data/ existe
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const db = new Database(DB_PATH)

  // WAL mode: mejor concurrencia de lectura, no bloquea reads durante writes
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Aplicar schema idempotentemente
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'lib', 'db', 'schema.sql'),
    'utf-8'
  )
  db.exec(schema)

  globalThis.__db = db
  return db
}

export { getDb }