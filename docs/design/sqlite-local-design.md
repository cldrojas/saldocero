# Design: SQLite Local-First

Change: `sqlite-local`
PRD: `docs/requirements/sqlite-local.md`
Fecha: 2026-08-31

---

## Propósito / Balance

Pivote completo de persistencia: reemplazar `localStorage` (client-side) + el backend huérfano de Supabase/Google Sheets por SQLite local-first con `better-sqlite3` (server-side) y Server Actions como capa de datos. La app pasa de ser 100% client-side a operar con un único archivo `.db` como fuente de verdad. Se elimina auth, Supabase, Google Sheets y `proxy.ts`. La proyección de flujo de caja se vuelve una vista computada nativa a partir de `recurring_events` + saldo actual, reutilizando `calculateDailyBalance` de `lib/cashflow.ts`.

**Balance de esta decisión**: este change es de alta complejidad porque toca la capa de persistencia completa (la única que existe), refactoriza un hook de 747 líneas, agrega una capa server-side nueva, y elimina infraestructura previa. El riesgo principal es regresión del flujo diario. Se mitiga manteniendo la API pública del hook idéntica, migración idempotente, y suite de tests intacta.

---

## Contexto

### Estado actual
- App Next.js 16.2.6, React 19, TypeScript 5, pnpm. Cero Server Actions, cero Route Handlers.
- `hooks/use-budget.tsx` (747 líneas): toda la lógica CRUD + derivación + persistencia a `localStorage` bajo clave `daily-budget-data`.
- Estado derivado (`dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay`) se persiste junto con datos crudos — potencial de divergencia.
- Infraestructura huérfana: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `contexts/auth-context.tsx`, `app/login/page.tsx`, `proxy.ts`, dependencias `@supabase/*`, env vars `NEXT_PUBLIC_SUPABASE_*` — todo desconectado de la UI.
- `lib/cashflow.ts` tiene función pura `calculateDailyBalance` y sample `flujoAgosto2026` (stub sin conexión a Sheets).
- `next.config.mjs` está vacío.

### Qué cambia con este design
- **Primera capa server-side**: `lib/db/*` (conexión singleton + schema) + `app/actions/*` (Server Actions) forman el nuevo backend local.
- **Fuente de verdad**: `data/saldo-cero.db` — un archivo SQLite en disco.
- **Migración**: `lib/migrate-localstorage.ts` migra datos existentes de forma idempotente.
- **Proyección**: `lib/projection.ts` materializa `recurring_events` sobre un horizonte, alimenta `calculateDailyBalance`, retorna tabla Fecha/Detalle/Ingreso/Egreso/Saldo.
- **Hook refactorizado**: `use-budget.tsx` se mantiene con la misma API pública, pero Internamente llama Server Actions en lugar de escribir `localStorage`.

---

## Decisiones de Diseño

| # | Decisión | Opción elegida | Alternativa | Rationale |
|---|----------|---------------|-------------|-----------|
| D1 | Motor de almacenamiento | **better-sqlite3** (server-side, native addon) | sql.js (WASM browser), libsql | Single-user local Mac; archivo `.db` en disco; prepara sync futuro (iCloud Drive); sincrono y extremadamente rápido |
| D2 | Capa de datos | **Server Actions** (`'use server'`) | Route Handlers | Menos moving parts; el hook llama Server Actions que ejecutan SQL. Route Handlers son overkill para single-user local |
| D3 | Estado derivado | **No persistido** — se calcula de `budgets` + `transactions` + fecha | Persistir en SQLite | Elimina divergencia; `dailyAllowance`, `progress`, `lastCheckedDay` siempre se recalculan |
| D4 | Saldo de cuenta | **Derivado de `SUM(transactions)`** | `accounts.balance` como valor autoritativo | Una sola verdad; el saldo siempre es reconstruible |
| D5 | Proyección recurrente | **`recurring_events` tabla nueva** | Generar desde código hardcodeado | Permite al usuario configurar sus propios eventos; alimenta proyección nativa |
| D6 | Persistencia de proyección | **Vista computada on-demand** (`computeProjection`) | Tabla materializada | El horizonte cambia constantemente; recalcula on-demand |
| D7 | Sync multi-dispositivo | **Deferred** (fuera de alcance) | Implementar ahora | El `.db` es single-device; sync futuro con iCloud Drive o copia directa |
| D8 | IDs de cuentas | **UUID v4** en `accounts.id` | Slug ('daily','savings','investment') | Identidad única e inmutable; la UI identifica cuentas por `name`/`type`, nunca por `id`. `DEFAULT_ACCOUNT_IDS` se resuelve por `type`, no por slug hardcodeado |
| D9 | Conexión SQLite singleton | **Módulo cacheado** con patrón `let db: Database | null` a nivel de módulo | Nueva conexión por request | better-sqlite3 es síncrono; re-abrir por request es innecesario y lento. El singleton sobrevive entre requests en el mismo proceso Node. Se protege contra HMR con guard `globalThis.__db` |
| D10 | Per-keystroke | **Debounce 300ms** para campos editables (amount, description); `useActionState` para submits | Server Action por cada tecla | Evita round-trips innecesarios; el usuario edita fluidamente, se persiste al soltar |
| D11 | Migración localStorage | **Idempotente**: check `accounts` vacía + `localStorage` existe → migrar en transacción SQLite | Migración manual o migratoria | Re-ejecutar no duplica; usa `ON CONFLICT` + check pre-migración |
| D12 | `proxy.ts` eliminado | **Eliminar** | Mantener | No es importado en ningún sitio; middleware mal nombrado; `pnpm tsc --noEmit` verifica |

