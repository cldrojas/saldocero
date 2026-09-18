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
- [~] T4 — `pnpm install` + gates: vitest 88/88 ✓, tsc ✓; `next build` BLOQUEADO por /login (era Supabase #40) sin env vars — decisión con usuario
- [ ] T5+ — Re-add progresivo de features (a definir con el usuario)

## Criterios de aceptación
- `main` y la rama de trabajo quedan en `b8760e6`: la app usa `localStorage['daily-budget-data']`.
- `backup/offline-first` preserva íntegro el HEAD anterior.
- Gates verdes en la rama de trabajo.

## Features candidatas para re-agregar (progresivo)
- Import/export de datos legacy (rescue de datos).
- Persistencia/autosave robusto (sin sql.js).
- Sync entre dispositivos (QR claim) — evaluación posterior.
- Base ya incluye: modos daily/track, ingresos, ajustes, export, selector de balance, historial ordenado, menú responsive.

## Progreso
- 2026-09-17: T1–T3 ejecutados. `main` y `feat/regreso-localstorage` en `b8760e6`; `backup/offline-first` en `e3e1c51`. `pnpm install` ok. Gates vitest 88/88 + tsc verdes. Build falla solo en /login (era Supabase #40) por falta de env vars — en la era original el build requería credenciales Supabase; decisión pendiente: quitar auth Supabase del base (build verde, app 100% local sin login) o dejarlo tal cual la era.
- Commits de tracking: `docs(odd): plan de regreso a localStorage (b8760e6)`