# PRD: offline-first-ui (UI 100% local-first — "sin servidor de estado")

## 1. Contexto y problema

La UI ya corre **íntegramente contra la DB sql.js del cliente**: `hooks/use-budget.tsx` opera sobre la DB en-memory vía `hooks/use-budget-commits.ts` → `lib/db/repository.ts`. El stack server-side (`app/actions/*` — budget, transactions, accounts, recurring, projection — y `lib/db/index.ts` con `better-sqlite3` + `data/saldo-cero.db`) es **código muerto**: nada en `components/` ni `contexts/` lo importa, salvo la mitad muerta de `hooks/use-budget-actions.ts` (líneas ~344-453) y `tests/unit/load-state.test.ts`.

En Vercel (serverless), ese stack server no puede existir: el filesystem es de solo lectura y `/var/task` no es escribible. Abrir/crear la DB falla con:

```
Error: ENOENT: no such file or directory, mkdir '/var/task/data'
```

Las pocas idas al servidor que quedaban fallan en silencio y el hook hace *optimistic rollback* del cambio aplicado en la UI. Por eso el **sync por QR ya funciona** (todo client-side: sql.js/IndexedDB + relay sin estado `app/api/sync/claim/*`), pero el **setup falla**: depende de operaciones que aterrizan en el servidor muerto.

### Bug crítico: el autosave nunca corre en mutaciones regulares

`saveToIndexedDB` (`lib/db/persistence.ts`) se invoca **solo** en dos puntos:
1. Migración legacy (`lib/migrate-localstorage.ts:248`)
2. Import por QR (`lib/sync-client.ts:159`, en `applyQrImport`)

**Nunca** tras una mutación normal (setup, addTransaction, clearData, transfer). Consecuencia: tras mutar y recargar, se restaura el snapshot **viejo** (o la DB vacía) desde IndexedDB → los cambios se pierden. Ese es el mecanismo directo del bug reportado "setup track no arranca": tras `clearData` + reload, el snapshot viejo con `is_setup=1` **resucita** (la app cree que ya pasó el setup), o aparece una app en blanco.

## 2. Objetivo

UI **100% offline-first**: cero dependencia de la DB server en tiempo de ejecución. El único código server estable es el **relay de Blob sin estado** para el sync por QR (`app/api/sync/claim/*`). Eliminar todo el andamiaje server muerto y hacer que el snapshot sql.js **persista de verdad** tras cada mutación.

## 3. Alcance

### In Scope

| Ítem | Descripción |
|------|-------------|
| **Autosave persistence layer** | Wrapper debounced (300 ms) que persiste el snapshot sql.js a IndexedDB tras cada commit; flush en `pagehide`/`visibilitychange`; **inmediato** para `clearData` y day-change rollover (quitar la ventana de pérdida) |
| **Schema upgrade path** | `initDb(snapshot)` (`lib/db/client.ts`) hoy **no aplica upgrades de schema** → snapshots viejos (pre-`deleted_at`/`device_id`/`recurring_events`/`sync_meta`) crashean `loadState` en silencio → UI en blanco. Proponer `PRAGMA user_version` + camino de upgrade con `ALTER TABLE` guards |
| **Eliminación del stack server muerto** | `app/actions/*` (5 archivos), `lib/db/index.ts`, la mitad muerta de `hooks/use-budget-actions.ts`, `tests/unit/load-state.test.ts`, `tests/ui/e2e-db.ts`, helpers server en `tests/ui/test-utils.ts`, deps `better-sqlite3` + `@types/better-sqlite3`, `serverExternalPackages` en `next.config.mjs`, `SQLITE_DB_PATH` en `playwright.config.ts`, artefactos `data/saldo-cero.db*` |
| **Fix `restoreBackup`** | `components/sync/sync-settings.tsx` `restoreBackup` es no-op (descarga bytes, los descarta, muestra toast de éxito). Aplicar restore real vía `initDb → setDb → saveToIndexedDB`, o **quitar el botón** |
| **`PRAGMA foreign_keys = ON`** | En `initDb` (sql.js lo trae OFF por defecto) |
| Renombres cosméticos opcionales (`runServer`/`commit*` misnomers) | Solo si es barato; no bloquea nada |

### Out of Scope

| Ítem | Razón |
|------|-------|
| Mover el relay de sync fuera de Vercel Blob | El estado sin estado del relay ya funciona; no toca el bug |
| Auth de cuenta en la nube | Local-first de un solo dueño |
| Migrar a DB externa (Turso/Neon/etc.) | No resuelve el bug del autosave ni el stack muerto |
| Renombre cosmético del hook (`use-budget-actions` → `use-budget-commits` merge) | Deferred a un refactor futuro |
| Port de `computeProjection` al cliente | Deferred — la proyección renderiza vacía (servidor muerto), no bloquea el flujo diario |

## 4. Enfoque propuesto