---

## Restricciones

1. **better-sqlite3 es native addon**: requiere `serverExternalPackages: ['better-sqlite3']` en `next.config.mjs`. No compila en edge runtime — solo funciona en Node.js runtime (el default).
2. **Argumentos seriales**: todas las Server Actions reciben y retornan objetos JSON-serializables. Dates se pasan como ISO strings (`'2026-08-31'`), no como objetos `Date`. El hook los convierte al recibir.
3. **ACID**: operaciones que tocan múltiples tablas o crean múltiples registros (addTransaction, transferFunds, setupBudget, deleteAccount, migración) se ejecutan dentro de `db.transaction()` de better-sqlite3.
4. **API pública del hook inmutable**: los 12 valores/funciones retornados por `useBudget()` se mantienen con la misma firma. Los componentes no se modifican.
5. **`data/saldo-cero.db`** se agrega a `.gitignore`. El path es configurable vía `SQLITE_DB_PATH` env var (override para tests).
6. **Schema idempotente**: `lib/db/schema.sql` se aplica con `CREATE TABLE IF NOT EXISTS` — seguro re-ejecutar.

---

## Arquitectura — Diagrama de Capas

```
┌─────────────────────────────────────────────────────────────────────┐
│  Client (React / 'use client')                                     │
│                                                                     │
│  hooks/use-budget.tsx ──── state in-memory (useState)               │
│       │                                                             │
│       │── loadState()          ◄── mount                           │
│       │── addTransaction()     ◄── user action                     │
│       │── removeTransaction()  ◄── user action                     │
│       │── ... (12 Server Actions)                                  │
│       │                                                             │
│       │── useMemo: dailyAllowance, remainingToday, progress        │
│       │   (calculados desde datos crudos + fecha, NO persistidos)  │
└───────┼─────────────────────────────────────────────────────────────┘
        │  'use server'  (serialización JSON)
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Server Actions  (app/actions/*)                                   │
│                                                                     │
│  budget.ts:      loadState, setupBudget, updateConfig,             │
│                  toggleAutoSave, clearData                          │
│  transactions.ts: addTransaction, removeTransaction,                │
│                  updateTransaction, transferFunds                   │
│  accounts.ts:    addAccount, updateAccount, deleteAccount           │
│  recurring.ts:   loadRecurringEvents, addRecurringEvent,            │
│                  updateRecurringEvent, deleteRecurringEvent         │
│  projection.ts:  computeProjection                                  │
└───────┬─────────────────────────────────────────────────────────────┘
        │  better-sqlite3 (síncrono,同一个 Node.js process)
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  lib/db/                                                            │
│                                                                     │
│  index.ts  ── connection singleton (cached, WAL mode)               │
│  schema.sql ── DDL de 4 tablas (CREATE TABLE IF NOT EXISTS)        │
│                                                                     │
│  data/saldo-cero.db  ◄── ÚNICA fuente de verdad (en disco)         │
└─────────────────────────────────────────────────────────────────────┘
        │
        │  lib/projection.ts ◄── lee recurring_events + saldo
        │  lib/cashflow.ts   ◄── calculateDailyBalance (puro, reutilizado)
        │
        ▼
  CashflowDayResult[] (Fecha, Detalle, Ingreso, Egreso, Saldo)
```

