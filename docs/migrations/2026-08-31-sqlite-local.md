# Migración: sqlite-local

Fecha: 2026-08-31
Change: `sqlite-local` (Pivote de Arquitectura — localStorage → SQLite local-first)
PRD: `docs/requirements/sqlite-local.md`

## Cambio de schema

La app pivota de 100% client-side con `localStorage` a una arquitectura **local-first**
con **SQLite como única fuente de verdad**. Se elimina por completo la dependencia de
Supabase/PostgreSQL, autenticación y Google Sheets. Los Server Actions reemplazan la
capa de persistencia del hook monolítico `use-budget.tsx`. El estado derivado deja de
persistirse y se calcula on-demand.

### Schema previo (localStorage, clave `daily-budget-data`)

La app almacena un **único blob JSON** en `localStorage` bajo la clave
`daily-budget-data`, serializado desde `hooks/use-budget.tsx`:

```json
{
  "budget": {
    "startAmount": <Int>,
    "startDate": "<ISO | undefined>",
    "endDate": "<ISO | undefined>",
    "autoSave": <boolean>,
    "mode": "daily" | "track" | undefined
  },
  "accounts": [
    {
      "id": "<string slug: 'daily' | 'savings' | 'investment' | custom>",
      "name": "<string>",
      "type": "<string>",
      "balance": <Int>,
      "icon": "<string>",
      "hidden?": <boolean>
    }
  ],
  "transactions": [
    {
      "id": "<uuid>",
      "type": "expense" | "transfer" | "income" | "adjustment",
      "amount": <Int>,
      "description": "<string>",
      "account": "<string — id de la cuenta, slug>",
      "date": "<ISO>"
    }
  ],
  "dailyAllowance": <number>,
  "remainingToday": <number>,
  "progress": <number>,
  "lastCheckedDay": "<ISO | null>",
  "isSetup": <boolean>
}
```

**Características clave del schema previo:**
- Sin identidad de usuario, sin separación entre personas, sin servidor.
- IDs de cuenta son **strings slug** (`'daily'`, `'savings'`, `'investment'` o slugs
  custom generados desde el `name`). `transactions.account` apunta a esos slugs.
- Estado derivado (`dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay`)
  se **persiste** junto con los datos crudos, creando potencial de divergencia.
- `dailyAllowance` se calcula como `(budget.startAmount - totalExpenses) / daysRemaining`.
- `lastCheckedDay` controla el auto-save diario: al pasar de día, se resetea el
  allowance.
- `isSetup` flag que indica si el usuario completó la configuración inicial.
- **Tipos TypeScript** (`types/index.ts`): `Account.id: string`, `Transaction.account: string`,
  `Budget.mode: 'daily' | 'track'`, `Int` (branded number type).

### Schema nuevo (SQLite, 4 tablas)

```sql
-- ============================================================
-- accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,  -- UUID v4, NO más slugs
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('daily', 'savings', 'investment', 'custom')),
  icon       TEXT NOT NULL DEFAULT 'wallet',
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY,  -- UUID de la transacción
  type        TEXT NOT NULL CHECK (type IN ('expense', 'transfer', 'income', 'adjustment')),
  amount      INTEGER NOT NULL,  -- unidades enteras (paridad con Int del frontend)
  description TEXT NOT NULL,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,  -- ISO 8601
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(account_id, date);

-- ============================================================
-- budgets (singleton — id siempre 'default')
-- ============================================================
CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY DEFAULT 'default',
  start_amount INTEGER NOT NULL DEFAULT 0,
  start_date   TEXT,  -- ISO date
  end_date     TEXT,  -- ISO date
  auto_save    INTEGER NOT NULL DEFAULT 1,
  mode         TEXT CHECK (mode IN ('daily', 'track')),
  is_setup     INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- recurring_events (NUEVO — no existía en localStorage)
-- ============================================================
CREATE TABLE IF NOT EXISTS recurring_events (
  id           TEXT PRIMARY KEY,  -- UUID v4
  description  TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount       INTEGER NOT NULL,
  frequency    TEXT NOT NULL CHECK (frequency IN ('monthly', 'weekly', 'bimonthly', 'once')),
  day_of_month INTEGER,  -- para monthly/bimonthly (1-31)
  day_of_week  INTEGER,  -- para weekly (0-6, 0=domingo)
  start_date   TEXT,
  end_date     TEXT,     -- null = sin fin
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
```

