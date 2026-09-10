# Design: Multi-Device Blob Sync

Change: `multi-device-blob-sync`
PRD: `docs/requirements/multi-device-blob-sync.md`
Spec: `docs/requirements/spec-multi-device-blob-sync.md`
Migración: `docs/migrations/2026-09-09-multi-device-blob-sync.md`
Fecha: 2026-09-09

---

## Propósito / Balance

Pivote local-first: la capa de datos migra de Server Actions + better-sqlite3 (server-side sobre el filesystem efímero de Vercel) a **sql.js (SQLite WASM en el browser)** con persistencia IndexedDB/OPFS, y se agrega **sync manual multi-dispositivo** vía **Vercel Blob como relay** (no fuente de verdad). El merge es **last-write-wins por registro con tombstones**. Este change activa el sync diferido D7 de `sqlite-local` y reemplaza la dirección Supabase archivada.

**Balance de esta decisión**: alta complejidad — invierte la capa de persistencia completa (server → client), sustituye la ruta primaria de datos (Server Actions → repository cliente), agrega un protocolo de sync con auth, y cambia el modelo (tombstones). El riesgo principal es regresión del flujo diario y pérdida de datos en concurrencia. Se mitiga: API del repository espeja la de Server Actions, el merge es puro/determinista/idempotente con backup pre-merge, y la suite de tests existente queda intacta. Single-user (~3 sesiones/día, volumen de decenas de filas) → se rechaza todo over-engineering (CRDT, realtime, multi-tenant).

---

## Contexto

### Estado actual
- Next.js 16.2.6 + React 19 + TS 5, pnpm. **Server Actions + better-sqlite3** como única capa de datos: `lib/db/index.ts` (singleton con `globalThis.__db`, WAL, `data/saldo-cero.db` en disco) + `app/actions/*` (budget, transactions, accounts, recurring, projection).
- `hooks/use-budget.tsx` (refactorizado en `sqlite-local`) consume Server Actions; API pública de 12 valores/funciones estable.
- `types/index.ts` — tipos canónicos (`Account`, `Transaction`, `Budget`, `Int`, `toInt()`).
- `lib/cashflow.ts` — `calculateDailyBalance` puro (derivados; **nunca** se persisten/sincronizan).
- Schema 4 tablas: `accounts`, `transactions`, `budgets` (singleton), `recurring_events` — **ya con UUID v4 + timestamps** (buena base para sync).
- `next.config.mjs` con `serverExternalPackages: ['better-sqlite3']`.
- Vercel Blob: no usado aún. Vercel: filesystem efímero → el `.db` server-side **pierde datos en cada redeploy**.

### Qué cambia con este design
- **Nueva fuente de verdad**: el `.db` vive en el dispositivo (sql.js en browser, bytes persistidos en IndexedDB/OPFS). Vercel deja de ser la base de datos.
- **Nueva capa cliente**: `lib/db/client.ts` (factory sql.js + schema), `lib/db/persistence.ts` (IndexedDB/OPFS), `lib/db/repository.ts` (API misma firma que Server Actions), `lib/db/merge.ts` (LWW + tombstones), `lib/db/meta.ts` (`sync_meta`).
- **Nuevo protocolo de sync**: API Routes `GET/POST /api/sync` + `GET /api/sync/meta`, relay `@vercel/blob` bajo `saldo-cero-<syncCode>.db`, auth `x-sync-code` + `x-sync-token` (token solo server-side).
- **Migración FR-5**: columnas `deleted_at`/`device_id` en 3 tablas + tabla `sync_meta` (migración descriptiva ya creada).
- **`lib/db/index.ts` (better-sqlite3) se conserva solo como utilidad de importación** del `.db` legacy → primer snapshot del relay (FR-DB).
- **UI**: `components/sync/sync-button.tsx` + `components/sync/sync-settings.tsx`; primer push guiado con confirmación.

---

## Decisiones de Diseño