**Nota**: esta es la **primera capa server-side** en una app que hasta ahora era 100% client-side. Antes, `use-budget.tsx` escribía directamente a `localStorage`. Ahora el flujo es: hook (client) → Server Action (server) → SQLite (disco).

---

## SQLite Connection Singleton (`lib/db/index.ts`)

```ts
// lib/db/index.ts
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.SQLITE_DB_PATH ||
  path.join(process.cwd(), 'data', 'saldo-cero.db')

// Guard global para sobrevivir HMR en dev
declare global {
  var __db: Database.Database | undefined
}

function getDb(): Database.Database {
  if (globalThis.__db) return globalThis.__db

  // Asegurar que el directorio data/ existe
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const db = new Database(DB_PATH)

  // WAL mode: mejor concurrencia de lectura, no bloquea reads durante writes
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Aplicar schema idempotentemente
  const schema = fs.readFileSync(
    path.join(process.cwd(), 'lib', 'db', 'schema.sql'),
    'utf-8'
  )
  db.exec(schema)

  globalThis.__db = db
  return db
}

export { getDb }
```

**Puntos clave**:
- `globalThis.__db` evita re-abrir la conexión durante HMR en `next dev`.
- `process.cwd()` resuelve el path relativo al proyecto; overridable con `SQLITE_DB_PATH` para tests (apuntar a un archivo temporal o `:memory:`).
- `WAL mode` permite reads concurrentes sin bloquear writes (importante si hay múltiples Server Actions en vuelo).
- `foreign_keys = ON` para integridad referencial.
- Schema se aplica una vez al primer `getDb()`.

---

## Schema SQL (`lib/db/schema.sql`)

