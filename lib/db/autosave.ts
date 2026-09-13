// lib/db/autosave.ts
// Capa de autosave: snapshot sql.js → IndexedDB con debounce tras mutaciones.
// La UI es 100% client-side (sql.js en memoria) y el ÚNICO lugar persistente
// es el snapshot en IndexedDB; antes este módulo no existía y solo se persistía
// en migración legacy / import QR, así que un reload resucitaba un snapshot
// stale (bug "setup track no arranca").
//
// Contratos (ver tests/unit/autosave.test.ts):
//   schedule()          — programa un persist a now+300ms; una ráfaga de
//                         mutaciones agrupa en 1 solo persist (debounce).
//   flushNow()          — persiste inmediato, cancela el timer pendiente y
//                         comparte el persist si ya hay uno en vuelo.
//   subscribeToVisibility() — flush en pagehide y visibilitychange→hidden
//                         (sin duplicar); devuelve unsubscribe.
// El persist es best-effort: nunca tira al caller (catch + console.error).
import type { Database } from 'sql.js'
import { getDb } from '@/lib/db/client'
import { saveToIndexedDB } from '@/lib/db/persistence'

const AUTOSAVE_DEBOUNCE_MS = 300

let timer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null

async function persist(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const db: Database = await getDb()
      await saveToIndexedDB(db)
    } catch (error) {
      console.error('[autosave] failed to persist snapshot', error)
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/**
 * Debounced persist: a las 300 ms de la última mutación se exporta el
 * snapshot actual de la DB a IndexedDB. Llamar varias veces seguidas
 * reinicia la ventana y agrupa en 1 solo persist.
 */
export function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void persist()
  }, AUTOSAVE_DEBOUNCE_MS)
}

/**
 * Persist inmediato: cancela el debounce pendiente y exporta ya. Usado en
 * clearData, day-rollover y los hooks de visibilidad. Si ya hay un persist
 * en vuelo, lo comparte (sin duplicar trabajo).
 */
export function flushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  return persist()
}

/**
 * Suscribe flush en los eventos de ciclo de vida de la página: pagehide
 * (cierre/navegación) y visibilitychange→hidden (cambiar de pestaña / bajar
 * la app). Devuelve una función para desuscribirse.
 */
export function subscribeToVisibility(): () => void {
  const onPageHide = (): void => {
    void flushNow()
  }
  const onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void flushNow()
    }
  }
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}