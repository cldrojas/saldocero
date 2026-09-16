# Design: import-data-json

**Change ID**: `import-data-json`
**Estado**: Implementado, verificado y archivado (2026-09-14).
**Complementa**: pivote `sqlite-local` (archivado) y `offline-first-ui` (v2). La migración automática (`lib/migrate-localstorage.ts`) solo cubre el localStorage del mismo browser; este change añade el **import manual de un backup `data.json`** (formato legacy) para recuperar datos en cualquier dispositivo.

---

## Propósito / Balance

Recuperar datos del formato anterior (`LocalStorageData`) desde un archivo `.json` descargado en el pivot (`daily-budget-export.json`), validando, mostrando preview y reemplazando —con confirmación y backup previo— la DB local si ya contiene datos.

**Balance perseguido**:

| Eje | Postura | Racional |
|-----|---------|----------|
| Reutilización vs. duplicación | Extraer el núcleo de mapeo legacy y compartirlo | Un solo origen de verdad para la transformación y los UUID deterministas |
| Seguridad de datos vs. simplicidad | Reemplazo solo con confirmación explícita + backup `pre-import-*` | El borrado nunca es silencioso; los datos previos quedan recuperables desde IndexedDB |
| Robustez vs. alcance | Validación estricta con errores tipados + límite 10 MB | Archivo inválido/corrupto no toca la DB; el rechazo es determinista y testeable |
| UX vs. cobertura | Preview antes de confirmar | El usuario sabe qué se va a importar (cuentas, transacciones, modo, rango) antes de reemplazar |

---

## Contexto

El pivote `sqlite-local` reemplazó localStorage por sql.js (`lib/db/client.ts`): un singleton `db` (lazy vía `getSql()` + `getDb()`), persistido a IndexedDB (`lib/db/persistence.ts`, DB `saldo-cero-db` v1, key `last`). La migración automática (`lib/migrate-localstorage.ts`) transforma `LocalStorageData` → schema nuevo con 3 guardas: (1) sin datos → skip, (2) `accounts` con filas → skip, (3) flag `daily-budget-data-migrated === 'true'` → skip. El export manual se genera en `config-form.tsx` (~línea 108) con el **mismo shape legacy** (`budget`, `accounts[]`, `transactions[]` + derivados `dailyAllowance/remainingToday/progress/lastCheckedDay`).

El problema que resuelve este change: un usuario que descargó `daily-budget-export.json` (o que quiere pasar sus datos a otro dispositivo/browser) no tiene forma de volver a cargarlos: la migración automática solo lee localStorage del browser actual.

**Hechos verificados en código** (fuentes: `lib/migrate-localstorage.ts`, `lib/db/client.ts`, `lib/db/repository.ts`, `lib/sync-client.ts`, `components/config-form.tsx`, `hooks/use-budget.tsx`):
- `migrateFromLocalStorage` (líneas 70-253) ya contiene TODO el mapeo en un bloque transaccional `BEGIN`/`COMMIT`/`ROLLBACK`: paso A cuentas con `INSERT ... ON CONFLICT(id) DO NOTHING`, paso B re-mapeo `transactions.account → account_id` (skip si sin mapeo; `tx.id || crypto.randomUUID()`), paso C budget singleton `id='default'`, paso D commit. Ese bloque es exactamente lo que el import necesita, **sin las guardas**.
- `clearData(db)` (`repository.ts:258`) borra en `inTx`: `DELETE transactions → accounts → budgets` (orden FK-safe).
- `applyQrImport` (`sync-client.ts:171-195`) establece el patrón de backup best-effort previo a mutación: `saveBackup(exportDb(db), 'pre-merge-<ts>')` → operación → `saveToIndexedDbSafe`.
- `getDb()` devuelve la **misma** instancia del singleton: mutar en sitio + `saveToIndexedDB(db)` alcanza, sin `setDb` y sin recarga.
- `refresh()` (`use-budget.tsx` ~83) recarga estado desde `getDb()`; `ConfigForm` (línea 28) ya consume `useBudget()`.
- El export fija `lastCheckedDay: null` y emite fechas legacy (ISO string) que la migración normaliza (`new Date(x).toISOString().split('T')[0]` para budget).
- i18n existente: `exportData`, `cancel`, `confirm`, `youSure`, `undoable`, `clearData`; **no hay** claves de import.