```sql
-- lib/db/schema.sql
-- Idempotente: CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,        -- UUID v4
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('daily','savings','investment','custom')),
  icon TEXT NOT NULL DEFAULT 'wallet',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,        -- UUID v4
  type TEXT NOT NULL CHECK(type IN ('expense','transfer','income','adjustment')),
  amount INTEGER NOT NULL,
  description TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(account_id, date);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY DEFAULT 'default',
  start_amount INTEGER NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  auto_save INTEGER NOT NULL DEFAULT 1,
  mode TEXT CHECK(mode IN ('daily','track')) DEFAULT 'daily',
  is_setup INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_events (
  id TEXT PRIMARY KEY,        -- UUID v4
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  amount INTEGER NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('monthly','weekly','bimonthly','once')),
  day_of_month INTEGER,
  day_of_week INTEGER,
  start_date TEXT,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Server Actions — Diseño Detallado

Todas las Server Actions viven en `app/actions/` con directive `'use server'`. Retornan objetos plain (serializables). Dates se pasan como ISO strings.

### `app/actions/budget.ts`

| Action | Firma | Tablas | ACID | Retorna |
|--------|-------|--------|------|---------|
| `loadState()` | `() → { budget, accounts, transactions }` | budgets, accounts, transactions | No (lectura) | `Budget` (con dates como ISO strings), `Account[]` (con `balance` = SUM transactions), `Transaction[]` |
| `setupBudget({ startAmount, endDate, mode })` | `(args: { startAmount: number, endDate?: string, mode: 'daily'\|'track' }) → void` | budgets, accounts, transactions | **Sí** — inserta budget + crea transacción inicial `income` + upsert account daily balance | void |
| `updateConfig({ startAmount?, endDate?, mode?, autoSave? })` | `(args) → void` | budgets, transactions | **Sí** — actualiza budgets + crea transacción `transfer` si `startAmount` cambió + modifica account balance | void |
| `toggleAutoSave()` | `() → void` | budgets | No (update 1 row) | void |
| `clearData()` | `() → void` | budgets, accounts, transactions | **Sí** — TRUNCATE 3 tablas | void |

**Nota sobre `loadState`**: retorna `accounts` con `balance` calculado como `SUM(CASE WHEN type='income' THEN amount WHEN type='expense' THEN amount ...)` — no lee una columna `balance` (D4: derivado). El hook recibe los saldos ya computados.

### `app/actions/transactions.ts`

| Action | Firma | Tablas | ACID | Retorna |
|--------|-------|--------|------|---------|
| `addTransaction({ type, amount, description, account_id, date })` | `(args) → { id: string }` | transactions | No (1 INSERT) | `{ id }` (UUID generado server-side) |
| `removeTransaction(id, refund?)` | `(id: string, refund?: boolean) → void` | transactions | No (1 DELETE) — el refund se maneja en el hook con una transacción de reversa | void |
| `updateTransaction({ id, type, amount, description, account_id, date })` | `(args) → void` | transactions | No (1 UPDATE) | void |
| `transferFunds({ amount, from_account_id, to_account_id, description })` | `(args) → void` | transactions | **Sí** — INSERT expense (from) + INSERT income (to) en una transacción SQLite | void |

**Nota sobre `addTransaction`**: la Server Action solo persiste la transacción. El cálculo de `dailyAllowance`, `remainingToday`, `progress` se hace en el hook (useMemo) después de recibir la respuesta, manteniendo la lógica de negocio en el cliente para evitar un round-trip adicional.

### `app/actions/accounts.ts`

| Action | Firma | Tablas | ACID | Retorna |
|--------|-------|--------|------|---------|
| `addAccount({ name, type, icon })` | `(args) → { id: string }` | accounts | No (1 INSERT) | `{ id }` (UUID) |
| `updateAccount({ id, name, type, icon, hidden })` | `(args) → void` | accounts | No (1 UPDATE) | void |
| `deleteAccount(id)` | `(id: string) → void` | accounts, transactions | **Sí** — si balance > 0: INSERT transfer (drain to savings) + INSERT income (savings) + DELETE account | void |

### `app/actions/recurring.ts`

| Action | Firma | Tablas | ACID | Retorna |
|--------|-------|--------|------|---------|
| `loadRecurringEvents()` | `() → RecurringEvent[]` | recurring_events | No (lectura) | `RecurringEvent[]` |
| `addRecurringEvent(args)` | `(args) → { id: string }` | recurring_events | No (1 INSERT) | `{ id }` |
| `updateRecurringEvent(args)` | `(args) → void` | recurring_events | No (1 UPDATE) | void |
| `deleteRecurringEvent(id)` | `(id: string) → void` | recurring_events | No (1 DELETE) | void |

### `app/actions/projection.ts`

| Action | Firma | Tablas | ACID | Retorna |
|--------|-------|--------|------|---------|
| `computeProjection(horizonDays?)` | `(horizonDays?: number) → CashflowDayResult[]` | accounts, transactions, recurring_events, budgets | No (lectura) | `CashflowDayResult[]` |

**Retorno**: array de objetos `{ date, movements, netChange, balance }` — el hook los presenta en la tabla.

---

## Refactor de `useBudget` (`hooks/use-budget.tsx`)

### Estrategia: misma API, nueva implementación interna

La API pública se mantiene idéntica — los 12 valores/funciones del return no cambian. Internamente:

```
ANTES (actual):
  useState → localStorage.setItem → derive state

AHORA (refactor):
  useState → Server Action → update local state → derive state (useMemo)
```

### Split en módulos

| Nuevo módulo | Responsabilidad | Líneas aprox. |
|-------------|-----------------|---------------|
| `hooks/use-budget.tsx` | Orquestador: carga inicial, optimistic updates, rollback | ~200 |
| `hooks/use-budget-derivation.ts` | `useMemo` para `dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay` — cálculos puros | ~80 |
| `hooks/use-budget-actions.ts` | Wrappers para cada Server Action con optimistic update + rollback | ~120 |

### Flujo de carga inicial

```ts
// hooks/use-budget.tsx (simplificado)
'use client'
import { useState, useEffect, useMemo } from 'react'
import { loadState } from '@/app/actions/budget'

