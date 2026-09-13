// @vitest-environment jsdom
// tests/unit/autosave.test.ts
// Capa de autosave: snapshot sql.js → IndexedDB con debounce tras mutaciones.
// RED stage — target: lib/db/autosave.ts (aún no existe → este archivo falla
// al resolver el import, que es exactamente el fail esperado por implementación
// ausente, ver task 2.1 / 2.5).
import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest'
import type { Database } from 'sql.js'

// Hoisted mocks: vitest hoistea vi.mock al tope, así que los mocks deben vivir
// fuera de la factory para ser visibles desde los tests.
const { getDbMock, saveToIndexedDBMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  saveToIndexedDBMock: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: getDbMock,
}))

vi.mock('@/lib/db/persistence', () => ({
  saveToIndexedDB: saveToIndexedDBMock,
}))

// Import después de los mock: en RED el módulo no existe y el suite rompe
// (fail por implementación ausente); en GREEN se resuelve contra el real.
import { schedule, flushNow, subscribeToVisibility } from '@/lib/db/autosave'

const FAKE_DB = { export: () => new Uint8Array([1, 2, 3, 255]) } as unknown as Database

async function flushMicrotasks(): Promise<void> {
  // vitest 0.34 tipa advanceTimersByTimeAsync como Promise<VitestUtils> (error
  // de sus tipos); await interno conserva la semántica void del helper.
  await vi.advanceTimersByTimeAsync(0)
}

describe('autosave: schedule() (debounce 300 ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getDbMock.mockReset()
    saveToIndexedDBMock.mockReset()
    getDbMock.mockResolvedValue(FAKE_DB)
    saveToIndexedDBMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persiste el snapshot tras una mutación: a now+300ms saveToIndexedDB recibe la DB (exportada)', async () => {
    schedule()

    expect(saveToIndexedDBMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(299)
    expect(saveToIndexedDBMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)
    expect(getDbMock).toHaveBeenCalledTimes(1)

    const persisted = saveToIndexedDBMock.mock.calls[0][0] as Database
    expect(Array.from(persisted.export())).toEqual([1, 2, 3, 255])
  })

  it('ráfaga de schedule() (2+ mutaciones en <300 ms) → 1 solo persist (debounce agrupa)', async () => {
    schedule()
    schedule()
    schedule()

    await vi.advanceTimersByTimeAsync(299)
    expect(saveToIndexedDBMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)

    // Confirmamos que la ventana ya quedó limpia (sin persist duplicado).
    await vi.advanceTimersByTimeAsync(600)
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)
  })
})

describe('autosave: flushNow()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getDbMock.mockReset()
    saveToIndexedDBMock.mockReset()
    getDbMock.mockResolvedValue(FAKE_DB)
    saveToIndexedDBMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persiste inmediato (sin esperar el debounce) y cancela el pendiente', async () => {
    schedule()
    void flushNow()

    await flushMicrotasks()
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)

    // El timer pendiente quedó cancelado → no hay persist duplicado.
    await vi.advanceTimersByTimeAsync(400)
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)
  })

  it('concurrencia: two flushNow superpuestos comparten 1 solo persist', async () => {
    void flushNow()
    void flushNow()

    await flushMicrotasks()
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)
  })
})

describe('autosave: persist best-effort', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getDbMock.mockReset()
    saveToIndexedDBMock.mockReset()
    getDbMock.mockResolvedValue(FAKE_DB)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('no tira si saveToIndexedDB rechaza (catch + log), la UI sigue viva', async () => {
    const error = new Error('quota exceeded')
    saveToIndexedDBMock.mockRejectedValueOnce(error)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    schedule()
    // vitest 0.34: advanceTimersByTimeAsync resuelve al estado interno del
    // clock (objeto), nunca undefined. Lo importante es que el tick no
    // propague el rechazo del persist (best-effort) — await no lanza.
    await vi.advanceTimersByTimeAsync(300)

    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(expect.any(String), error)

    spy.mockRestore()
  })
})

describe('autosave: subscribeToVisibility()', () => {
  const env = { hidden: false }

  beforeAll(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (env.hidden ? 'hidden' : 'visible'),
    })
  })

  beforeEach(() => {
    vi.useFakeTimers()
    env.hidden = false
    getDbMock.mockReset()
    saveToIndexedDBMock.mockReset()
    getDbMock.mockResolvedValue(FAKE_DB)
    saveToIndexedDBMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flush en pagehide y visibilitychange→hidden (sin duplicar si ambos disparan)', async () => {
    const unsubscribe = subscribeToVisibility()
    schedule()

    env.hidden = true
    window.dispatchEvent(new Event('pagehide'))
    document.dispatchEvent(new Event('visibilitychange'))

    await flushMicrotasks()
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)

    // El timer del debounce quedó cancelado → sigue sin duplicarse.
    await vi.advanceTimersByTimeAsync(400)
    expect(saveToIndexedDBMock).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('devuelve un unsubscribe que desregistra los listeners', async () => {
    const unsubscribe = subscribeToVisibility()

    saveToIndexedDBMock.mockClear()
    unsubscribe()

    env.hidden = true
    window.dispatchEvent(new Event('pagehide'))
    document.dispatchEvent(new Event('visibilitychange'))

    await flushMicrotasks()
    expect(saveToIndexedDBMock).not.toHaveBeenCalled()
  })

  it('visibilitychange→visible NO dispara flush', async () => {
    const unsubscribe = subscribeToVisibility()

    document.dispatchEvent(new Event('visibilitychange'))

    await flushMicrotasks()
    expect(saveToIndexedDBMock).not.toHaveBeenCalled()

    unsubscribe()
  })
})