---

## Decisiones de Diseño

**D1 — Extraer el núcleo de mapeo como `insertLegacyData(db, parsedData)`; NO reutilizar `migrateFromLocalStorage` completa.**
El mapeo transaccional (pasos A–D) se extrae a una función exportada en `lib/migrate-localstorage.ts` que recibe `(db, parsedData)`. `migrateFromLocalStorage` conserva sus 3 guardas y delega en ella; el import manual la invoca directamente. Resultado: una sola implementación del mapeo y de los UUID deterministas (D6), cero duplicación, y comportamiento byte-idéntico con la migración automática.

**D2 — Reemplazo con confirmación + backup `pre-import-<ts>` (solo si la DB ya tiene cuentas).**
Si `SELECT COUNT(*) FROM accounts > 0`, el modal muestra variante de reemplazo (`youSure`+`undoable`); al confirmar: `saveBackup(exportDb(db), 'pre-import-<ts>')` (best-effort, espejo de `applyQrImport`) → `clearData(db)` → import. DB vacía → confirmación simple sin backup. El borrado nunca es silencioso.

**D3 — Bypass únicamente del guard 3 (flag migrated).**
`migrateFromLocalStorage` queda intacta (auto-migración idempotente con sus 3 guardas). El import manual ignora el flag y llama a `insertLegacyData`; las guardas 1–2 no aplican porque el origen es un archivo (no localStorage) y el "ya hay datos" se resuelve como decisión UX de reemplazo (D2), no como skip silencioso.

**D4 — Entrada junto al botón Exportar en `config-form.tsx`.**
Botón secundario "Importar datos" (`t('importData')`, `variant="secondary"`) al lado del de exportar (línea 108-160). `<input type="file" accept="application/json,.json" className="hidden">` disparado programáticamente, con `key` reiniciable para permitir re-seleccionar el mismo archivo. Botón `disabled` mientras `busy`. Mismo container `div.flex.justify-between` del export.

**D5 — Modal propio `components/import-json-modal.tsx` con preview + confirmación.**
Reutiliza el patrón Dialog de `sync-qr-modal.tsx`. Tras leer/validar el archivo muestra preview: nº de cuentas, nº de transacciones, modo (`daily`/`track`), rango de fechas (min–max de transacciones, si hay) y si hay budget con `isSetup`. Si la DB tiene cuentas → variante reemplazo (D2). Confirm → `applyJsonImport` → `onImported()` → parent (`config-form`) hace `refresh()` + toast.

**D6 — UUIDs deterministas v5 (heredados del núcleo, D1).**
Default: `stableUuid('daily'|'savings'|'investment')` = `uuidv5('daily-budget-account-<type>')`; custom: `uuidv5('daily-budget-account-<type>-<name>')`; namespace `3f8e4a12-7b6c-4d9e-8f0a-1b2c3d4e5f6a`. `ON CONFLICT(id) DO NOTHING` en accounts y budget; transactions conservan `tx.id || crypto.randomUUID()` y el re-mapeo `account → account_id` (sin mapeo → skip). **No se reutiliza el `id` legacy como PK.**

**D7 — Validación estricta con type guard y errores tipados; 10 MB máximo.**
`readImportFile(file)`: chequea `file.size > 10 MB` ANTES de leer texto → error `'too-large'`. `validateImportJson(text)` → `{ ok: true; data: LegacyImportData } | { ok: false; error: 'invalid-json' | 'invalid-shape' }`. Requiere shape: objeto con `budget` (startAmount number, mode `'daily'|'track'`, isSetup boolean...), `accounts[]` (name/type string, balance number...), `transactions[]`. Los campos **derivados** (`dailyAllowance/remainingToday/progress/lastCheckedDay`) se toleran pero se **ignoran** — se recomputan vía `loadState`; la fecha `lastCheckedDay` se descarta por seguridad (rollover del día).

**D8 — Persistencia y refresh sin `setDb`.**
`applyJsonImport` trabaja sobre la DB singleton obtenida con `getDb()` (sin `setDb`: se muta la misma instancia) → backup/clear si aplica → `insertLegacyData(db, data)` → `saveToIndexedDB(db)` → retorna `{ accounts, transactions }`. El modal llama `onImported()` y el parent hace `await refresh()` + toast. Al no intercambiar la instancia se elimina la carrera de autosave por swap de singleton (riesgo que sí existía en `applyQrImport`).

