import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import type { Language } from '@/contexts/language-context'

/**
 * Short transaction date ("12 abr") honoring the active language locale.
 * Shared by TransactionHistory and the desktop RecentTransactions card so both
 * surfaces format dates identically (issue #10, Phase B).
 */
export function formatTransactionDate(date: Date | string, language: Language) {
  const locale = language === 'es' ? es : undefined
  const formattedDate = format(new Date(date), 'd MMM', { locale }).replace(/\./g, '')
  const [day, month] = formattedDate.split(' ')
  return `${day} ${month.slice(0, 3)}`
}