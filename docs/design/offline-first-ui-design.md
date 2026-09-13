# Design: Offline-First UI — persistencia real del snapshot + eliminación del stack server muerto

**Change ID**: `offline-first-ui`
**Fuente**: `docs/requirements/offline-first-ui.md`
**Estado**: En diseño — listo para `sdd-tasks`
**Complementa / sustituye**: `sqlite-local` (el pivote a SQLite deja de ser client→Server Actions y se vuelve 100% client-side). Sustituye la mitad viva de `use-budget-actions.ts` por la mitad viva de `use-budget-commits.ts` (el flujo real).

---

## Contexto

La UI ya corre íntegramente contra la DB sql.js del cliente (`hooks/use-budget-commits.ts` → `lib/db/repository.ts`), pero el snapshot nunca se persiste tras mutaciones regulares: `saveToIndexedDB` solo se invoca desde la migración legacy (`lib/migrate-localstorage.ts:248`) y desde el import por QR (`lib/sync-client.ts:159`), así que tras `clearData` o cualquier mutación + reload se restaura el snapshot viejo (el mecanismo directo del bug "setup track no arranca"). Además, `initDb(data)` abre un snapshot sin aplicar upgrades de schema ni `user_version` (los snapshots viejos crashean `loadState` en silencio), el stack server (`app/actions/*` + `lib/db/index.ts` con `better-sqlite3`) es código muerto que además revienta en Vercel (`ENOENT: mkdir '/var/task/data'`), y `restoreBackup` en `sync-settings.tsx` es un no-op que descarta los bytes descargados.

## Decisiones de diseño

| # | Decisión | Opción elegida | Alternativa descartada | Justificación |
|---|----------|----------------|------------------------|---------------|
| D1 | `restoreBackup` | **Arreglar**: aplicar bytes vía `initDb → setDb → saveToIndexedDB` y recargar la página | Quitar el botón | El botón existe en la UI, los backups `pre-claim-*` y `pre-merge` ya se generan, y los usuarios lo esperan. El patrón de recarga es el mismo que ya usa el import por QR (el state de la app no observa `setDb` en vivo — patrón IDB boot). |
| D2 | Ubicación del autosave | **Módulo propio `lib/db/autosave.ts`** (persistencia pura) + integración delgada en `use-budget-commits.ts` | Wrapper dentro del hook | El debounce/persistencia es un cross-cutting concern testeable en aislamiento; `use-budget-commits.ts` queda como capa delgada de commits (`getDb` + `repo.*` + `schedule()`), sin lógica de timing. |
| D3 | Renombres cosméticos (`runServer`/`commit*` misnomers) | **Deferred** (fuera de este change) | Renombrar ahora | Churn cosmético sin impacto en correctitud; no bloquea autosave/upgrade/dedup; se documenta en tasks como follow-up opcional. |

**D1 en detalle** — `handleRestore(label)` hoy hace `await restoreBackup(label)` (lee bytes de IndexedDB) y **los descarta**; solo pinta `syncRestored`. El fix aplica el snapshot como unidad atómica: `initDb(bytes) → setDb(db) → saveToIndexedDB(db) → window.location.reload()`. Reutiliza exactamente la misma secuencia que `applyQrImport` (sin el merge: un backup restaurado **reemplaza** a la DB actual, no se mezcla). Al fallar la apertura del snapshot (bytes corruptos o schema incompatibles) se muestra el error y no se toca la DB activa.

**D2 en detalle** — `lib/db/autosave.ts` expone:

```ts
// lib/db/autosave.ts — persistencia pura, sin React
schedule(): void              // debounce 300 ms → persist(getDb())
flushNow(): Promise<void>     // inmediato (clearData, day-rollover, pagehide)
subscribeToVisibility(): void // pagehide + visibilitychange→hidden → flushNow()
persist(db): Promise<void>    // exportDb(db) → saveToIndexedDB(db), best-effort con catch
```

