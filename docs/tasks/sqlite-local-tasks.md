# Tasks: sqlite-local (Pivote de Arquitectura — localStorage → SQLite local-first)

Referencias: PRD `docs/requirements/sqlite-local.md` · Design `docs/design/sqlite-local-design.md` · Migración `docs/migrations/2026-08-31-sqlite-local.md`

Leyenda: `[x]` completado / `[ ]` pendiente

---

## Fase 1: SQLite + Schema + Server Actions + next.config (2 días)

- [x] 1.1 `pnpm add better-sqlite3` (⚠️ native addon — requiere compilación C++ y `serverExternalPackages`; verificar que compila en el runtime Node de Next 16) — **v13.0.3 instalado; verificado en Next 16.2.6 dev server**
- [x] 1.2 Actualizar `next.config.mjs` (hoy `{}`) con:
      ```js
      const nextConfig = { serverExternalPackages: ['better-sqlite3'] }
      export default nextConfig
      ```
- [x] 1.3 Crear `lib/db/schema.sql` con DDL idempotente (`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`) de las 4 tablas:
      - `accounts` (id TEXT PK UUID v4, name, type CHECK daily/savings/investment/custom, icon DEFAULT 'wallet', hidden DEFAULT 0, created_at/updated_at)
      - `transactions` (id TEXT PK, type CHECK expense/transfer/income/adjustment, amount INTEGER, description, account_id TEXT FK → accounts(id), date, created_at/updated_at)
      - índice `idx_tx_date ON transactions(account_id, date)`
      - `budgets` (id TEXT PK DEFAULT 'default' — singleton, start_amount DEFAULT 0, start_date, end_date, auto_save DEFAULT 1, mode CHECK daily/track, is_setup DEFAULT 0)
      - `recurring_events` (id TEXT PK, description, type CHECK income/expense, amount, frequency CHECK monthly/weekly/bimonthly/once, day_of_month, day_of_week, start_date, end_date, active DEFAULT 1, created_at/updated_at) — copiar DDL de DESIGN §"Schema SQL" — **verificado en smoke: tablas accounts, budgets, recurring_events, transactions**
- [x] 1.4 Crear `lib/db/index.ts` — conexión singleton con patrón del DESIGN: `getDb()` cacheado en `globalThis.__db` (guard HMR); `DB_PATH = process.env.SQLITE_DB_PATH || path.join(process.cwd(),'data','saldo-cero.db')`; asegurar `data/` con `fs.mkdirSync(recursive)`; `journal_mode = WAL`; `foreign_keys = ON`; aplicar `schema.sql` en el primer `getDb()`; exportar `getDb`
- [x] 1.5 Crear `app/actions/budget.ts` ('use server') con: `loadState() → {budget, accounts (balance=SUM transactions), transactions}`, `setupBudget({startAmount,endDate,mode})` (ACID: insert budget + create income transaction + upsert daily account), `updateConfig({startAmount?,endDate?,mode?,autoSave?})` (ACID), `toggleAutoSave()`, `clearData()` (ACID — TRUNCATE 3 tablas). Dates como ISO strings; retornos JSON-serializables
- [x] 1.6 Crear `app/actions/transactions.ts` ('use server') con: `addTransaction → {id}` (UUID server-side), `removeTransaction(id,refund?)`, `updateTransaction`, `transferFunds({amount,from_account_id,to_account_id,description})` (ACID: INSERT expense from + INSERT income to en `db.transaction()`)
- [x] 1.7 Crear `app/actions/accounts.ts` ('use server') con: `addAccount → {id}`, `updateAccount({id,name,type,icon,hidden})`, `deleteAccount(id)` (ACID: si balance>0 drain a savings + DELETE account)
- [x] 1.8 Crear `app/actions/recurring.ts` ('use server') con: `loadRecurringEvents`, `addRecurringEvent → {id}`, `updateRecurringEvent`, `deleteRecurringEvent` (CRUD sobre `recurring_events`)
- [x] 1.9 Crear `app/actions/projection.ts` ('use server') con: `computeProjection(horizonDays?) → CashflowDayResult[]` (wrapper que delega en `lib/projection.ts` de Fase 3 — stub inicial que retorna `[]` o se implementa junto a Fase 3)
- [x] 1.10 Agregar `data/saldo-cero.db` + `data/*.db-wal` + `data/*.db-shm` a `.gitignore` (también en `data/.gitignore` si se prefiere)
- [x] 1.11 Verificar: `pnpm tsc --noEmit` pasa; smoke test en `pnpm dev` que `lib/db/index.ts` crea `data/saldo-cero.db` al primer `getDb()` — **tsc limpio + dev server 200 + getDb crea/schema tablas con `SQLITE_DB_PATH` temporal + singleton confirmado**