export function useBudget() {
  const [isSetup, setIsSetup] = useState(false)
  const [budget, setBudget] = useState<Budget>(DEFAULT_BUDGET)
  const [accounts, setAccounts] = useState<Account[]>(DEFAULT_ACCOUNTS)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // 1. Carga inicial desde SQLite
  useEffect(() => {
    loadState().then((data) => {
      setBudget(data.budget)
      setAccounts(data.accounts)  // balance ya calculado por SUM
      setTransactions(data.transactions)
      setIsSetup(data.budget.is_setup)
      setIsLoading(false)
    })
  }, [])

  // 2. Derivados (useMemo, NO persistidos)
  const dailyAllowance = useMemo(
    () => computeDailyAllowance(budget, accounts, transactions, today),
    [budget, accounts, transactions, today]
  )

  const remainingToday = useMemo(
    () => computeRemainingToday(dailyAllowance, transactions, today),
    [dailyAllowance, transactions, today]
  )

  const progress = useMemo(
    () => computeProgress(dailyAllowance, remainingToday),
    [dailyAllowance, remainingToday]
  )

  // 3. Actions: optimistic update + fire Server Action
  const addTransaction = useCallback(async (args) => {
    const tx = { id: uuidv4(), ...args }
    // Optimistic: agregar a state inmediatamente
    setTransactions(prev => [tx, ...prev])
    // Persistir en background
    try {
      await addTransactionAction(args)
    } catch (e) {
      // Rollback: remover la transacción optimista
      setTransactions(prev => prev.filter(t => t.id !== tx.id))
    }
  }, [])

  return { accounts, budget, dailyAllowance, isSetup, progress,
           remainingToday, transactions, addTransaction, ... }
}
```

### Manejo por teclado (debounce)

Para campos editables como monto de transacción:

```ts
// En vez de llamar updateTransaction por cada tecla:
const debouncedUpdate = useMemo(
  () => debounce((tx: Transaction) => {
    updateTransactionAction({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      account_id: tx.account,
      date: tx.date.toISOString()
    })
  }, 300),
  []
)

const handleAmountChange = (txId: string, newAmount: number) => {
  // Actualizar UI inmediatamente (optimistic)
  setTransactions(prev => prev.map(t =>
    t.id === txId ? { ...t, amount: toInt(newAmount) ?? t.amount } : t
  ))
  // Persistir con debounce
  const tx = transactions.find(t => t.id === txId)
  if (tx) debouncedUpdate({ ...tx, amount: toInt(newAmount) ?? tx.amount })
}
```

### Rollback on error

Cada Server Action wrapper implementa:
1. Snapshot del estado actual
2. Aplicar cambio optimista
3. Llamar Server Action
4. Si falla: restaurar snapshot (rollback) + mostrar toast de error

---

## Migración localStorage → SQLite (`lib/migrate-localstorage.ts`)

### Flujo

```
1. ¿Existe localStorage['daily-budget-data']?
   └── NO → return (nada que migrar)
2. ¿Tabla accounts está vacía?
   └── NO → return (ya migrado)
3. Leer localStorage → parsedData
4. En transacción SQLite:
   a. Crear accounts con UUIDs estables
   b. Build id-map: old-slug → new-uuid
   c. Insertar transactions re-mapeadas (account → account_id)
   d. Insertar budget desde parsedData.budget
   e. Marcar localStorage['daily-budget-data-migrated'] = 'true'
5. Eliminar localStorage['daily-budget-data']
```

### UUIDs estables por tipo

Para que la migración sea determinista (re-ejecutar no crea UUIDs nuevos):

```ts
import { v5 as uuidv5 } from 'uuid'

// Namespace fijo para este proyecto
const MIGRATION_NAMESPACE = '3f8e4a12-7b6c-4d9e-8f0a-1b2c3d4e5f6a'

function stableUuid(type: string): string {
  return uuidv5(`daily-budget-account-${type}`, MIGRATION_NAMESPACE)
}

// Cuentas default: 'daily', 'savings', 'investment'
const ACCOUNT_TYPES = ['daily', 'savings', 'investment'] as const
```

### Re-mapeo de transactions.account (slug) → account_id (UUID)

```ts
const idMap: Record<string, string> = {
  'daily': stableUuid('daily'),
  'savings': stableUuid('savings'),
  'investment': stableUuid('investment'),
}