Solo el **gestor de uniformización** del autosave se monta una vez (en el boot de `use-budget.tsx`); `use-budget-commits.ts` solo llama `schedule()` (o `flushNow()` para `clearData`). El módulo no conoce React ni el hook.

## Arquitectura

```
[mutación de negocio]              hooks/use-budget-actions.ts (optimistic puro)
        │
        ▼
[commit]                           hooks/use-budget-commits.ts
        │  getDb() → repo.<mutation>(db)          ← mutación ACID sobre sql.js en memoria
        │  schedule() | flushNow()                ← punto único de entrada al autosave
        ▼
[persistencia]                     lib/db/autosave.ts
        │  debounce 300 ms (o inmediato) → persist(db)
        │  = exportDb(db) → Uint8Array snapshot (db.export())
        │  = saveToIndexedDB(db)  ← write 'last' en IndexedDB store snapshots
        ▼
[fuente de verdad durable]         IndexedDB: saldo-cero-db/snapshots/last

[reload]                           boot: loadFromIndexedDB() → initDb(bytes, {upgrade:true}) → getDb()
        └── initDb ahora aplica user_version / upgrade path / foreign_keys (ver §Cambios de modelo de datos)
```

Quién llama a qué:

| Llamante | Qué invoca | Cuándo |
|----------|------------|--------|
| `use-budget-commits.ts` (`commitAddTransaction`, `commitUpdateConfig`, `commitSetupBudget`, etc.) | `autosave.schedule()` | Tras cada mutación regular (debounced 300 ms) |
| `use-budget-commits.ts` (`commitClearData`) | `autosave.flushNow()` | **Inmediato** — el escenario que hoy resucita `is_setup=1` |
| `use-budget.tsx` (efecto de day-rollover, ~L182 cuando `!isSameDay(today, lastCheckedDay)` y `autoSave`) | `autosave.flushNow()` | **Inmediato** en el rollover diario (reset del allowance) |
| `lib/sync-client.ts` (`applyQrImport`) | `saveToIndexedDB` directo (ya es inmediato y best-effort) | Import por QR — se **conserva** tal cual (no pasa por el debounce: es un reemplazo de DB completo, no una mutación) |
| `lib/migrate-localstorage.ts` | `saveToIndexedDB` directo | Migración legacy — se conserva (una sola vez en el boot) |
| `components/sync/sync-settings.tsx` (`handleRestore`) | `initDb → setDb → saveToIndexedDB → reload` (D1) | Restaurar backup |
| Boot de la app | `loadFromIndexedDB → initDb(snapshot) → getDb` | Carga inicial |

La persistencia queda en un **solo punto** (autosave) para mutaciones, y dos puntos explícitos e inmediatos para reemplazos de DB completos (import/restore) y migración legacy. No hay camino de escritura a IndexedDB fuera de estos.

## Cambios de modelo de datos

`initDb(data?)` (`lib/db/client.ts`) hoy abre un snapshot **sin** aplicar `SCHEMA` y sin gestionar versiones. Cambios:

1. **`PRAGMA user_version = 2`** luego del upgrade (marcador de shape).
2. **`PRAGMA foreign_keys = ON`** en `initDb` (sql.js lo trae OFF por defecto; hoy la integridad referencial solo existe en el papel). Se aplica **después** del DDL de upgrade para no interferir con `ALTER`s.
3. **Upgrade path en `initDb(data)`** para snapshots viejos (los bytes del snapshot embeben su propio DDL viejo; ahora se migran antes de que `loadState` los lea):
   - `CREATE TABLE IF NOT EXISTS` de las 5 tablas + `idx_tx_date` (cubre snapshots pre-`recurring_events`/`sync_meta`);
   - `ALTER TABLE ... ADD COLUMN` **con guard** para `deleted_at` / `device_id` en `accounts`, `transactions`, `budgets`, `recurring_events` — el guard consulta `PRAGMA table_info(<tabla>)` y solo emite el `ALTER` si la columna no existe;
   - stamp `user_version = 2` al final (idempotente: si ya es 2, no se re-ejecuta el DDL de upgrade).