| # | Decisión | Opción elegida | Alternativa | Rationale |
|---|----------|---------------|-------------|-----------|
| D1 | Motor SQLite cliente | **sql.js (WASM)** | wa-sqlite (exige COOP/COEP), libsql, mejor-sqlite3 (no corre en browser) | WASM estándar, API familiar style better-sqlite3, carga lazy, suficiente para decenas de filas |
| D2 | Persistencia local | **IndexedDB primaria + OPFS fallback** | OPFS-only, localStorage (límite 5MB, síncrono) | IndexedDB universal; OPFS mejora perf en Chromium; fallback garantiza Safari/Firefox |
| D3 | Relay de sync | **Vercel Blob** (`@vercel/blob`) | Turso (latencia Oregon), Cloudflare D1 (workerd incompatible en Mac dev), VPS, Supabase/Neon (centralizados) | Mismo stack, $0/mes Hobby para ~180 ops/mes; blob opaco + endpoints autenticados |
| D4 | Algoritmo de merge | **LWW por registro con tombstones** | CRDT, OT, merge semántico | Single-user, writes raros; LWW determinista e idempotente; tombstones evitan resurrección |
| D5 | Desempate | **updated_at → created_at → device_id (lexicográfico)** | mtime de archivo, "último que sincroniza gana" | Determinsta y testable; device_id estable por dispositivo (uuid v4 persistido en localStorage) |
| D6 | Borrado | **Soft delete (`deleted_at`)** | Hard delete | Un hard delete no mergea; el tombstone con `updated_at` mayor vence siempre |
| D7 | Concurrencia | **Meta re-check antes de POST + re-merge si cambió** | Lock/bloqueo de relay, versión en blob | Hobby tier no ofrece locks; chequeo por hash en `sync_meta` es suficiente para single-user |
| D8 | Auth del relay | **`x-sync-code` (namespace) + `x-sync-token` estático (server env)** | Auth completa (Supabase), token en public bundle | Código corto compartible solo entre dispositivos propios; token NUNCA `NEXT_PUBLIC_*`; 401 sin credenciales |
| D9 | Estado derivado | **Sigue sin persistirse/sincronizarse** | Sincronizar derivados | `dailyAllowance`, `remainingToday`, `progress` se recalculan via `lib/cashflow.ts`; el snapshot del relay contiene SOLO datos crudos |
| D10 | Budgets (singleton) | **LWW por `updated_at` de la fila única** | Merge campo a campo | Una sola fila `id='default'`; el ganador es la versión con `updated_at` mayor, sin tombstones |
| D11 | Carga de WASM | **Lazy dynamic import** (`await import('sql.js')`), cache de instancia | Carga eager en bundle | No bloquea primer paint; ~1MB WASM se descarga solo cuando el hook lo necesita |
| D12 | Backup pre-merge | **Snapshot local en IndexedDB restaurable desde UI** | Backup en blob, snapshot efímero | El usuario puede revertir un merge malo; restauración = reemplazar `.db` + recargar |
| D13 | mejor-sqlite3 server | **Se conserva SOLO para import inicial del `.db` legacy** | Eliminarlo por completo | `data/saldo-cero.db` ya existe con datos reales; el primer push lo convierte en snapshot; después queda inerte |
| D14 | Hash del snapshot | **SHA-256 del array de bytes del `.db`** | Versión incremental, mtime | Detección de divergencia local/remoto barata; guarda en `sync_meta.last_snapshot_hash` |

---

## Restricciones

