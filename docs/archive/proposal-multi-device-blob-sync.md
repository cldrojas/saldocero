# Proposal: multi-device-blob-sync

## Intent

Convert Saldo Cero from a server-side SQLite app (Server Actions + better-sqlite3 on Vercel ephemeral filesystem) to a **local-first multi-device** app where the SQLite `.db` lives on each device (browser/phone via sql.js WASM) and syncs on demand via **Vercel Blob as a relay** (not source of truth). This activates the deferred sync path from `sqlite-local` (D7) and replaces the archived Supabase-centralized attempt.

## Scope

### In Scope
- Client-side SQLite engine: `sql.js` (WASM) with lazy load; persistence in IndexedDB + OPFS fallback
- Data layer pivot: `lib/db/repository.ts` (client) replacing Server Actions as primary read/write path; same API surface
- Sync relay: API Routes `GET/POST /api/sync`, `GET /api/sync/meta` backed by Vercel Blob (`@vercel/blob`)
- Merge algorithm: `lib/db/merge.ts` — last-write-wins per row using `updated_at` + tombstones (`deleted_at`) + deterministic tie-break (`created_at` → `device_id`)
- Schema migration: add `deleted_at`, `device_id` to `accounts`, `transactions`, `recurring_events`; new `sync_meta` singleton table
- Auth: sync code + static token per user namespace (`saldo-cero-<code>.db`); 401 without credentials; blob not listable
- UI: "Sincronizar" button with status (synced/pending/last sync); settings for code/token; guided first push of existing `data/saldo-cero.db`
- Backup: local pre-merge snapshot in IndexedDB, restorable from UI
- Tests: unit (merge, persistence, repository), integration (API routes, migration), E2E (dual-device convergence)
- Descriptive migration: `docs/migrations/2026-09-09-multi-device-blob-sync.md` (already created)

### Out of Scope
- CRDT/OT/semantic merges (overkill for 1 user, low volume)
- Automatic/realtime sync (user requested manual click; 3 sessions/day)
- Encryption at rest (OS protects device; HTTPS covers transit)
- Multi-user / multi-tenant (personal app by philosophy)
- Central backend (Supabase/Turso/VPS) — contradicts local-first

## Approach

1. **Client SQLite layer** (`lib/db/client.ts`, `persistence.ts`): load sql.js WASM lazily, open/create DB in IndexedDB/OPFS, apply `schema.sql` (with FR-5 columns).
2. **Repository client** (`lib/db/repository.ts`): replicate Server Actions API (`loadState`, `addTransaction`, `removeTransaction`, `updateTransaction`, `addAccount`, `updateAccount`, `deleteAccount`, `transferFunds`, `updateConfig`, `toggleAutoSave`, `clearData`, `setupBudget`, recurring CRUD, `computeProjection`). Hooks consume this; UI unchanged.
3. **Merge engine** (`lib/db/merge.ts`): pure function `mergeDatabases(local, remote, deviceId)` returning `MergeResult`; rules per PRD §4.4/FR-4; backup before mutate.
4. **Sync API + Relay** (`app/api/sync/`): GET/POST blob with `x-sync-code` + `x-sync-token`; meta endpoint for concurrency check (re-read meta → re-merge if changed).
5. **Schema migration** (FR-5): `ALTER TABLE` + new `sync_meta`; existing rows get `deleted_at=NULL`, `device_id=NULL`; backfill `sync_meta` singleton.
6. **UI + Settings**: sync button, status indicator, code/token generation, guided first push.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `lib/db/client.ts` | New | sql.js factory: init WASM, open/create DB, apply schema, export/import |
| `lib/db/persistence.ts` | New | IndexedDB + OPFS wrapper for `.db` blob persistence |
| `lib/db/repository.ts` | New | Client-side data API (replaces Server Actions as primary path) |
| `lib/db/merge.ts` | New | Pure merge function + `MergeResult`; tombstone-aware LWW |
| `lib/db/meta.ts` | New | `sync_meta` read/write helpers |
| `lib/db/schema.sql` | Modified | Add `deleted_at`, `device_id` columns + `sync_meta` table |
| `app/api/sync/route.ts` | New | GET/POST sync endpoint with auth; `@vercel/blob` |
| `app/api/sync/meta/route.ts` | New | GET snapshot metadata (hash, updated_at, size) |
| `components/sync/sync-button.tsx` | New | "Sincronizar" button + status indicator |
| `components/sync/sync-settings.tsx` | New | Generate/save sync code + token; guided first push |
| `hooks/use-budget.tsx` | Modified | Switch from Server Actions to `lib/db/repository.ts` |
| `lib/migrate-localstorage.ts` | Kept | First-load migration utility (legacy localStorage → client DB) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Data loss in merge | Medium | Pre-merge local backup (restorable UI); deterministic LWW tested; never delete without tombstone |
| Concurrent snapshot overwrite | Medium | Re-check `meta` before POST; re-merge if remote changed; snapshot hash in `sync_meta` |
| Blob exposed (privacy) | Low | Authenticated endpoints (401 w/o creds); blob not listable; token never in public bundle |
| sql.js slow on mobile | Medium | Lazy WASM load; tiny data volume (10s of rows); E2E perf measurement |
| OPFS unavailable (Safari/Firefox) | Medium | Universal IndexedDB fallback |
| Existing `.db` migration duplicates | Medium | Guided first push with confirmation; idempotency via hash/`sync_meta`; migration test |
| Regression from layer pivot | High | Repository mirrors Server Actions API; existing test suite; dedicated verification phase |

## Rollback Plan

1. Revert `hooks/use-budget.tsx` and related hooks to Server Actions consumption
2. Delete `lib/db/client.ts`, `repository.ts`, `merge.ts`, `persistence.ts`, `meta.ts`
3. Delete `app/api/sync/` and `components/sync/`
4. Revert `lib/db/schema.sql` to `sqlite-local` schema (drop new columns + `sync_meta`)
5. Uninstall `sql.js`, `@vercel/blob`; restore `better-sqlite3` as sole data layer
6. Remove any Vercel Blob namespaces created
7. Run full suite — app returns to `sqlite-local` behavior (Server Actions + `data/saldo-cero.db`)

## Dependencies

- `sql.js` (npm) — SQLite WASM for client
- `@vercel/blob` (npm) — Relay storage
- Existing: `lib/db/schema.sql`, `lib/db/index.ts` (base for migration), `app/actions/*` (API to replicate), `lib/cashflow.ts` (unchanged derived calc), `types/index.ts`, `hooks/use-budget.tsx`
- Vercel Blob enabled on project (Hobby tier sufficient)
- Descriptive migration `docs/migrations/2026-09-09-multi-device-blob-sync.md` (exists)

## Success Criteria

- [ ] SQLite runs in client (sql.js): `.db` persists in IndexedDB/OPFS; daily flow works offline
- [ ] Sync API routes functional with auth (401 without credentials)
- [ ] "Sincronizar" button: pull → merge → push; visible status (synced/pending/last sync)
- [ ] Merge LWW per row with tombstones; pre-merge backup; `MergeResult` reported
- [ ] Schema migration applied (`deleted_at`/`device_id` + `sync_meta`)
- [ ] Existing `data/saldo-cero.db` importable as first relay snapshot
- [ ] `docs/migrations/2026-09-09-multi-device-blob-sync.md` complete
- [ ] `pnpm test` + `pnpm tsc --noEmit` pass (no regression)
- [ ] E2E: operate on device A → sync → device B converges