# PRD: Supabase Backend + Autenticación (Fase 1 — Persistencia y Sync Multi-dispositivo)

## 1. Resumen Ejecutivo

### 1.1 Propósito
Implementar la **Fase 1 (Backend)** del plan de implementación del issue [#40 — Persistencia de saldos con sincronización multi-dispositivo](https://github.com/cldrojas/daily-budget/issues/40): conectar la app a **Supabase** para integrar **autenticación de usuarios**, crear el **schema de base de datos** (profiles, accounts, transactions), habilitar **Row Level Security (RLS)** y dejar preparada la infraestructura sobre la que la Fase 2 construirá el CRUD sincronizado.

Esta fase NO migra los datos existentes ni implementa sincronización: establece la base segura (identidad + aislamiento de datos) para las fases siguientes.

### 1.2 Change ID
`supabase-auth-backend`

### 1.3 Estado
**Implementado (Fases 1-4 parciales)** — Schema+RLS aplicados en remoto; UI de auth (login/registro/sign out) completa; unit tests y verificación RLS OK. Pendiente: habilitar provider Email en dashboard (2.3) para ejecutar e2e; Fase 5 de cleanup en curso.

---

## 2. Planteamiento del Problema

### 2.1 Estado Actual
- La app (Next.js 16 + App Router, `daily-budget`) persiste todo su estado en **localStorage** bajo la clave `daily-budget-data` (`hooks/use-budget.tsx`, líneas 86-111).
- El modelo de datos vive en `types/index.ts`: `Account` (id, name, type, balance, icon, hidden?), `Transaction` (id, type, amount, description, account, date) y `Budget`.
- No existe backend, base de datos remota, autenticación ni aislamiento por usuario. Cualquier persona con la app comparte el mismo estado local.
- El proyecto Supabase vinculado originalmente (`https://hewarrzvigimkekvykjs.supabase.co`) contenía el schema completo de **otra aplicación** (clínica veterinaria: `pets`, `appointments`, `medical_records`, etc.) y un `public.profiles` con schema incompatible (enum de roles veterinarios). Se decidió crear un **proyecto dedicado nuevo** para saldo-cero: `https://whacwpjgizlxvnmckyli.supabase.co` (ref `whacwpjgizlxvnmckyli`, East US). No hay dependencias `@supabase/*` instaladas en `package.json`.

### 2.2 Pain Points
1. **Datos efímeros**: al limpiar el navegador o cambiar de dispositivo, todo el historial de cuentas y transacciones se pierde.
2. **Sin identidad**: no hay concepto de usuario; es imposible distinguir datos entre personas.
3. **Sin aislamiento ni seguridad**: cualquier dato futuro en la nube sería accesible por cualquiera sin RLS.
4. **Sin base para sincronizar**: no existe un servidor de verdad (source of truth) contra el cual la Fase 2 pueda hacer sync multi-dispositivo.

### 2.3 Oportunidad
Supabase ya está vinculado al proyecto y provee, con un solo stack: **Auth** (sesiones, JWT, emails), **PostgreSQL** (schema relacional) y **RLS** (aislamiento de datos por usuario a nivel de base de datos). Configurar Fase 1 desbloquea Fase 2 (CRUD/sync) y Fase 3 (seguridad reforzada) sin re-arquitectura.

---

## 3. Historias de Usuario

### US-1: Registrarse
**Como** usuario nuevo
**Quiero** crear una cuenta con email y contraseña
**Para que** mis datos queden asociados a mi identidad y sincronizables entre dispositivos

**Criterios de aceptación:**
- [ ] Existe un formulario de registro (email + password) accesible desde `/login`.
- [ ] Al registrarse, se crea el usuario en `auth.users` y su fila en `profiles` automáticamente (trigger).
- [ ] La sesión queda iniciada tras el registro.
- [ ] Errores (email ya registrado, password débil) se muestran con mensajes en `en` y `es`.

### US-2: Iniciar sesión
**Como** usuario existente
**Quiero** iniciar sesión con mis credenciales
**Para que** la app cargue mi espacio de trabajo

**Criterios de aceptación:**
- [ ] Existe un formulario de login (email + password).
- [ ] La sesión se mantiene al recargar la página (cookie httpOnly, refresh automático).
- [ ] Un usuario no autenticado no puede acceder a la app principal (redirección a `/login`).

### US-3: Cerrar sesión
**Como** usuario autenticado
**Quiero** cerrar sesión
**Para que** ningún otro usuario de mi dispositivo acceda a mis datos

**Criterios de aceptación:**
- [ ] Existe una acción de sign out accesible desde la UI.
- [ ] Al cerrar sesión se limpian las cookies de sesión y se redirige a `/login`.
- [ ] El estado local (localStorage) no se borra (fuente transicional hasta Fase 2).

### US-4: Aislamiento de datos por usuario
**Como** usuario
**Quiero** que mis cuentas y transacciones solo sean visibles para mí
**Para que** nadie más pueda leer o modificar mis datos

**Criterios de aceptación:**
- [ ] RLS habilitado en `profiles`, `accounts` y `transactions`.
- [ ] Un usuario solo puede SELECT/INSERT/UPDATE/DELETE filas con su `user_id`.
- [ ] Test automatizado de aislamiento: usuario A no ve ni modifica filas de usuario B.

### US-5: (Backend) App operativa durante la transición
**Como** usuario
**Quiero** que la app siga funcionando con mis datos locales
**Para que** la Fase 1 no me rompa el flujo mientras la sincronización (Fase 2) no existe

**Criterios de aceptación:**
- [ ] Con sesión iniciada, la app funciona exactamente como hoy (fuente de datos: localStorage).
- [ ] La única diferencia visible es la puerta de autenticación y el botón de sign out.

---

## 4. Requerimientos Funcionales

### FR-1: Dependencias de Supabase
Instalar:
- `@supabase/supabase-js` — cliente core.
- `@supabase/ssr` — gestión de sesión con cookies para Next.js (App Router).

```bash
pnpm add @supabase/supabase-js @supabase/ssr
```

### FR-2: Variables de entorno
Agregar a `.env.local` y documentar en `.env.local.example` (nunca commitear valores reales):

| Variable | Descripción | Público |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto (`https://whacwpjgizlxvnmckyli.supabase.co`) | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/publishable key (solo sirve con RLS activo) | Sí (cliente) |

- **Prohibido** exponer `service_role` en el cliente. No se usa en esta fase.

### FR-3: Clientes Supabase
- `lib/supabase/client.ts` — `createBrowserClient` para componentes client (`'use client'`).
- `lib/supabase/server.ts` — `createServerClient` con cookies de `next/headers` (API async de Next.js 16) para Server Components y Server Actions.
- `middleware.ts` — refresh de sesión con cookies y protección de rutas (ver FR-5).

### FR-4: Schema de base de datos (migración SQL)
Migración nombrada `create_supabase_auth_backend`. Ver archivo obligatorio `docs/migrations/2026-08-11-supabase-auth-backend.md` y el DDL completo en la Sección 6. Resumen:

| Tabla | Columnas clave |
|-------|----------------|
| `profiles` | `id uuid PK → auth.users.id`, `display_name text`, timestamps |
| `accounts` | `id uuid PK default gen_random_uuid()`, `user_id uuid FK → auth.users`, `name`, `type`, `balance integer default 0`, `icon`, `hidden boolean default false`, timestamps |
| `transactions` | `id uuid PK`, `user_id uuid FK → auth.users`, `account_id uuid FK → accounts`, `type text CHECK ('expense','transfer','income','adjustment')`, `amount integer`, `description text`, `date timestamptz`, timestamps |

Además:
- Trigger `handle_new_user` → inserta `profiles` al crear usuario en `auth.users`.
- Trigger `set_updated_at` en las tres tablas.
- Índices: `accounts(user_id)`, `transactions(user_id, date)`, `transactions(account_id)`.

**Decisión de diseño**: NO se crea tabla `public.users`. `auth.users` ya es la fuente de identidad; duplicarla en `public` crea problemas de sincronización y drift. Se usa `profiles` para datos de aplicación del usuario (decisión documentada también en Sección 6.4).

### FR-5: RLS (Row Level Security)
Habilitar RLS en las 3 tablas y crear políticas (una por operación en cada tabla):

```sql
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;

-- Ejemplo patrón por tabla (accounts):
create policy "select own accounts" on public.accounts
  for select using (auth.uid() = user_id);
create policy "insert own accounts" on public.accounts
  for insert with check (auth.uid() = user_id);
create policy "update own accounts" on public.accounts
  for update using (auth.uid() = user_id);
create policy "delete own accounts" on public.accounts
  for delete using (auth.uid() = user_id);
```

Regla: **ninguna tabla expone filas sin `auth.uid() = user_id`**. La anon key pública depende 100% de estas políticas.

### FR-6: UI de autenticación
- Ruta `/login` con formularios de **login** y **registro** (tabs o alternancia), usando `react-hook-form` + `zod` (ya instalados).
- `contexts/auth-context.tsx` (`'use client'`) que expone `{ user, session, isLoading, signIn, signUp, signOut }` vía `supabase.auth` + listeners de cambio de sesión.
- Acción de **sign out** en la navbar existente (`components/navbar.tsx`).
- Claves i18n en `en` y `es` (`contexts/language-context.tsx`): `login`, `register`, `logout`, `email`, `password`, mensajes de error.

### FR-7: Protección de rutas y sesión
- `middleware.ts`: refresh de cookies de sesión en cada request; si no hay sesión y la ruta es privada (`/` y subrutas de la app), redirigir a `/login`.
- La app principal (`app/page.tsx`) se renderiza solo con sesión válida.
- Estados de carga: pantalla/skeleton mientras se resuelve la sesión (evitar flash de login).

### FR-8: Configuración del proyecto Supabase (dashboard)
Reactivar/verificar el proyecto y habilitar en **Authentication → Providers**:
- Email (password) como provider mínimo. Opcional (Nice to Have): magic link.

### FR-9: Migración del modelo (OBLIGATORIA)
Todo cambio al modelo de datos **debe** registrar su migración descriptiva:
- **Ruta**: `docs/migrations/2026-08-11-supabase-auth-backend.md`.
- **Contenido mínimo**: schema previo (localStorage JSON), schema nuevo (tablas Postgres), estrategia de datos (Fase 1 no migra datos; mapeo de ids string→uuid para Fase 2), rollback.
- **Regla**: esta implementación no se considera completa sin su archivo de migración.

---

## 5. Requerimientos No Funcionales

### NFR-1: Seguridad
- La anon key solo es segura **con RLS activo**: verificar policies en la migración antes de cualquier uso.
- `service_role` nunca en el cliente; no se usa en Fase 1.
- Cookies de sesión `httpOnly` (manejo estándar de `@supabase/ssr`), refrescadas por middleware.
- Verificación final con `supabase get_advisors` (security): 0 errores RLS en las tablas nuevas.

### NFR-2: Privacidad
- Aislamiento total por `user_id` (RLS). Datos de un usuario invisibles para otro, incluso con la misma anon key.

### NFR-3: Compatibilidad y no-regresión
- **localStorage sigue siendo la fuente de datos** durante Fase 1 (`hooks/use-budget.tsx` sin cambios). La Fase 2 conectará el CRUD.
- Todos los tests existentes (`pnpm test`, `pnpm tsc --noEmit`) deben pasar.
- El flujo existente de la app no cambia para un usuario autenticado.

### NFR-4: Performance
- Session refresh vía middleware sin bloquear render (Suspense/loading states).
- Sin llamadas redundantes a `auth.getUser()` por render (una vez por sesión, cache en contexto).

### NFR-5: Testeabilidad
- Unit tests: auth-context (mock de `supabase.auth`), validación de formularios.
- E2E (Playwright): registro → login → sign out; ruta privada redirige a `/login`.
- Test de aislamiento RLS (SQL o integración): usuario A no accede a filas de B.

---

## 6. Restricciones de Diseño Técnico

### 6.1 Fuente de verdad
- **Identidad**: `auth.users` (Supabase Auth) — única fuente.
- **Datos de app**: durante Fase 1, localStorage (transicional). A partir de Fase 2, Postgres vía Supabase.

### 6.2 DDL de la migración (resumen ejecutable)

```sql
-- 1. profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. accounts
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

-- 3. transactions
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

-- triggers handle_new_user + set_updated_at, índices y RLS: ver migración completa
-- docs/migrations/2026-08-11-supabase-auth-backend.md
```

### 6.3 Ubicación de los cambios
| Archivo | Cambio |
|---------|--------|
| `package.json` | `@supabase/supabase-js`, `@supabase/ssr` |
| `.env.local` / `.env.local.example` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `lib/supabase/client.ts` | Cliente browser (`createBrowserClient`) |
| `lib/supabase/server.ts` | Cliente server (`createServerClient` + cookies) |
| `middleware.ts` | Refresh de sesión + protección de rutas |
| `contexts/auth-context.tsx` | Contexto `{ user, session, signIn, signUp, signOut }` |
| `app/login/page.tsx` | UI login/registro |
| `components/navbar.tsx` | Botón sign out |
| `contexts/language-context.tsx` | Claves i18n (en + es) |
| `docs/migrations/2026-08-11-supabase-auth-backend.md` | Migración descriptiva del modelo (OBLIGATORIA) |
| Migración SQL (Supabase) | DDL + triggers + RLS + índices |
| `hooks/use-budget.tsx` | **Sin cambios** en Fase 1 |

### 6.4 Decisiones de diseño
| Decisión | Opción tomada | Alternativa rechazada |
|----------|---------------|-----------------------|
| Tabla de usuario | `profiles` FK → `auth.users` | `public.users` duplica identidad (drift, sync problems) |
| PK de cuentas/transacciones | `uuid` | `text` con ids `'daily'`/`'savings'` (compatibilidad, pero frágil para sync; mapeo se hace en Fase 2) |
| Moneda | `integer` en unidades enteras (mismo `Int` del frontend) | `numeric`/céntimos (más correcto, pero rompe paridad con el modelo actual; evaluar en Fase 3) |
| Estado de la app | localStorage hasta Fase 2 | Migración de datos en Fase 1 (fuera de alcance, ver Sección 7) |

### 6.5 Flujo de datos

```
/ (app privada) ── middleware.ts ── sin sesión? ──> /login
        │  sesión válida (cookies refrescadas)
        ▼
app/page.tsx (DailyBudgetApp)
        │  useAuth() → user/session
        ▼
hooks/use-budget.tsx  ── localStorage (fuente de datos transicional)
        │
        ▼  (Fase 2: reemplaza por llamadas a Supabase)
accounts / transactions (Postgres, RLS por user_id)
```

---

## 7. Fuera de Alcance

| Ítem | Razón | Trabajo futuro |
|------|-------|----------------|
| CRUD de cuentas/transacciones contra Supabase | Fase 2 del issue #40 | Fase 2: API/hooks sync |
| Sincronización multi-dispositivo y conflict resolution | Fase 2 | Fase 2 |
| Offline-first / IndexedDB / cache local | Fase 2 | Fase 2 |
| Migración de datos de localStorage a Postgres | Necesita el CRUD (Fase 2) | Fase 2 |
| Encriptación de datos sensibles, rate limiting, JWT custom | Fase 3 del issue | Fase 3 |
| OAuth providers (Google, GitHub) | No requerido para el MVP de auth | PRD/issue aparte |
| Borrado de cuenta / GDPR | Independiente | PRD aparte |
| Verificación de email / password reset | Mejora de auth | PRD aparte |

---

## 8. Resumen de Criterios de Aceptación

### Must Have (MVP)
- [x] Proyecto Supabase dedicado creado y respondiendo (`https://whacwpjgizlxvnmckyli.supabase.co`)
- [x] `@supabase/supabase-js` + `@supabase/ssr` instalados
- [x] Env vars documentadas (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
- [x] Migración SQL aplicada: `profiles`, `accounts`, `transactions` + triggers + índices
- [x] RLS habilitado con políticas own-rows en las 3 tablas (verificado en remoto)
- [ ] Registro y login con email/password funcionando (e2e) ⚠️ bloqueado por provider Email en dashboard (2.3)
- [x] Sesión persistente tras recarga (proxy + cookies)
- [x] Rutas privadas protegidas (redirect a `/login`)
- [x] Sign out funcional desde el menú de usuario (header)
- [x] Migración descriptiva en `docs/migrations/2026-08-11-supabase-auth-backend.md` (OBLIGATORIO)
- [x] Tests nuevos (auth-context, login validation, aislamiento RLS) + sin regresión (83 unit tests OK)
- [x] App existente sin cambios funcionales (localStorage sigue operando; `use-budget.tsx` intacto)

### Should Have
- [x] Claves i18n completas en `en` y `es` para toda la UI de auth
- [x] Estados de carga/skeleton durante resolución de sesión
- [x] Manejo de errores de auth legibles (email duplicado, credenciales inválidas)

### Nice to Have
- [ ] Magic link como segundo método de login
- [ ] Mostrar email/avatar del usuario en la navbar
- [ ] Verificación de email obligatoria antes de usar la app

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Proyecto Supabase original compartido con otra app (schema veterinario) | Resuelto (2026-08-11) | Alto | Se creó proyecto dedicado `whacwpjgizlxvnmckyli`; el ref original `hewarrzvigimkekvykjs` queda pausado por el usuario en dashboard (CLI no soporta pause) |
| RLS mal configurada expone datos | Baja | Crítico | Policies explícitas por operación; verificación con `supabase get_advisors` (security) y test de aislamiento |
| Fuga de `service_role` key | Baja | Crítico | Jamás en cliente; no se usa en Fase 1; `.env.local` en gitignore |
| Doble persistencia (localStorage + Postgres) genera confusión | Media | Media | Documentado: Fase 1 = localStorage como fuente; Fase 2 migra. Sin escritura a Postgres en Fase 1 |
| Mapeo de cuentas default (`'daily'`, `'savings'`) a UUID en Fase 2 | Media | Media | Decisión registrada (Sección 6.4); Fase 2 hará seed de cuentas default por usuario |
| API de cookies async de Next.js 16 mal manejada | Media | Media | Seguir patrón oficial de `@supabase/ssr` para App Router; tests e2e de sesión |
| Romper el flujo actual al agregar auth gate | Baja | Alta | `use-budget.tsx` intacto; app renderiza igual con sesión; e2e de no-regresión |

---

## 10. Plan de Rollback

1. Eliminar `middleware.ts` y las rutas de auth (`app/login`), restaurando el acceso directo a la app.
2. Quitar `contexts/auth-context.tsx` y el botón de sign out de la navbar.
3. Eliminar dependencias `@supabase/*` (`pnpm remove`).
4. Remover env vars de Supabase de `.env.local` y `.env.local.example`.
5. Ejecutar migración de rollback en Supabase: `drop table public.transactions, public.accounts, public.profiles;` (y triggers/policies asociados).
6. Borrar tests de auth y correr suite completa (la app vuelve a ser 100% localStorage).

---

## 11. Dependencias

| Dependencia | Fuente | Propósito |
|-------------|--------|-----------|
| Proyecto Supabase (`whacwpjgizlxvnmckyli.supabase.co`) | Dashboard Supabase / CLI | Auth + Postgres + RLS |
| `@supabase/supabase-js` | npm | Cliente core |
| `@supabase/ssr` | npm | Sesión con cookies para Next.js App Router |
| `react-hook-form` + `zod` | `package.json` (ya instalados) | Formularios de auth |
| `lucide-react` | `package.json` (ya instalado) | Íconos de UI |
| Convención `docs/migrations/*.md` | Regla interna del repo | Migración descriptiva (FR-9) |
| Vitest / Playwright | `package.json` | Tests unitarios y e2e |

---

## 12. Métricas de Éxito

| Métrica | Objetivo | Medición |
|---------|----------|----------|
| Registro + login + sign out e2e | 100% pass | `pnpm test:ui` |
| Aislamiento RLS | 100% (usuario A no ve datos de B) | Test de aislamiento + `get_advisors` security |
| Regresión de tests | 100% pass | `pnpm test` + `pnpm tsc --noEmit` |
| Persistencia de sesión | Sesión sobrevive recarga | Test manual + e2e |
| Latencia de login | < 1s percibido | Devtools / percepción |

---

## 13. Fases de Implementación

| Fase | Entregables | Esfuerzo est. |
|------|-------------|---------------|
| **1. Infraestructura** | Reactivar proyecto, env vars, dependencias, `lib/supabase/*`, middleware | 0.5-1 día |
| **2. Schema + RLS** | Migración SQL (tablas, triggers, índices, policies), migración descriptiva en `docs/migrations/` | 1 día |
| **3. Auth UI** | `auth-context`, `/login`, sign out, protección de rutas, i18n | 1-2 días |
| **4. Tests + verificación** | Unit (auth-context), e2e (login/registro/aislamiento), advisors, no-regresión | 1 día |

**Total: ~3-5 días**

---

## 14. Documentos Relacionados

- **Issue**: [cldrojas/daily-budget#40 — Persistencia de saldos con sincronización multi-dispositivo](https://github.com/cldrojas/daily-budget/issues/40) (plan de implementación: Fase 1 Backend)
- **Migración**: `docs/migrations/2026-08-11-supabase-auth-backend.md`
- **Modelo actual**: `types/index.ts`, `hooks/use-budget.tsx`
- **PRD de referencia (formato)**: `docs/requirements/hide-accounts-from-totals.md`
- **Exploración**: completada (2026-08-11) — hallazgos clave resumidos en Sección 2.1; ver también memoria de proyecto
- **Spec**: `docs/requirements/supabase-auth-backend-spec.md` (en generación)
- **Design**: `docs/design/supabase-auth-backend-design.md` (en generación)

---

## 15. Aprobación

| Rol | Nombre | Estado | Fecha |
|-----|--------|--------|-------|
| Product Owner | — | Pendiente | — |
| Tech Lead | — | Pendiente | — |
| QA Lead | — | Pendiente | — |

---

*Documento generado como parte del flujo SDD para el change `supabase-auth-backend` (Fase 1 del issue #40)*