4. La DB **nueva** (sin snapshot) ya arranca con `SCHEMA` completo → equivalente a v2; se le setea también `user_version = 2` para paridad de shape.

**¿Es un "data-model change" que requiere migración descriptiva?** — **SÍ**, por política: se retira el modelo `server.db` (mejor-sqlite3), la fuente de verdad pasa a ser el **snapshot IndexedDB**, y se introduce `user_version` con camino de upgrade. Ver `docs/migrations/2026-09-12-offline-first-ui.md`.

## Estrategia de datos

- **Usuarios con `localStorage` legacy**: mantienen el path actual de `lib/migrate-localstorage.ts` — migra a una DB nueva con SCHEMA completo (v2) y persiste con `saveToIndexedDB`. Sin cambios.
- **Snapshots IndexedDB de esta rama (Batch 5.1+, era QR)**: ya traen las 5 tablas + `deleted_at`/`device_id` (el `SCHEMA` las incluye desde `account-type-expense`/`multi-device`). El upgrade es **no-op**: `CREATE IF NOT EXISTS` no toca nada, los `ALTER`s con guard se saltan (columnas existentes), y solo se sella `user_version = 2`. No se reescribe ni una fila.
- **Snapshots pre-Batch (más viejos)**: les faltan `recurring_events`/`sync_meta` (tablas) y/o `deleted_at`/`device_id` (columnas). El upgrade los completa con `NULL` en las columnas nuevas — las filas existentes se preservan y pasan a ser "no borradas / sin device". `loadState` deja de crashear.
- **`server.db` (mejor-sqlite3)**: se elimina. Los datos eran un **espejo** del snapshot; ante cualquier divergencia, el sync por QR (claim autocontenido, LWW en `mergeDatabases`) es el camino de reconciliación. Discard aceptado (ver migración + rollback).
- **Sin destrucción de datos de usuario**: el único borrado real es del espejo server y del andamiaje muerto (archivos de código + `data/saldo-cero.db*`).

Flujo **antes → después**:

```
ANTES:  mutación → sql.js en memoria → (nada guardado en IndexedDB)
        reload → IndexedDB snapshot VIEJO restaurado → cambios perdidos / setup resucita

DESPUÉS: mutación → commit repo (sql.js) → debounce 300 ms → exportDb → IndexedDB
         reload → IndexedDB snapshot NUEVO → initDb(upgrade) → estado intacto
```

## Estrategia de prueba

Gate de aceptación: `pnpm tsc --noEmit` + `pnpm test` + `pnpm test:ui` (12/12).

| Capa | Qué se prueba | Cómo |
|------|---------------|------|
| **Unit — autosave** | `schedule()` persiste tras mutación (fake timers: `now+300ms` → `saveToIndexedDB` llamado con el snapshot exportado); `flushNow()` inmediato; flush en `pagehide`/`visibilitychange→hidden`; `persist` no tira si IndexedDB falla (best-effort, quitando el window de pérdida del caso erróneo) | Vitest + fake `indexedDB`/mock de `saveToIndexedDB`; test dedicado "mutar → reload → estado intacto" |
| **Unit — upgrade de schema** | Snapshot de shape viejo (DDL manual pre-`recurring_events`/`sync_meta`/`deleted_at`/`device_id`) abre con `initDb` y queda v2: columnas presentes con `NULL`, tablas nuevas creadas, `loadState` no crashea, `setMeta` funciona | Vitest: construir bytes con DDL viejo → `initDb(bytes)` → `repo.loadState` y `meta` |
| **Unit — idempotencia de `initDb`** | Correr el upgrade 2× sobre el mismo snapshot → sin errores, `user_version=2`, misma shape | Vitest sobre mock de snapshot |
| **Unit — `PRAGMA foreign_keys`** | Con `foreign_keys=ON`, un `INSERT` con `account_id` huérfano falla | Vitest + sql.js |
| **Unit — restoreBackup** | Aplicar bytes vía `initDb→setDb→saveToIndexedDB` persiste; snapshot corrupto → error sin tocar la DB activa | `tests/unit/sync-settings.test.tsx` rework |
| **Eliminación** | `tests/unit/load-state.test.ts` (depende de `app/actions/budget`), `tests/ui/e2e-db.ts` y los helpers server de `tests/ui/test-utils.ts` (crean/lean la DB server vía `SQLITE_DB_PATH`) | Borrar + reemplazar los helpers UI con un harness client-side (sql.js/IndexedDB) que comparta los mismos fixtures |
| **Regresión** | Suite existente intacta tras borrar el stack server; cero imports residuales de `app/actions/*` y `lib/db/index.ts` por `grep` | `pnpm test` + gate |