**Cambios clave respecto al schema previo:**

1. **`accounts.id` es ahora UUID v4** (D8): abandona los slugs string. Las cuentas
   default (`'daily'`, `'savings'`, `'investment'`) se crean con un UUID **estable**
   por tipo, identificadas por su columna `type` con CHECK constraint. La UI nunca lee
   el id directamente — identifica cuentas por `name`/`type`.

2. **`transactions.account_id` es UUID FK → `accounts(id)`**: reemplaza el string slug
   `transactions.account`. Se re-mapea en la migración usando un mapa old-slug → new-uuid.

3. **`budgets` es singleton** (`id='default'`): absorbe `budget` + `isSetup` del
   localStorage. Una sola fila por la app.

4. **`recurring_events` es tabla nueva**: no existía en localStorage. Soporta eventos
   recurrentes (sueldo, alquiler, suscripciones) con frecuencias monthly, weekly,
   bimonthly y once. Alimenta la proyección de flujo de caja nativa.

5. **Estado derivado ya NO se persiste** (D3): `dailyAllowance`, `remainingToday`,
   `progress` y `lastCheckedDay` se calculan on-demand desde `budgets` +
   `transactions` + fecha actual via `lib/cashflow.ts`. Elimina el problema de
   divergencia.

6. **Saldo de cuenta es derivado** (D4): se calcula como `SUM(transactions.amount)`
   por `account_id`, no almacenado como autoridad. La columna `balance` de localStorage
   se usa solo como fallback en la migración si no hay historial de transacciones.

## Estrategia de datos

La migración de `localStorage → SQLite` es **idempotente** y se ejecuta como parte
del flujo de carga de la app. Implementada en `lib/migrate-localstorage.ts`.

### Flujo de migración (paso a paso)

**1. Detección:**
Si existe `localStorage['daily-budget-data']` con datos válidos Y la tabla `accounts`
está vacía → proceder a migrar. Si `accounts` tiene filas, la migración ya corrió
(previa o en otro dispositivo) y se omite.

**2. Crear/sembrar cuentas default con UUIDs estables:**
Las cuentas `'daily'`, `'savings'`, `'investment'` se crean con un UUID **determinista**
por tipo (fijo, no random). Esto garantiza que el mismo tipo siempre mapea al mismo
UUID, sin importar el dispositivo o momento de ejecución. La columna `type` con CHECK
constraint identifica las cuentas de sistema.

La seed table es un mapa estático en código:

| slug (localStorage) | type    | UUID estable (fijo)                  |
|---------------------|---------|--------------------------------------|
| `daily`             | `daily` | UUID predefinido para tipo `daily`   |
| `savings`           | `savings`| UUID predefinido para tipo `savings` |
| `investment`        | `investment`| UUID predefinido para tipo `investment` |

**3. Construir mapa de mapeo:**
Se construye un `Map<string, string>` donde la key es el slug original del localStorage
y el value es el nuevo UUID. Para cuentas default se usa la seed. Para cuentas custom
se genera un UUID v4 nuevo.

**4. Insertar cuentas custom:**
Cualquier cuenta en `localStorage` cuyo `type` no es `'daily'`, `'savings'` ni
`'investment'` se inserta como cuenta custom con:
- `id` = UUID v4 nuevo
- `name`, `type`, `icon`, `hidden` = preservados del localStorage
- `balance` = **NO se inserta** como dato autoritativo (se deriva de transacciones)

