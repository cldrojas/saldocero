# Tasks: Multi-Device Blob Sync

Change: `multi-device-blob-sync`
PRD: `docs/requirements/multi-device-blob-sync.md`
Spec: `docs/requirements/spec-multi-device-blob-sync.md`
Design: `docs/design/multi-device-blob-sync-design.md`
Migración: `docs/migrations/2026-09-09-multi-device-blob-sync.md`
Fecha: 2026-09-09

---

## Convenciones para aplicar

- **Strict TDD activo** (Vitest unit + Playwright e2e). Escribir el test ANTES de la implementación de cada artefacto nuevo (merge, persistence, repository, meta).
- API del repository **espejo exacto** de las Server Actions (`lib/db/index.ts`, `app/actions/*`). Los componentes no cambian de contrato.
- `updated_at`/`created_at` en UTC (ISO, `datetime('now')`). `device_id` se setea en **cada escritura**.
- Soft delete (`deleted_at`) en `accounts`, `transactions`, `recurring_events`; lecturas filtran `deleted_at IS NULL`.
- `sync_meta` lee/escribe solo via `lib/db/meta.ts`.
- El token del relay NUNCA `NEXT_PUBLIC_*`.
- Commit inicial de rama = `docs(plan):` (fase de plan, no tocar código en ese commit).
- Criterio de aceptación del change: `pnpm test` + `pnpm tsc --noEmit` verdes.

---

## Batch 0 — Fundaciones (dependencias y scaffolding)

- [x] 0.1 Instalar dependencias: `pnpm add sql.js @vercel/blob` y `pnpm add -D @types/sql.js`
- [x] 0.2 Verificar que `sql.js` no rompe `next.config.mjs` (no debe ir a `serverExternalPackages`; es client-side)
- [x] 0.3 Crear `lib/db/client.ts` con `initDb()`, `openDb(bytes)`, `applySchema()`, `exportDb()` (lazy WASM, ver design D11)
- [x] 0.4 Crear `lib/db/persistence.ts` con IndexedDB primario + OPFS fallback + `saveBackup`/`listBackups`/`restoreBackup` (design D2/D12)
- [x] 0.5 Crear `lib/db/meta.ts` con `getSyncMeta`/`updateSyncMeta`/`getActiveDeviceId` (localStorage uuid v4 estable)

## Batch 1 — Schema y Merge (corazón, strict TDD)

- [x] 1.1 Actualizar `lib/db/schema.sql`: `CREATE TABLE IF NOT EXISTS` con columnas `deleted_at`/`device_id` + tabla `sync_meta` (ver migración)
- [x] 1.2 En `applySchema`: detección por `PRAGMA table_info` → migración de bases legacy (idempotente)
- [x] 1.3 **[TEST primero]** Unit tests de `merge.ts`: LWW por `updated_at`, empates `created_at` → `device_id` lexicográfico, tombstones (borrado vs vivo, revival), budgets singleton, MergeResult counts, determinismo/idempotencia — con dos `Database` sql.js en memoria
- [x] 1.4 Implementar `lib/db/merge.ts` con `mergeDatabases(local, remote, deviceId): MergeResult` (puro, in-place sobre local)

## Batch 2 — Repository cliente

- [x] 2.1 **[TEST primero]** Unit tests de repository: soft delete + `device_id` en cada write + filtro `deleted_at IS NULL` (sql.js en memoria)
- [x] 2.2 Implementar `lib/db/repository.ts`: replicate las 16+ funciones de Server Actions (`loadState`, `setupBudget`, `addTransaction`, `removeTransaction`, `updateTransaction`, `addAccount`, `updateAccount`, `deleteAccount`, `transferFunds`, `updateConfig`, `toggleAutoSave`, `clearData`, recurring CRUD, `computeProjection`)
- [x] 2.3 Migrar `hooks/use-budget.tsx`: de Server Actions a `lib/db/repository.ts` (mismo contrato, optimistic updates intactos)
- [x] 2.4 Regresión: `pnpm test` + `pnpm tsc --noEmit` verdes (la UI debe seguir idéntica)

## Batch 3 — Protocolo de Sync (server)

- [x] 3.1 **[TEST primero]** Integration tests del protocolo: 401 sin credenciales, GET/POST round-trip, meta hash, 409 concurrency re-check (blob mock en memoria)
- [x] 3.2 Crear `lib/blob-relay.ts`: wrapper `@vercel/blob` con namespace `saldo-cero-<syncCode>.db`
- [x] 3.3 Crear `app/api/sync/meta/route.ts` (GET metadata) + `app/api/sync/route.ts` (GET snapshot, POST upload con re-check meta → 409)
- [x] 3.4 Crear `app/api/sync/import/route.ts` (primer push guiado del `.db` legacy vía better-sqlite3, hash idempotente) — **[TEST primero]** con `.db` legacy sintético
- [x] 3.5 Documentar/crear env vars: `SYNC_TOKEN` (server), y `BLOB_READ_WRITE_TOKEN` en dev (dashboard Vercel para prod)

## Batch 4 — UI de Sync

- [x] 4.1 Crear `components/sync/sync-button.tsx`: botón "Sincronizar" con estados (synced / pending / last sync / error)
- [x] 4.2 Crear `components/sync/sync-settings.tsx`: configuración code + token + primer push guiado + lista de backups/restore
- [x] 4.3 Integrar en la página correspondiente (invitación al primer push si no hay snapshot, design US-5)

## Batch 5 — E2E y Convergencia

- [x] 5.1 **[TEST primero]** Playwright e2e dual-device: operar en A → sync → B converge (merge correcto; relay stub en memoria, dev server :3100 con E2E DB aislada)
- [x] 5.2 E2E: primer push guiado en fresh device (import legacy → snapshot → hash idempotente)
- [x] 5.3 E2E regresión del flujo diario completo (login opcional no existe; recorrido budget completo via UI)

## Batch 6 — Verificación y Cierre

- [x] 6.1 `pnpm test` completo (unit + integration + e2e) verde
- [x] 6.2 `pnpm tsc --noEmit` sin errores
- [x] 6.3 Revisar cobertura del spec: FR-1..FR-6 + FR-DB + FR-UI-HOOK + NFR-1..4 marcados en `spec-multi-device-blob-sync.md` (ejecutado por `sdd-verify`: checklist + verdicto en la spec; W1-W4 corregidos en follow-up)
- [x] 6.4 Commit fase de implementación (primer commit separado `docs(plan):` ya hecho al inicio de rama) — `71c6442`

---

## Orden de dependencia (grafo)

```
Batch 0 → Batch 1 → Batch 2 → Batch 3 → Batch 4 → Batch 5 → Batch 6
    │         │          │          │
    └─────────┴──────────┴──────────┘ (B3 depende de 0.4/0.5 y de 1.4 para 409 re-merge;
                                       B2 depende de 1.4 para merge-then-persist)
```

Cada batch se implementa de corrida (auto) y se verifica con su suite antes de pasar al siguiente. Si un batch rompe regresión, se detiene y se reporta antes de continuar.

---

*Documento generado como parte del flujo SDD para el change `multi-device-blob-sync`.*