**D9 — i18n con claves fijas `import.*` (es/en).**
Claves nuevas: `importData`, `importFile` (textarea/label del picker), `importPreviewTitle`, `importPreviewAccounts`, `importPreviewTransactions`, `importPreviewMode`, `importPreviewDateRange`, `importOverwriteWarning`, `importConfirm`, `importSuccess`, `importErrorInvalidJson`, `importErrorInvalidShape`, `importErrorTooLarge`, `importErrorUnexpected`. `confirm`/`cancel`/`youSure`/`undoable` ya existen y se reutilizan. Prohibido interpolar contenido dinámico en `t()`; números/fechas se renderizan en el componente.

**D10 — Sin migración de schema.**
Ningún cambio a SQLite → **no** se crea archivo en `docs/migrations/`. Rollback = revertir `lib/import-json.ts`, `import-json-modal.tsx`, el wiring de `config-form.tsx`, claves i18n y tests.

**D11 — Tests.**
Unit `tests/unit/import-json.test.ts` (espejo de `migrate-localstorage.test.ts`): validación (json inválido, shape inválido, >10MB, archivo vacío, `type` fuera del enum), preview (counts, rango de fechas, falta de budget), `applyJsonImport` con `getDb`/`clearData`/persistence mockeados (path reemplazo con backup, path DB vacía sin backup), mapeo idéntico al esperado de la migración (mismos UUIDs, ON CONFLICT, skip de transacciones sin cuenta). E2E `tests/ui/import-json.spec.ts` (Playwright `:3100`, DB E2E aislada): seleccionar archivo → preview → confirmar → verificar budget/cuentas en UI. La validación >10 MB se cubre en unit (no Playwright).

---

## Restricciones

| Restricción | Origen | Implicación de diseño |
|-------------|--------|----------------------|
| Sin cambio de schema SQLite | PRD / pivote | No hay `docs/migrations/` nuevo; core `insertLegacyData` reutiliza el INSERT existente |
| El export actual es el contrato de entrada | PRD §3 / pivot | El shape de `config-form.tsx` (~115-144) ES el formato aceptado; compatible hacia atrás con el de localStorage |
| Backup previo a cualquier reemplazo | Patrón `applyQrImport` | `saveBackup(..., 'pre-import-<ts>')` best-effort antes de `clearData` |
| Reemplazo nunca silencioso | NFR del pivot (recuperabilidad) | Dialog con `youSure`+`undoable` solo cuando `accounts > 0` |
| Validación antes de tocar la DB | NFR robustez (proposal) | `readImportFile`/`validateImportJson` puros, sin efecto; errores tipados |
| Límite 10 MB | Spec FR (archivos externos) | Chequeo `file.size` pre-read; `'too-large'` en unit |
| Sin interpolación en `t()` | convención repo | Counts/fechas fuera de i18n |
| `migrateFromLocalStorage` no cambia de comportamiento | idempotencia previa | Solo extracción (D1); guardas intactas; tests existentes deben seguir verdes |

---

## Arquitectura

```
┌──────────────────────┐  btn "Importar datos"   ┌────────────────────────┐
│ components/config-   │ ──────────────────────▶ │ input[type=file]      │
│ form.tsx (Export row)│   click programático    │ (hidden, .json)       │
└──────────────────────┘                         └──────────┬─────────────┘
                                                           │ File
                                               ┌───────────▼─────────────┐
                                               │ lib/import-json.ts      │
                                               │  readImportFile(file)   │  → 10MB check
                                               │  validateImportJson(txt)│  → type guard
                                               │  buildImportPreview(d)  │  → counts/range
                                               └───────────┬─────────────┘
                                                           │ preview
                                               ┌───────────▼─────────────┐
                                               │ import-json-modal.tsx   │ Dialog preview
                                               │  si accounts>0 → D2     │ + confirm
                                               └───────────┬─────────────┘
                                               confirm     │
                                               ┌───────────▼─────────────┐
                                               │ applyJsonImport(text)   │ lib/import-json.ts
                                               │  db = getDb()           │  (msma instancia)
                                               │  si hay cuentas:        │
                                               │    saveBackup(pre-import)│
                                               │    clearData(db)        │
                                               │  insertLegacyData(db)   │ ← lib/migrate-ls.ts
                                               │  saveToIndexedDB(db)    │
                                               └───────────┬─────────────┘
                                               onImported()│
                                               ┌───────────▼─────────────┐
                                               │ refresh() + toast       │ (useBudget en parent)
                                               └─────────────────────────┘
```