1. **sql.js es síncrono y corre en el browser**: no hay `prepare` asíncrono; operaciones sobre memoria. El hook debe seguir usando el patrón optimistic updates para UI fluida. El WASM se carga lazy (D11).
2. **Los bytes del `.db` son la unidad de sync**: el snapshot del relay es un archivo `.db` exportado por sql.js (`db.export()` → `Uint8Array`). El merge opera sobre bases completas (local abierta + remoto abierto en memoria), no sobre diffs.
3. **Server/cliente**: las API Routes (`/api/sync*`) son server-only y pueden leer `BLOB_READ_WRITE_TOKEN` y el sync code desde server env. El pin del token vive en `.env.local` / dashboard de Vercel. Nada de `NEXT_PUBLIC_*` para el token (FR-6).
4. **ACID local**: dentro de sql.js, las operaciones multi-tabla (transferFunds, setupBudget, migración) se ejecutan dentro de `db.transaction()` (sql.js expone `db.transaction(fn)`).
5. **API pública estable**: el repository replica la firma de las Server Actions; `use-budget.tsx` cambia de import, no de contrato. Los componentes no se modifican.
6. **Determinismo del merge**: `mergeDatabases(local, remote, deviceId)` es pura — mismo par + mismo deviceId → mismo resultado. Re-mergeable (idempotente). Sin efectos colaterales; e l backup es responsabilidad del caller.
7. **Migración descriptiva obligatoria**: `docs/migrations/2026-09-09-multi-device-blob-sync.md` (creada). El change no se considera completo sin ella.
8. **Primer commit de rama = fase de plan** (`docs(plan):`) según convención del repo.
9. **No hay realtime**: el sync es manual (botón "Sincronizar"). Sin polling, sin websockets, sin reintentos automáticos.

---

## Arquitectura — Diagrama de Capas

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Client (React / 'use client')                                          │
│                                                                          │
│  components/sync/sync-button.tsx  ── botón Sincronizar + estado         │
│  components/sync/sync-settings.tsx ── code/token, primer push guiado    │
│  hooks/use-budget.tsx ── consume lib/db/repository.ts (misma API)       │
│       │                                                                  │
│       │── loadState()      ◄── mount                                    │
│       │── addTransaction() ◄── user action                              │
│       │── syncNow()        ◄── botón (pull → merge → push)             │
│       │                                                                  │
│       │── useMemo: dailyAllowance, remainingToday, progress             │
│       │   (derivados via lib/cashflow.ts, NUNCA sincronizados)          │
└───────┼──────────────────────────────────────────────────────────────────┘
        │  lib/db/repository.ts (cliente, sql.js)
        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  lib/db/  (client data layer)                                           │
│                                                                          │
│  client.ts      ── initWasm() lazy, openDb(bytes?), applySchema,        │
│                    exportDb() → Uint8Array                               │
│  persistence.ts ── IndexedDB primary + OPFS fallback para el .db blob   │
│  repository.ts  ── API de datos (misma firma que Server Actions)        │
│  merge.ts       ── mergeDatabases(local, remote, deviceId) → MergeResult│
│  meta.ts        ── sync_meta read/write (hash, last_sync_at, device_id) │
│  schema.sql     ── DDL + FR-5 columns (deleted_at, device_id, sync_meta)│
│                                                                          │
│  IndexedDB/OPFS  ◄── bytes del .db (fuente de verdad del dispositivo)   │
└───────┬──────────────────────────────────────────────────────────────────┘
        │  fetch GET/POST /api/sync*  (auth: x-sync-code + x-sync-token)
        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Server (Next.js)  —  app/api/sync/                                     │
│                                                                          │
│  /api/sync      GET ── download snapshot (si las credenciales valen)    │
│                 POST ── upload snapshot (re-check meta antes)           │
│  /api/sync/meta GET ── { hash, updated_at, size }                       │
│                                                                          │
│  lib/blob-relay.ts ── wrapper @vercel/blob (put/get/head por            │
│                      namespace saldo-cero-<syncCode>.db)                │
│                                                                          │
│  Vercel Blob  ◄── blob del snapshot (RELAY únicamente, no verdad)       │
└──────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Import inicial (solo primer push)                                      │
│  lib/db/index.ts (better-sqlite3) ── lee data/saldo-cero.db legacy      │
│  → exportDb() → POST /api/sync ── primer snapshot, hash en sync_meta    │
└──────────────────────────────────────────────────────────────────────────┘

