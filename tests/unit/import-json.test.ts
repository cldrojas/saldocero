import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBudget } from '@/hooks/use-budget'
import {
  applyJsonImport,
  buildImportPreview,
  MAX_IMPORT_BYTES,
  readImportFile,
  validateImportJson,
  type ImportPreview,
} from '@/lib/import-json'
import type { LegacyImportData } from '@/lib/import-json'

// ─── localStorage mock (Map-backed, para leer el blob persistido) ──────────

const STORAGE_KEY = 'daily-budget-data'

const store = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    store.delete(key)
  }),
  clear: vi.fn(() => {
    store.clear()
  }),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// ─── Mocks de módulos (mismo patrón que use-budget.test.tsx) ───────────────

// Mock date-fns: date-fns se resuelve tanto en use-budget como en
// lib/daily-metrics; la implementación es determinista.
vi.mock('date-fns', () => ({
  differenceInDays: vi.fn((date1, date2) => Math.floor((date1 - date2) / (1000 * 60 * 60 * 24))),
  startOfDay: vi.fn((date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())),
  isSameDay: vi.fn((date1, date2) => date1.toDateString() === date2.toDateString()),
  isToday: vi.fn((date) => new Date().toDateString() === date.toDateString()),
}))

// Mock uuid con IDs únicos (solo se usa si una transacción importada no trae id).
let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    const id = `mock-uuid-${uuidCounter}`
    uuidCounter++
    return id
  }),
}))

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** ISO con ms+Z de hoy ± days (roundtrip estable new Date(iso).toISOString()). */
function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

// Import diario-mode COMPLETO con derivados basura: prueba que replaceAll NO
// confía en dailyAllowance/remainingToday/progress/isSetup del archivo.
const dailyImport: LegacyImportData = {
  budget: {
    startAmount: 8000,
    startDate: isoDaysFromNow(-5),
    endDate: isoDaysFromNow(7),
    mode: 'daily',
    autoSave: false,
    isSetup: false, // el guard lo tolera; replaceAll fuerza isSetup top-level true
  },
  accounts: [
    { id: 'daily', name: 'Diario', type: 'daily', icon: 'wallet', balance: 8000 },
    // Sin id ni icon: replaceAll debe normalizar (slug + 'wallet').
    { name: 'Viajes', type: 'custom', balance: 5000, hidden: true },
  ],
  transactions: [
    {
      id: 'tx-1',
      type: 'income',
      amount: 8000,
      description: 'Sueldo',
      account: 'daily',
      date: isoDaysFromNow(-5),
    },
    // Sin id: replaceAll debe asignar uuid. Gasto de HOY en 'daily'.
    { type: 'expense', amount: -400, description: 'Café', account: 'daily', date: new Date().toISOString() },
  ],
  dailyAllowance: 999, // basura: NO debe persistir
  remainingToday: 999, // basura
  progress: 0, // basura
  lastCheckedDay: new Date().toISOString(), // hoy → el day-check no hace rollover
  isSetup: false, // basura: replaceAll debe forzar true
}

// Import MÍNIMO: solo los campos que exige el type guard (sin opcionales).
const minimalImport: LegacyImportData = {
  budget: { startAmount: 1000, mode: 'track' },
  accounts: [{ name: 'Diario', type: 'daily', balance: 1000 }],
  transactions: [{ type: 'income', amount: 1000, account: 'daily' }],
}

// Import track-mode sin lastCheckedDay ni derivados.
const trackImport: LegacyImportData = {
  budget: { startAmount: 1000, mode: 'track', autoSave: true },
  accounts: [{ id: 'daily', name: 'Diario', type: 'daily', balance: 1000 }],
  transactions: [],
}

// Import con budget sin isSetup y startAmount 0 (device fresco) y con
// startAmount > 0 (configurado por regresión).
const freshBudgetImport: LegacyImportData = {
  budget: { startAmount: 0, mode: 'track' },
  accounts: [],
  transactions: [],
}
const configuredByAmountImport: LegacyImportData = {
  budget: { startAmount: 500, mode: 'track' },
  accounts: [],
  transactions: [],
}