Same single sql.js singleton end-to-end: no `setDb`, no recarga de bootstrap. El núcleo `insertLegacyData` es la única pieza compartida entre la migración automática y el import manual.

---

## Módulos y Firmas

### `lib/migrate-localstorage.ts` (modificado — extracción D1)

```ts
// Extraído del cuerpo transaccional actual (pasos A–D, líneas 112-245).
// Muta db en sitio. Sin guardas: el CALLER decide cuándo invocar.
export function insertLegacyData(
  db: Database,
  parsedData: LocalStorageData
): void
  // BEGIN → accounts (ON CONFLICT DO NOTHING) → transactions (remap account_id,
  // skip sin mapeo, tx.id || uuidv4) → budget 'default' → COMMIT | ROLLBACK

export async function migrateFromLocalStorage(
  storedData?: string | null,
  alreadyMigrated?: string | null
): Promise<boolean>
  // SIN CAMBIOS de comportamiento: guardas 1-3 + JSON.parse + insertLegacyData(db, parsed) 
  // + saveToIndexedDB + setItem(MIGRATED_FLAG_KEY,'true')
```

### `lib/import-json.ts` (nuevo)

```ts
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024 // 10 MB
export type ImportFileError = 'too-large' | 'invalid-json' | 'invalid-shape'
export type ImportParseResult =
  | { ok: true; data: LegacyImportData }
  | { ok: false; error: ImportFileError }
export type ImportPreview = {
  accounts: number
  transactions: number
  mode: string
  dateRange: { start: string | null; end: string | null }
  hasConfiguredBudget: boolean
}

export async function readImportFile(file: File): Promise<ImportParseResult & { size: number }>
  // file.size > MAX_IMPORT_BYTES → { ok:false, error:'too-large' } (sin leer)
  // text() → JSON.parse → validateImportJson

export function validateImportJson(text: string): ImportParseResult
  // JSON.parse|catch → 'invalid-json'; type guard estricto → 'invalid-shape'
  // shape mínimo: budget(mode 'daily'|'track', isSetup boolean, startAmount number),
  // accounts[] (name/type string, balance number, hidden boolean),
  // transactions[] (type string, amount number, account string)
  // derivados ignorados (D7)

export function buildImportPreview(data: LegacyImportData): ImportPreview
  // counts + mode + rango min/max de tx.date + isSetup
  // puro, sin DB.

export async function applyJsonImport(
  text: string,
  opts: { replace: boolean }
): Promise<{ accounts: number; transactions: number }>
  // 1. const res = validateImportJson(text); !res.ok → throw { error: res.error }
  // 2. db = await getDb()
  // 3. if (opts.replace) { saveBackup(exportDb(db), `pre-import-${Date.now()}`) best-effort; clearData(db) }
  // 4. insertLegacyData(db, res.data)
  // 5. await saveToIndexedDB(db)
  // 6. contadores de filas → { accounts, transactions }
  // Sin setDb ni refresh: el modal/parent orquestan.
```

Tipos `LegacyImportData`/`LegacyImportAccount`/... se re-exportan desde `lib/migrate-localstorage.ts` (se convierten en `export`).

### `components/import-json-modal.tsx` (nuevo)

```tsx
export function ImportJsonModal({
  open, onOpenChange, onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (result: { accounts: number; transactions: number }) => void
}): JSX.Element
  // state: preview | busy | error(ImportFileError) | replaceWarning
  // 1. open + file seleccionado → readImportFile → preview | error toast
  // 2. getDb→count accounts → si >0 → replaceWarning (D2), else confirm simple
  // 3. Confirm → applyJsonImport(text, { replace: onData }) → busy
  // 4. ok → onImported(result); onOpenChange(false)
  // Errores tipados (D7) → título/descripción i18n, sin tocar la DB
```

### `components/config-form.tsx` (modificado)