Ciclo de sync (botón):
  pull (GET /api/sync/meta → GET /api/sync)
    → mergeDatabases(local, remote, deviceId)   [con backup local previo]
    → persistir merge en IndexedDB
    → push (POST /api/sync con el resultado)
  Si entre pull y push el meta remoto cambió → re-merge antes de sobrescribir.
```

---

## Módulos y Firmas

### `lib/db/client.ts` — factory sql.js

```ts
import initSqlJs, { Database } from 'sql.js'

let wasmReady: Promise<Database> | null = null

/** Carga WASM lazy (una vez) y devuelve una base vacía con schema aplicado. */
export async function initDb(): Promise<Database>

/** Abre una base desde bytes exportados (IndexedDB o snapshot remoto). */
export async function openDb(bytes: Uint8Array): Promise<Database>

/** Aplica schema.sql + migración FR-5 (columnas nuevas, sync_meta). Idempotente. */
export function applySchema(db: Database): void

/** Exporta la base a bytes (unidad de persistencia y de sync). */
export function exportDb(db: Database): Uint8Array
```

### `lib/db/persistence.ts` — IndexedDB/OPFS wrapper

```ts
const DB_KEY = 'saldo-cero-db'
const OPFS_FILE = 'saldo-cero.db'
const BACKUP_PREFIX = 'saldo-cero-backup'   // pre-merge snapshots (D12)

export async function loadDbBytes(): Promise<Uint8Array | null>
export async function saveDbBytes(bytes: Uint8Array): Promise<void>
export async function saveBackup(bytes: Uint8Array, label: string): Promise<void>
export async function listBackups(): Promise<Array<{ label: string; at: string }>>
export async function restoreBackup(label: string): Promise<Uint8Array>
```

Implementación: IndexedDB (clave `DB_KEY`) primario; en Chromium, si `navigator.storage.getDirectory()` está disponible → OPFS además (write `OPFS_FILE`); lee OPFS primero, cae a IndexedDB.

### `lib/db/repository.ts` — API cliente (espejo de Server Actions)

```ts
export async function loadState(): Promise<{ budget: Budget; accounts: Account[]; transactions: Transaction[] }>
export async function setupBudget(args: { startAmount: number; endDate?: string; mode: 'daily' | 'track' }): Promise<void>
export async function addTransaction(args: { type: TxType; amount: number; description: string; account_id: string; date: string }): Promise<{ id: string }>
export async function removeTransaction(id: string, refund?: boolean): Promise<void>
export async function updateTransaction(args: Transaction): Promise<void>
export async function addAccount(args: { name: string; type: AccountType; icon: string }): Promise<{ id: string }>
export async function updateAccount(args: Account): Promise<void>
export async function deleteAccount(id: string): Promise<void>
export async function transferFunds(args: { amount: number; from_account_id: string; to_account_id: string; description: string }): Promise<void>
export async function updateConfig(args: Partial<Budget>): Promise<void>
export async function toggleAutoSave(): Promise<void>
export async function clearData(): Promise<void>
export async function loadRecurringEvents(): Promise<RecurringEvent[]>
export async function addRecurringEvent(args: RecurringEvent): Promise<{ id: string }>
export async function updateRecurringEvent(args: RecurringEvent): Promise<void>
export async function deleteRecurringEvent(id: string): Promise<void>
export async function computeProjection(horizonDays?: number): Promise<CashflowDayResult[]>
```

**Nota**: cada escritura setea `updated_at = datetime('now')` y `device_id = <activeDeviceId>` (FR-5). `removeTransaction`/`deleteAccount`/`deleteRecurringEvent` pasan a **soft delete** (`deleted_at = datetime('now')`) en lugar de DELETE físico. Las lecturas filtran `deleted_at IS NULL`.

### `lib/db/merge.ts` — merge puro LWW + tombstones

```ts
export interface MergeResult {
  localWins: number      // filas tomadas de local
  remoteWins: number     // filas tomadas de remote
  conflictsResolved: number // empates resueltos por created_at → device_id
  tombstonesApplied: number // borrados aplicados
  newRemoteRows: number  // filas nuevas en remoto insertadas en local
  newLocalRows: number   // filas nuevas en local insertadas en remoto
  unchanged: number
}

