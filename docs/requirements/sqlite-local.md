# PRD: SQLite Local-First (Pivote de Arquitectura)

## 1. Resumen Ejecutivo

### 1.1 Propósito
Pivote completo de la persistencia: reemplazar `localStorage` (client-side) + el planeado backend de Supabase/PostgreSQL + Google Sheets por una arquitectura **local-first** con **SQLite como única fuente de verdad**. La app (`daily-budget`) pasa de ser 100% client-side a operar con Server Actions sobre un archivo `.db` local vía `better-sqlite3`. Se elimina por completo la autenticación, Google Sheets y la dependencia de Supabase. La proyección de flujo de caja (antes Google Sheets) se convierte en una **vista computada nativa** a partir de datos locales.

### 1.2 Change ID
`sqlite-local`

### 1.3 Estado
**Propuesto.** Sin implementar. Este change sustituye y cierra la dirección del `multi-device-sync` (Fase 2, issue #40), que pivotó hacia un escape hatch a SQLite documentado en su §6.6. El sync multi-dispositivo queda **deferred explícitamente** — el archivo `.db` es single-device por ahora.

---

## 2. Planteamiento del Problema

### 2.1 Estado Actual
- **App 100% client-side**: Next.js 16.2.6, React 19, TypeScript 5, pnpm. Cero Server Actions, cero Route Handlers, cero API Routes. `'use client'` en todos los componentes.
- **Backend monolítico en un hook**: `hooks/use-budget.tsx` (747 líneas) contiene toda la lógica CRUD, derivación de estado y persistencia a `localStorage` bajo la clave `daily-budget-data`. API surface: `setupBudget`, `addTransaction`, `removeTransaction`, `updateTransaction`, `addAccount`, `updateAccount`, `deleteAccount`, `transferFunds`, `updateConfig`, `toggleAutoSave`, `clearData`, `getRemainingDays`, `setLastCheckedDay`.
- **Estado derivado persistido**: `dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay`, `isSetup` se guardan en `localStorage` junto con los datos crudos, creando potencial de divergencia.
- **Supabase/Sheets footprint huérfano**: el repo contiene `lib/supabase/client.ts`, `lib/supabase/server.ts`, `contexts/auth-context.tsx`, `app/login/page.tsx`, `proxy.ts` (middleware mal nombrado), env vars (`NEXT_PUBLIC_SUPABASE_*`, `GMAIL_CLIENT_ID`), dependencias `@supabase/ssr` y `@supabase/supabase-js`, y un directorio `supabase/` — todo ello **desconectado** de la UI, que nunca lo consume.
- **Google Sheets**: `lib/cashflow.ts` tiene una función pura `calculateDailyBalance` y un sample `flujoAgosto2026` que representa la tabla de proyección de flujo de caja (columnas: Fecha, Detalle, Ingreso, Egreso, Saldo). Actualmente es un stub sin conexión real a Sheets.
- **`next.config.mjs`** está vacío (`{}`) — necesita `serverExternalPackages: ['better-sqlite3']`.

### 2.2 Pain Points
1. **localStorage como única persistencia**: frágil, sin backup, sin export, atado al browser. Limpiar caché del browser destruye todos los datos.
2. **Backend huérfano**: Supabase, auth y Sheets están instalados pero sin usar — generan complejidad, dependencias sin consumir y confusión arquitectónica.
3. **Proyección externalizada**: la tabla de flujo de caja (cash flow) se planeó como Google Sheets, pero no está conectada. No hay forma de ver proyecciones futuras con datos actuales.
4. **Sin recurring events**: la app no soporta eventos recurrentes (sueldo mensual, alquiler, suscripciones). Cada transacción se ingresa manualmente.
5. **Estado derivado persistido**: `dailyAllowance`, `remainingToday`, `progress` pueden quedar desactualizados si el cálculo falla o el usuario edita datos manualmente en `localStorage`.
6. **Sin backup/export**: no hay forma de exportar datos ni crear un respaldo del `.db`.

### 2.3 Oportunidad
Pivotar a SQLite local-first elimina la ceremonia de auth/Supabase/Sheets sin perder funcionalidad. El archivo `.db` en disco es portable, exportable, y sienta las bases para un sync futuro (iCloud Drive, cp directo). Server Actions en Next.js son el puente natural entre la UI client-side y la capa de datos server-side.

---

## 3. Historias de Usuario

### US-1: Migración de datos existentes de localStorage a SQLite
**Como** usuario con datos en `localStorage` (budget, accounts, transactions)
**Quiero** que la app migre mis datos existentes al nuevo backend SQLite automáticamente
**Para que** no pierda cuentas, movimientos ni configuración al actualizar la app

**Criterios de aceptación:**
- [ ] Al detectar `localStorage['daily-budget-data']` con datos y la base SQLite vacía, la app ofrece migrar (o migra con confirmación).
- [ ] Las cuentas se migran a UUIDs (`accounts.id` = UUID v4) resolviendo las cuentas default (`'daily'`, `'savings'`, `'investment'`) y las custom mediante su `type`/`name`. Se preservan `name`, `type`, `icon`, `balance`.
- [ ] Todas las transacciones se migran preservando `id`, `type`, `amount`, `description`, con `account` (string) re-mapeado a `account_id` (UUID) contra la seed table.
- [ ] `localStorage['daily-budget-data-migrated']` se marca como migrado (flag de histórico) y deja de ser fuente de lectura.

### US-2: App opera completamente local desde SQLite
**Como** usuario de la app
**Quiero** que toda la información se lea y escriba desde SQLite en mi máquina
**Para que** no dependa de servicios externos, login ni conexión a internet

**Criterios de aceptación:**
- [ ] La app carga datos de SQLite al iniciar (vía Server Actions), no de `localStorage`.
- [ ] Cada operación CRUD (addTransaction, addAccount, etc.) escribe en SQLite y refleja el cambio en la UI.
- [ ] No hay login, no hay auth, no hay llamadas a Supabase o Google.
- [ ] Las dependencias `@supabase/ssr`, `@supabase/supabase-js` están eliminadas de `package.json`.
- [ ] `lib/supabase/`, `contexts/auth-context.tsx`, `app/login/page.tsx`, `proxy.ts` están eliminados.
- [ ] La UI se comporta idéntica al estado actual (no-regresión visual ni funcional).

### US-3: Proyección de flujo de caja nativa
**Como** usuario que quiere ver hacia adelante
**Quiero** una tabla de proyección de flujo de caja (Fecha, Detalle, Ingreso, Egreso, Saldo) calculada desde mis datos locales
**Para que** pueda anticipar mi saldo futuro sin depender de Google Sheets

**Criterios de aceptación:**
- [ ] La tabla de proyección se genera a demanda desde el saldo actual + eventos recurrentes.
- [ ] Columnas: Fecha, Detalle, Ingreso, Egreso, Saldo — calculadas usando `calculateDailyBalance` de `lib/cashflow.ts`.
- [ ] Los eventos recurrentes (`recurring_events`) alimentan las filas de la proyección.
- [ ] La proyección es una **vista computada** — no se almacena en SQLite.
- [ ] Se puede configurar el horizonte de proyección (ej. 30, 60, 90 días).

### US-4: CRUD de eventos recurrentes
**Como** usuario con gastos/ingresos fijos
**Quiero** poder crear, editar y eliminar eventos recurrentes (sueldo mensual, alquiler, suscripciones)
**Para que** la proyección refleje mis compromisos reales sin tener que ingresarlos cada mes

**Criterios de aceptación:**
- [ ] Se puede crear un evento recurrente con: descripción, tipo (income/expense), monto, frecuencia (monthly/weekly/bimonthly/once), día del mes/semana, fecha inicio/fin, activo/inactivo.
- [ ] Se puede editar y eliminar eventos recurrentes existentes.
- [ ] Los eventos inactivos no se incluyen en la proyección.
- [ ] La tabla `recurring_events` persiste en SQLite con CRUD completo vía Server Actions.
- [ ] La UI muestra la lista de eventos recurrentes y permite operaciones CRUD.

### US-5: No-regresión del flujo diario
**Como** usuario de la app
**Quiero** que el registro diario de gastos, ingresos y transferencias funcione igual que hoy
**Para que** el cambio de backend sea transparente

**Criterios de aceptación:**
- [ ] Todos los tests existentes pasan (`pnpm test`, `pnpm tsc --noEmit`).
- [ ] El flujo de setup inicial (configurar presupuesto, cuentas) funciona igual.
- [ ] Los cálculos derivados (allowance diario, progreso, ahorro automático) se calculan correctamente desde SQLite.
- [ ] Transferencias entre cuentas funcionan correctamente.
- [ ] La UI de cuentas, transacciones y presupuesto se comporta idéntica.

---

## 4. Requerimientos Funcionales

### FR-1: Schema SQLite (4 tablas)
Archivos: `lib/db/schema.sql`, `lib/db/index.ts` (conexión better-sqlite3).

**Tabla `accounts`:**
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | TEXT PK | **UUID (v4)**, generado con `uuid` (ya en deps). Único e inmutable |
| `name` | TEXT NOT NULL | Nombre legible ('Daily Budget', 'Savings', ...) |
| `type` | TEXT NOT NULL | CHECK: daily, savings, investment, custom — identifica las cuentas de sistema |
| `icon` | TEXT NOT NULL DEFAULT 'wallet' | Emoji/icono |
| `hidden` | INTEGER NOT NULL DEFAULT 0 | Si está oculta |
| `created_at` | TEXT DEFAULT (datetime('now')) | Timestamp |
| `updated_at` | TEXT DEFAULT (datetime('now')) | Timestamp |

**Tabla `transactions`:**
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | TEXT PK | ID de la transacción |
| `type` | TEXT NOT NULL | CHECK: expense, transfer, income, adjustment |
| `amount` | INTEGER NOT NULL | En unidades enteras (paridad con `Int`) |
| `description` | TEXT NOT NULL | Descripción |
| `account_id` | TEXT NOT NULL | FK → accounts(id) |
| `date` | TEXT NOT NULL | Fecha ISO |
| `created_at` | TEXT DEFAULT (datetime('now')) | Timestamp |
| `updated_at` | TEXT DEFAULT (datetime('now')) | Timestamp |

Índice: `idx_tx_date ON transactions(account_id, date)`

**Tabla `budgets`:**
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | TEXT PK DEFAULT 'default' | Singleton (una sola fila) |
| `start_amount` | INTEGER NOT NULL DEFAULT 0 | `Budget.startAmount` |
| `start_date` | TEXT | `Budget.startDate` |
| `end_date` | TEXT | `Budget.endDate` |
| `auto_save` | INTEGER NOT NULL DEFAULT 1 | `Budget.autoSave` |
| `mode` | TEXT CHECK | 'daily' o 'track' |
| `is_setup` | INTEGER NOT NULL DEFAULT 0 | Setup completado |
| `updated_at` | TEXT DEFAULT (datetime('now')) | Timestamp |

**Tabla `recurring_events`:**
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | TEXT PK | UUID |
| `description` | TEXT NOT NULL | Nombre del evento |
| `type` | TEXT NOT NULL | CHECK: income, expense |
| `amount` | INTEGER NOT NULL | Monto en unidades enteras |
| `frequency` | TEXT NOT NULL | CHECK: monthly, weekly, bimonthly, once |
| `day_of_month` | INTEGER | Para monthly/bimonthly (1-31) |
| `day_of_week` | INTEGER | Para weekly (0-6, 0=domingo) |
| `start_date` | TEXT | Fecha de inicio |
| `end_date` | TEXT | Fecha de fin (null = sin fin) |
| `active` | INTEGER NOT NULL DEFAULT 1 | Si está activo |
| `created_at` | TEXT DEFAULT (datetime('now')) | Timestamp |
| `updated_at` | TEXT DEFAULT (datetime('now')) | Timestamp |

### FR-2: Server Actions layer
Nuevo directorio: `app/actions/`. Cada Server Action reemplaza una función de `hooks/use-budget.tsx`:

| Server Action | Reemplaza | Tabla(s) |
|---------------|-----------|----------|
| `loadState` | Lectura inicial | budgets, accounts, transactions |
| `setupBudget` | `setupBudget()` | budgets |
| `addTransaction` | `addTransaction()` | transactions |
| `removeTransaction` | `removeTransaction()` | transactions |
| `updateTransaction` | `updateTransaction()` | transactions |
| `addAccount` | `addAccount()` | accounts |
| `updateAccount` | `updateAccount()` | accounts |
| `deleteAccount` | `deleteAccount()` | accounts |
| `transferFunds` | `transferFunds()` | transactions |
| `updateConfig` | `updateConfig()` | budgets |
| `toggleAutoSave` | `toggleAutoSave()` | budgets |
| `clearData` | `clearData()` | budgets, accounts, transactions |

Server Actions adicionales para `recurring_events`:
- `loadRecurringEvents`, `addRecurringEvent`, `updateRecurringEvent`, `deleteRecurringEvent`

Server Action para proyección:
- `computeProjection(horizonDays)` — retorna `CashflowDayResult[]` calculado on-demand.

**Patrón de integración**: `hooks/use-budget.tsx` se refactoriza para llamar Server Actions en lugar de escribir `localStorage`. El hook mantiene el estado local (React state) y sincroniza con SQLite vía Server Actions. Se usa `useActionState` o batching para evitar una Server Action por cada tecla.

### FR-3: Migración idempotente de localStorage → SQLite
Archivo: `lib/migrate-localstorage.ts`

- Detección: si existe `localStorage['daily-budget-data']` con datos y la tabla `accounts` está vacía → migrar.
- Garantizar cuentas default (`'daily'`, `'savings'`, `'investment'`): crear/ubicar cada una con un **UUID estable** (p. ej. fijo por tipo, o registrado en una seed table) navegando por su `type`/`name`, y mapear el id del `localStorage` al UUID generado.
- Re-mapeo de `transactions.account` (string) → `account_id` (UUID) resolviendo el mapa id-local → UUID generado.
- Poblar `budgets` desde `budget` + `isSetup` del localStorage.
- Marcar `localStorage` como migrado (clave `daily-budget-data-migrated: true`).
- Idempotente: re-ejecutar no duplica (guardas `ON CONFLICT` + check de filas existentes).

### FR-4: Proyección nativa de flujo de caja
Archivo: `lib/projection.ts` (extiende `lib/cashflow.ts`)

- Lee saldo actual de `accounts` (balance derivado de transacciones, o suma de `start_amount` + transacciones de la cuenta `daily`).
- Lee eventos recurrentes activos de `recurring_events`.
- Genera filas para cada día del horizonte usando `calculateDailyBalance`.
- Retorna `CashflowDayResult[]` con columnas: Fecha, Detalle, Ingreso, Egreso, Saldo.
- **No se almacena**: se calcula on-demand vía Server Action `computeProjection`.

### FR-5: Eliminación de Supabase/Auth/Sheets
Archivos a eliminar:
- `lib/supabase/client.ts`
- `lib/supabase/server.ts`
- `contexts/auth-context.tsx`
- `app/login/page.tsx`
- `proxy.ts`
- `app/layout.tsx` (wrapper de AuthProvider — se simplifica)
- Directorio `supabase/`
- Variables de entorno: `NEXT_PUBLIC_SUPABASE_*`, `GMAIL_CLIENT_ID` en `.env.local`

Dependencias a eliminar de `package.json`:
- `@supabase/ssr`
- `@supabase/supabase-js`

### FR-6: Configuración de Next.js
`next.config.mjs` se actualiza para:
```js
const config = {
  serverExternalPackages: ['better-sqlite3'],
};
```

### FR-7: Archivo de migración descriptiva (OBLIGATORIO)
- **Ruta**: `docs/migrations/2026-08-31-sqlite-local.md`
- **Contenido mínimo**: schema previo (localStorage JSON shape), schema nuevo (4 tablas SQLite), estrategia de datos (migración idempotente), rollback.
- **Regla**: este change no se considera completo sin su migración descriptiva.

---

## 5. Requerimientos No Funcionales

### NFR-1: Sin dependencia de red o servicios externos
- La app funciona 100% offline por diseño (SQLite local).
- No hay llamadas a APIs externas, no hay auth, no hay tokens.
- La app se ejecuta en el Mac del usuario (`pnpm dev` o `pnpm build && pnpm start`).

### NFR-2: Consistencia
- **Única fuente de verdad**: SQLite. `localStorage` es solo fuente de migración.
- Estado derivado (`dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay`) **no se persiste** — se calcula a partir de `budgets` + `transactions` + fecha actual via `lib/cashflow.ts`.
- Saldo de cuenta derivado de transacciones (SUM), no almacenado como autoridad.

### NFR-3: Performance
- `better-sqlite3` es síncrono y extremadamente rápido para operaciones locales.
- Server Actions agregan un round-trip server→client, pero para single-user local es despreciable.
- Para operaciones por teclado (ej. editar monto de transacción): batching o debounce en el hook, no una Server Action por keystroke.
- Índice `idx_tx_date` para queries por cuenta+fecha.

### NFR-4: Portabilidad del archivo `.db`
- El archivo se almacena en un path predecible del proyecto (ej. `data/saldo-cero.db`).
- El `.db` es portable: se puede copiar entre máquinas, respaldar, o sincronizar vía iCloud Drive en el futuro.
- El `.db` debe estar en `.gitignore`.

### NFR-5: Testeabilidad y no-regresión
- Unit: Server Actions, migración, cálculo de proyección.
- Integración: migración localStorage→SQLite, CRUD completo.
- E2E: setup → agregar transacción → verificar saldo → proyección.
- Suite existente intacta: `pnpm test` + `pnpm tsc --noEmit` (pre-commit).

### NFR-6: Seguridad
- No hay auth porque no hay red. El `.db` está en disco local, protegido por el OS.
- No se exponen API endpoints. Server Actions son internos de Next.js.
- No se loguean secrets ni keys.

---

## 6. Restricciones de Diseño Técnico

### 6.1 Stack
- Next.js 16.2.6 + App Router, React 19, TypeScript 5, pnpm.
- `better-sqlite3` (server-side, native addon) para SQLite.
- Server Actions (App Router) como capa de datos.
- `lib/cashflow.ts` existente reutilizado para proyecciones.

### 6.2 Estructura de archivos propuesta
```
lib/db/
  index.ts          // better-sqlite3 connection singleton
  schema.sql        // DDL de las 4 tablas
  migrate.ts        // ejecuta schema.sql si las tablas no existen
app/actions/
  budget.ts         // Server Actions para budget/crud
  transactions.ts   // Server Actions para transacciones
  accounts.ts       // Server Actions para cuentas
  recurring.ts      // Server Actions para recurring_events
  projection.ts     // Server Action para computeProjection
lib/migrate-localstorage.ts  // migración idempotente
lib/projection.ts   // lógica de proyección (extiende cashflow.ts)
data/
  saldo-cero.db     // archivo SQLite (en .gitignore)
```

### 6.3 Decisiones de diseño

| # | Decisión | Opción elegida | Alternativa | Rationale |
|---|----------|---------------|-------------|-----------|
| D1 | Motor de almacenamiento | **better-sqlite3** (server-side) | sql.js (WASM en browser), libsql | Single-user local Mac; archivo `.db` en disco que soporta sync futuro (iCloud Drive) y export directo |
| D2 | Capa de datos | **Server Actions** | Route Handlers | Menos moving parts; el hook llama Server Actions que ejecutan SQL. Route Handlers son overkill para single-user |
| D3 | Estado derivado | **No persistido** — se calcula de budgets+transactions+fecha | Persistir en SQLite | Elimina el problema de divergencia; `dailyAllowance`, `progress`, `lastCheckedDay` siempre se recalculan |
| D4 | Saldo de cuenta | **Derivado de SUM(transactions)** | `accounts.balance` como valor autoritativo | Elimina el problema de dos verdades; el saldo siempre es reconstruible |
| D5 | Proyección recurrente | **`recurring_events` tabla nueva** | Generar desde código hardcodeado | Permite al usuario configurar sus propios eventos; alimenta la proyección nativa |
| D6 | Persistencia de proyección | **Vista computada on-demand** | Tabla materializada | El horizonte cambia constantemente; no tiene sentido almacenar lo que se recalcula |
| D7 | Sync multi-dispositivo | **Deferred** (fuera de alcance) | Implementar ahora | El `.db` es single-device por ahora; sync futuro con iCloud Drive o copia directa |
| D8 | IDs de cuentas | **UUID (v4)** en `accounts.id` | Slug ('daily','savings','investment') | Identidad única y sin colisiones (prepara sync futuro); la UI identifica la cuenta por `name`/`type`, nunca leyendo el id. El re-mapeo de `transactions.account` → `account_id` ya ocurre en la migración (FR-3) |

### 6.4 Flujo de datos
```
hooks/use-budget.tsx (client) ──► Server Actions ──► better-sqlite3 ──► data/saldo-cero.db
                                        │
                                        └──► lib/cashflow.ts (derivados)
                                        └──► lib/projection.ts (proyección)
```

---

## 7. Fuera de Alcance

| Ítem | Razón | Trabajo futuro |
|------|-------|----------------|
| Sync multi-dispositivo | Deferred deliberadamente; el `.db` es single-device | Evaluación futura (iCloud Drive, cp, o sync engine) |
| Autenticación / login | No aplica — la app es local, single-user | No se requiere |
| Google Sheets | Eliminado completamente; reemplazado por proyección nativa | No se requiere |
| Supabase / PostgreSQL | Eliminado completamente | No se requiere |
| Exportación a CSV/PDF | Nice to Have, no bloquea MVP | PRD futuro si el usuario lo solicita |
| Encriptación del `.db` | El OS ya protege el disco; no es prioridad para single-user | Evaluación futura |
| Multi-usuario / multi-tenant | Fuera de alcance — la app es personal | No se requiere |
| Backup automático | El usuario puede copiar el `.db` manualmente | Nice to Have futuro |

---

## 8. Resumen de Criterios de Aceptación

### Must Have
- [ ] SQLite como única fuente de verdad: 4 tablas (accounts, transactions, budgets, recurring_events) con schema completo.
- [ ] Server Actions para CRUD: al menos 12 Server Actions reemplazando las 12 funciones de `use-budget`.
- [ ] `next.config.mjs` con `serverExternalPackages: ['better-sqlite3']`.
- [ ] Migración idempotente de `localStorage` a SQLite que preserve accounts, transactions y budget.
- [ ] Estado derivado (`dailyAllowance`, `progress`, `lastCheckedDay`) calculado, no persistido.
- [ ] Saldo de cuenta derivado de transacciones (SUM).
- [ ] Eliminación completa de Supabase/Auth/Sheets: dependencias, archivos, env vars.
- [ ] `proxy.ts` eliminado (middleware mal nombrado).
- [ ] UI se comporta idéntica al estado actual (no-regresión funcional y visual).
- [ ] `docs/migrations/2026-08-31-sqlite-local.md` creado (OBLIGATORIO).
- [ ] `pnpm test` + `pnpm tsc --noEmit` en verde.

### Should Have
- [ ] CRUD de `recurring_events` con UI funcional.
- [ ] Proyección de flujo de caja nativa (Fecha/Detalle/Ingreso/Egreso/Saldo) calculada on-demand.
- [ ] Configuración de horizonte de proyección (30/60/90 días).
- [ ] El archivo `.db` está en `.gitignore`.
- [ ] Tests unitarios para Server Actions y migración.

### Nice to Have
- [ ] Exportación del `.db` a JSON o CSV.
- [ ] Backup manual del `.db` desde la UI.
- [ ] Indicador visual de "datos cargados desde SQLite" en la UI.

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Transición client-only → server+client rompe el flujo existente | Alta | Alta | Refactorizar `use-budget` incrementalmente; mantener tests existentes; fase de verificación dedicada |
| `better-sqlite3` native addon no compila en Next.js 16 | Media | Alta | Usar `serverExternalPackages` en `next.config.mjs`; fallback a `sql.js` (WASM) si es necesario |
| Pérdida de datos durante migración localStorage → SQLite | Media | Crítica | Migración idempotente con guardas; backup del `localStorage` antes de migrar; test de migración exhaustivo |
| Server Actions por cada tecla causan latencia perceptible | Media | Media | Debounce/batching en el hook; optimistic updates; no Server Action en cada keystroke |
| Datos atados a un solo dispositivo (sin sync) | Alta | Baja | Aceptado deliberadamente; documentado como deferred; el `.db` es portable y copiable manualmente |
| `proxy.ts` eliminación rompe middleware no detectado | Baja | Media | Verificar que `proxy.ts` no es importado en ningún sitio antes de eliminar; `pnpm tsc --noEmit` |
| Regresión del flujo diario al cambiar la fuente de datos | Media | Alta | Tests de no-regresión; fase dedicada de verificación; UI idéntica |
| `recurring_events` con frecuencias edge cases (bimestral, semanal con día específico) | Media | Media | Unit tests para cada frecuencia; empezar con monthly/once y expandir |

---

## 10. Plan de Rollback

1. Revertir `hooks/use-budget.tsx` a la versión previa (fuente = `localStorage`).
2. Restaurar `next.config.mjs` a `{}`.
3. Eliminar `lib/db/`, `app/actions/`, `lib/migrate-localstorage.ts`, `lib/projection.ts`.
4. Restaurar archivos eliminados desde git (`lib/supabase/`, `contexts/auth-context.tsx`, `app/login/page.tsx`, `proxy.ts`).
5. Restaurar dependencias: `pnpm add @supabase/ssr @supabase/supabase-js`.
6. Eliminar `data/saldo-cero.db` si existe.
7. Correr suite completa. La app vuelve a operar 100% sobre `localStorage`.

---

## 11. Dependencias

| Dependencia | Fuente | Propósito |
|-------------|--------|-----------|
| `better-sqlite3` | npm (nueva) | Motor SQLite server-side |
| `lib/cashflow.ts` | Repo existente | Cálculo de campos derivados y base para proyección |
| `types/index.ts` | Repo existente | Tipos `Account`, `Transaction`, `Budget`, `Int`, `toInt()` |
| `hooks/use-budget.tsx` | Repo existente | Hook a refactorizar (747 líneas) |
| Next.js 16 Server Actions | Framework | Capa de datos server-side |
| Convención `docs/migrations/*.md` | Regla interna del repo | Migración descriptiva (FR-7) |
| Vitest | `package.json` | Tests unitarios |

---

## 12. Métricas de Éxito

| Métrica | Objetivo | Medición |
|---------|----------|----------|
| Migración idempotente | No duplicación al re-ejecutar | Test de integración repetido |
| No-regresión | 100% pass | `pnpm test` + `pnpm tsc --noEmit` |
| Carga inicial | < 500ms percibido | Devtools / percepción |
| Latencia de CRUD | < 100ms por operación | DevTools Network (Server Actions) |
| Eliminación de dependencias | 0 llamadas a Supabase/Sheets | `grep -r "supabase\|sheets" lib/ app/` → 0 resultados |
| Proyección funcional | Tabla computada con datos correctos | Test E2E: setup → recurring → computeProjection → verificar filas |
| Archivo `.db` portable | Se puede copiar entre máquinas y la app lo lee | Test manual: copiar `.db` a otra ubicación, apuntar la app, verificar datos |

---

## 13. Fases de Implementación

| Fase | Entregables | Esfuerzo est. |
|------|-------------|---------------|
| **1. SQLite + Schema + Server Actions + next.config** | `lib/db/index.ts`, `schema.sql`, `migrate.ts`; Server Actions (12+); `next.config.mjs` actualizado; conexión funcional | 2 días |
| **2. Migración localStorage → SQLite** | `lib/migrate-localstorage.ts`; integración en flujo de carga; idempotencia; backup de localStorage previo | 1 día |
| **3. Recurring Events + Proyección nativa** | CRUD de `recurring_events` (Server Actions + UI); `lib/projection.ts`; vista de proyección; horizonte configurable | 1.5 días |
| **4. Eliminación de Supabase/Auth/Sheets** | Eliminar archivos, dependencias, env vars; limpiar `app/layout.tsx`; eliminar `proxy.ts`; verificación de imports | 0.5 días |
| **5. Tests + Verificación** | Tests unitarios (Server Actions, migración, proyección); tests de no-regresión; verificación E2E completa | 1 día |

**Total estimado: ~6 días**

---

## 14. Documentos Relacionados

- **PRD previo (supersedido)**: `docs/requirements/multi-device-sync.md` — el escape hatch de §6.6 documenta esta dirección
- **Design previo (supersedido)**: `docs/design/multi-device-sync-design.md`
- **Migración previa (supersedida)**: `docs/migrations/2026-08-27-multi-device-sync.md`
- **Migración descriptiva de este change**: `docs/migrations/2026-08-31-sqlite-local.md` (OBLIGATORIO)
- **Modelo actual**: `types/index.ts`, `hooks/use-budget.tsx`
- **Utilidad de cálculo**: `lib/cashflow.ts`, `docs/cashflow.md`
- **Issue**: [cldrojas/daily-budget#40 — Persistencia de saldos con sincronización multi-dispositivo](https://github.com/cldrojas/daily-budget/issues/40)

---

## 15. Aprobación

| Rol | Nombre | Estado | Fecha |
|-----|--------|--------|-------|
| Product Owner | — | Pendiente | — |
| Tech Lead | — | Pendiente | — |
| QA Lead | — | Pendiente | — |

---

*Documento generado como parte del flujo SDD para el change `sqlite-local`. Pivote de arquitectura: localStorage + Supabase/Sheets → SQLite local-first.*
