# ODD — Regreso a localStorage (rewind a b8760e6)

## Objetivo
Volver al punto de la historia en que la app funcionaba con `localStorage` como
store (commit `b8760e6`, anterior al pivot offline-first `e215390`) y re-agregar
features de forma progresiva, con el trabajo actual (sql.js + IndexedDB + sync QR)
preservado como referencia en una rama de respaldo.

## Problema / Por qué
El usuario quiere el estado histórico en que la app leía y escribía en
`localStorage['daily-budget-data']`. La era offline-first (sql.js + IndexedDB) queda
descartada como store, pero su código se conserva íntegro para re-agregar features
progresivamente.

## Alcance autorizado
- Rewind de `main` a `b8760e6`.
- Rama `backup/offline-first` en el HEAD anterior (`e3e1c51`) como respaldo.
- Rama `feat/regreso-localstorage` para el trabajo progresivo.
- Re-agregado progresivo de features: cada feature se propone y acuerda antes de implementar.
- No se tocan datos del navegador: la app revertida lee `localStorage['daily-budget-data']` directo.

## Restricciones / Notas
- La migración (`lib/migrate-localstorage.ts`) NO borró `localStorage['daily-budget-data']` — queda como backup histórico.
- El snapshot de localStorage quedó congelado al momento de la migración; transacciones posteriores viven en IndexedDB (contingencia: exportar desde `backup/offline-first` e inyectar en localStorage).
- Gates del repo: `pnpm exec vitest run` + `pnpm tsc --noEmit` (+ `next build` como smoke).

## Tareas
- [x] T1 — Crear rama de respaldo `backup/offline-first` en HEAD actual (`e3e1c51`)
- [x] T2 — Reset `main` a `b8760e6` (preservando cambios tooling `.atl/` vía stash)
- [x] T3 — Crear rama de trabajo `feat/regreso-localstorage`
- [x] T4 — `pnpm install` + gates: vitest 88/88 ✓, tsc ✓ (build pendía de decisión auth — resuelta en T5)
- [x] T5 — Quitar auth Supabase del base (login, auth-context, lib/supabase, proxy.ts, tests, deps) → build verde ✓ (commit `2f20cbe`)
- [x] T6 — Fix de hydration mismatches del base (patrón effect-hydration + mounted; refs `b759898`, `1662616`) → commit `8482ab0`
- [x] T7 — Re-agregar import de datos JSON (port de `e6f944a`/`feat/import-data-json` al base localStorage) → commit `9986422` (en la rama reescrito como `2245abc`)
- [x] T8 — Chips de selección rápida en modal de transacciones (port de `9bb1316`: 1000/2000/5000/10000, chip activo resaltado) → commit `a1877aa` (PR #68 → main `d23ce2d`)
- [x] T9 — Limpiar restos de la era SQLite de main: borrar `supabase/` (migraciones SQL del CLI, sin referencias en el build) y los `.db` locales en `data/` (ya ignorados) → commit (rama `chore/remove-supabase-data`)

## Criterios de aceptación
- `main` y la rama de trabajo quedan en `b8760e6`: la app usa `localStorage['daily-budget-data']`.
- `backup/offline-first` preserva íntegro el HEAD anterior.
- Gates verdes en la rama de trabajo.

## Features candidatas para re-agregar (progresivo)
- Import/export de datos legacy (rescue de datos). → DONE (T7 import; export ya en base)
- Persistencia/autosave robusto (sin sql.js). → toggle `autoSave` ya en base; manejo de conflictos/backup NO
- Sync entre dispositivos (QR claim) — evaluación posterior. → PENDIENTE
- Base ya incluye: modos daily/track, ingresos, ajustes, export, selector de balance, historial ordenado, menú responsive, ocultar cuentas, saldo en dropdown de cuenta.

## Progreso
- 2026-09-17: T1–T6 ejecutados. `main` y `feat/regreso-localstorage` en `b8760e6`+3; `backup/offline-first` en `e3e1c51`. Gates verdes: vitest 68/68, tsc, eslint 0 errores, `next build` OK.
- 2026-09-17: T7 import JSON portado de `e6f944a` (sin sql.js): `lib/import-json.ts` + `components/modals/import-json-modal.tsx` + `use-budget.replaceAll` (aditivo) + 19 tests unit + 2 E2E. Gates verdes: vitest 87/87, tsc, eslint 0 errores, build OK. En la rama de trabajo el import quedó reescrito como `2245abc` y `33eab4c` integró origin/main manteniendo el rewind (.gitignore ahora cubre `.atl/` y `data/`).
- 2026-09-17/18: T8 chips commiteado → `a1877aa` (hook pre-commit: vitest 89/89 ✓). Delivery: PR #68 → main `d23ce2d`.
- 2026-09-18: Merge de origin/main sobre main local resuelto con prioridad a lo más reciente (`07c1f58`), 2 conflictos (`.gitignore`, `lib/db/repository.ts` eliminado). Vitest/tsc verdes.
- 2026-09-18: T9 limpieza `supabase/` + `data/`: sin referencias en build (grep app/components/hooks/lib/contexts/middleware), `data/` ya ignorado, commit en `chore/remove-supabase-data`.
- Nota E2E conocida: `tests/ui/config-form.spec.ts` falla 9/9 pre-existente (busca el botón de configuración visible en desktop; en esta era el ConfigForm vive en el Sheet mobile). Fuera de CI (tests.yml corre tsc + vitest).