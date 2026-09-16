# Spec: Importar data.json (Delta)

## Change ID
`import-data-json`

## Estado
**Implementado, verificado y archivado (2026-09-14).** Complementa el pivote `sqlite-local` (archivado) y el change `offline-first-ui` (v2). La migración automática solo cubre el caso de `localStorage` presente en el **mismo browser**; este change cubre el caso de un **archivo JSON exportado manualmente** (`daily-budget-export.json` o el blob `daily-budget-data` de `localStorage`), que hoy no tiene vía de recuperación. El usuario selecciona su archivo desde el **mismo contenedor** del botón "Exportar datos" (`config-form.tsx`), la app valida el shape, muestra un **preview** (cuentas, transacciones, modo, fechas), pide confirmación explícita si la DB ya tiene datos, y persiste usando el **mismo mapeo canónico** que la migración automática (`lib/migrate-localstorage.ts`). No requiere archivo de migración de schema. Verdicto `sdd-verify`: **PASS** — 17/17 tasks, 210/210 unit, tsc clean, 2/2 e2e; los 2 WARNINGs resueltos (W1: enmienda NFR-2, el balance es siempre `SUM` sin `adjustment`; W2: claves i18n `dailyMode`/`trackMode` en `c275dc7`). Checklist de cobertura en la sección "Cobertura del Spec".

---

## REQUISITOS AÑADIDOS

### FR-1: Botón "Importar datos" en el menú de configuración
Archivo: `components/config-form.tsx`

- Junto al botón existente "Exportar datos" (`t('exportData')`, ~línea 158), agregar un botón "Importar datos" (`t('importData')`) con estilo `variant="secondary"`.
- Al hacer click, invoca un `<input type="file" accept="application/json,.json">` oculto.
- El botón se deshabilita mientras el import esté en curso (busy state).

#### Escenario: Flujo de selección de archivo
- GIVEN el usuario está en Settings con `config-form.tsx` visible
- WHEN pulsa "Importar datos"
- THEN se abre el selector de archivo del sistema (solo `.json` / `application/json`)
- AND el botón se deshabilita durante la operación

#### Escenario: Archivo rechazado por tamaño
- GIVEN el selector de archivo abierto
- WHEN el usuario selecciona un archivo mayor a 10 MB
- THEN se muestra feedback de error y no se procesa

---

### FR-2: Lectura y validación del archivo
Archivo: `lib/import-json.ts` (nuevo)

- Lee el contenido del archivo como texto (`file.text()`).
- Parsea JSON en `try/catch`: si falla → error `invalid_json` (toast destructivo, sin tocar DB).
- Valida el shape con un guard estricto:
  - `parsed.budget` es objeto con `startAmount: number`
  - `parsed.accounts` es array de `{ id, name, type, icon?, hidden?, balance? }` — `type` debe estar dentro del CHECK del schema (`daily`, `savings`, `investment`, `custom`, `expense`) para **fallar temprano con error claro** en lugar de SQL error a mitad de transacción.
  - `parsed.transactions` es array de `{ id?, type, amount, description?, account, date? }`
  - Cualquier otra forma (incl. un snapshot binario `Uint8Array`, o el JSON de `sync_meta`) → error `invalid_shape`.
- Retorna un resumen para el preview: `{ accounts: n, transactions: n, mode, startDate?, endDate? }`.

#### Escenario: Archivo válido (formato export actual)
- GIVEN un archivo `daily-budget-export.json` con shape `LocalStorageData` correcto
- WHEN se valida
- THEN la función retorna `{ accounts: <count>, transactions: <count>, mode, startDate?, endDate? }` sin errores

#### Escenario: Archivo válido (blob viejo de localStorage)
- GIVEN un blob de `localStorage` sin campo `isSetup` en budget, con derivados (`dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay`)
- WHEN se valida
- THEN la validación acepta el shape (los campos derivados se ignoran silenciosamente)

#### Escenario: JSON inválido (sintaxis)
- GIVEN un archivo con contenido no-JSON (ej. texto plano, HTML)
- WHEN `JSON.parse` lanza SyntaxError
- THEN se retorna error `invalid_json` y la DB permanece intacta

#### Escenario: Shape desconocido (binario o sync_meta)
- GIVEN un archivo que contiene un `Uint8Array` serializado o el shape de `sync_meta`
- WHEN se valida
- THEN se retorna error `invalid_shape` y la DB permanece intacta