function asFile(overrides: Partial<File> & { text?: () => Promise<string> }): File {
  return { size: 0, text: vi.fn(async () => ''), ...overrides } as unknown as File
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('validateImportJson — matriz de validación', () => {
  it('rechaza JSON inválido', () => {
    expect(validateImportJson('{esto no es json')).toEqual({ ok: false, error: 'invalid-json' })
  })

  it('rechaza shape inválido (no es un objeto con budget/accounts/transactions)', () => {
    expect(validateImportJson(JSON.stringify({ foo: 1 }))).toEqual({
      ok: false,
      error: 'invalid-shape',
    })
  })

  it('rechaza cuentas con type fuera del enum', () => {
    const bad = JSON.parse(JSON.stringify(minimalImport))
    bad.accounts[0].type = 'cripto'
    expect(validateImportJson(JSON.stringify(bad))).toEqual({ ok: false, error: 'invalid-shape' })
  })

  it('rechaza balance no numérico', () => {
    const bad = JSON.parse(JSON.stringify(minimalImport))
    bad.accounts[0].balance = 'mil'
    expect(validateImportJson(JSON.stringify(bad))).toEqual({ ok: false, error: 'invalid-shape' })
  })

  it('rechaza budget sin startAmount numérico', () => {
    const bad = JSON.parse(JSON.stringify(minimalImport))
    delete bad.budget.startAmount
    expect(validateImportJson(JSON.stringify(bad))).toEqual({ ok: false, error: 'invalid-shape' })
  })

  it('acepta el shape MÍNIMO (sin id/icon/hidden/isSetup/date/description/derivados)', () => {
    const res = validateImportJson(JSON.stringify(minimalImport))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.budget.mode).toBe('track')
      expect(res.data.accounts).toHaveLength(1)
    }
  })

  it('acepta el shape COMPLETO (ids, icon, hidden, isSetup, fechas, derivados)', () => {
    const res = validateImportJson(JSON.stringify(dailyImport))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.budget.isSetup).toBe(false) // tolerado, no exigido
      expect(res.data.accounts[1].hidden).toBe(true)
      expect(res.data.dailyAllowance).toBe(999) // tolerado, se ignora en apply
    }
  })
})

describe('readImportFile — tamaño y pipeline', () => {
  it('rechaza archivos > 10 MB ANTES de leer el texto', async () => {
    const text = vi.fn(async () => '')
    const file = asFile({ size: MAX_IMPORT_BYTES + 1, text })
    const res = await readImportFile(file)
    expect(res).toEqual({ ok: false, error: 'too-large', size: MAX_IMPORT_BYTES + 1 })
    expect(text).not.toHaveBeenCalled()
  })

  it('acepta el límite exacto de 10 MB', async () => {
    const file = asFile({ size: MAX_IMPORT_BYTES, text: async () => JSON.stringify(minimalImport) })
    const res = await readImportFile(file)
    expect(res).toEqual({ ok: true, data: minimalImport, size: MAX_IMPORT_BYTES })
  })

  it('propaga invalid-json desde el texto', async () => {
    const file = asFile({ size: 10, text: async () => '{rotos' })
    const res = await readImportFile(file)
    expect(res).toEqual({ ok: false, error: 'invalid-json', size: 10 })
  })

  it('propaga invalid-shape desde el texto', async () => {
    const file = asFile({ size: 10, text: async () => '{"foo":1}' })
    const res = await readImportFile(file)
    expect(res).toEqual({ ok: false, error: 'invalid-shape', size: 10 })
  })
})

describe('buildImportPreview — contadores, modo y rango de fechas', () => {
  it('cuenta cuentas/transacciones, modo y rango min/max del archivo', () => {
    const preview = buildImportPreview(dailyImport)
    expect(preview).toMatchObject<Partial<ImportPreview>>({
      accounts: 2,
      transactions: 2,
      mode: 'daily',
      dateRange: {
        start: dailyImport.transactions[0].date ?? null, // min lexicográfico real del fixture
        end: dailyImport.transactions[1].date ?? null, // max (ISO capturado del fixture)
      },
    })
  })

  it('devuelve rango null/null sin transacciones con fecha', () => {
    const preview = buildImportPreview(trackImport)
    expect(preview.dateRange).toEqual({ start: null, end: null })
  })

  it('hasConfiguredBudget: respeta isSetup explícito', () => {
    expect(buildImportPreview(dailyImport).hasConfiguredBudget).toBe(false) // isSetup: false
    expect(buildImportPreview(minimalImport).hasConfiguredBudget).toBe(true) // sin isSetup + startAmount > 0
    expect(buildImportPreview(freshBudgetImport).hasConfiguredBudget).toBe(false) // sin isSetup + 0
    expect(buildImportPreview(configuredByAmountImport).hasConfiguredBudget).toBe(true)
  })
})