/**
 * Pura y determinista. NO hace backup, NO persiste — el caller decide.
 * Operación: para cada tabla con tombstones (accounts, transactions,
 * recurring_events), unir por id y resolver:
 *   - solo local / solo remote → gana el que existe
 *   - ambos: updated_at mayor gana; empate → created_at mayor; empate → device_id lexicográfico mayor
 *   - budgets (singleton): fila única; gana la de updated_at mayor
 * @returns la base local MUTADA con el resultado del merge (in-place sobre sql.js) y el reporte
 */
export function mergeDatabases(
  local: Database,
  remote: Database,
  deviceId: string
): MergeResult
```

Reglas de resolución por fila (FR-3):
- Si `updated_at` difiere → gana la mayor.
- Empate → `created_at` mayor.
- Empate → `device_id` mayor lexicográficamente.
- Una fila con `deleted_at` es la versión "borrada": si su `updated_at` es mayor que la viva opuesta → gana el borrado (tombstone). Si la viva es mayor → revive la viva (se limpia `deleted_at`).

### `lib/db/meta.ts` — sync_meta helpers

```ts
export interface SyncMeta {
  id: 'singleton'
  last_sync_at: string | null
  device_id: string | null
  last_snapshot_hash: string | null
  updated_at: string
}

export function getSyncMeta(db: Database): SyncMeta
export function updateSyncMeta(db: Database, patch: Partial<SyncMeta>): void
export function getActiveDeviceId(): string   // localStorage 'saldo-cero-device-id' (uuid v4) o se crea
```

### `app/api/sync/route.ts` + `app/api/sync/meta/route.ts`

```ts
// GET /api/sync → 200 { bytes: base64 } | 401 | 404 (sin snapshot aun)
// POST /api/sync → body { bytes: base64 } → 200 { hash, updated_at } | 401 | 409 (meta cambió → cliente re-mergea y reintenta)
// GET /api/sync/meta → 200 { hash, updated_at, size } | 401 | 404

const SYNC_TOKEN = process.env.SYNC_TOKEN            // NUNCA NEXT_PUBLIC_*
const syncCode = getSyncCodeFromHeader(req)          // x-sync-code
const blobPath = `saldo-cero-${syncCode}.db`         // namespace por código
```

Token opcionalmente rotable; en Hobby el usuario lo genera una vez (UI) y lo pega como `SYNC_TOKEN` en Vercel.

---

## Protocolo de Sync Detallado

### Pull
1. `GET /api/sync/meta` → `{ hash, updated_at, size }` (404 si no hay snapshot).
2. Si `sync_meta.last_snapshot_hash === hash` y local sin cambios posteriores → estado "synced", no descarga.
3. Si no: `GET /api/sync` → bytes del snapshot → `openDb(bytes)` → `mergeDatabases(local, remote, deviceId)` (previa `saveBackup`) → persistir merge → `sync_meta` actualizado.

### Push
1. `exportDb(local)` → bytes → hash SHA-256.
2. `GET /api/sync/meta`:
   - 404 → primer push → `POST /api/sync` con bytes (idempotente por hash).
   - hash == `sync_meta.last_snapshot_hash` → `POST /api/sync` directo.
   - hash != → remoto cambió → **re-merge** con el snapshot remoto → persistir → reintentar POST.
3. `POST /api/sync` responde 200 con `{ hash, updated_at }` → se persiste en `sync_meta`.

### Auth
- Toda petición sin `x-sync-code` válido (formato corto alfanumérico) o sin `x-sync-token` == `SYNC_TOKEN` → **401**, sin body de datos.
- El namespace deriva del código (`saldo-cero-<syncCode>.db`) → cada usuario tiene su propio blob, no listable entre códigos.
- El relay de producción usa `BLOD_READ_WRITE_TOKEN` de Vercel (dashboard env); en dev se genera un token local.

### Primer push guiado (FR-DB / US-5)
1. UI detecta: `sync_meta.last_snapshot_hash` null y existe `data/saldo-cero.db` (server) → invita a configurar sync.
2. El usuario pega código + token → la UI llama `POST /api/sync/import` (o el server lee `data/saldo-cero.db` vía better-sqlite3 y sube el snapshot) con confirmación explícita.
3. `sync_meta` queda con hash; re-push no duplica (idempotencia por hash). Los datos se eliminan de Vercel solo cuando el usuario lo confirme (fuera de alcance del primer push).

---

## Schema y Migración

Ver `docs/migrations/2026-09-09-multi-device-blob-sync.md`. Resumen:

```sql
-- Columnas nuevas (FR-5)
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;      -- tombstone
ALTER TABLE accounts ADD COLUMN device_id TEXT;        -- último escritor
ALTER TABLE transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE transactions ADD COLUMN device_id TEXT;
ALTER TABLE recurring_events ADD COLUMN deleted_at TEXT;
ALTER TABLE recurring_events ADD COLUMN device_id TEXT;