#### Escenario: Cuentas con type inválido
- GIVEN un archivo con una cuenta cuyo `type` no está en el CHECK del schema
- WHEN se valida
- THEN se retorna error `invalid_shape` (falla temprano, no SQL error)

---

### FR-3: Preview + confirmación
Archivo: `components/import-json-modal.tsx` (nuevo)

- Antes de aplicar, muestra:
  - Origen del archivo (`data.json` / nombre real del archivo).
  - `N` cuentas, `M` transacciones, modo del presupuesto (`daily`/`track`), rango de fechas de transacciones si aplica.
  - Si la DB ya tiene datos (`accounts` con filas): **advertencia de reemplazo** + confirmación explícita.
- Botón "Importar" (disabled hasta confirmación si hay warning) y "Cancelar" (`t('cancel')`).

#### Escenario: Preview en DB vacía
- GIVEN la DB no tiene cuentas
- WHEN se valida un archivo válido
- THEN el modal muestra: nombre de archivo, N cuentas, M transacciones, modo del presupuesto, fechas
- AND no hay advertencia de reemplazo

#### Escenario: Preview en DB con datos
- GIVEN la DB tiene cuentas existentes
- WHEN se valida un archivo válido
- THEN el modal muestra la misma info + **advertencia explícita** de que el import reemplazará los datos actuales
- AND el botón "Importar" permanece disabled hasta que el usuario confirme la advertencia

#### Escenario: Cancelación
- GIVEN el modal de preview abierto
- WHEN el usuario pulsa "Cancelar"
- THEN el modal se cierra sin tocar la DB

---

### FR-4: Aplicación del import
Archivos: `lib/import-json.ts` (nuevo) + `lib/migrate-localstorage.ts` (modificado)

1. **Backup pre-import** (best-effort): `exportDb(await getDb())` → `saveBackup(bytes, 'pre-import-<ts>')` (patrón `applyQrImport`). El backup se lista en la UI de sync.
2. **`clearData()`** si la DB tiene filas y el usuario confirmó el reemplazo.
3. **Núcleo de mapeo**: refactorizar `migrateFromLocalStorage` para exponer `importFromJson(storedData: string)` que **bypasee el guard 3** (flag `daily-budget-data-migrated`) — el import es una acción explícita del usuario. El guard 2 (DB vacía) se mantiene; en el flujo de import, si queda DB con filas tras `clearData()`, es un error → lanzar en vez de skip silencioso.
4. **Persistir**: `saveToIndexedDB(db)`.
5. **Refrescar la UI**: llamar `refresh()` del hook (`hooks/use-budget.tsx`, `loadState`) para que la vista se regenere desde la DB importada.
6. **Toast de éxito** `t('importSuccess')` con resumen (`N cuentas, M movimientos`). Marcar la flag `daily-budget-data-migrated` para que la migración automática no intente sobre-escribir después.
7. **Transacción atómica**: `BEGIN`/`COMMIT`/`ROLLBACK` manual dentro del núcleo de mapeo (`insertLegacyData` en `lib/migrate-localstorage.ts`, compartido con la migración automática). `ON CONFLICT(id) DO NOTHING` → idempotente.

#### Escenario: Import en DB vacía
- GIVEN la DB no tiene cuentas ni transacciones
- WHEN el usuario confirma el import
- THEN `clearData()` se omite (no hay filas)
- AND `importFromJson(storedData)` ejecuta la transacción atómica
- AND `saveToIndexedDB(db)` persiste el estado
- AND `refresh()` actualiza la UI con los datos importados
- AND se muestra toast `t('importSuccess')`

#### Escenario: Import con reemplazo (DB con datos)
- GIVEN la DB tiene cuentas y transacciones existentes
- WHEN el usuario confirma el reemplazo
- THEN `saveBackup(bytes, 'pre-import-<ts>')` guarda el estado actual
- AND `clearData()` elimina las tablas
- AND `importFromJson(storedData)` ejecuta la transacción
- AND `saveToIndexedDB(db)` persiste
- AND `refresh()` actualiza la UI
- AND el backup `pre-import-*` queda listado en la UI de sync

#### Escenario: Archivo inválido / error de parse
- GIVEN un archivo con JSON inválido o shape incorrecto
- WHEN se intenta importar
- THEN se muestra toast con error (`t('importErrorInvalidJson')` o `t('importErrorInvalidShape')`)
- AND la DB permanece intacta (no se toca antes de validar)

