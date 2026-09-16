// tests/unit/import-json.test.ts
// Espejo de migrate-localstorage.test.ts — Phase 4 de `import-data-json`:
//   4.1 readImportFile / validateImportJson / buildImportPreview (puros, sin DB)
//   4.2 applyJsonImport con getDb/clearData/saveToIndexedDB/exportDb mockeados
//       (path reemplazo, DB vacía, shape inválido, flag, bypass D3)
//   4.3 Paridad D1: mismo fixture legacy vía applyJsonImport ==
//       migrateFromLocalStorage (mismos UUIDs/ON CONFLICT) + idempotencia con
//       la DB sql.js real (mismo patrón de aislamiento que el test de migración).
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_IMPORT_BYTES,
  buildImportPreview,
  readImportFile,
  validateImportJson,
} from '@/lib/import-json'
import type { LocalStorageData } from '@/lib/migrate-localstorage'

const STORAGE_KEY = 'daily-budget-data'
const MIGRATED_FLAG_KEY = 'daily-budget-data-migrated'

// Seed con el formato legacy (pre-pivote) tal como vivía en localStorage. El
// MISMO fixture que migrate-localstorage.test.ts: la paridad D1 exige input
// idéntico para poder comparar el output fila por fila.
function legacySeed(): LocalStorageData {
  return {
    budget: {
      startAmount: 50000,
      startDate: '2026-08-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
      mode: 'daily',
      autoSave: true,
      isSetup: true,
    },
    accounts: [
      { id: 'daily', name: 'Diario', type: 'daily', icon: 'wallet', hidden: false, balance: 34000 },
      { id: 'savings', name: 'Ahorro', type: 'savings', icon: 'piggy-bank', hidden: false, balance: 120000 },
      { id: 'custom-1', name: 'Viajes', type: 'custom', icon: 'plane', hidden: true, balance: 8000 },
    ],
    transactions: [
      { id: 'tx-1', type: 'income', amount: 50000, description: 'Sueldo', account: 'daily', date: '2026-08-01' },
      { id: 'tx-2', type: 'expense', amount: -4000, description: 'Supermercado', account: 'daily', date: '2026-08-03' },
      { id: 'tx-3', type: 'expense', amount: -6000, description: 'Vuelo', account: 'custom-1', date: '2026-08-05' },
      { id: 'tx-4', type: 'transfer', amount: -10000, description: 'Transferencia', account: 'savings', date: '2026-08-10' },
    ],
    dailyAllowance: 2000,
    remainingToday: 1100,
    progress: 0.45,
    lastCheckedDay: '2026-09-05',
    isSetup: true,
  }
}

function legacyText(): string {
  return JSON.stringify(legacySeed())
}

// ─── 4.1 funciones puras (sin DB) ──────────────────────────────

describe('validateImportJson (4.1)', () => {
  it('rechaza texto vacío → invalid-json', () => {
    expect(validateImportJson('')).toEqual({ ok: false, error: 'invalid-json' })
  })

  it('rechaza JSON que no es objeto (array) → invalid-shape', () => {
    expect(validateImportJson('[]')).toEqual({ ok: false, error: 'invalid-shape' })
    expect(validateImportJson('null')).toEqual({ ok: false, error: 'invalid-shape' })
  })

  it('rechaza account con type fuera del enum → invalid-shape', () => {
    const seed = legacySeed()
    seed.accounts[0].type = 'crypto'
    expect(validateImportJson(JSON.stringify(seed))).toEqual({
      ok: false,
      error: 'invalid-shape',
    })
  })

  it('rechaza transaction sin account (string) → invalid-shape', () => {
    const seed = legacySeed()
    // @ts-expect-error — shape inválido a propósito
    seed.transactions[0].account = undefined
    expect(validateImportJson(JSON.stringify(seed))).toEqual({
      ok: false,
      error: 'invalid-shape',
    })
  })

  it('acepta export sin hidden en una cuenta (regresión: data real del user)', () => {
    const seed = legacySeed()
    const daily = seed.accounts.find((a) => a.type === 'daily')!
    delete (daily as { hidden?: boolean }).hidden
    expect(validateImportJson(JSON.stringify(seed))).toEqual({ ok: true, data: seed })
  })

  it('tolera e ignora los campos derivados del blob legacy (D7)', () => {
    const res = validateImportJson(legacyText())
    expect(res.ok).toBe(true)
    if (res.ok) {
      // Los derivados siguen presentes pero el import los recomputa vía loadState.
      expect(res.data.dailyAllowance).toBe(2000)
      expect(res.data.progress).toBe(0.45)
    }
  })
})

