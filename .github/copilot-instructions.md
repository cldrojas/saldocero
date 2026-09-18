# Copilot Instructions — daily-budget

This file gives focused, actionable guidance for AI coding agents working on the daily-budget repository. Keep it short and concrete.

1. Big picture
   - Next.js App Router frontend only (app/). No server-side backend code in this repo; state is in-browser via `hooks/use-budget.tsx` and persisted to `localStorage`.
   - UI is componentized under `components/` with small, reusable primitives in `components/ui/` (Radix + Tailwind patterns).
   - Global contexts: `contexts/language-context.tsx` and `contexts/currency-context.tsx` provide localized strings and currency formatting used across components.
   - Data flows: user actions -> `useBudget()` hook mutates `accounts`, `transactions`, `budget` -> persisted to `localStorage` -> UI re-renders. Many components import `useBudget()` directly to read/update state.

2. Important files and patterns (quick map)
   - `hooks/use-budget.tsx` — single source of truth for accounts/transactions/daily allowance logic. Read this file before changing domain logic; it contains important business rules (daily allowance calculation, transfer logic, default accounts `daily`, `savings`).
   - `components/transaction-history.tsx` and `components/transactions-list.tsx` — where transactions are rendered. Prefer resolving account names via `accounts.find(acc => acc.id === transaction.account)` and show `account.name`.
   - `components/transaction-modal.tsx` — add/edit transaction UI. Uses `accounts` prop (id + name). Select controls use `value={acc.id}` and show `acc.name` in list items.
   - `components/accounts-list.tsx`, `components/account-edit-modal.tsx` — account CRUD UI. Account shape: `{ id: string; name: string; type: string; balance: number; icon?: string }`.
   - `components/ui/*` — UI primitives used app-wide. Keep changes small and consistent with current props and composition.
   - `types/index.ts` — canonical TS types (Transaction, Account, etc.). Use them when adding or updating components.

3. Conventions and gotchas
   - Translation: `useLanguage().t(key)` is used for translatable strings. Do NOT pass dynamic user content (like account names) into `t()`; instead render the literal `account.name` and fall back to `t('unknownAccount')` when missing.
   - Default accounts: `daily`, `savings`, (and `investment` referenced in code). They should not be deleted — deletion logic in `use-budget.tsx` checks `DEFAULT_ACCOUNT_IDS`.
   - Dates: use `date-fns` with locale chosen from `language` context (`es` used when Spanish). Use `format(new Date(...), 'd MMM yyyy', { locale })`.
   - Persistence: state saved to `localStorage` key `daily-budget-data`. When editing state logic, think about backwards compatibility with previously saved shapes (the hook reparses dates on load).
   - Typescript: project is TypeScript-first. If adding functions/components, import types from `types/index.ts` and annotate props to avoid implicit `any` errors (the repo currently fails `tsc` for some components if props are untyped).

4. Developer workflows (commands discovered)
   - Install: `pnpm install` (or `npm install`). Repository uses pnpm but npm also works.
   - Dev server: `pnpm dev` (runs Next.js frontend)
   - Typecheck: `pnpm tsc --noEmit` (run from repo root)
    - Tests:
       - Unit/integration: `pnpm test` (Vitest, runs `tests/unit/**`)
       - UI: `pnpm test:ui` (Playwright — starts `pnpm dev` automatically)
       - Coverage: `pnpm test:coverage`
    - Lint: `pnpm lint`. Avoid large refactors without running `pnpm tsc` and `pnpm test`.

5. Integration points / external deps
   - UI libs: Tailwind CSS, Radix UI primitives, Lucide icon set
   - Persistence: no remote backend by default; prepared for Cloudflare Workers / D1 if backend is added (README notes planned integrations).

6. When editing UI that shows accounts or transactions
   - Always resolve `account` from `useBudget().accounts` (or prop `accounts`) and render `account?.name` directly.
   - Avoid `t(account.name)` — translations are for fixed keys only.
   - When changing transaction/account shapes, update `hooks/use-budget.tsx` and `types/index.ts` together and run `pnpm tsc`.

7. Small examples (copyable)
   - Resolve and render account name safely:
     const account = accounts.find(acc => acc.id === transaction.account)
     // show literal name, fallback to translation
     {account ? account.name : t('unknownAccount')}

   - Add a transaction via hook:
     addTransaction({ type: 'expense', amount: 12.34, description: 'Lunch', account: 'daily', date: new Date() })

8. Files to read first for context
   - `hooks/use-budget.tsx`
   - `components/transaction-history.tsx`
   - `components/transactions-list.tsx`
   - `components/transaction-modal.tsx`
   - `types/index.ts`
   - `README.md` (project overview)
   - `vitest.config.ts` and `playwright.config.ts` for test runner config
   - `.github/workflows/tests.yml` for CI test steps

If you want, I can iterate: merge this into an existing `.github/copilot-instructions.md` if one exists, or adjust tone/length. Any specific areas you want expanded (tests, deployment, backend wiring)?
