# Tasks: offline-first-ui (UI 100% local-first — "sin servidor de estado")

**Change ID**: `offline-first-ui`
**Fuente**: PRD `docs/requirements/offline-first-ui.md` · Design `docs/design/offline-first-ui-design.md` · Migración `docs/migrations/2026-09-12-offline-first-ui.md`
**Rama**: `feat/sqlite-local` (basado en `f18ee3c` QR claim)
**Gate de aceptación**: `pnpm tsc --noEmit` limpio + `pnpm test` (Vitest) en verde + `pnpm test:ui` 12/12 en verde + **cero imports residuales** de `app/actions/*` y `lib/db/index.ts` (verificado por `grep`) + dep `better-sqlite3` y `@types/better-sqlite3` fuera de `package.json` + `serverExternalPackages` fuera de `next.config.mjs`
**TDD (strict_tdd)**: Phase 2 (RED) escribe y corre los tests ANTES de Phase 3 (GREEN) — cada test debe fallar con la implementación ausente.

Leyenda: `[ ]` pendiente — planificación inicial (nada implementado aún).

---

## Fase 1: docs(plan) — commit de planificación

- [ ] 1.1 Verificar que los 3 archivos de planificación existen y están completos:
      `docs/requirements/offline-first-ui.md`, `docs/design/offline-first-ui-design.md`, `docs/migrations/2026-09-12-offline-first-ui.md`
- [ ] 1.2 Este archivo (`docs/tasks/offline-first-ui-tasks.md`) se incorpora al mismo commit de planificación
- [ ] 1.3 Commit del primer cambio en la rama, tipo `docs(plan):`, contenido explícito:
      `docs(plan): offline-first-ui — autosave snapshot sql.js + upgrade path user_version=2 + eliminación stack server (proposal+design+migration+tasks)`
      (convención: mismo estilo que `e89b79e` para `qr-sync-simplify`)

## Fase 2: TDD RED — tests primero (escribir → correr → fallan)

- [ ] 2.1 `tests/unit/autosave.test.ts` (NUEVO): fake timers + mock de `saveToIndexedDB`/`indexedDB`
      — `schedule()` persiste tras mutación: a `now+300ms` `saveToIndexedDB` es llamado con `exportDb(getDb())`;
      ráfaga de `schedule()` (2+ mutaciones) → **1 solo** persist (debounce agrupa);
      `flushNow()` persiste inmediato (sin esperar 300 ms);
      flush en `pagehide` y en `visibilitychange→hidden` (x2, sin duplicar flush si ambos disparan);
      `persist()` **no tira** si `saveToIndexedDB` rechaza (best-effort, catch) — red antes de `lib/db/autosave.ts`
- [ ] 2.2 `tests/unit/schema-upgrade.test.ts` (NUEVO): construir bytes con **DDL de shape viejo**
      (sin `recurring_events`/`sync_meta`, sin `deleted_at`/`device_id`) → `initDb(bytes)`:
      columnas nuevas presentes con `NULL` (`PRAGMA table_info`), tablas nuevas creadas, `user_version = 2`,
      `loadState` no crashea, `setMeta` funciona;
      **idempotencia**: upgrade 2× sobre el mismo snapshot → sin errores, `user_version = 2`, misma shape;
      **`foreign_keys = ON`**: INSERT con `account_id` huérfano falla, INSERT válido pasa ver `client.ts:initDb`
- [ ] 2.3 Rework `tests/unit/sync-settings.test.tsx`: reemplazar el test de restore no-op por —
      restore aplica bytes vía `initDb → setDb → saveToIndexedDB` (assert sobre el snapshot persistido,
      patrón `saldo-cero-db/snapshots`); bytes corruptos → error visible y **DB activa intacta**
      (no se llama `setDb` con un db roto) — red antes del fix de `handleRestore`
- [ ] 2.4 Extender `tests/unit/use-budget.test.tsx` (opcional si es barato): mutación regular del hook
      (`setup`, `addTransaction`) dispara `schedule()`; `clearData` dispara `flushNow()` (mockear `lib/db/autosave`)
- [ ] 2.5 Gate de la fase: `pnpm test` sobre los tests nuevos **en rojo** (verificar que fallan por la
      implementación ausente, no por infraestructura de test) + `pnpm tsc --noEmit`