describe('readImportFile (4.1)', () => {
  it('rechaza archivos > 10 MB antes de leer el texto (D7)', async () => {
    const text = vi.fn().mockResolvedValue('')
    const file = { size: MAX_IMPORT_BYTES + 1, text } as unknown as File

    const res = await readImportFile(file)

    expect(res).toEqual({ ok: false, error: 'too-large', size: MAX_IMPORT_BYTES + 1 })
    expect(text).not.toHaveBeenCalled()
  })

  it('acepta archivos exactamente en el límite y parsea el JSON', async () => {
    const file = {
      size: MAX_IMPORT_BYTES,
      text: async () => legacyText(),
    } as unknown as File

    const res = await readImportFile(file)

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.accounts).toHaveLength(3)
    }
    expect(res.size).toBe(MAX_IMPORT_BYTES)
  })

  it('propaga invalid-json con el tamaño del archivo', async () => {
    const file = { size: 48, text: async () => '{not valid json' } as unknown as File
    const res = await readImportFile(file)
    expect(res).toEqual({ ok: false, error: 'invalid-json', size: 48 })
  })

  it('devuelve el resultado validado (ok) con el tamaño del archivo', async () => {
    const file = { size: 640, text: async () => legacyText() } as unknown as File
    const res = await readImportFile(file)
    expect(res).toEqual({ ...validateImportJson(legacyText()), size: 640 })
  })
})

describe('buildImportPreview (4.1)', () => {
  it('cuenta filas, expone el modo y el rango min/max de fechas', () => {
    const preview = buildImportPreview(legacySeed())
    expect(preview).toEqual({
      accounts: 3,
      transactions: 4,
      mode: 'daily',
      dateRange: { start: '2026-08-01', end: '2026-08-10' },
      hasConfiguredBudget: true,
    })
  })

  it('sin transacciones → rango null/null; sin isSetup → sin budget configurado', () => {
    const noTx = { ...legacySeed(), transactions: [] }
    expect(buildImportPreview(noTx).dateRange).toEqual({ start: null, end: null })

    const noSetup = {
      ...legacySeed(),
      budget: { ...legacySeed().budget, isSetup: false },
    }
    expect(buildImportPreview(noSetup).hasConfiguredBudget).toBe(false)
  })

  it('sin isSetup pero startAmount > 0 → hasConfiguredBudget: true (blob legacy real)', () => {
    const blob = {
      ...legacySeed(),
      budget: { ...legacySeed().budget },
    }
    delete (blob.budget as { isSetup?: boolean }).isSetup

    expect(buildImportPreview(blob).hasConfiguredBudget).toBe(true)
  })
})

// ─── 4.2 applyJsonImport con módulos mockeados ─────────────────