describe('applyJsonImport — valida y delega el volcado', () => {
  it('invoca replace con el data parseado y devuelve los contadores', () => {
    const replace = vi.fn()
    const result = applyJsonImport(JSON.stringify(dailyImport), replace)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(dailyImport)
    expect(result).toEqual({ accounts: 2, transactions: 2 })
  })

  it('lanza { error } sin invocar replace si el shape es inválido', () => {
    const replace = vi.fn()
    expect(() => applyJsonImport('{rotos', replace)).toThrow(
      expect.objectContaining({ error: 'invalid-json' })
    )
    expect(() => applyJsonImport('{"foo":1}', replace)).toThrow(
      expect.objectContaining({ error: 'invalid-shape' })
    )
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('Integración: useBudget().replaceAll → estado + blob de localStorage', () => {
  beforeEach(() => {
    store.clear()
    uuidCounter = 0
  })

  it('reemplaza el estado y persiste el blob EXACTO con derivados RECOMPUTADOS', () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.replaceAll(dailyImport)
    })

    // Estado de React refleja lo importado (sin reload).
    expect(result.current.isSetup).toBe(true)
    expect(result.current.accounts).toHaveLength(2)
    expect(result.current.accounts.map((a) => a.name)).toEqual(['Diario', 'Viajes'])
    expect(result.current.transactions).toHaveLength(2)

    // Blob persistido: shape del save() de use-budget.
    const raw = store.get(STORAGE_KEY)
    expect(raw).toBeDefined()
    const blob = JSON.parse(raw!) as Record<string, unknown>

    // Las claves exactas del save effect (isSetup top-level true).
    expect(Object.keys(blob).sort()).toEqual([
      'accounts',
      'budget',
      'dailyAllowance',
      'isSetup',
      'lastCheckedDay',
      'progress',
      'remainingToday',
      'transactions',
    ])
    expect(blob.isSetup).toBe(true)

    // budget: shape EXACTO de Budget (sin isSetup adentro) y fechas ISO estables.
    const budget = blob.budget as Record<string, unknown>
    expect(Object.keys(budget).sort()).toEqual(['autoSave', 'endDate', 'mode', 'startAmount', 'startDate'])
    expect(budget).toMatchObject({
      startAmount: 8000,
      endDate: dailyImport.budget.endDate, // roundtrip estable del ISO del fixture
      startDate: dailyImport.budget.startDate,
      mode: 'daily',
      autoSave: false,
    })

    // accounts normalizadas: id/icon default, hidden preservado, balance toInt.
    const accounts = blob.accounts as Array<Record<string, unknown>>
    expect(accounts).toHaveLength(2)
    expect(accounts[0]).toMatchObject({ id: 'daily', name: 'Diario', type: 'daily', icon: 'wallet', balance: 8000 })
    expect(accounts[1]).toMatchObject({ id: 'viajes', name: 'Viajes', type: 'custom', icon: 'wallet', balance: 5000, hidden: true })

    // transactions: la de hoy sin id recibió uuid; fechas a ISO (roundtrip
    // estable del ISO capturado en el fixture).
    const transactions = blob.transactions as Array<Record<string, unknown>>
    expect(transactions).toHaveLength(2)
    expect(transactions[0]).toMatchObject({ id: 'tx-1', amount: 8000 })
    expect(transactions[1]).toMatchObject({ id: 'mock-uuid-0', amount: -400, account: 'daily' })
    expect(transactions[1].date).toBe(dailyImport.transactions[1].date)

    // Derivados RECOMPUTADOS (los del archivo eran basura): daily balance 8000,
    // días restantes = differenceInDays(end, hoy)+1 = 8 → allowance 1000;
    // gastado hoy = 400 → remaining 600, progress 60.
    expect(blob.dailyAllowance).toBe(1000)
    expect(blob.remainingToday).toBe(600)
    expect(blob.progress).toBe(60)
    expect(blob.lastCheckedDay).toBe(dailyImport.lastCheckedDay)
  })

  it('track mode sin lastCheckedDay: derivados 0/0/100 y lastCheckedDay = hoy', () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.replaceAll(trackImport)
    })

    expect(result.current.isSetup).toBe(true)
    expect(result.current.accounts).toHaveLength(1)

    const blob = JSON.parse(store.get(STORAGE_KEY)!) as Record<string, unknown>
    expect(blob.isSetup).toBe(true)
    expect(blob.dailyAllowance).toBe(0)
    expect(blob.remainingToday).toBe(0)
    expect(blob.progress).toBe(100)
    // Sin lastCheckedDay en el archivo → hoy (startOfDay, como el hook).
    const midnightToday = new Date()
    midnightToday.setHours(0, 0, 0, 0)
    expect(blob.lastCheckedDay).toBe(midnightToday.toISOString())
  })

  it('import MÍNIMO: normaliza defaults (id slug, icon, uuid, descripción vacía)', () => {
    const { result } = renderHook(() => useBudget())

    act(() => {
      result.current.replaceAll(minimalImport)
    })

    expect(result.current.accounts[0]).toMatchObject({ id: 'diario', icon: 'wallet' })
    expect(result.current.transactions[0]).toMatchObject({
      id: 'mock-uuid-0',
      description: '',
      type: 'income',
    })
  })
})