#### Escenario: Doble import (idempotencia)
- GIVEN la DB tiene datos importados previamente
- WHEN el usuario importa el mismo archivo de nuevo
- THEN `ON CONFLICT(id) DO NOTHING` evita duplicar cuentas y transacciones
- AND el total de filas no cambia
- AND se muestra toast de éxito

#### Escenario: Bypass del flag `daily-budget-data-migrated`
- GIVEN `localStorage['daily-budget-data-migrated']` está en `'true'` (migración automática ya corrió)
- WHEN el usuario importa un JSON explícitamente
- THEN `importFromJson` bypasee el guard 3 y ejecuta el import
- AND tras el import exitoso, la flag se marca (o re-marca) para que la migración automática no intente sobre-escribir

---

### FR-5: Internacionalización (i18n)
Archivo: `contexts/language-context.tsx`

Claves nuevas junto a `exportData` (en ~línea 46, es ~línea 260), usando claves fijas, sin interpolación dinámica en `t()`:

| Clave | es | en |
|-------|-----|-----|
| `importData` | Importar datos | Import Data |
| `importSuccess` | Datos importados correctamente | Data imported successfully |
| `importErrorInvalidJson` | El archivo no es un JSON válido | File is not valid JSON |
| `importErrorInvalidShape` | El archivo no tiene el formato esperado | File does not have the expected format |
| `importPreviewTitle` | Importar desde archivo | Import from file |
| `importConfirm` | Confirmar importación | Confirm import |
| `importOverwriteWarning` | Esto reemplazará los datos actuales | This will replace current data |
| `importCancel` | Cancelar | Cancel (reutiliza `t('cancel')`) |

#### Escenario: Claves disponibles en ambos idiomas
- GIVEN el usuario cambia el idioma entre español e inglés
- WHEN se abre el modal de import y se muestran errores
- THEN todas las cadenas visibles usan `t()` con claves fijas y muestran el texto correcto para cada idioma

---

### FR-6: Tests
Archivos: `tests/unit/import-json.test.ts` (nuevo, espejo de `tests/unit/migrate-localstorage.test.ts`)

Cobertura mínima:
- Shape válido (formato export actual `daily-budget-export.json`) → datos insertados
- Shape válido (blob `localStorage` viejo, sin `isSetup` en budget, con derivados) → datos insertados
- JSON inválido / shape inválido → error, DB intacta
- Import en DB vacía → datos insertados, sin backup previo innecesario
- Import con DB no vacía → reemplazo tras confirmación + backup `pre-import-*` creado
- Idempotencia: doble import no duplica filas (ON CONFLICT DO NOTHING)
- Bypass del flag `daily-budget-data-migrated`: flag previa no bloquea el import
- Account type inválido → error `invalid_shape`, DB intacta

E2E (opcional): `tests/ui/import-json.spec.ts` — subir archivo → preview → confirmar → UI muestra datos importados.

#### Escenario: Suite existente sin regresión
- GIVEN la suite de tests de migración (`migrate-localstorage.test.ts`) está verde
- WHEN se refactoriza `migrateFromLocalStorage` para exponer `importFromJson`
- THEN la suite existente sigue verde (no se cambia el comportamiento de la migración automática)

---

## REQUISITOS NO FUNCIONALES

### NFR-1: Sin migración de schema (no data-model change)
**DECLARACIÓN EXPLÍCITA**: Este change **NO REQUIERE** archivo de migración descriptiva (`docs/migrations/YYYY-MM-DD-import-data-json.md`) porque:
- El import **no modifica** el modelo de datos: las tablas `accounts`, `transactions`, `budgets`, `recurring_events`, `sync_meta` quedan intactas
- Introduce una **nueva ruta de ingestión** de datos (archivo JSON → mismo mapeo canónico que la migración automática)
- Por la regla del repo (migración solo para cambios de modelo de datos), este change queda exento

### NFR-2: Consistencia de mapeo
- La DB importada pasa por el **mismo mapeo canónico** que la migración automática (slugs → UUIDs estables v5, re-mapeo `account → account_id`, budgets singleton).
- El estado derivado del archivo (`dailyAllowance`, `remainingToday`, `progress`, `lastCheckedDay`) **nunca** se importa como autoridad: se recalcula on-demand desde `budgets` + `transactions` vía `lib/cashflow.ts`.
- El saldo de cuenta se deriva de `SUM(transactions.amount)`, no del campo `balance` del archivo. Si el archivo solo trae saldos sin historial, el saldo derivado queda en `0` (no se genera ninguna transacción de tipo `adjustment`; el campo `balance` del archivo nunca se importa como autoridad).