// Para accounts custom, generar UUID estable desde name+type
for (const acc of parsedData.accounts) {
  if (!idMap[acc.id]) {
    idMap[acc.id] = uuidv5(`daily-budget-account-${acc.type}-${acc.name}`, MIGRATION_NAMESPACE)
  }
}
```

### Idempotencia

- **Guard 1**: `loadState()` checkea si `accounts` tiene filas → si sí, no migra.
- **Guard 2**: transacción SQLite completa (si falla a mitad, se revierte).
- **Guard 3**: después de migrar, elimina `localStorage['daily-budget-data']` y marca `daily-budget-data-migrated`.

### Integración

La migración se ejecuta una vez al montar la app (en `useBudget` o en un `lib/migrate-localstorage.ts` que se llama antes del primer `loadState`):

```ts
// En hooks/use-budget.tsx o en lib/migrate-localstorage.ts
import { migrateFromLocalStorage } from '@/lib/migrate-localstorage'

useEffect(() => {
  migrateFromLocalStorage() // idempotente, seguro llamar múltiples veces
  loadState().then(/* ... */)
}, [])
```

---

## Proyección de Flujo de Caja (`lib/projection.ts`)

### Función principal

```ts
// lib/projection.ts
import { calculateDailyBalance, CashflowDayInput } from '@/lib/cashflow'
import { getDb } from '@/lib/db'

interface RecurringEvent {
  id: string
  description: string
  type: 'income' | 'expense'
  amount: number
  frequency: 'monthly' | 'weekly' | 'bimonthly' | 'once'
  day_of_month: number | null
  day_of_week: number | null
  start_date: string | null
  end_date: string | null
  active: number
}

/**
 * Materializa eventos recurrentes sobre un horizonte de días,
 * construye CashflowDayInput[] y alimenta calculateDailyBalance.
 */
export function computeProjection(horizonDays: number = 30): CashflowDayInput[] {
  const db = getDb()

  // 1. Saldo inicial: SUM de la cuenta daily
  const { initialBalance } = db.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN t.type = 'income' THEN t.amount
           WHEN t.type = 'expense' THEN t.amount
           ELSE 0 END
    ), 0) as initialBalance
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE a.type = 'daily'
  `).get() as { initialBalance: number }

  // Si hay budget.start_amount, usarlo como saldo base en modo daily
  const budget = db.prepare('SELECT start_amount FROM budgets WHERE id = ?').get('default') as
    { start_amount: number } | undefined
  const baseBalance = budget ? budget.start_amount : initialBalance

  // 2. Leer eventos recurrentes activos
  const events = db.prepare(`
    SELECT * FROM recurring_events WHERE active = 1
  `).all() as RecurringEvent[]

  // 3. Generar días del horizonte
  const today = new Date()
  const days: CashflowDayInput[] = []

  for (let i = 0; i < horizonDays; i++) {
    const date = new Date(today)
    date.setDate(today.getDate() + i)
    const dateStr = date.toISOString().split('T')[0] // YYYY-MM-DD
    const dayOfMonth = date.getDate()
    const dayOfWeek = date.getDay() // 0=domingo

    const movements = events
      .filter(event => matchesEvent(event, dateStr, dayOfMonth, dayOfWeek))
      .map(event => ({
        label: event.description,
        amount: event.type === 'income' ? event.amount : -event.amount,
      }))

    days.push({ date: dateStr, movements })
  }

  // 4. Calcular usando calculateDailyBalance
  return calculateDailyBalance(baseBalance, days)
}

function matchesEvent(
  event: RecurringEvent,
  dateStr: string,
  dayOfMonth: number,
  dayOfWeek: number
): boolean {
  // Filtro por rango de fechas
  if (event.start_date && dateStr < event.start_date) return false
  if (event.end_date && dateStr > event.end_date) return false

  switch (event.frequency) {
    case 'once':
      return event.start_date === dateStr
    case 'monthly':
      return event.day_of_month === dayOfMonth
    case 'bimonthly':
      return event.day_of_month === dayOfMonth &&
        (new Date(dateStr).getMonth() % 2 === 0) // simplificado
    case 'weekly':
      return event.day_of_week === dayOfWeek
    default:
      return false
  }
}
```

### Mapeo a columnas de la tabla

