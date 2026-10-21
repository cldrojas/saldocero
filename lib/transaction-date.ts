import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import type { Language } from '@/contexts/language-context'

/**
 * Short transaction date ("12 abr") honoring the active language locale.
 * Shared by TransactionHistory and the desktop RecentTransactions card so both
 * surfaces format dates identically (issue #10, Phase B).
 *
 * With `weekday: true` the short weekday name is prepended ("dom 12 abr"). The
 * weekday and the day number are formatted from the SAME date, so they can
 * never disagree about which day it is — no timezone off-by-one drift between
 * two separately derived parts.
 */
export function formatTransactionDate(
  date: Date | string,
  language: Language,
  options: { weekday?: boolean } = {}
) {
  const locale = language === 'es' ? es : undefined
  const value = new Date(date)

  // The trailing dot some locales put on abbreviated months ("abr.") is not
  // part of this UI's label.
  const month = format(value, 'MMM', { locale }).replace(/\./g, '').slice(0, 3)
  const day = format(value, 'd', { locale })

  if (!options.weekday) return `${day} ${month}`

  return `${format(value, 'EEE', { locale })} ${day} ${month}`
}