### NFR-3: Seguridad e integridad
- El archivo es texto procesado solo client-side: el parseo no evalúa código, no hay `eval`, no hay ejecución de contenido del archivo.
- Tamaño máximo razonable (10 MB) con abort y feedback si se excede.
- La transacción de inserción es atómica (`BEGIN`/`COMMIT`/`ROLLBACK`): un fallo a mitad no deja datos parciales.

### NFR-4: Testeabilidad y no-regresión
- Suite existente intacta: `pnpm test` + `pnpm tsc --noEmit` (pre-commit).
- La refactorización de `migrateFromLocalStorage` no cambia el comportamiento de la migración automática (los tests existentes de `migrate-localstorage.test.ts` siguen en verde).

---

## FUERA DE ALCANCE

| Ítem | Razón | Trabajo futuro |
|------|-------|----------------|
| Import de snapshot binario (.db export / Uint8Array) | El flujo QR/claims ya cubre sync de snapshots; este change es específicamente para el JSON del export | No se requiere |
| Merge inteligente JSON ↔ datos existentes | `mergeDatabases` opera sobre snapshots sql.js, no sobre el shape JSON | Evaluación futura |
| Drag & drop del archivo | Nice to have; el file picker cubre la user story | Evaluación futura |
| Import desde CSV | Formato distinto, requiere mapeo de columnas | PRD futuro si se solicita |

---

## Tabla de Cobertura (Delta)

| Requisito | Happy path | Edge cases | Error states |
|-----------|-----------|------------|--------------|
| FR-1 Botón import | ✅ file picker abre | ✅ límite 10 MB | — |
| FR-2 Validación shape | ✅ export actual; ✅ blob viejo | ✅ blob sin isSetup | ✅ JSON inválido; ✅ shape binario/sync_meta; ✅ type inválido |
| FR-3 Preview + confirm | ✅ DB vacía sin warning | — | ✅ DB con datos → warning + confirm; ✅ cancelar |
| FR-4 Aplicación import | ✅ DB vacía → insert; ✅ reemplazo con backup | ✅ idempotencia ON CONFLICT; ✅ bypass flag | ✅ error pre-validate, DB intacta; ✅ error mid-transaction → rollback |
| FR-5 i18n | ✅ claves fijas es/en | — | — |
| FR-6 Tests | ✅ suite espejo + existing green | ✅ idempotencia; ✅ bypass flag | ✅ shape inválido |
| NFR-1 Sin migración | ✅ declaración explícita | — | — |
| NFR-2 Consistencia mapeo | ✅ mismo mapeo que migración auto | — | — |
| NFR-3 Seguridad | ✅ client-side, 10MB, atómico | — | — |
| NFR-4 No-regresión | ✅ tests existentes siguen verdes | — | — |

---

## Cobertura del Spec (para `sdd-verify` futuro)

| Requisito | Estado Esperado | Tests Clave | Notas |
|-----------|----------------|-------------|-------|
| FR-1 Botón import | ✅ COVERED | E2E o manual (file picker) | UI junto a export |
| FR-2 Validación shape | ✅ COVERED | `import-json.test.ts` | 6 escenarios de validación |
| FR-3 Preview + confirm | ✅ COVERED | `import-json.test.ts` + E2E opcional | Modal con warning DB con datos |
| FR-4 Aplicación import | ✅ COVERED | `import-json.test.ts` | 5 escenarios: vacía, reemplazo, inválido, idempotencia, bypass |
| FR-5 i18n | ✅ COVERED | `language-context.test.tsx` (keys exist) | Claves fijas junto a exportData |
| FR-6 Tests | ✅ COVERED | Propio (suite espejo) | mantiene tests existentes verdes |
| NFR-1 Sin migración | ✅ COVERED | Declaración en spec + ausencia migration file | Regla repo satisfecha |
| NFR-2 Consistencia mapeo | ✅ COVERED | `import-json.test.ts` (mismo mapeo que migración) | UUIDs v5; balance = SUM, sin adjustment |
| NFR-3 Seguridad | ✅ COVERED | Structural: client-side, 10MB, atomic | — |
| NFR-4 No-regresión | ✅ COVERED | `pnpm test` + `pnpm tsc --noEmit` verdes | Tests existentes intactos |

---

*Documento generado como parte del flujo SDD para el change `import-data-json`. Delta spec complementaria a `sqlite-local` (archivado 2026-08-31) y `offline-first-ui` (v2).*