| Columna | Fuente |
|---------|--------|
| **Fecha** | `CashflowDayResult.date` |
| **Detalle** | `CashflowDayResult.movements.map(m => m.label).join(', ')` o `'—'` si vacío |
| **Ingreso** | `sum(movements.filter(m => m.amount > 0).map(m => m.amount))` |
| **Egreso** | `abs(sum(movements.filter(m => m.amount < 0).map(m => m.amount)))` |
| **Saldo** | `CashflowDayResult.balance` |

El hook `useBudget` puede opcionalmente incluir `dailyAllowance` como flag de gasto variable diario en la proyección.

---

## Estructura de Archivos Final

```
lib/
  db/
    index.ts              # better-sqlite3 connection singleton (D9)
    schema.sql            # DDL de 4 tablas (idempotente)
  cashflow.ts             # existente, sin cambios (calculateDailyBalance)
  projection.ts           # computeProjection (nuevo)
  migrate-localstorage.ts # migración idempotente localStorage → SQLite

app/
  actions/
    budget.ts             # loadState, setupBudget, updateConfig, toggleAutoSave, clearData
    transactions.ts       # addTransaction, removeTransaction, updateTransaction, transferFunds
    accounts.ts           # addAccount, updateAccount, deleteAccount
    recurring.ts          # loadRecurringEvents, addRecurringEvent, updateRecurringEvent, deleteRecurringEvent
    projection.ts         # computeProjection (Server Action wrapper)

hooks/
  use-budget.tsx          # refactorizado (~200 líneas, misma API pública)
  use-budget-derivation.ts # useMemo: dailyAllowance, remainingToday, progress (~80 líneas)
  use-budget-actions.ts   # wrappers Server Action + optimistic + rollback (~120 líneas)

types/
  index.ts                # existente (Transaction.account: string se mantiene para el hook)

data/
  saldo-cero.db           # archivo SQLite (EN .gitignore)

# Archivos eliminados
lib/supabase/client.ts    # ELIMINADO
lib/supabase/server.ts    # ELIMINADO
contexts/auth-context.tsx  # ELIMINADO
app/login/page.tsx         # ELIMINADO
proxy.ts                   # ELIMINADO
```

### `.gitignore` — entrada agregada

```
# SQLite database
data/*.db
data/*.db-wal
data/*.db-shm
```

---

## `next.config.mjs`

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
}

export default nextConfig
```

**Por qué**: `better-sqlite3` es un native addon (requiere compilación C++). Next.js necesita saber que no debe intentar empaquetarlo con webpack — se ejecuta directamente en Node.js.

---

## Estrategia de Testing

| Capa | Qué testear | Cómo |
|------|-------------|------|
| **Unit: derivación** | `computeDailyAllowance`, `computeRemainingToday`, `computeProgress` | Vitest: funciones puras, datos mockeados. Sin DB, sin React. |
| **Unit: proyección** | `computeProjection` con eventos de prueba | Vitest: DB en `:memory:` o archivo temporal (`SQLITE_DB_PATH`). Seed de recurring_events de prueba. |
| **Unit: migración** | Lógica de re-mapeo de ids (slug → UUID), detección de duplicados | Vitest: pasarle un JSON de localStorage sintético, verificar outputs sin DB. |
| **Unit: cashflow** | `calculateDailyBalance` existente | Ya cubierto o fácil de testear (función pura). |
| **Integration: Server Actions** | CRUD completo contra SQLite temporal | Vitest + better-sqlite3 en modo temporal. Crear DB, llamar acciones, verificar estado. Cada test en su propia DB (cleanup al final). |
| **Integration: migración** | localStorage real (o jsdom) → SQLite temporal | Vitest + jsdom para localStorage + DB temporal. Verificar accounts, transactions, budgets. |
| **Unit: useBudget hook** | Optimistic updates, rollback, derivation | Vitest + @testing-library/react. **Mockear Server Actions** (no DB real). Verificar estado del hook post-acción. |
| **Regresión** | Suite existente intacta | `pnpm test` + `pnpm tsc --noEmit` — se ejecutan en pre-commit. |

### Configuración de DB para tests

```ts
// En cada test file que use SQLite
import { getDb } from '@/lib/db'

beforeEach(() => {
  process.env.SQLITE_DB_PATH = `/tmp/saldo-cero-test-${Date.now()}.db`
})