## Fase 3: TDD GREEN — implementación (hace pasar 2.1–2.4)

- [ ] 3.1 `lib/db/autosave.ts` (NUEVO): persistencia pura, **sin React** —
      `schedule()` (debounce 300 ms → `persist(getDb())`), `flushNow()` (inmediato),
      `subscribeToVisibility()` (registra `pagehide` + `visibilitychange→hidden` → `flushNow()`),
      `persist(db)` (`exportDb` → `saveToIndexedDB`, best-effort con catch + log, no bloquea la UI)
- [ ] 3.2 `lib/db/client.ts`: `initDb(data?)` aplica `applySchemaUpgrade` —
      `PRAGMA user_version` leído; `< 2` o snapshot → `upgradeFromLegacyShape`:
      `CREATE TABLE IF NOT EXISTS recurring_events/sync_meta` (DDL canónico) +
      `ALTER TABLE ADD COLUMN deleted_at/device_id` **con guard** vía `PRAGMA table_info` en
      accounts/transactions/budgets/recurring_events; luego `PRAGMA foreign_keys = ON` (sql.js lo trae OFF);
      sellar `user_version = 2`. **Idempotente** (2× seguro); DB nueva vía `SCHEMA` ya es v2 (sellado de paridad)
- [ ] 3.3 `hooks/use-budget-commits.ts`: tras cada commit regular (`commitAddTransaction`,
      `commitUpdateTransaction`, `commitRemoveTransaction`, `commitTransferFunds`, `commitAddAccount`,
      `commitUpdateAccount`, `commitDeleteAccount`, `commitSetupBudget`, `commitUpdateConfig`,
      `commitToggleAutoSave`) → `autosave.schedule()`; tras `commitClearData` → `autosave.flushNow()`
      (inmediato — el escenario que hoy resucita `is_setup=1`)
- [ ] 3.4 `hooks/use-budget.tsx`: en el efecto de **boot** (~L148-176) montar el singleton
      `autosave.subscribeToVisibility()` una sola vez (cleanup al desmontar); en el efecto de **day-rollover**
      (efecto que muta `stateRef` cuando `!isSameDay(today, lastCheckedDay)`, ~L179-219) → `autosave.flushNow()`
      inmediato al final (tras `setLastCheckedDay(today)`, cubre el reset del allowance; si hubo `leftover>
      0` el `transferFunds` ya agenda debounced, el flush cubre el resto)
- [ ] 3.5 `components/sync/sync-settings.tsx` fix D1 `handleRestore(label)`:
      `bytes = restoreBackup(label)` → `initDb(bytes)` → `setDb(db)` → `saveToIndexedDB(db)` →
      `window.location.reload()`; **al fallar** la apertura del snapshot (bytes corruptos/schema incompatibles)
      → mostrar error y **NO tocar** la DB activa (sin `setDb`/reload)
- [ ] 3.6 Gate de la fase: `pnpm test` verde (autosave + schema-upgrade + sync-settings nuevos) + `pnpm tsc --noEmit`

## Fase 4: Eliminar stack server muerto + limpieza de deps (verificación por grep/tsc)

- [ ] 4.1 Borrar `app/actions/budget.ts`, `app/actions/transactions.ts`, `app/actions/accounts.ts`,
      `app/actions/recurring.ts`, `app/actions/projection.ts` (5 archivos)
- [ ] 4.2 Borrar `lib/db/index.ts` (conexión singleton `better-sqlite3`) — **conservar** `lib/db/schema.ts`
      (shape canónico v2) y `lib/db/schema.sql` solo si algo externo lo usa (auditar; el upgrade usa schema.ts)
- [ ] 4.3 `hooks/use-budget-actions.ts`: eliminar la **mitad muerta** "commit half" (L344-453: interfaces
      `TransactionInput` + `commit*Server`) y los imports huérfanos de `@/app/actions/*` (L5-21); **conservar**
      las funciones `optimistic*` puras + `clearData` (L330-342) + `BudgetState`. Verificar que
      `use-budget-commits.ts` sigue siendo el único llamador real
