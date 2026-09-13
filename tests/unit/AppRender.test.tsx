import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import DailyBudgetApp from '@/app/page'
import { LanguageProvider } from '@/contexts/language-context'
import { CurrencyProvider } from '@/contexts/currency-context'

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: {
    replace: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}))

// Smoke test: render the main page component and assert on the app title
describe('App render', () => {
  it('renders app title', async () => {
    render(
      <LanguageProvider>
        <CurrencyProvider>
          <DailyBudgetApp />
        </CurrencyProvider>
      </LanguageProvider>
    )
    expect(await screen.findByText('Saldo Cero')).toBeInTheDocument()
  })
})