describe('applyJsonImport (4.2, módulos mockeados)', () => {
  let importModule: typeof import('@/lib/import-json')
  let getDbMock: ReturnType<typeof vi.fn>
  let exportDbMock: ReturnType<typeof vi.fn>
  let saveBackupMock: ReturnType<typeof vi.fn>
  let saveToIndexedDBMock: ReturnType<typeof vi.fn>
  let clearDataMock: ReturnType<typeof vi.fn>
  let insertLegacyDataMock: ReturnType<typeof vi.fn>

  // Fake suficiente para countRows (único consumo de db en applyJsonImport).
  function fakeDb(counts = { accounts: 3, transactions: 4 }) {
    return {
      prepare: (query: string) => ({
        step: () => undefined,
        getAsObject: () => ({
          count: query.includes('transactions') ? counts.transactions : counts.accounts,
        }),
        free: () => undefined,
      }),
    }
  }

  beforeEach(async () => {
    // Aislamiento: los singletons de sql.js/IndexedDB y el localStorage de jsdom
    // se recrean por prueba. El import dinámico resuelve los módulos mockeados.
    vi.resetModules()
    window.localStorage.clear()

    getDbMock = vi.fn()
    exportDbMock = vi.fn()
    saveBackupMock = vi.fn().mockResolvedValue(undefined)
    saveToIndexedDBMock = vi.fn().mockResolvedValue(undefined)
    clearDataMock = vi.fn()
    insertLegacyDataMock = vi.fn()

    vi.doMock('@/lib/db/client', () => ({
      getDb: getDbMock,
      exportDb: exportDbMock,
    }))
    vi.doMock('@/lib/db/persistence', () => ({
      saveBackup: saveBackupMock,
      saveToIndexedDB: saveToIndexedDBMock,
    }))
    vi.doMock('@/lib/db/repository', () => ({
      clearData: clearDataMock,
    }))
    vi.doMock('@/lib/migrate-localstorage', () => ({
      insertLegacyData: insertLegacyDataMock,
      MIGRATED_FLAG_KEY: 'daily-budget-data-migrated',
    }))

    importModule = await import('@/lib/import-json')
  })

  it('path reemplazo: backup pre-import-* + clearData + flag tras éxito', async () => {
    const db = fakeDb()
    getDbMock.mockResolvedValue(db)
    exportDbMock.mockReturnValue(new Uint8Array([1, 2, 3]))

    const res = await importModule.applyJsonImport(legacyText(), { replace: true })

    // Contadores de filas resultantes (countRows sobre el fake).
    expect(res).toEqual({ accounts: 3, transactions: 4 })

    // Backup best-effort con el snapshot exportado y nombre pre-import-<ts>.
    expect(saveBackupMock).toHaveBeenCalledTimes(1)
    const [snapshot, backupName] = saveBackupMock.mock.calls[0] as [Uint8Array, string]
    expect(snapshot).toBeInstanceOf(Uint8Array)
    expect(backupName).toMatch(/^pre-import-\d+$/)

    // Reemplazo: clearData sobre la misma instancia singleton (D8, sin setDb).
    expect(clearDataMock).toHaveBeenCalledTimes(1)
    expect(clearDataMock).toHaveBeenCalledWith(db)

    // Mapeo idéntico al de la migración (D1) + persistencia + flag (FR-4.6).
    expect(insertLegacyDataMock).toHaveBeenCalledWith(db, legacySeed())
    expect(saveToIndexedDBMock).toHaveBeenCalledWith(db)
    expect(window.localStorage.getItem(MIGRATED_FLAG_KEY)).toBe('true')
  })

  it('DB vacía (replace=false): sin backup ni clearData', async () => {
    const db = fakeDb({ accounts: 0, transactions: 0 })
    getDbMock.mockResolvedValue(db)

    const res = await importModule.applyJsonImport(legacyText(), { replace: false })

    expect(res).toEqual({ accounts: 0, transactions: 0 })
    expect(saveBackupMock).not.toHaveBeenCalled()
    expect(clearDataMock).not.toHaveBeenCalled()
    expect(insertLegacyDataMock).toHaveBeenCalledTimes(1)
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(MIGRATED_FLAG_KEY)).toBe('true')
  })

  it('shape inválido → throw sin tocar la DB ni la flag', async () => {
    const db = fakeDb()
    getDbMock.mockResolvedValue(db)

    await expect(importModule.applyJsonImport('[]', { replace: true })).rejects.toEqual({
      error: 'invalid-shape',
    })
    await expect(importModule.applyJsonImport('{not json', { replace: true })).rejects.toEqual({
      error: 'invalid-json',
    })

    // Nada se tocó: ni backup, ni clearData, ni mapeo, ni persistencia, ni flag.
    expect(getDbMock).not.toHaveBeenCalled()
    expect(saveBackupMock).not.toHaveBeenCalled()
    expect(clearDataMock).not.toHaveBeenCalled()
    expect(insertLegacyDataMock).not.toHaveBeenCalled()
    expect(saveToIndexedDBMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(MIGRATED_FLAG_KEY)).toBeNull()
  })

  it('D3: la flag previa "true" NO bloquea el import manual', async () => {
    window.localStorage.setItem(MIGRATED_FLAG_KEY, 'true')
    const db = fakeDb()
    getDbMock.mockResolvedValue(db)

    const res = await importModule.applyJsonImport(legacyText(), { replace: false })

    // A diferencia de migrateFromLocalStorage (guard 3), el import manual no
    // consulta la flag: siempre inserta y persiste.
    expect(res).toEqual({ accounts: 3, transactions: 4 })
    expect(getDbMock).toHaveBeenCalledTimes(1)
    expect(insertLegacyDataMock).toHaveBeenCalledTimes(1)
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem(MIGRATED_FLAG_KEY)).toBe('true')
  })
})