## Riesgos y mitigaciones

| Riesgo | Probab. | Impacto | Mitigación |
|--------|---------|---------|------------|
| Perf del autosave con snapshot grande (export cada 300 ms) | Baja | Baja | El debounce agrupa ráfagas de mutaciones en un solo export/persist; IndexedDB local **no** aplica el cap de 3 MiB del relay (límite solo del claim; los snapshots reales rondan decenas de KiB) |
| Ventana de 300 ms de pérdida en crash | Baja | Baja | Flush en `pagehide`/`visibilitychange` cubre cierre de pestaña; el caso residual (kill del proceso sin evento) es aceptable y se documenta |
| IndexedDB falla (modo privado / cuota) | Baja | Media | `persist()` envuelve `saveToIndexedDB` en try/catch best-effort (mismo patrón `saveToIndexedDbSafe` de `applyQrImport`); la app sigue viva en memoria; se registra el error. Fallback: DB vacía aceptable — no bloquear la UI |
| Carga WASM de sql.js | Baja | Media | Sin cambio — `getSql()` ya maneja el fallback de `locateFile`; fuera de alcance |
| Drift entre `schema.sql` / `schema.ts` / upgrade path | Media | Media | `tests/unit/schema-sync.test.ts` cubre la paridad schema.sql↔schema.ts; el upgrade path se testea contra un snapshot de shape viejo |
| `user_version` ausente en snapshots viejos (= 0) | Alta (pre-Batch) | Baja | El upgrade trata todo `< 2` por igual: el DDL es idempotente (IF NOT EXISTS / ALTER con guard) |
| Restaurar un snapshot viejo que no tiene `sync_meta` | Baja | Media | El upgrade corre `CREATE TABLE IF NOT EXISTS` de `sync_meta` **antes** del primer `setMeta`/`markSynced`; el test de restore usa un snapshot pre-Batch |
| Reintroducción accidental de un import server al borrar el stack | Baja | Media | Orden de aplicación: borrar librerías+rutas primero, luego UI, luego tests; `grep` + `tsc` como gate final |

## Migración

- **Archivo**: `docs/migrations/2026-09-12-offline-first-ui.md`.
- **Resumen**: pivot offline-first — el snapshot sql.js/IndexedDB pasa a ser fuente de verdad única; se introduce `user_version=2` con upgrade path en `initDb`; se retira el modelo `server.db` (mejor-sqlite3); `PRAGMA foreign_keys=ON`; se documenta la estrategia de datos para usuarios legacy, snapshots actuales (no-op) y pre-Batch (upgrades por guard), el rollback (conservar `data/saldo-cero.db` local fuera del commit de borrado) y la ejecución DDL del upgrade.

---

*Documento generado como parte del flujo SDD para el change `offline-first-ui`. Complementa `docs/migrations/2026-09-12-offline-first-ui.md`.*