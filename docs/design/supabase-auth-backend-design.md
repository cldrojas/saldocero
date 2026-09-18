# Design: Supabase Auth Backend — Fase 1

Change: `supabase-auth-backend`
PRD: `docs/requirements/supabase-auth-backend.md`
Spec: `docs/requirements/supabase-auth-backend-spec.md`
Migración descriptiva: `docs/migrations/2026-08-11-supabase-auth-backend.md`
Fecha: 2026-08-11

---

## Enfoque técnico

Cerrar la app con una puerta de autenticación Supabase (email/password) usando `@supabase/ssr` con cookies httpOnly y refresh de sesión en middleware. El backend (tablas + RLS) queda listo para Fase 2, pero **localStorage sigue siendo la fuente de datos** en esta fase. Proyecto Supabase dedicado: `whacwpjgizlxvnmckyli` (base vacía — sin conflictos).

## Decisiones de arquitectura

| # | Decisión | Alternativas | Rationale |
|---|----------|--------------|-----------|
| D1 | Sesión con `@supabase/ssr` (cookies httpOnly) + refresh en `middleware.ts` | Tokens en localStorage; SSR manual | Patrón oficial Supabase para App Router; httpOnly evita XSS; middleware refresca sin bloquear render |
| D2 | `lib/supabase/client.ts` (`createBrowserClient`) y `lib/supabase/server.ts` (`createServerClient` + cookies async de Next 16) | Cliente único compartido | Separación estricta server/client; las cookies de Next 16 son async (`await cookies()`) |
| D3 | Auth provider (`contexts/auth-context.tsx`) montado **entre Language y Currency** en `app/layout.tsx` | Dentro de `page.tsx`; global en root | Necesita idioma para mensajes y es consumido por toda la app; evita re-mounts |
| D4 | `app/login/page.tsx` client con `react-hook-form` + `zod`, tabs login/registro | Formularios separados; server actions | RHF+zod ya instalados; validación de cliente para password débil/email formato |
| D5 | Protección en `middleware.ts` (matcher) + doble verificación con `auth.getUser()` en server | Solo middleware | Middleware refresca cookies; `getUser()` en Server Components evita confiar solo en cookies |
| D6 | Migración SQL: tablas `profiles`/`accounts`/`transactions` + triggers + RLS own-rows | `public.users` duplicado | `auth.users` es fuente de identidad; RLS `auth.uid() = user_id` por operación |
| D7 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` = **publishable key** (`sb_publishable_...`) | anon JWT legacy | Recomendación actual de Supabase; mismo comportamiento con RLS |
| D8 | Sign out en navbar con confirmación ligera (dropdown) | Botón directo | Consistente con UI existente (dropdown-menu Radix) |

## Flujo de datos

```
Request a / (privada)
      │
      ▼
middleware.ts ── refresh cookies de sesión ── sin sesión? ──► /login
      │  sesión válida (cookies refrescadas)
      ▼
app/layout.tsx (AuthProvider entre Language y Currency)
      │  useAuth() → { user, session, isLoading, signIn, signUp, signOut }
      ▼
app/page.tsx (DailyBudgetApp)  ── hooks/use-budget.tsx ── localStorage 'daily-budget-data'
      │                                                          │
      ▼ (Fase 2: sustituye por Supabase)                          ▼
accounts / transactions (Postgres + RLS por user_id)        fuente de datos actual
```

## Cambios de archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `package.json` | Modificar | + `@supabase/supabase-js`, `@supabase/ssr` |
| `.env.local` / `.env.local.example` | Modificar | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ `SUPABASE_DB_PASSWORD` solo local) |
| `lib/supabase/client.ts` | Crear | `createBrowserClient` para componentes client |
| `lib/supabase/server.ts` | Crear | `createServerClient` con `await cookies()` (Next 16) |
| `middleware.ts` | Crear | Refresh de sesión + redirect a `/login` si no hay sesión; matcher excluye `/login` y estáticos |
| `contexts/auth-context.tsx` | Crear | `{ user, session, isLoading, signIn, signUp, signOut }`, listener `onAuthStateChange` |
| `app/layout.tsx` | Modificar | Montar `AuthProvider` entre `LanguageProvider` y `CurrencyProvider` |
| `app/login/page.tsx` | Crear | Login/registro con RHF+zod, tabs, mensajes i18n |
| `components/navbar.tsx` | Modificar | Acción sign out (dropdown-menu) |
| `contexts/language-context.tsx` | Modificar | Claves i18n auth en `en`/`es` |
| Migración SQL (Supabase) | Crear | DDL + triggers + índices + RLS (abajo) |
| `hooks/use-budget.tsx` | **Sin cambios** | Fuente de datos transicional |

## Esquema SQL (bosquejo de migración)

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'custom',
  balance integer not null default 0,
  icon text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  type text not null check (type in ('expense','transfer','income','adjustment')),
  amount integer not null,
  description text,
  date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- triggers: handle_new_user (insert profiles), set_updated_at (3 tablas)
-- índices: accounts(user_id); transactions(user_id, date); transactions(account_id)
-- RLS habilitado + policies own-rows por operación (auth.uid() = user_id)
```

Nota: base del proyecto `whacwpjgizlxvnmckyli` está **vacía** — sin `ALTER`, sin conflictos con la app veterinaria.

## Configuración dashboard (manual)

1. Proyecto `whacwpjgizlxvnmckyli` → **Authentication → Providers → Email**: habilitar (password).
2. (Opcional, Nice to Have) Magic link.

## Estrategia de testing

| Capa | Qué | Cómo |
|------|-----|------|
| Unit | `auth-context` (signIn/signUp/signOut, estado isLoading, listener) | Vitest con `supabase.auth` mockeado |
| Unit | Validación de formularios login/registro | Vitest con RHF+zod (email formato, password ≥ 8) |
| E2E | Registro → login → sign out; ruta privada redirige; sesión sobrevive recarga | Playwright (`pnpm test:ui`) |
| SQL | Aislamiento RLS: usuario A no lee/modifica filas de B | Script SQL/seed con 2 usuarios + asserts |
| Regresión | Suite existente intacta | `pnpm test` + `pnpm tsc --noEmit` (pre-commit ya los corre) |

## Migración / rollout

1. Instalar deps (`@supabase/supabase-js`, `@supabase/ssr`).
2. Env vars en `.env.local` (URL + publishable key) y `.env.local.example`.
3. `lib/supabase/*` + `middleware.ts`.
4. Aplicar migración SQL en Supabase (MCP re-apuntado a `whacwpjgizlxvnmckyli` o CLI `supabase link` + `db push`).
5. UI de auth (context, login, navbar, i18n).
6. Tests + verificación.

**Rollback**: eliminar middleware/rutas/context/deps/env vars + `drop table public.transactions, public.accounts, public.profiles;` (ver PRD §10).

## Preguntas abiertas

- [ ] ¿El usuario confirmó el pegado de env vars y el re-apunte del MCP al ref nuevo?
- [ ] ¿Se habilita magic link además de email/password en el dashboard?