- [ ] 4.4 Borrar `tests/unit/load-state.test.ts` (depende de `app/actions/budget`)
- [ ] 4.5 Borrar `tests/ui/e2e-db.ts` (arranca `better-sqlite3` para seed server)
- [ ] 4.6 Rework `tests/ui/test-utils.ts`: eliminar helpers server seed (imports de `./e2e-db`,
      `clearAppData`/`setupTestAppState`/`ensureSetupState`/`ensureConfiguredState`/
      `getCurrentAppState`/`createFreshAppState`); **conservar** helpers UI puros
      (`waitForAppReady`, `waitForToast`, `dismissToast`, `isInSetupMode`, `isInConfiguredMode`,
      `fillSetupForm` si algún spec activo lo usa). Fixtures/estado E2E solo vía UI real
      (specs activos ya usan `setupViaUI`)
- [ ] 4.7 Borrar `tests/ui/tmp-track-setup.spec.ts` (spec diagnóstico temporal)
- [ ] 4.8 Deps: `pnpm remove better-sqlite3 @types/better-sqlite3` (desde `package.json`)
- [ ] 4.9 `next.config.mjs`: quitar `serverExternalPackages: ['better-sqlite3']` (conservar `distDir` + allowedDevOrigins)
- [ ] 4.10 `playwright.config.ts`: quitar env `SQLITE_DB_PATH` del `webServer` (+ el import de `./e2e-db`);
      **conservar** `NEXT_DIST_DIR: '.next-e2e'`
- [ ] 4.11 `data/saldo-cero.db*` — **NO borrar en el commit de código** (recomendación de rollback,
      migración §Ejecución item 6): documentar en el PR/commit; limpieza separada si se decide
- [ ] 4.12 Verificación de residuos: `grep -rn "app/actions\|lib/db/index\|better-sqlite3\|SQLITE_DB_PATH" lib/ app/ hooks/ contexts/ components/ tests/ next.config.mjs playwright.config.ts`
      → 0 resultados (ajustar scope a lo que quede); `pnpm tsc --noEmit` limpio
- [ ] 4.13 Commit de Phase 4 (convención chore):
      `chore(db): remove dead server stack (app/actions/*, lib/db/index.ts, better-sqlite3) (test suite, 12 e2e, tsc clean)`
      — puede ir junto a Phase 3 en el primer commit `feat` si el diff lo permite (ver Fase 6)

## Fase 5: E2E + verificación manual

- [ ] 5.1 `pnpm test:ui` — las **12/12** specs activas en verde **sin** el andamiaje server
      (seeds eliminados; estado vía `setupViaUI` real → sql.js/IndexedDB). Confirmar que `webServer`
      arranca sin `SQLITE_DB_PATH`
- [ ] 5.2 Manual (o evidencia documentada de causa raíz): **clearData → reload** → la app arranca en setup
      limpio (no resucita `is_setup=1`) y el **track** funciona
- [ ] 5.3 Manual: **setup → reload** → los datos persisten (mutación regular → debounce 300 ms → snapshot nuevo)
- [ ] 5.4 Manual: **day-rollover** (si es feasible) persiste inmediato; **sync por QR** intacto
      (export/import `applyQrImport` directo, sin pasar por el debounce)

## Fase 6: Gate final + commits de implementación

- [ ] 6.1 Gate full: `pnpm tsc --noEmit` + `pnpm test` (suite completa en verde, ~188+ unit con los nuevos)
      + `pnpm test:ui` 12/12; confirmar counts en el mensaje de commit
- [ ] 6.2 Commit de implementación (convención feat/fix, estilo `(count unit, 12 e2e, tsc clean)`):
      `feat(db): offline-first autosave + initDb upgrade path (user_version=2, foreign_keys) + restoreBackup fix (~190 unit, 12 e2e, tsc clean)`
      — agrupa Fase 2+3 (+4 si el diff lo permite)
- [ ] 6.3 Verificar que el git log de la rama queda: `docs(plan): offline-first-ui…` (primer commit)
      seguido del/los commit(s) de implementación; sin `data/saldo-cero.db*` en el diff

---

*Checklist SDD para `offline-first-ui`. Orden: F1 (docs plan) → F2 (tests RED: autosave, schema-upgrade, sync-settings) → F3 (GREEN: autosave.ts, initDb upgrade, commits schedule/flushNow, boot+rollover, restore fix) → F4 (borrado stack server + deps) → F5 (E2E 12/12 + manual) → F6 (gate + commits). Requisito transversal: `data/saldo-cero.db*` se documenta pero NO se borra en el commit de código (rollback).*