// tests/unit/schema-sync.test.ts
// Guard: the client-side DDL lives inline in lib/db/schema.ts (Turbopack
// resolves `?raw` to undefined). The server reads lib/db/schema.sql via fs.
// This test fails if the two drift apart.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { SCHEMA } from '@/lib/db/schema'

const sqlFile = readFileSync(
  path.join(process.cwd(), 'lib', 'db', 'schema.sql'),
  'utf-8'
)

describe('schema parity', () => {
  it('SCHEMA matches lib/db/schema.sql exactly', () => {
    expect(SCHEMA.trim()).toBe(sqlFile.trim())
  })

  it('SCHEMA contains the tables the client depends on', () => {
    for (const table of [
      'accounts',
      'transactions',
      'budgets',
      'recurring_events',
      'sync_meta',
    ]) {
      expect(SCHEMA).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })
})