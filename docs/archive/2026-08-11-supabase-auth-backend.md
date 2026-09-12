# Migración: supabase-auth-backend

Fecha: 2026-08-11
Change: `supabase-auth-backend` (Fase 1 — issue #40)
PRD: `docs/requirements/supabase-auth-backend.md`

## Cambio de schema

La persistencia deja de ser exclusivamente local (localStorage) y se introduce un
backend de datos relacional (Supabase/PostgreSQL) con aislamiento por usuario.

### Schema previo (localStorage, clave `daily-budget-data`)

```
{
  budget: Budget,          // { startAmount, startDate?, endDate?, autoSave, mode? }
  accounts: Account[],     // { id: string, name, type, balance: Int, icon, hidden? }
  transactions: Transaction[], // { id: string, type, amount: Int, description, account: string (id), date: Date }
  dailyAllowance: number,
  remainingToday: number,
  progress: number,
  lastCheckedDay: Date | null,
  isSetup: boolean
}
```

- Sin identidad de usuario, sin separación entre personas, sin servidor.
- Ids de cuenta: strings (`'daily'`, `'savings'`, `'investment'`) o UUID (custom).

### Schema nuevo (Supabase/PostgreSQL)

```
profiles(
  id uuid PK → auth.users.id (on delete cascade),
  display_name text,
  created_at timestamptz, updated_at timestamptz
)

accounts(
  id uuid PK default gen_random_uuid(),
  user_id uuid FK → auth.users.id (on delete cascade),
  name text, type text,
  balance integer default 0,      -- unidades enteras (paridad con Int del frontend)
  icon text, hidden boolean default false,
  created_at timestamptz, updated_at timestamptz
)

transactions(
  id uuid PK default gen_random_uuid(),
  user_id uuid FK → auth.users.id (on delete cascade),
  account_id uuid FK → accounts.id (on delete cascade),
  type text CHECK (type in ('expense','transfer','income','adjustment')),
  amount integer, description text,
  date timestamptz default now(),
  created_at timestamptz, updated_at timestamptz
)
```

- RLS habilitado en las 3 tablas; políticas own-rows (`auth.uid() = user_id`).
- Trigger `handle_new_user`: inserta `profiles` al crear usuario en `auth.users`.
- Trigger `set_updated_at` en las 3 tablas.
- Índices: `accounts(user_id)`, `transactions(user_id, date)`, `transactions(account_id)`.
- `auth.users` es la fuente de identidad; **no** se crea `public.users` (evita drift).

## Estrategia de datos

- **Fase 1 no migra datos**: las tablas se crean vacías. localStorage continúa siendo
  la fuente de datos de la app hasta que la Fase 2 implemente el CRUD contra Supabase.
- **Mapeo de ids (Fase 2)**: las cuentas default `'daily'`/`'savings'`/`'investment'`
  no son UUID. Fase 2 hará seed de una fila por cuenta default por usuario al migrar
  (o al registrarse), y re-apuntará `transactions.account` (string) → `account_id` (uuid).
- **Moneda**: `integer` en unidades enteras, mismo contrato que `Int` del frontend.
  Si en el futuro se requiere céntimos, nueva migración a `numeric` (decisión Fase 3).
- **Usuarios pre-existentes**: no existen (no había auth). No hay datos a re-asociar.

## Rollback

1. En Supabase (migración de rollback):

```sql
drop table if exists public.transactions;
drop table if exists public.accounts;
drop table if exists public.profiles;
-- triggers y policies se eliminan en cascada con sus tablas
```

2. En el repo: quitar dependencias `@supabase/*`, `lib/supabase/`, `middleware.ts`,
   rutas de auth y env vars de Supabase (ver PRD Sección 10).
3. La app vuelve a operar 100% sobre localStorage sin cambios.
