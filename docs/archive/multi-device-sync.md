# PRD: Sincronización Multi-dispositivo (Fase 2 — Persistencia y Sync)

## 1. Resumen Ejecutivo

### 1.1 Propósito
Convertir **Supabase/PostgreSQL en la fuente de verdad (source of truth)** de la app, conectando el CRUD de cuentas, transacciones y presupuesto que hoy viven en `localStorage`, para que un mismo usuario pueda **ver y operar sus datos de forma consistente desde cualquier dispositivo** (desktop, móvil, tablet).

Esta es la **Fase 2** del issue [#40 — Persistencia de saldos con sincronización multi-dispositivo](https://github.com/cldrojas/daily-budget/issues/40). La Fase 1 (<change id `supabase-auth-backend`>) ya dejó lista la identidad (`auth.users`), el schema (`profiles`, `accounts`, `transactions`), RLS own-rows y la puerta de login. Esta fase **conecta ese backend a la UI**, migra los datos locales existentes y garantiza la consistencia entre dispositivos.

### 1.2 Change ID
`multi-device-sync`

### 1.3 Estado
**Propuesto.** Sin implementar. Depende de `supabase-auth-backend` (Fase 1, implementada).
Revisado el 2026-08-28: alcance recortado — Supabase Realtime queda explícitamente **fuera del MVP** (refetch en `visibilitychange`), la cola offline se reduce a un mecanismo trivial, y se documenta un **escape hatch a SQLite (Cloudflare D1)** por si la ceremonia de auth/RLS pesa más que su beneficio (ver §6.6).

---

## 2. Planteamiento del Problema

### 2.1 Estado Actual
- La **autenticación** ya funciona (Fase 1): sesión Supabase con cookies httpOnly, `/login`, aislamiento RLS, schema `accounts`/`transactions`/`profiles` en Postgres (proyecto `whacwpjgizlxvnmckyli`).
- **Pero la app sigue leyendo y escribiendo 100% en `localStorage`** bajo la clave `daily-budget-data` (`hooks/use-budget.tsx`, líneas 88-115). El schema de Postgres está **vacío y desconectado** de la UI.
- El estado persistido localmente incluye: `budget` (config), `accounts`, `transactions`, `dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay` e `isSetup`.
- El schema de Postgres creado en Fase 1 **no tiene tabla de presupuesto** (`budget`) ni cubre los campos derivados de la app (allowance, progress, lastCheckedDay, isSetup).

### 2.2 Pain Points
1. **Datos atrapados en un solo dispositivo**: cambias de móvil a desktop y cada uno arranca desde cero (o desde sus `saldos` default).
2. **Ediciones divergentes**: registrar un gasto en el móvil y abrir el desktop no lo refleja; el desktop conserva datos obsoletos que pueden **sobrescribir** los del móvil (sincronización zombie).
3. **Sin fuente única de verdad**: el `localStorage` de cada dispositivo se contradice. No hay forma de saber cuál es correcto.
4. **Presupuesto no sincronizable**: aun cuando se conectaran `accounts`/`transactions`, la config de `budget` (startAmount, startDate, endDate, autoSave, mode) quedaría fuera del backend.
5. **Doble verdad frágil**: `accounts.balance` (Postgres) y las cuentas de `localStorage` pueden desincronizarse; hay que decidir quién manda y cómo reconciliar.

### 2.3 Oportunidad
Supabase ya provee **Postgres + Auth + RLS** y **Realtime** (change data capture sobre Postgres). La Fase 1 dejó `updated_at` y triggers listos. Conectar el CRUD, decidir una estrategia de conflictos y añadir una tabla `budgets` desbloquea la sincronización multi-dispositivo **sin re-arquitecturar**: solo completar la Fase 2 ya planificada.

---

## 3. Historias de Usuario

### US-1: Sincronización de cuentas y saldos entre dispositivos
**Como** ingeniero con workflow multidispositivo
**Quiero** que mis cuentas con sus saldos y movimientos se sincronicen entre dispositivos
**Para que** registrar un gasto en el móvil se refleje al instante en el desktop

**Criterios de aceptación:**
- [ ] Las cuentas, sus saldos y los movimientos se guardan en Postgres (fuente de verdad).
- [ ] Un cambio hecho en el dispositivo A aparece en el dispositivo B (tras refresh o en tiempo real vía Realtime).
- [ ] El `localStorage` deja de ser la fuente de lectura/escritura; pasa a ser solo caché offline.

### US-2: Migración de datos existentes
**Como** usuario con datos en `localStorage`
**Quiero** conservar mi historial al activar la sincronización
**Para que** no pierda cuentas ni movimientos ya registrados

**Criterios de aceptación:**
- [ ] Al iniciar la app con una cuenta nueva (o en la primera conexión), se migran las cuentas y transacciones de `localStorage` a Postgres.
- [ ] Las cuentas default (`'daily'`, `'savings'`, `'investment'`) se preservan con su `balance` e `icon`.
- [ ] `transactions.account` (string) se re-mapea a `account_id` (uuid) correctamente.
- [ ] La config de `budget` (startAmount, startDate, endDate, autoSave, mode) se persiste y sincroniza.

### US-3: Consistencia al operar desde múltiples dispositivos
**Como** usuario autenticado en varios dispositivos
**Quiero** que la app resuelva cambios concurrentes de forma predecible
**Para que** no pierda ni corrompa datos al editar desde dos lugares

**Criterios de aceptación:**
- [ ] La estrategia de conflictos está documentada y aplicada.
- [ ] No se sobrescriben cambios más recientes con cambios más antiguos (o el conflicto se resuelve sin pérdida).
- [ ] El saldo de una cuenta es **derivado** de sus transacciones (no dos verdades independientes que puedan divergir).

### US-4: Funcionamiento offline básico
**Como** usuario con conectividad intermitente
**Quiero** poder operar la app aunque esté sin conexión
**Para que** el registro de gastos no se bloquee por falta de red

**Criterios de aceptación:**
- [ ] La app funciona en caché local cuando no hay conexión.
- [ ] Los cambios hechos offline se sincronizan a Postgres al recuperar la conexión.
- [ ] La cola offline es **trivial**: operaciones pendientes en memoria + `localStorage`, flush al reconectar en orden de creación. Sin replay ordenado, sin CRDT (ver Sección 7 y §6.6).

### US-5: No-regresión del flujo actual
**Como** usuario de la app
**Quiero** que la sincronización no rompa el flujo diario que ya conozco
**Para que** el cambio sea transparente

**Criterios de aceptación:**
- [ ] Todos los tests existentes (`pnpm test`, `pnpm tsc --noEmit`) pasan.
- [ ] La UI de cuentas, transacciones, transferencias y presupuesto se comporta igual que hoy.
- [ ] Los cálculos derivados (allowance diario, progreso, ahorro automático) funcionan con datos de Postgres.

---

## 4. Requerimientos Funcionales

### FR-1: Fuente de verdad = Postgres (Supabase)
- `hooks/use-budget.tsx` deja de leer/escribir `localStorage` como fuente primaria y pasa a operar contra Postgres vía el cliente Supabase autenticado.
- Un **adaptador/abstracción de persistencia** (`lib/sync/` o similar) separa el estado de la UI (hooks) del transporte (Supabase). Mínimo debe exponer: `loadState()`, `saveAccount()`, `saveTransaction()`, `saveBudget()`.
- `localStorage` queda como **caché offline** (load inicial rápido) y cola local para operaciones sin red.

### FR-2: Schema del modelo (ampliar el creado en Fase 1)
- **Nueva tabla `budgets`** (1:1 con el usuario) para la config del presupuesto:

| Columna | Tipo | Notas |
|---------|------|-------|
| `user_id` | uuid PK → `auth.users.id` (on delete cascade) | 1 fila por usuario |
| `start_amount` | integer default 0 | `Budget.startAmount` |
| `start_date` | date | `Budget.startDate` |
| `end_date` | date | `Budget.endDate` |
| `auto_save` | boolean default true | `Budget.autoSave` |
| `mode` | text CHECK ('daily','track') | `Budget.mode` |
| `is_setup` | boolean default false | de `localStorage` |
| `updated_at` | timestamptz | trigger `set_updated_at` |

- **Campos derivados NO se persisten** en Postgres: `dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay` se **calculan** a partir de `budgets` + `transactions` + fecha actual (función pura en `lib/cashflow.ts`). Esto elimina la fuente de divergencia (dos dispositivos con "remainingToday" distintos).
- **`accounts.balance`**: ver decisión SD-2 (Sección 6.4). Recomendado: mantenerlo como **derivado** de transacciones (recalcular), o conservarlo con estrategia de resolución documented.

### FR-3: Migración de datos de `localStorage` → Postgres
- Detección: si el usuario tiene `localStorage['daily-budget-data']` con datos y su cuenta en Postgres está vacía (`accounts` sin filas), se ofrece migrar (o se migra automáticamente con confirmación).
- **Seed de cuentas default**: se crean `daily`/`savings`/`investment` por usuario (preservando `balance`, `icon`, `name`) si no existen.
- **Re-mapeo** `transactions.account` (string) → `account_id` (uuid) resolviendo las cuentas default y las custom.
- **Idempotente**: migrar dos veces no duplica datos (guardas por `localStorage` marcado como migrado o por chequeo de filas existentes).
- La migración es **por usuario y por dispositivo**: el dispositivo que migre primero define el estado canónico que luego se sincroniza al resto.

### FR-4: Sincronización de lecturas
- Al montar la app (sesión válida), se **lee de Postgres** (fetch de cuentas, transacciones, budget) en lugar de `localStorage`.
- **Fuera de MVP** (decisión §6.6): nada de Supabase Realtime en esta fase. Los cambios de otros dispositivos se reflejan al recargar o al volver a la pestaña (`visibilitychange`). Añadirlo después no cambia el modelo.

### FR-5: Sincronización de escrituras
- Cada mutación (`addTransaction`, `addAccount`, `deleteAccount`, `transfer`, `updateConfig`, `setupBudget`, auto-save diario) escribe en Postgres.
- El auto-save diario (mover remaining a savings, crear la transferencia) se persiste en Postgres, no re-calculado localmente de forma divergente.
- `isSetup` y `budget` fluyen a `budgets` / se derivan como corresponde.

### FR-6: `proxy.ts` y sesión (sin cambios de alcance mayor)
- Reutilizar `proxy.ts` y `auth-context` de Fase 1. El sync opera **solo con sesión autenticada**; usuarios no autenticados siguen redirigidos a `/login`.

### FR-7: Cambio de modelo documentado (OBLIGATORIO)
- Todo cambio al modelo de datos **debe** tener su archivo de migración:
  - **Ruta**: `docs/migrations/2026-08-27-multi-device-sync.md`.
  - **Contenido mínimo**: schema previo, schema nuevo, estrategia de datos (incl. re-mapeo de ids y seed), rollback.
  - **Regla**: este change no se considera completo sin su migración descriptiva.
- Migración SQL ejecutable en `supabase/migrations/` (`create_..._sync.sql`): tabla `budgets` + trigger `set_updated_at` + índice + RLS + política own-rows + grants.

---

## 5. Requerimientos No Funcionales

### NFR-1: Seguridad y privacidad
- RLS own-rows sigue siendo la barrera: un usuario **solo** lee/escribe sus filas (`auth.uid() = user_id`).
- La nueva tabla `budgets` debe tener RLS own-rows (misma regla).
- `service_role` jamás en el cliente. Todas las escrituras pasan por la anon/publishable key + RLS.
- Verificación final con `supabase get_advisors` (security): 0 errores RLS en las tablas nuevas.

### NFR-2: Consistencia
- **Única fuente de verdad**: Postgres. `localStorage` = caché, nunca autoridad.
- Saldo de cuenta derivado o resolución documentada (SD-2) para evitar dos verdades.
- Migración idempotente (no duplicar datos al re-ejecutar o re-sincronizar).

### NFR-3: Performance
- Lecturas eficientes: índices sobre `user_id` (ya existen para `accounts`/`transactions`); añadir índice `budgets(user_id)` implícito por PK.
- Evitar llamadas redundantes a Supabase por render (cache en contexto/hook, load una vez por sesión).
- `transactions` paginada si el volumen crece (Nice to Have), con índice `(user_id, date)` ya presente.

### NFR-4: Offline (básico) y UX
- La app sigue operando con caché local sin conexión; muestra estado de sync claro (p.ej. "cambios pendientes de sincronizar").
- Carga inicial fluida, sin bloqueos largos; estados de carga/skeleton consistentes con Fase 1.

### NFR-5: Testeabilidad y no-regresión
- Unit: adaptador de persistencia, cálculo de derivados, re-mapeo de ids, idempotencia de migración.
- Integración: migración localStorage→Postgres, estrategia de conflictos (SD-2).
- E2E: registro → crear cuenta/gasto → recargar → datos presentes; dos dispositivos convergen.
- Suite existente intacta: `pnpm test` + `pnpm tsc --noEmit` (pre-commit).

---

## 6. Restricciones de Diseño Técnico

### 6.1 Stack
- Next.js 16 + App Router, React 19, TypeScript.
- Supabase: `@supabase/supabase-js` (cliente), `@supabase/ssr` (sesión por cookies), proyecto `whacwpjgizlxvnmckyli`.
- `lib/supabase/client.ts` y `lib/supabase/server.ts` ya existen (Fase 1).

### 6.2 Nueva abstracción de persistencia (borrador)
```
lib/sync/repository.ts   // capa de datos: loadState, upsertAccount, upsertTransaction, upsertBudget
lib/sync/migrate.ts      // migración idempotente localStorage -> Postgres (seed + re-mapeo)
lib/sync/conflicts.ts    // estrategia de resolución de conflictos (SD-2)
hooks/use-budget.tsx      // consume repository; localStorage solo como caché offline
```

### 6.3 Cálculo de campos derivados (no persistidos)
Reutilizar `lib/cashflow.ts` (`calculateDailyBalance`) para derivar de `budgets` + `transactions`:
- `dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay`.
- Regla: **nunca** dos dispositivos con valores distintos de un derivado; siempre se calculan del mismo set de datos.

### 6.4 Decisiones de diseño
| # | Decisión | Opción | Alternativa | Rationale |
|---|----------|--------|-------------|-----------|
| SD-1 | Fuente de verdad | **Postgres** | localStorage | Necesario para sync; localStorage pasa a caché |
| SD-2 | Modelo del saldo | **Balance derivado** (recalcular de transacciones) | `accounts.balance` como valor maestro | Elimina divergencia entre dispositivos; el saldo siempre se puede reconstruir |
| SD-3 | Campos derivados | **No persistir** (`dailyAllowance`, `progress`, `lastCheckedDay`) | Persistir por dispositivo | Persistir crearía estados contradictorios por dispositivo |
| SD-4 | Config de presupuesto | Nueva tabla `budgets` (1:1 usuario) | En `profiles` (columnas) | Aisla el dominio; `profiles` queda para identidad/display |
| SD-5 | Conflictos (alcance) | **Last-write-wins** con `updated_at` + protección del lado del hook | CRDT / OT / cola de operaciones | Suficiente para volumen personal; los derivados no compiten porque no se persisten |
| SD-6 | Realtime | **Fuera de MVP** (decisión de alcance) | Opcional injectable (Nice to Have) | 1 usuario, volumen bajo; refetch en `visibilitychange` cubre el caso; añadir Realtime después no cambia el modelo (§6.6) |

### 6.5 Flujo de datos
```
Dispositivo A (móvil) ──► use-budget ──► lib/sync/repository ──► Supabase (Postgres, source of truth)
                                                                     │
Dispositivo B (desktop) ──► use-budget ──► lib/sync/repository ──────┘
                                                                     │ RLS own-rows (auth.uid() = user_id)
                                        accounts / transactions / budgets
localStorage: caché offline (lectura inicial rápida + cola de escritura sin red)
```

### 6.6 Alcance recortado y escape hatch (revisión 2026-08-28)

El modelo de datos es pequeño (3 tablas, una fila de `budgets`, decenas de transacciones por
mes) y el usuario es único. En línea con el principio local-first de *no mantener dos
verdades*, esta fase se ejecuta **mínima**:

- **Realtime: fuera del MVP.** Los cambios de otro dispositivo se reflejan al recargar o al
  volver a la pestaña (`visibilitychange`). No se suscribe a Postgres en esta fase.
- **Cola offline trivial.** Sin red: las mutaciones se acumulan en memoria + `localStorage`;
  al reconectar se hace flush en orden de creación. Sin replay ordenado, sin CRDT, sin fusión
  de ediciones divergentes (ver §7).
- **Nada de lo multi-tenant.** Aunque RLS lo permita "gratis", no se construyen features
  pensadas para más de un usuario.

**Escape hatch documentado (no se paga ahora):** si la ceremonia completa (login por
dispositivo, RLS, dashboard de Supabase) pesa más que su beneficio, el reemplazo natural es
**Cloudflare D1** — SQLite server-side — tras una API de ~50 líneas desde Next.js. Misma DX
de SQLite, sin motor de sync, sin auth/RLS. Este PRD **no cambia de motor**: documenta la
salida para no re-arquitecturar a ciegas si el costo operativo supera al de la solución actual.

---

## 7. Fuera de Alcance

| Ítem | Razón | Trabajo futuro |
|------|-------|----------------|
| Resolución de conflictos avanzada (CRDT/OT, fusión de ediciones concurrentes divergentes) | Sobrepasa el need de un presupuesto personal | PRD aparte / Fase 3 |
| Cola de escritura offline sofisticada con replay ordenado | Complejidad no justificada en MVP de sync | Fase 3 |
| Supabase Realtime en vivo | Fuera de MVP (decisión §6.6); el refetch en `visibilitychange` cubre el caso de 1 usuario | Fase 3 (o incremental aquí) |
| Encriptación de datos en reposo / borrado de cuenta / GDPR | Independiente de sync | PRD aparte |
| Sincronización a otra infraestructura (Cloudflare D1) | Modelo actual es Supabase; documentado como escape hatch (§6.6), no como plan activo | Evaluación futura si el costo operativo supera al beneficio |

---

## 8. Resumen de Criterios de Aceptación

### Must Have (MVP)
- [ ] Postgres como fuente de verdad: `use-budget` lee/escribe en Supabase (no localStorage como autoridad).
- [ ] Tabla `budgets` + RLS own-rows + trigger `updated_at` + migración descriptiva + migración SQL.
- [ ] Migración idempotente de datos existentes de `localStorage` (cuentas default + custom, re-mapeo de `account` → `account_id`, config de `budget`).
- [ ] Saldo derivado de transacciones (o estrategia de conflictos documentada y aplicada).
- [ ] Campos derivados (allowance/progress/lastCheckedDay) calculados, no persistidos.
- [ ] Un cambio en dispositivo A reflejado en B (tras refresh con una cuenta en común).
- [ ] Offline básico: edición en caché sin bloqueo, sync al reconectar.
- [ ] Sin regresión: `pnpm test` + `pnpm tsc --noEmit` en verde.
- [ ] `docs/migrations/2026-08-27-multi-device-sync.md` (OBLIGATORIO).

### Should Have
- [ ] Estado de sync visible en la UI (pendiente / sincronizado).
- [ ] Confirmación al migrar datos locales (evitar sobrescribir el backend sin aviso).

### Nice to Have
- [ ] ~~Supabase Realtime en vivo~~ — **diferido deliberadamente** (ver §6.6); no forma parte de la definición de done de esta fase.
- [ ] Optimistic UI con rollback ante fallo de red.

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Divergencia del saldo entre dispositivos | Media | Alta | SD-2: saldo derivado de transacciones; nunca dos verdades |
| Sobrescribir datos del backend con un localStorage obsoleto al migrar | Media | Alta | Migración por usuario/dispositivo con confirmación; check de filas existentes; idempotencia |
| `budgets` sin RLS expone presupuesto de otros | Baja | Crítica | Política own-rows explícita en `budgets`; verificar `get_advisors` |
| Migración duplica cuentas/transacciones | Media | Media | Idempotencia (seed con `on conflict`, re-mapeo con guardas) |
| Auto-save diario divergente en dos dispositivos | Media | Media | Persistir el auto-save en Postgres; derivar `lastCheckedDay` de transacciones |
| Regresión del flujo existente al cambiar la fuente de datos | Media | Alta | `lib/sync/` como capa aislada; tests de no-regresión + e2e |
| Volume grande de transacciones (freno) | Baja | Media | Paginación + índice `(user_id, date)` (ya existe) |

---

## 10. Plan de Rollback

1. Revertir `hooks/use-budget.tsx` a la versión previa (fuente = `localStorage`).
2. Eliminar `lib/sync/` (repository, migrate, conflicts).
3. Migración de rollback en Supabase:

```sql
drop table if exists public.budgets;
-- accounts/transactions/profiles y sus policies/triggers se conservan (Fase 1 intacta)
```

4. Borrar/omitir tests de sync; correr suite completa. La app vuelve a operar 100% sobre `localStorage` (comportamiento Fase 1).

---

## 11. Dependencias

| Dependencia | Fuente | Propósito |
|-------------|--------|-----------|
| Fase 1 (`supabase-auth-backend`, issue #40) | Implementada | Auth, schema base, RLS, sesión |
| `@supabase/supabase-js` + `@supabase/ssr` | `package.json` (ya instalados) | Cliente + sesión |
| Proyecto Supabase `whacwpjgizlxvnmckyli` | Dashboard/CLI | Postgres + Auth + (opcional) Realtime |
| `lib/cashflow.ts` | Repo | Cálculo de campos derivados |
| Convención `docs/migrations/*.md` | Regla interna del repo | Migración descriptiva (FR-7) |
| Vitest / Playwright | `package.json` | Unit e2e |
| Cloudflare D1 | No es dependencia activa | Escape hatch documentado (§6.6); no se instala ni se contrata en esta fase |

---

## 12. Métricas de Éxito

| Métrica | Objetivo | Medición |
|---------|----------|----------|
| Cambio reflejado entre dispositivos | 100% | E2E: crear gasto en A, verlo en B tras refresh |
| Consistencia de saldo | 100% (saldo = Σ transacciones) | Test de cálculo derivado |
| Migración idempotente | No duplicación al re-ejecutar | Test de integración repetido |
| Regresión | 100% pass | `pnpm test` + `pnpm tsc --noEmit` |
| RLS en tablas nuevas | 0 errores | `supabase get_advisors` (security) |
| Latencia de carga inicial | < 1s percibido | Devtools / percepción |

---

## 13. Fases de Implementación

| Fase | Entregables | Esfuerzo est. |
|------|-------------|---------------|
| **1. Modelo + migración** | Tabla `budgets` (SQL + descriptiva), índices, RLS, grants | 0.5-1 día |
| **2. Capa de persistencia** | `lib/sync/repository`, `conflicts`, integración en `use-budget` | 1-2 días |
| **3. Migración de datos** | `lib/sync/migrate` (seed defaults + re-mapeo + idempotencia) | 1 día |
| **4. Offline + UX** | Caché offline, estado de sync, confirmación de migración | 0.5-1 día |
| **5. Tests + verificación** | Unit (persistencia, derivados, migración), e2e (dos dispositivos), advisors, no-regresión | 1 día |

**Total: ~4-6 días**

---

## 14. Documentos Relacionados

- **Issue**: [cldrojas/daily-budget#40 — Persistencia de saldos con sincronización multi-dispositivo](https://github.com/cldrojas/daily-budget/issues/40) (Fase 2)
- **PRD Fase 1**: `docs/requirements/supabase-auth-backend.md` (auth, schema, RLS)
- **Spec Fase 1**: `docs/requirements/supabase-auth-backend-spec.md`
- **Design Fase 1**: `docs/design/supabase-auth-backend-design.md`
- **Migración Fase 1**: `docs/migrations/2026-08-11-supabase-auth-backend.md`
- **Migración descriptiva de este change**: `docs/migrations/2026-08-27-multi-device-sync.md`
- **Modelo actual**: `types/index.ts`, `hooks/use-budget.tsx`
- **Utilidad de cálculo**: `lib/cashflow.ts`, `docs/cashflow.md`

---

## 15. Aprobación

| Rol | Nombre | Estado | Fecha |
|-----|--------|--------|-------|
| Product Owner | — | Pendiente | — |
| Tech Lead | — | Pendiente | — |
| QA Lead | — | Pendiente | — |

---

*Documento generado como parte del flujo SDD para el change `multi-device-sync` (Fase 2 del issue #40).*
