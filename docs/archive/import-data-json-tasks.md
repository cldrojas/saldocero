# Tasks: Importar data.json (import-data-json)
**Change ID**: `import-data-json` | **Fuente**: `docs/requirements/spec-import-data-json.md` + `docs/design/import-data-json.md` (D1–D11)

## Phase 1: Fundación — extracción del núcleo de mapeo (D1)
- [x] 1.1 `lib/migrate-localstorage.ts`: convertir a `export` los tipos `LocalStorageData/Account/Budget/Transaction` (re-export como `LegacyImportData`…, sin cambiar shape).
- [x] 1.2 `lib/migrate-localstorage.ts`: extraer el bloque transaccional actual (pasos A–D, líneas ~112–245) a `export function insertLegacyData(db: Database, parsedData: LocalStorageData): void` — BEGIN → accounts `ON CONFLICT(id) DO NOTHING` → remap `account→account_id` (skip sin mapeo, `tx.id || uuidv4`) → budget `'default'` → COMMIT | ROLLBACK; muta db en sitio, sin guardas.
- [x] 1.3 `migrateFromLocalStorage` (guardas 1–3 + `JSON.parse` + `saveToIndexedDB` + `setItem(flag,'true')`) delega en `insertLegacyData`; exportar `MIGRATED_FLAG_KEY`.
- [x] 1.4 Gate: `pnpm exec vitest run tests/unit/migrate-localstorage.test.ts` (equivalente single-run de `pnpm test`) — verde (11/11) + `pnpm tsc --noEmit` limpio (no-regresión, D1).

## Phase 2: Librería de import (`lib/import-json.ts`, nuevo)
- [x] 2.1 `MAX_IMPORT_BYTES = 10*1024*1024`; tipos `ImportFileError`, `ImportParseResult`, `ImportPreview`.
- [x] 2.2 `readImportFile(file)`: `file.size > MAX` → `'too-large'` antes de leer; `text()` + `JSON.parse` catch → `'invalid-json'`; delega en `validateImportJson`.
- [x] 2.3 `validateImportJson(text)`: type guard estricto — budget (`startAmount:number`, `mode:'daily'|'track'`, `isSetup:boolean`), `accounts[]` (`name`/`type`/`balance`/`hidden`, `type` dentro de `daily|savings|investment|custom|expense`), `transactions[]` (`type`/`amount`/`account`) → falla temprano `'invalid-shape'`; derivados (`dailyAllowance/remainingToday/progress/lastCheckedDay`) tolerados e ignorados (D7).
- [x] 2.4 `buildImportPreview(data)`: puro (sin DB) — counts, mode, rango min/max de `tx.date` (`{start:null,end:null}` sin txs), `hasConfiguredBudget` (isSetup).
- [x] 2.5 `applyJsonImport(text,{replace})`: validar → `!ok` throw `{error}`; `db = await getDb()` (misma instancia, **sin setDb**); si `replace` → `saveBackup(exportDb(db),'pre-import-<ts>')` best-effort + `clearData(db)`; `insertLegacyData(db,data)`; `await saveToIndexedDB(db)`; `setItem(MIGRATED_FLAG_KEY,'true')` tras éxito (FR-4.6); retorna `{accounts,transactions}`.

## Phase 3: UI + i18n
- [x] 3.1 `components/import-json-modal.tsx` (`ImportJsonModal({open,onOpenChange,onImported})`, patrón `sync-qr-modal`): `readImportFile` → preview (filename, counts, modo, rango); `getDb()` cuenta `accounts` → si >0 warning reemplazo + Confirm disabled hasta aceptar (D2); estados `preview|busy|error(ImportFileError)` tipados (D7); Cancelar sin tocar DB; reset input al re-abrir (riesgo 3).
- [x] 3.2 `components/config-form.tsx`: botón `t('importData')` `variant="secondary"` junto a Exportar (div ~línea 108–160); `<input type="file" accept="application/json,.json">` hidden dentro del modal (riesgo 3: reset por `key` al re-abrir); agregar `refresh` al destructure de `useBudget` (línea 28).
- [x] 3.3 `components/config-form.tsx`: `handleImported` → `await refresh()` + toast `t('importSuccess')`; montar `<ImportJsonModal>` (return en fragmento).
- [x] 3.4 `contexts/language-context.tsx`: claves `import.*` es/en (tabla FR-5/D9), claves fijas sin interpolación en `t()`; reutiliza `cancel/confirm/youSure/undoable`.

## Phase 4: Tests + gate
- [x] 4.1 `tests/unit/import-json.test.ts` (espejo de `migrate-localstorage.test.ts`): `readImportFile` too-large/invalid-json/invalid-shape; `validateImportJson` vacío/JSON array/type fuera del enum/derivados; `buildImportPreview` counts+rango.
- [x] 4.2 `applyJsonImport` con `getDb`/`clearData`/`saveToIndexedDB`/`exportDb` mockeados: path reemplazo (backup `pre-import-*` + clearData), DB vacía sin backup, shape inválido → throw sin efecto sobre db; flag `daily-budget-data-migrated` marcada; bypass: flag previa `'true'` no bloquea (D3).
- [x] 4.3 Paridad D1: mismo fixture legacy vía `applyJsonImport` = `migrateFromLocalStorage` (mismos UUIDs/ON CONFLICT); idempotencia: doble import no duplica filas.
- [x] 4.4 `tests/ui/import-json.spec.ts` (Playwright `:3100`, DB E2E aislada): picker `.json` → preview visible → confirmar → toast → budget/cuentas en UI → `page.reload()` persiste.
- [x] 4.5 Gate: `pnpm test` + `pnpm tsc --noEmit` verdes; suite de migración intacta; ausencia de `docs/migrations/import-data-json*` (NFR-1/D10).

---
*Checklist SDD para `import-data-json`. Extracción (Phase 1) antes que librería (Phase 2); UI (Phase 3) depende de librería; tests (Phase 4) verifican FR-2/3/4. Sin archivo de migración (D10).*