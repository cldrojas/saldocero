# Migración: multi-device-sync

Fecha: 2026-08-27
Change: `multi-device-sync` (Fase 2 — issue #40)
PRD: `docs/requirements/multi-device-sync.md`
Migración SQL: `supabase/migrations/20260828042045_create_sync.sql`

## Cambio de schema

La persistencia deja de ser exclusivamente local y Postgres pasa a ser la **fuente
de verdad** para cuentas, transacciones y presupuesto. Se añade la tabla `budgets`
(1:1 con el usuario) para el estado que antes vivía solo en `localStorage`.

### Schema previo (localStorage → caché; Postgres solo parcial)

**localStorage** (`daily-budget-data`), autoridad hasta esta fase:

```
{
  budget: Budget,          // { startAmount, startDate?, endDate?, autoSave, mode? }
  accounts: Account[],     // { id: string ('daily'|'savings'|'investment'|uuid),
                           //    name, type, balance: Int, icon, hidden? }
  transactions: Transaction[], // { id: string, type, amount: Int, description,
                           //    account: string (id), date: Date }
  dailyAllowance: number,  // derivado — NO se persistirá
  remainingToday: number,  // derivado — NO se persistirá
  progress: number,        // derivado — NO se persistirá
  lastCheckedDay: Date|null, // derivado del auto-save
  isSetup: boolean
}
```

**Postgres (Fase 1, ya aplicado)** — sin tabla de presupuesto:

```
profiles( id uuid PK → auth.users, display_name, created_at, updated_at )
accounts(
  id uuid PK, user_id uuid FK → auth.users,
  name, type, balance integer default 0, icon, hidden boolean default false,
  created_at, updated_at
)
transactions(
  id uuid PK, user_id uuid FK → auth.users, account_id uuid FK → accounts (cascade),
  type check('expense','transfer','income','adjustment'),
  amount integer, description, date timestamptz default now(),
  created_at, updated_at
)
-- triggers: handle_new_user, set_updated_at (3 tablas)
-- índices: accounts(user_id); transactions(user_id,date); transactions(account_id)
-- RLS own-rows (auth.uid() = user_id) en las 3 tablas
```

### Schema nuevo (Postgres como fuente de verdad)

Se **añade** `budgets` (1:1 con usuario). El resto del schema es igual al de Fase 1
(ya desplegado); esta fase lo puebla y lo consume.

```
budgets(
  user_id      uuid PK → auth.users.id (on delete cascade),  -- 1 fila por usuario
  start_amount integer not null default 0,   -- Budget.startAmount
  start_date   date,                          -- Budget.startDate
  end_date     date,                          -- Budget.endDate
  auto_save    boolean not null default true, -- Budget.autoSave
  mode         text default 'daily' check (mode in ('daily','track')), -- Budget.mode
  is_setup     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
)
-- trigger: set_updated_at sobre budgets
-- RLS own-rows: auth.uid() = user_id (todas las operaciones)
-- grants: anon, authenticated sobre public.budgets
```

**Campos derivados que NO se persisten** en Postgres (se calculan en el cliente desde
`budgets` + `transactions` usando `lib/cashflow.ts`): `dailyAllowance`,
`remainingToday`, `progress`, `lastCheckedDay`. Esto evita estados contradictorios
entre dispositivos.

**Saldo de cuenta**: ver decisión SD-2 del PRD (§6.4). Recomendado: el saldo se
deriva de las transacciones de la cuenta para evitar dos verdades entre dispositivos.
Si se mantiene `accounts.balance` como columna, debe tratarse con la estrategia de
conflictos documentada (last-write-wins con `updated_at`).

## Estrategia de datos

- **Migración de `localStorage` → Postgres** (por usuario y dispositivo, idempotente):
  1. Si el usuario no tiene filas en `accounts`, y existe `localStorage`, se migran.
  2. **Seed de cuentas default** `'daily'`/`'savings'`/`'investment'` (con su `name`,
     `balance`, `icon`) si no existen (guardas para no duplicar).
  3. **Re-mapeo** de `transactions.account` (string) → `account_id` (uuid),
     resolviendo cuentas default y custom.
  4. **`budgets`** se puebla desde `budget` + `isSetup` (`start_amount`, `start_date`,
     `end_date`, `auto_save`, `mode`, `is_setup`).
  5. Idempotencia: marcar `localStorage` como migrado y/o comprobar filas existentes
     antes de insertar; re-ejecutar no duplica.
- **Sin datos pre-existentes en Postgres** (Fase 1 no pobló las tablas), la migración
  parte de `localStorage`. El primer dispositivo que migre define el estado canónico.
- **Moneda**: `integer` en unidades enteras (paridad con `Int` del frontend).
- **`date` como tipo `date`** en `budgets` (día calendario, sin zona horaria) para
  paridad con el contrato de `Budget`; las transacciones conservan `timestamptz`.

## Rollback

1. En Supabase (migración de rollback):

```sql
drop table if exists public.budgets;
-- accounts / transactions / profiles y sus policies/triggers se conservan (Fase 1)
```

2. En el repo: revertir `hooks/use-budget.tsx` a fuente `localStorage`, eliminar
   `lib/sync/` y los tests de sync.
3. La app vuelve a operar 100% sobre `localStorage` (comportamiento Fase 1),
   sin migración de datos adicional.
