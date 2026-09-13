# Tasks: supabase-auth-backend (Fase 1)

Referencias: PRD `docs/requirements/supabase-auth-backend.md` · Spec `docs/requirements/supabase-auth-backend-spec.md` · Design `docs/design/supabase-auth-backend-design.md` · Migración `docs/migrations/2026-08-11-supabase-auth-backend.md`

## Phase 1: Infraestructura

- [x] 1.1 `pnpm add @supabase/supabase-js @supabase/ssr`
- [x] 1.2 Actualizar `.env.local` con `NEXT_PUBLIC_SUPABASE_URL=https://whacwpjgizlxvnmckyli.supabase.co`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key — ver .env.local>` (y `SUPABASE_DB_PASSWORD` solo local)
- [x] 1.3 Documentar vars en `.env.local.example` (placeholders)
- [x] 1.4 Crear `lib/supabase/client.ts` con `createBrowserClient`
- [x] 1.5 Crear `lib/supabase/server.ts` con `createServerClient` + `await cookies()` (Next 16)
- [x] 1.6 Crear `proxy.ts` (antes `middleware.ts`; Next 16.2 deprecó `middleware` → `proxy`): refresh de sesión + redirect a `/login` sin sesión; matcher excluye estáticos
- [x] 1.7 Verificar: `pnpm tsc --noEmit` pasa con los clientes nuevos

## Phase 2: Schema + RLS (Supabase)

- [x] 2.1 Aplicar migración SQL en proyecto `whacwpjgizlxvnmckyli` (`supabase link` + `db push`): `profiles`, `accounts`, `transactions`, triggers `handle_new_user`/`set_updated_at`, índices, RLS habilitado
- [x] 2.2 Crear policies own-rows (`auth.uid() = user_id`) para SELECT/INSERT/UPDATE/DELETE en las 3 tablas
- [ ] 2.3 Habilitar provider Email (password) en dashboard Authentication → Providers ⚠️ pendiente usuario
- [ ] 2.4 Verificar: `supabase get_advisors` (security) sin errores RLS en tablas nuevas

## Phase 3: Core — UI de auth

- [x] 3.1 Crear `contexts/auth-context.tsx` exponiendo `{ user, session, isLoading, signIn, signUp, signOut }` con listener `onAuthStateChange`
- [x] 3.2 Montar `AuthProvider` en `app/layout.tsx` entre LanguageProvider y CurrencyProvider
- [x] 3.3 Crear `app/login/page.tsx`: tabs login/registro con react-hook-form + zod (email formato, password ≥ 8)
- [x] 3.4 Agregar claves i18n auth (`login`, `register`, `logout`, `email`, `password`, `confirmPassword`, errores) en `contexts/language-context.tsx` (en + es)
- [x] 3.5 Agregar acción sign out en `components/user-menu.tsx` (dropdown en header de `app/page.tsx`; `navbar.tsx` es la barra de tabs y quedó sin cambios)
- [x] 3.6 Estados de carga durante resolución de sesión (spinner en `/login` mientras `isLoading`; `UserMenu` no renderiza sin `user`)

## Phase 4: Testing

- [x] 4.1 Unit: `auth-context` (mock `supabase.auth`): signIn/signUp/signOut, isLoading, listener — `tests/unit/auth-context.test.tsx` (8 tests)
- [x] 4.2 Unit: validación RHF+zod del formulario (email inválido, password corta) — `tests/unit/login-validation.test.tsx` (10 tests, incluye traducción de errores)
- [ ] 4.3 E2E Playwright: spec escrito en `tests/ui/auth.spec.ts` (redirect sin sesión, errores de validación, credenciales inválidas, registro→app, sign out preserva localStorage) pero NO ejecutable aún: requiere provider Email habilitado (2.3) ⚠️ Los specs UI existentes (`tests/ui/*.spec.ts`) también requieren sesión (storageState o login) una vez activo el auth
- [x] 4.4 SQL de aislamiento RLS: `supabase/tests/rls_isolation.sql` + verificación en remoto (RLS true ×3, 12 policies own-rows, anon bloqueado 42501)
- [x] 4.5 Regresión: `pnpm test` (83 tests OK) + `pnpm tsc --noEmit` + `pnpm lint` (0 errores) + `pnpm build` OK

## Phase 5: Cleanup / Docs

- [x] 5.1 Actualizar estado del PRD (checklist Must Have) en `docs/requirements/supabase-auth-backend.md`
- [x] 5.2 Actualizar `CHANGELOG.md` con el cambio
- [x] 5.3 Verificar que `hooks/use-budget.tsx` quedó sin cambios (fuente localStorage intacta)

---

**Orden de implementación**: Fase 1 (deps+clientes+middleware) habilita todo lo demás; Fase 2 (schema) es independiente y puede correr en paralelo vía dashboard/CLI; Fase 3 (UI) depende de 1; Fase 4 (tests) valida spec; Fase 5 cierra.