```tsx
// En el div del export (línea 108-160), junto al botón Exportar:
<Button type="button" variant="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
  {t('importData')}
</Button>
<input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden"
       onChange={handleImportFileSelected} />
<ImportJsonModal open={importOpen} onOpenChange={setImportOpen}
                 onImported={handleImported} />
// handleImported: await refresh(); toast({ title: t('importSuccess') })
// `refresh` se agrega al destructure de useBudget (línea 28).
```

### `contexts/language-context.tsx` (modificado — keys `import.*` es/en, D9)

Nuevas claves `en` y `es` (listado en D9). `confirm`/`cancel`/`youSure`/`undoable` existentes reutilizadas por el modal.

---

## Estructura de Archivos Final

| Archivo | Estado | Cambio |
|---------|--------|--------|
| `lib/migrate-localstorage.ts` | Modificado | Extraer `insertLegacyData`, exportar tipos legacy |
| `lib/import-json.ts` | Nuevo | `readImportFile`/`validateImportJson`/`buildImportPreview`/`applyJsonImport` |
| `components/import-json-modal.tsx` | Nuevo | Modal preview + confirm (patrón `sync-qr-modal`) |
| `components/config-form.tsx` | Modificado | Botón import + input file + modal + `refresh` |
| `contexts/language-context.tsx` | Modificado | Claves `import.*` es/en |
| `tests/unit/import-json.test.ts` | Nuevo | Validación, preview, apply (mocks db/persistence) |
| `tests/ui/import-json.spec.ts` | Nuevo | E2E import→preview→confirm→UI |
| `docs/requirements/*` | Sin cambio | — |
| `docs/migrations/*` | **No se crea** | Sin cambio de schema (D10) |

---

## Estrategia de Testing

- **Unit (`tests/unit/import-json.test.ts`, espejo de `migrate-localstorage.test.ts`)**:
  - `readImportFile`: `'too-large'` (file mock >10MB), `'invalid-json'` (texto corrupto), `'invalid-shape'` (faltan cuentas, `mode` inválido, `budget` ausente), ok.
  - `validateImportJson`: archivo vacío, JSON array (no objeto), `type` fuera del enum de cuentas, derivados presentes/ausentes.
  - `buildImportPreview`: counts, rango de fechas min/max, sin transacciones → `{start:null,end:null}`, sin budget.
  - `applyJsonImport`: con `getDb`/`clearData`/`saveToIndexedDB`/`exportDb` mockeados — path reemplazo (backup `pre-import-*` + clearData), path DB vacía (sin backup), shape inválido → throws `{error}` sin efecto sobre db.
  - **Paridad D1**: importar un fixture legacy vía `applyJsonImport` produce la misma DB que `migrateFromLocalStorage` con el mismo fixture (mismos UUIDs, mismos `ON CONFLICT`).
  - Datos reales: reutilizar el fixture de `migrate-localstorage.test.ts` como input de import.
- **E2E (`tests/ui/import-json.spec.ts`)** Playwright `:3100`, DB aislada: abrir config → Importar datos → picker `.json` (fixture) → preview visible (counts/modo) → confirmar → toast success → budget/cuentas renderizadas y persistencia en reload (`page.reload` mantiene datos).
- **Aceptación**: `pnpm test` (unit + e2e) y `pnpm tsc --noEmit` verdes; tests existentes de migración intactos.

---

## Riesgos Específicos

1. **Regression en la migración automática** al extraer `insertLegacyData`. Mitigación: extracción puramente mecánica del bloque transaccional existente (sin tocar lógica), los tests actuales de `migrate-localstorage` actúan como red de seguridad y el test de paridad (D1) fija D-N-ingreso = D-migración.
2. **Interpolación de fechas/formatos legacy** (ISO vs `YYYY-MM-DD`): mitigado porque el import reutiliza exactamente la normalización del core (`new Date(x).toISOString().split('T')[0]`), idéntica al path probado.
3. **Re-selección del mismo archivo** no dispara `onChange` (input file cacheado). Mitigación: reset del input tras cada import/cierre (patrón `key`/`value=''`).
4. **Carrera UI**: `busy` deshabilita el botón y el modal durante `applyJsonImport`; al no haber `setDb`, no hay swap del singleton — el refresh posterior lee la misma instancia ya mutada.