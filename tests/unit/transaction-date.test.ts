import { describe, it, expect } from 'vitest'
import { formatTransactionDate } from '@/lib/transaction-date'

describe('formatTransactionDate', () => {
  // Local-time construction on purpose: `new Date('2026-10-18')` is parsed as
  // UTC midnight and renders as the previous day west of Greenwich, which would
  // make the expected label timezone-dependent.
  const sunday = new Date(2026, 9, 18)

  it('formats a short date without the weekday by default', () => {
    expect(formatTransactionDate(sunday, 'es')).toBe('18 oct')
    expect(formatTransactionDate(sunday, 'en')).toBe('18 Oct')
  })

  it('prepends the short weekday name when asked for it', () => {
    expect(formatTransactionDate(sunday, 'es', { weekday: true })).toBe('dom 18 oct')
    expect(formatTransactionDate(sunday, 'en', { weekday: true })).toBe('Sun 18 Oct')
  })

  it('shows the weekday of the day it displays, whatever the timezone', () => {
    // The weekday and the day number are the two halves of the same date, so
    // they can never drift apart: the only way they could disagree is if one
    // of them was derived from a different instant.
    const weekdays = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

    for (const iso of ['2026-10-18', '2026-01-01', '2026-03-15', '2026-12-31']) {
      const value = new Date(iso)
      const localDay = new Date(value.getFullYear(), value.getMonth(), value.getDate())
      const expectedWeekday = weekdays[localDay.getDay()]

      const label = formatTransactionDate(iso, 'es', { weekday: true })

      expect(label.startsWith(`${expectedWeekday} `)).toBe(true)
    }
  })
})