## Fase 2: Migración localStorage → SQLite (1 día)

- [x] 2.1 Crear `lib/migrate-localstorage.ts` idempotente según DESIGN + migración §"Estrategia de datos":
      - Guard 1: si no existe `localStorage['daily-budget-data']` → return
      - Guard 2: si `accounts` tiene filas → return (ya migrado)
      - Dentro de `db.transaction()`: seed cuentas default con UUIDs estables (`uuid v5`, namespace fijo `3f8e4a12-...`), build slug→UUID map, insertar cuentas custom preservando name/type/icon/hidden (sin balance como autoridad), re-mapear `transactions.account` → `account_id` (`ON CONFLICT DO NOTHING`), insertar `budgets` singleton (`ON CONFLICT DO NOTHING`), calcular balance inicial como transacción `adjustment` cuando no hay historial
      - Marcar `localStorage['daily-budget-data-migrated']='true'`; NO eliminar `daily-budget-data` (backup histórico)
- [x] 2.2 Integrar migración en el flujo de carga: ejecutar `migrateFromLocalStorage()` (idempotente) antes del primer `loadState()` en `hooks/use-budget.tsx` — **verificado en test: se llama una sola vez antes del primer load**
- [x] 2.3 Refactorizar `hooks/use-budget.tsx` (747 líneas → ~200) manteniendo **API pública idéntica** (12 valores/funciones): carga inicial vía `loadState()`; split en `hooks/use-budget-derivation.ts` (`useMemo`: dailyAllowance, remainingToday, progress, lastCheckedDay) y `hooks/use-budget-actions.ts` (wrappers Server Action con optimistic update + rollback + debounce 300ms para edits per-keystroke, ver D10) — **commits 05c8280 + a72eed4**
- [x] 2.4 Asegurar `DEFAULT_ACCOUNT_TYPES = ['daily','savings','investment']` (no slugs hardcodeados como ids) — resolver cuentas por `type`, nunca `account.id === 'daily'` — **`isDefaultAccountType` en use-budget-derivation.ts**
- [x] 2.5 Unit + integration tests migración: idempotencia (re-ejecutar no duplica), re-mapeo slug→UUID, cuentas custom preservadas, backup localStorage intacto — con jsdom + DB temporal via `SQLITE_DB_PATH` — **tests/unit/migrate-localstorage.test.ts (9 tests); destapó y corrigió bug: cuentas custom recibían id NULL y sus transacciones se descartaban**

## Fase 3: Recurring Events + Proyección nativa (1.5 días)

- [ ] 3.1 Crear `lib/projection.ts`: `computeProjection(horizonDays=30)` lee saldo inicial (SUM de cuenta daily / `budgets.start_amount`), materializa `recurring_events` activos sobre el horizonte, construye `CashflowDayInput[]` con `matchesEvent` (frecuencias monthly/weekly/bimonthly/once, rango start/end, active=1), alimenta `calculateDailyBalance` de `lib/cashflow.ts`, retorna `CashflowDayResult[]` (copiar lógica de DESIGN §"Proyección de Flujo de Caja")
- [ ] 3.2 Conectar `computeProjection(horizonDays)` Server Action (`app/actions/projection.ts`) con `lib/projection.ts`
- [ ] 3.3 UI: lista de `recurring_events` con CRUD (crear/editar/eliminar + toggle activo) — campos: descripción, tipo income/expense, monto, frecuencia, día del mes/semana, fecha inicio/fin
- [ ] 3.4 UI: vista de proyección — tabla Fecha/Detalle/Ingreso/Egreso/Saldo (mapeo por columnas del DESIGN §"Mapeo a columnas") con horizonte configurable 30/60/90 días
- [ ] 3.5 Unit tests: `computeProjection` con cada frecuencia (monthly, weekly, bimonthly, once) + math de saldo de la proyección, contra `:memory:` o archivo temporal (`SQLITE_DB_PATH`)

## Fase 4: Eliminación Supabase / Auth / Sheets (0.5 días)