afterEach(() => {
  const db = getDb()
  db.close()
  // cleanup
  fs.unlinkSync(process.env.SQLITE_DB_PATH!)
  delete process.env.SQLITE_DB_PATH
})
```

**Importante**: como `getDb()` usa `globalThis.__db`, hay que resetearlo entre tests:

```ts
afterEach(() => {
  globalThis.__db = undefined  // forzar nueva conexión con nuevo path
})
```

---

## Riesgos Específicos del Diseño

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| `better-sqlite3` native addon falla al compilar con Node/Next 16 | Media | Alta | `serverExternalPackages` en next.config; test de build como primer paso; fallback a `sql.js` (WASM) si es necesario |
| Module caching vs HMR: `globalThis.__db` se cierra pero Next.js recrea el módulo | Media | Media | Guard `globalThis.__db` checkea si está abierto antes de reusar; si el archivo DB cambió (tests), forzar nueva instancia |
| Per-keystroke Server Action round-trips causan latencia perceptible | Media | Media | Debounce 300ms para edits (D10); optimistic updates inmediatos en UI; Server Action fire-and-forget para edits |
| Pérdida de datos durante migración localStorage → SQLite | Baja | Crítica | Transacción SQLite (rollback on error); backup de localStorage antes de migrar; test de migración exhaustivo; eliminación de localStorage solo después de commit exitoso |
| `proxy.ts` eliminación rompe algo no detectado | Baja | Media | `pnpm tsc --noEmit` verifica imports; grep antes de eliminar; proxy.ts no es importado en ningún sitio (verificado en PRD §2.1) |
| `DEFAULT_ACCOUNT_IDS` hardcodeado como slugs (`['daily','savings','investment']`) rompe con D8 (UUID) | Alta | Alta | Refactorizar: `DEFAULT_ACCOUNT_TYPES = ['daily','savings','investment']` y resolver cuentas por `type` en vez de por `id`. Nunca comparar `account.id === 'daily'` — comparar `account.type === 'daily'` |
| Regresión visual o funcional del flujo diario | Media | Alta | Tests existentes intactos; fase dedicada de verificación; UI se comporta idéntica (misma API pública del hook) |
| `better-sqlite3` synchronous blocking en el event loop | Baja | Baja | Single-user local; operaciones son microsegundos; no hay concurrencia server real |
| Migración se ejecuta múltiples veces (race condition en dev) | Baja | Media | Guard `accounts` vacía es atómico dentro de la transacción SQLite; `ON CONFLICT DO NOTHING` en inserts |

---

## Flujo de Datos Completo

```
[Usuario abre la app]
    │
    ▼
useBudget() mounts
    │
    ├─ migrateFromLocalStorage()  ◄── idempotente, solo 1ra vez
    │      └─ INSERT accounts (UUIDs estables)
    │      └─ INSERT transactions (re-mapeadas)
    │      └─ INSERT budgets
    │      └─ localStorage cleanup
    │
    └─ loadState()  ◄── Server Action
           └─ SELECT budgets, accounts, transactions
           └─ RETURN { budget, accounts (con balance SUM), transactions }
    │
    ▼
React state populated: budget, accounts, transactions
    │
    ▼
useMemo derivations:
    dailyAllowance = f(budget, accounts, transactions, today)
    remainingToday = f(dailyAllowance, transactions, today)
    progress = f(dailyAllowance, remainingToday)
    lastCheckedDay = (recalc on day change)
    │
    ▼
[Usuario agrega gasto]
    │
    ├─ Optimistic: setTransactions([...newTx, ...prev])
    │
    └─ addTransactionAction({ type, amount, ... })
           └─ INSERT INTO transactions ...
           └─ OK → nothing (optimistic already applied)
           └─ ERROR → rollback: setTransactions(prev)
    │
    ▼
[Usuario ve proyección]
    │
    └─ computeProjection(30)  ◄── Server Action
           └─ SELECT balance FROM accounts WHERE type='daily'
           └─ SELECT * FROM recurring_events WHERE active=1
           └─ materialize events over 30 days
           └─ calculateDailyBalance(initialBalance, days)
           └─ RETURN CashflowDayResult[]
```

---

*Documento generado como parte del flujo SDD para el change `sqlite-local`. Design: SQLite local-first con better-sqlite3, Server Actions, y proyección nativa.*