**5. Insertar transacciones re-mapeando `account` → `account_id`:**
Cada transacción del localStorage se inserta con:
- `id`, `type`, `amount`, `description`, `date` = preservados
- `account_id` = resuelto via el mapa (slug → UUID)
- `ON CONFLICT(id) DO NOTHING` para idempotencia

**6. Insertar `budgets` singleton:**
Se crea una fila con `id='default'` desde `budget` + `isSetup` del localStorage:
- `start_amount` = `budget.startAmount`
- `start_date` = `budget.startDate` (ISO date string)
- `end_date` = `budget.endDate` (ISO date string)
- `auto_save` = `budget.autoSave` (boolean → integer)
- `mode` = `budget.mode` ('daily' | 'track' | null)
- `is_setup` = `isSetup`
- `ON CONFLICT(id) DO NOTHING` para idempotencia

**7. Marcar migración completada:**
Se establece `localStorage['daily-budget-data-migrated'] = true` como flag de
histórico. La clave original `daily-budget-data` se **conserva intacta** como backup
histórico — nunca se lee como fuente de datos después de la migración.

**8. Idempotencia:**
- Guards `ON CONFLICT DO NOTHING` en todas las inserciones.
- Check de `accounts` vacía como gate de entrada.
- El **entero proceso** se ejecuta dentro de una transacción SQLite:
  `BEGIN → inserts → COMMIT`. Si cualquier paso falla, se ejecuta `ROLLBACK` y no
  quedan datos parciales.

**9. Saldo de cuenta:**
El campo `balance` del localStorage **NO se migra como autoridad** (D4). El saldo se
deriva de `SUM(transactions.amount)` por `account_id` a partir de la migración en
adelante. Si un usuario no tiene transacciones históricas (solo el blob del
localStorage con saldos), se calcula el balance inicial desde el `balance` del
localStorage como transacción de tipo `adjustment` para que el derived sum coincida.

### Archivos involucrados

| Archivo | Rol |
|---------|-----|
| `lib/db/schema.sql` | DDL de las 4 tablas |
| `lib/db/index.ts` | Conexión better-sqlite3 singleton |
| `lib/db/migrate.ts` | Ejecuta schema.sql si tablas no existen |
| `lib/migrate-localstorage.ts` | Migración idempotente localStorage → SQLite |
| `hooks/use-budget.tsx` | Refactorizado para llamar Server Actions |
| `app/actions/*.ts` | Server Actions CRUD (reemplazan funciones del hook) |

## Rollback

Para revertir a `localStorage` como fuente de datos:

1. **Revertir `hooks/use-budget.tsx`** a la versión que lee/escribe directamente
   `localStorage` (fuente: la versión previa al change `sqlite-local`). Eliminar las
   llamadas a Server Actions y restaurar la lógica CRUD inline.

2. **Eliminar archivos nuevos** del change:
   - `lib/db/` (schema.sql, index.ts, migrate.ts)
   - `app/actions/` (budget.ts, transactions.ts, accounts.ts, recurring.ts, projection.ts)
   - `lib/migrate-localstorage.ts`
   - `lib/projection.ts`

3. **Eliminar `data/saldo-cero.db`** si existe.

4. **Restaurar `next.config.mjs`** a `{}` (quitar `serverExternalPackages`).

5. **Restaurar dependencias eliminadas** en `package.json`:
   ```bash
   pnpm add @supabase/ssr @supabase/supabase-js
   ```
   (Solo si la fase de eliminación de Supabase ya se ejecutó; si no, omitir.)

6. **Restaurar archivos eliminados** desde git (si ya se ejecutó la fase de limpieza):
   - `lib/supabase/client.ts`, `lib/supabase/server.ts`
   - `contexts/auth-context.tsx`
   - `app/login/page.tsx`
   - `proxy.ts`

7. **Correr suite completa**: `pnpm test` + `pnpm tsc --noEmit`.

8. **Verificar**: la app vuelve a operar 100% sobre `localStorage`. Los datos no se
   pierden porque la clave original `daily-budget-data` se conservó intacta como backup
   durante la migración.