- [x] 4.1 Eliminar archivos: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `contexts/auth-context.tsx`, `app/login/page.tsx`, `proxy.ts`, y el directorio `supabase/`
- [x] 4.2 Modificar `app/layout.tsx`: quitar import + wrapper de `AuthProvider`
- [x] 4.3 `pnpm remove @supabase/ssr @supabase/supabase-js` (eliminar de `package.json`); también `dotenv` (devDep sin uso tras limpiar playwright.config)
- [x] 4.4 Limpiar `.env.local` + `.env.local.example`: eliminar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GMAIL_CLIENT_ID` (y remanentes Supabase). Adicional: eliminadas `GMAIL_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL` (todas huérfanas — 0 usos en código)
- [x] 4.5 Eliminar/archivar docs de auth+sync supersedidos: `docs/requirements/supabase-auth-backend*.md`, `docs/design/supabase-auth-backend-design.md`, `docs/tasks/supabase-auth-backend-tasks.md`, `docs/migrations/2026-08-11-supabase-auth-backend.md`, `docs/requirements/multi-device-sync.md`, `docs/migrations/2026-08-27-multi-device-sync.md` (mover a `docs/archive/`; conservar git history). Nota: `multi-device-sync-design.md` no existía.
- [x] 4.6 Verificar: `grep -r "supabase\|@supabase" lib/ app/ contexts/` → 0 resultados; `pnpm tsc --noEmit` pasa. Verificado también: `pnpm build` (3 páginas → 2, sin `/login`), `pnpm vitest` 65/65, `pnpm eslint .` 0 issues

## Fase 5: Tests + Verificación (1 día)

- [ ] 5.1 Re-escribir unit tests de hook: `use-budget.test.tsx` — **mockear el boundary de Server Actions** (no DB real en vitest/jsdom); verificar optimistic updates, rollback, derivation. ✓ (parte auth hecha) `auth-context.test.tsx` y `login-validation.test.tsx` eliminados; `AppRender.test.tsx` sin mock de AuthProvider
- [ ] 5.2 E2E: ✓ (parte auth hecha) `auth.spec.ts`, `auth.setup.ts` eliminados; projects `setup`/`chromium-auth` y `storageState` removidos de `playwright.config.ts`; `E2E_USER` eliminado de `e2e-constants.ts`. Pendiente: actualizar `tests/ui/test-utils.ts` para hacer seed a SQLite (via `SQLITE_DB_PATH` override a DB de test); actualizar `home.spec.ts` y demás specs; eliminar `.env.e2e`
- [ ] 5.3 Unit: frecuencias de proyección (3.5), idempotencia de migración (2.5), integración de Server Actions (CRUD completo contra SQLite temporal — `SQLITE_DB_PATH` a archivo temp, reset `globalThis.__db` entre tests)
- [ ] 5.4 No-regresión: `pnpm test` en verde + `pnpm tsc --noEmit` en verde (pre-commit)

---

## Definición de Done (feedback a PRD §8 Must Have)

- [ ] `pnpm test` + `pnpm tsc --noEmit` en verde (suite intacta + tests nuevos)
- [ ] SQLite como única fuente de verdad: 4 tablas con schema completo y conexión funcional
- [ ] ≥ 12 Server Actions reemplazando las 12 funciones de `use-budget` (API pública del hook idéntica)
- [ ] `next.config.mjs` con `serverExternalPackages: ['better-sqlite3']`
- [ ] Migración idempotente localStorage → SQLite que preserva accounts, transactions y budget (backup histórico conservado)
- [ ] Estado derivado (`dailyAllowance`, `progress`, `lastCheckedDay`) calculado, no persistido; saldo de cuenta derivado de SUM(transactions)
- [x] Eliminación completa de Supabase/Auth/Sheets: dependencias, archivos, env vars, `proxy.ts`, `AuthProvider`
- [ ] UI se comporta idéntica al estado actual (no-regresión funcional y visual)
- [ ] `docs/migrations/2026-08-31-sqlite-local.md` presente (OBLIGATORIO)
- [ ] `data/saldo-cero.db` en `.gitignore`

**Should Have**: CRUD de `recurring_events` con UI · proyección nativa Fecha/Detalle/Ingreso/Egreso/Saldo · horizonte 30/60/90 · tests unitarios Server Actions y migración

---

**Orden de implementación**: Fase 1 (SQLite+Server Actions+config) desbloquea todo lo demás; Fase 2 (migración) depende de 1 e integra el hook refactorizado; Fase 3 (proyección) depende de 1 (schema/actions) y puede correr en paralelo parcial con 2; Fase 4 (limpieza) es independiente y puede correr en paralelo; Fase 5 (tests) valida spec al cierre. Total estimado: **~6 días** (2 + 1 + 1.5 + 0.5 + 1).