// ─── 4.3 Paridad D1 + idempotencia (DB sql.js real) ─────────────

describe('Paridad D1 con migrateFromLocalStorage (4.3)', () => {
  let migrateModule: typeof import('@/lib/migrate-localstorage')
  let importModule: typeof import('@/lib/import-json')
  let clientModule: typeof import('@/lib/db/client')

  beforeEach(async () => {
    // Des-hacer los mocks del describe 4.2 (defensivo aunque 4.2 corre después)
    // y resetear módulos: getDb() construye una DB sql.js fresca con el schema.
    vi.doUnmock('@/lib/db/client')
    vi.doUnmock('@/lib/db/persistence')
    vi.doUnmock('@/lib/db/repository')
    vi.doUnmock('@/lib/migrate-localstorage')
    vi.resetModules()
    window.localStorage.clear()

    migrateModule = await import('@/lib/migrate-localstorage')
    importModule = await import('@/lib/import-json')
    clientModule = await import('@/lib/db/client')
    clientModule.resetDb()
  })

  afterEach(async () => {
    // Dejar el proceso limpio para la próxima prueba: borra el snapshot de
    // IndexedDB y el singleton sql.js.
    const { clearIndexedDB } = await import('@/lib/db/persistence')
    await clearIndexedDB().catch(() => undefined)
    clientModule.resetDb()
  })

  const selectCount = async (table: string): Promise<number> => {
    const db = await clientModule.getDb()
    const stmt = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    stmt.step()
    const row = stmt.getAsObject() as { count: number }
    stmt.free()
    return row.count
  }

  // Snapshot determinista del estado (sin created_at/updated_at: diff de
  // timestamps por corrida). Compara lo que D1 promete: mismos ids/UUIDs,
  // mismo mapeo account→account_id y ON CONFLICT.
  async function snapshotState() {
    const db = await clientModule.getDb()
    const rows = <T>(sql: string): T[] => {
      const res = db.exec(sql)
      if (res.length === 0) return []
      const { columns, values } = res[0]
      return values.map((row) =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]]))
      ) as T[]
    }
    return {
      accounts: rows(`SELECT id, name, type, icon, hidden FROM accounts ORDER BY id`),
      transactions: rows(
        `SELECT id, type, amount, description, account_id, date FROM transactions ORDER BY id`
      ),
      budgets: rows(`SELECT id, start_amount, start_date, end_date, auto_save, mode, is_setup FROM budgets`),
    }
  }

  it('applyJsonImport produce el mismo estado que migrateFromLocalStorage (D1)', async () => {
    // Corrida A: migración automática (guardas + insertLegacyData).
    window.localStorage.setItem(STORAGE_KEY, legacyText())
    await migrateModule.migrateFromLocalStorage()
    const migrated = await snapshotState()

    // Corrida B: import manual sobre DB fresca.
    clientModule.resetDb()
    window.localStorage.clear()
    const result = await importModule.applyJsonImport(legacyText(), { replace: false })
    // applyJsonImport ya persistió a IndexedDB por dentro; aquí comparamos el
    // estado de la DB sql.js contra la corrida de migración.
    const imported = await snapshotState()

    expect(result).toEqual({ accounts: 3, transactions: 4 })
    // Mismos UUIDs estables, mismo mapeo de account y mismos montos/fechas.
    expect(imported).toEqual(migrated)
  })

  it('es idempotente: doble import no duplica filas (ON CONFLICT DO NOTHING)', async () => {
    const first = await importModule.applyJsonImport(legacyText(), { replace: false })
    const second = await importModule.applyJsonImport(legacyText(), { replace: false })

    expect(first).toEqual({ accounts: 3, transactions: 4 })
    expect(second).toEqual(first)
    expect(await selectCount('accounts')).toBe(3)
    expect(await selectCount('transactions')).toBe(4)
    expect(await selectCount('budgets')).toBe(1)
  })

  it('D1: blob sin isSetup pero startAmount > 0 → is_setup=1 en la fila budgets', async () => {
    const blob = legacySeed()
    delete (blob.budget as { isSetup?: boolean }).isSetup

    await importModule.applyJsonImport(JSON.stringify(blob), { replace: false })

    const db = await clientModule.getDb()
    const stmt = db.prepare(`SELECT is_setup FROM budgets`)
    stmt.step()
    const budget = stmt.getAsObject() as { is_setup: number }
    stmt.free()

    expect(budget.is_setup).toBe(1)
  })
})