1. **Autosave**: módulo `lib/db/autosave.ts` (o wrapper dentro de `use-budget-commits`) que, tras cada commit, agenda `saveToIndexedDB` con debounce de 300 ms y **flush inmediato** en `pagehide`/`visibilitychange`. `clearData` y day-rollover (cambio de `lastCheckedDay`) persisten **síncronos/immediatos** — son los escenarios que hoy resucitan el snapshot viejo. La persistencia local a IndexedDB aguanta snapshots mayores que el cap de 3 MiB del relay (no aplica el límite).
2. **Upgrade de schema en `initDb`**: `PRAGMA user_version = 2`; si el snapshot abierto reporta `user_version < 2`, aplicar chemin de `ALTER TABLE ... ADD COLUMN` con guards de existencia previa a cualquier lectura de `loadState`. Snapshots legacy sin `sync_meta`/`recurring_events` se actualizan en lugar de crashear.
3. **Eliminación explícita** (lista de §3): borrar `app/actions/*`, `lib/db/index.ts`, mitad muerta de `use-budget-actions.ts`, `load-state.test.ts`, `e2e-db.ts`, helpers server de `test-utils.ts`, deps de better-sqlite3, `serverExternalPackages`, `SQLITE_DB_PATH`, artefactos `data/`. Verificar con `pnpm tsc --noEmit` + `grep` que nada importa lo borrado.
4. **`restoreBackup`**: aplicar bytes vía `initDb → setDb → saveToIndexedDB` y refactorizar la UI del botón, o quitarlo (decisión en design).
5. `PRAGMA foreign_keys = ON` en `initDb`.

## 5. Riesgos y mitigaciones

| Riesgo | Probab. | Impacto | Mitigación |
|--------|---------|---------|------------|
| Snapshot viejo resucita (is_setup=1) | Alta (hoy) | Crítico | Autosave debounced en cada commit + persist inmediato en clearData/day-rollover; test dedicaado de "mutar → reload → estado intacto" |
| Snapshot antiguo sin aplicar upgrades crashea `loadState` | Media | Alto | `PRAGMA user_version` + upgrade path con guards en `initDb`; test con snapshot de shape viejo |
| Drift entre `schema.sql`/`schema.ts` y el upgrade path | Media | Medio | El migration file descriptivo documenta ambos; test de schema-sync cubre paridad |
| IndexedDB falla en modo privado | Baja | Medio | Catch y fallback best-effort (persistir solo en memoria); log; no bloquear la UI |
| Carga WASM de sql.js | Baja | Medio | Sin cambio — el flujo de carga ya maneja el fallback; fuera de alcance |
| Ventana de 300 ms de debounce = pérdida de datos en crash | Baja | Bajo | Flush en `pagehide`/`visibilitychange` cubre cierre/tab; el riesgo residual (kill del proceso sin evento) es aceptable |
| Perf del autosave con snapshot grande | Baja | Bajo | IndexedDB local no aplica el cap de 3 MiB del relay; debounce agrupa mutaciones en ráfaga |

## 6. Criterios de aceptación

- [ ] `pnpm tsc --noEmit` limpio; **cero imports** residuales de `app/actions/*`, `lib/db/index.ts` (verificado por grep), dep `better-sqlite3` y `serverExternalPackages` removidos
- [ ] **Unit — autosave**: mutación regular (addTransaction, setup, transfer) → `saveToIndexedDB` llamado (debounced); `clearData` y day-rollover persisten inmediato; flush en `pagehide`
- [ ] **Unit — upgrade**: snapshot de shape viejo (pre-`recurring_events`/`sync_meta`/`deleted_at`/`device_id`) abre con `initDb` aplicando upgrade → `loadState` no crashea
- [ ] **Unit — restoreBackup**: aplicar bytes vía `initDb→setDb→saveToIndexedDB` persiste; o el botón fue eliminado
- [ ] **Playwright** `pnpm test:ui` 12/12 en verde (sin regresiones)
- [ ] `pnpm test` (Vitest) en verde, incluyendo los tests nuevos de autosave/upgrade
- [ ] **Manual probado en producción** (o evidencia documentada de causa raíz): tras `clearData` → reload, la app arranca en setup limpio y el **track** funciona; tras setup → reload, los datos persisten
- [ ] Migración descriptiva `docs/migrations/2026-09-12-offline-first-ui.md` creada en la fase design (cambio de modelo de datos: política de persistencia + `user_version` + eliminación del modelo `server.db`)

---

## Decisiones Abiertas (resolver en design)

| # | Decisión | Recomendación |
|---|----------|---------------|
| 1 | `restoreBackup`: arreglar (initDb→setDb→save) o quitar botón | Arreglar — el botón existe y los backups `pre-claim-*` ya se generan |
| 2 | Ubicación del autosave: módulo propio `lib/db/autosave.ts` vs wrapper en `use-budget-commits` | Módulo propio, testeable en aislamiento |
| 3 | Renombres cosméticos `runServer`/`commit*` | Solo si impacta <30 min de trabajo; si no, se dejan |

---

*Documento generado como parte del flujo SDD para el change `offline-first-ui`. Bug crítico: persistencia de snapshot tras mutaciones + stack server muerto en Vercel.*