-- Tabla nueva sync_meta
CREATE TABLE IF NOT EXISTS sync_meta (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  last_sync_at TEXT,
  device_id TEXT,
  last_snapshot_hash TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Backfill
INSERT OR IGNORE INTO sync_meta (id) VALUES ('singleton');
```

`schema.sql` se actualiza a `CREATE TABLE IF NOT EXISTS` con las columnas nuevas para bases nuevas; para bases legacy se ejecuta la migración por detección (`PRAGMA table_info`).

---

## Estructura de Archivos Final

```
lib/
  db/
    index.ts              # better-sqlite3 (SOLO import .db legacy, inerte después)
    client.ts             # NUEVO: factory sql.js (initDb/openDb/applySchema/exportDb)
    persistence.ts        # NUEVO: IndexedDB + OPFS + backups
    repository.ts         # NUEVO: API datos cliente (espejo Server Actions)
    merge.ts              # NUEVO: mergeDatabases + MergeResult (puro)
    meta.ts               # NUEVO: sync_meta + active device id
    schema.sql            # MODIFICADO: FR-5 columns + sync_meta
    blob-relay.ts         # NUEVO: wrapper @vercel/blob (put/get/head/stat)
app/
  api/
    sync/
      route.ts            # NUEVO: GET/POST snapshot
      meta/route.ts       # NUEVO: GET metadata
      import/route.ts     # NUEVO: primer push guiado del .db legacy
components/
  sync/
    sync-button.tsx       # NUEVO: botón + estado (synced/pending/last sync)
    sync-settings.tsx     # NUEVO: code/token + primer push + backups
hooks/
  use-budget.tsx          # MODIFICADO: Server Actions → lib/db/repository.ts
types/
  index.ts                # existente (sin cambios de contrato)
data/
  saldo-cero.db           # legacy (en .gitignore) — importada una vez, luego inerte
```

Dependencias nuevas: `sql.js`, `@vercel/blob`, `@types/sql.js` (dev). `better-sqlite3` permanece (import legacy).

---

## Estrategia de Testing

| Capa | Qué testear | Cómo |
|------|-------------|------|
| **Unit: merge** | LWW por fila, empates (created_at → device_id), tombstones (borrado vs vivo, revival), budgets singleton, MergeResult counts, determinismo/idempotencia | Vitest: dos `Database` sql.js en memoria (no WASM real — mock/memoria), seeds sintéticos; casos por tabla y edge |
| **Unit: repository** | Soft delete (deleted_at set), device_id set en cada write, filtro `deleted_at IS NULL` | Vitest + sql.js en memoria; verificar SQL resultante |
| **Unit: meta** | getSyncMeta/updateSyncMeta, activeDeviceId estable | Vitest + sql.js; localStorage mock (jsdom) |
| **Unit: persistence** | save/load/backup/restore sobre IndexedDB (fake-indexeddb) | Vitest + `fake-indexeddb` |
| **Integration: sync protocol** | 401 sin credenciales, GET/POST round-trip, meta hash, 409 concurrency re-check | Vitest + API handler llamados directos + blob mock (memoria) |
| **Integration: primer push** | Import de un `.db` legacy sintético → snapshot → hash idempotente | Vitest + better-sqlite3 temporal + handler |
| **E2E: convergencia dual-device** | operar A → sync → B converge (merge correcto) | Playwright (:3100): dos browsers/perfiles aislados, relay stub en memoria |
| **Regresión** | Suite existente intacta; UI idéntica | `pnpm test` + `pnpm tsc --noEmit` (CI) |
| **Strict TDD** | merge/persistence/repository tests escritos antes de la implementación | Red → Green → Refactor por tarea |

---

## Riesgos Específicos del Diseño

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| WASM de sql.js ~1MB penaliza carga inicial en móvil | Media | Media | Lazy dynamic import (D11); fallback UI mientras carga; aceptable para uso diario (~3 sesiones) |
| OPFS no disponible (Safari/Firefox) rompe persistencia | Media | Media | IndexedDB universal (D2); OPFS solo mejora Chromium |
| Merge incorrecto en edge case (empate de timestamps, borrado simultáneo) | Baja | Alta | Merge puro + tabla de casos exhaustiva en unit tests; backup pre-merge restaurable (D12) |
| Concurrencia real entre dos dispositivos en distinta zona horaria | Baja | Media | Timestamps UTC ISO en SQLite (`datetime('now')`), desempate determinista (D5); re-check meta antes de POST (D7) |
| Pérdida del `.db` local por limpiar caché del browser | Baja | Alta | Backups en IndexedDB; snapshot en relay como recuperación (pull re-crea dispositivo) |
| Regresión del flujo diario al pivotar a repository cliente | Media | Alta | Misma API (D9-restricción 5); suite existente; fase de verificación dedicada |
| Token expuesto accidentalmente en el bundle | Baja | Crítica | Nunca `NEXT_PUBLIC_*`; solo server env; review en code review |
| sql.js síncrono bloquea hilo principal en merge grande | Baja | Media | Volumen tiny (decenas de filas); merge en `requestIdleCallback`/worker si crece |

---

## Flujo de Datos Completo

```
[Usuario abre la app]
    │
    ▼
useBudget() mounts
    ├─ initDb() (lazy WASM) → openDb(loadDbBytes() ?? nueva)
    ├─ migrateFromLocalStorage() (legacy, solo 1ra vez, idempotente)
    ├─ applySchema + migración FR-5 (detecta columnas faltantes)
    └─ loadState() → state React (budget, accounts, transactions)
    │
[Usuario registra gasto]
    ├─ Optimistic: setTransactions([...newTx, ...prev])
    └─ repository.addTransaction({...}) → INSERT + updated_at + device_id
    │
[Usuario pulsa Sincronizar]
    ├─ syncNow():
    │   1. saveBackup(local)                       [D12]
    │   2. GET /api/sync/meta
    │   3. GET /api/sync → bytes → openDb(remote)
    │   4. mergeDatabases(local, remote, deviceId)  [LWW + tombstones]
    │   5. persistir merge + métricas al usuario (MergeResult)
    │   6. exportDb → hash → POST /api/sync
    │        └─ si 409 → re-merge con remote nuevo → re-POST
    │   7. updateSyncMeta(hash, last_sync_at)
    └─ estado UI: synced / pending / last sync
    │
[Primer push (solo una vez)]
    ├─ user configura code + token
    ├─ POST /api/sync/import → better-sqlite3 lee data/saldo-cero.db
    │   → exportDb → PUT blob → hash
    └─ updateSyncMeta(hash)
    │
[Dispositivo B (nuevo)]
    ├─ initDb + pull (mismo flujo syncNow) → converge desde el relay
    └─ a partir de ahí opera local-first
```

---

*Documento generado como parte del flujo SDD para el change `multi-device-blob-sync`. Design: local-first con sql.js + repository cliente, sync manual vía Vercel Blob relay, merge LWW con tombstones.*