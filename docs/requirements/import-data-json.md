# PRD: Importar data.json (recuperación de datos localStorage → DB local)

## 1. Resumen Ejecutivo

### 1.1 Propósito
Agregar un flujo de **importación manual de datos** para usuarios que actualizaron al
release SQL/local-first con datos previos en `localStorage` exportados como JSON.
El usuario selecciona su archivo `data.json` desde el mismo menú donde existe la
opción **Exportar datos**, la app valida el archivo, muestra un preview, y persiste
los datos en la base local (sql.js + IndexedDB) reutilizando la lógica de mapeo de
`lib/migrate-localstorage.ts`.

### 1.2 Change ID
`import-data-json`

### 1.3 Estado
**Propuesto.** Sin implementar. Complementa el pivote `sqlite-local` (archivado) y el
change `offline-first-ui` (v2). La migración automática de `sqlite-local` solo cubre
el caso **localStorage presente en el mismo browser**; este change cubre el caso de un
**archivo JSON exportado manualmente** (desde otro browser, otra máquina, o tras
haber limpiado el localStorage), que hoy no tiene vía de recuperación.

---

## 2. Planteamiento del Problema

### 2.1 Contexto
- Antes del pivote a SQL, la app almacenaba un **único blob JSON** en
  `localStorage['daily-budget-data']` (ver `docs/migrations/2026-08-31-sqlite-local.md` §Schema previo).
- El pivote `sqlite-local` introdujo `lib/migrate-localstorage.ts`, que migra ese blob
  **solo si todavía está en `localStorage` del browser actual** y la tabla `accounts`
  está vacía. Guars: (1) no hay blob → skip, (2) `accounts` con filas → skip, (3)
  flag `daily-budget-data-migrated='true'` → skip.
- Un usuario que **exportó su información como `.json` antes del cambio** (desde la
  opción de export del release anterior, o copiando la clave del localStorage) no tiene
  hoy ninguna forma de recuperarla: la migración automática no lee archivos, y el
  JSON que tiene en disco no se puede inyectar en la DB local.

### 2.2 Pain Points
1. **Sin vía de recuperación desde archivo**: el único import existente es el automático
   desde `localStorage` del mismo browser. Si el usuario exportó a `.json` y luego
   actualizó (o cambió de browser/máquina), sus datos quedan huérfanos en el disco.
2. **Asimetría Export/Import**: la UI tiene "Exportar datos" pero no "Importar datos".
   Un export sin import es un vault sin llave.
3. **Fricción post-update**: el usuario se encuentra con una app vacía aunque tiene sus
   datos a dos clicks de distancia.

### 2.3 Oportunidad
El formato del export actual (`daily-budget-export.json`, generado en
`components/config-form.tsx`) y el blob de `localStorage` comparten **el mismo shape**
(`LocalStorageData`: `budget`, `accounts`, `transactions` + derivados). Esto significa
que la lógica de mapeo existente (`migrateFromLocalStorage`) es **reutilizable casi
directa** para el import: el cambio es mayormente UI (file picker + preview + confirm)
y ajustes de guard (bypass del flag, manejo de DB no vacía).

---

## 3. Historias de Usuario

### US-1: Importar el archivo exportado
**Como** usuario que actualizó a la versión SQL con datos previos exportados como `data.json`
**Quiero** poder seleccionar ese archivo desde el menú de configuración (donde está "Exportar datos")
**Para que** mis cuentas, movimientos y presupuesto se recuperen en la base local

**Criterios de aceptación:**
- [ ] En el mismo contenedor del botón "Exportar datos" (`config-form.tsx`) existe un botón "Importar datos".
- [ ] Al hacer click se abre un selector de archivo (`accept="application/json,.json"`).
- [ ] El archivo se valida; si el shape no corresponde, se muestra un error claro y **no** se toca la DB.
- [ ] Antes de aplicar se muestra un **preview** (nº de cuentas, nº de transacciones, modo del presupuesto, fechas) para confirmar.
- [ ] Al confirmar, los datos se persisten en la DB local (sql.js → IndexedDB) y la UI se refresca mostrando los datos importados.

### US-2: Import sin perder datos existentes
**Como** usuario que ya tiene datos en la app (DB no vacía) y quiere importar un backup
**Quiero** que la app me avise antes de sobrescribir y haga un backup automático
**Para que** no pierda lo que ya tengo si el archivo no es lo que esperaba

**Criterios de aceptación:**
- [ ] Si `accounts` ya tiene filas, el preview muestra una advertencia clara de que el import **reemplazará** los datos actuales.
- [ ] La confirmación es explícita (checkbox o diálogo de confirmación), no un simple click.
- [ ] Antes de reemplazar, se guarda un snapshot del estado actual en backups (patrón `saveBackup` de `applyQrImport`).
- [ ] Al importar, el estado derivado (saldos, allowance, progreso) vuelve a calcularse desde los datos importados — nunca se importa el estado derivado del archivo como autoridad.

### US-3: Re-import es seguro (idempotencia)
**Como** usuario que importó el mismo archivo dos veces
**Quiero** que el segundo import no duplique transacciones ni cuentas
**Para que** no genere ruido si le doy click dos veces o reutilizo el mismo archivo

**Criterios de aceptación:**
- [ ] El mapeo de cuentas es determinista (UUIDs estables: v5 por type para `daily`/`savings`/`investment`, v5 por type+name para custom).
- [ ] La inserción usa `ON CONFLICT(id) DO NOTHING` en una transacción atómica (reusa la lógica de `migrateFromLocalStorage`).
- [ ] Test de idempotencia: importar el mismo archivo dos veces no cambia el total de filas.

---

## 4. Requerimientos Funcionales

### FR-1: Botón "Importar datos" en el menú de configuración
Archivo: `components/config-form.tsx`

- Junto al botón existente "Exportar datos" (`t('exportData')`), agregar un botón
  "Importar datos" (`t('importData')`) con el mismo estilo (`variant="secondary"`).
- Al hacer click, invoca un `<input type="file" accept="application/json,.json">`
  oculto (o un `FilePicker` nativo del browser).
- El input acepta solo `.json` / `application/json`.
- El botón se deshabilita mientras el import está en curso (busy state).

### FR-2: Lectura y validación del archivo
Archivo: `lib/import-json.ts` (nuevo)

- Lee el contenido del archivo como texto (`file.text()`).
- Parsea JSON en `try/catch`: si falla → error `invalid_json` (toast destructivo, sin tocar DB).
- Valida el shape con un guard tipo-type:
  - `parsed.budget` es objeto con `startAmount: number`
  - `parsed.accounts` es array no vacío de `{ id, name, type, icon?, hidden?, balance? }`
    — `type` debe estar dentro del CHECK actual del schema (`daily`, `savings`,
    `investment`, `custom`, `expense`) para **fallar temprano con error claro** en
    lugar de un SQL error a mitad de la transacción.
  - `parsed.transactions` es array de `{ id?, type, amount, description?, account, date? }`
  - Cualquier otra forma (incl. un snapshot binario `Uint8Array`, o el JSON de `sync_meta`)
    → error `invalid_shape`.
- Retorna un resumen para el preview: `{ accounts: n, transactions: n, mode, startDate?, endDate? }`.

### FR-3: Preview + confirmación
Archivo: `components/import-json-modal.tsx` (nuevo) o diálogo inline en `config-form.tsx`

- Antes de aplicar, muestra:
  - Origen del archivo (`data.json` / nombre real del archivo).
  - `N` cuentas, `M` transacciones, modo del presupuesto (`daily`/`track`), rango de fechas de transacciones si aplica.
  - Si la DB ya tiene datos: **advertencia de reemplazo** (US-2) + confirmación explícita.
- Botón "Importar" (disabled hasta confirmación si hay warning) y "Cancelar".

### FR-4: Aplicación del import
Archivo: `lib/import-json.ts` (nuevo) + reuso de `lib/migrate-localstorage.ts`

1. Tomar el snapshot actual como backup: `exportDb(await getDb())` → `saveBackup(bytes, 'pre-import-<ts>')` (best-effort, patrón `applyQrImport`).
2. Si la DB tiene filas y el usuario confirmó el reemplazo, ejecutar `clearData()` (semántica del Server Action `clearData` de `lib/db/repository.ts`) antes de importar.
3. Invocar el núcleo de mapeo con el contenido del archivo:
   - Refactorizar `migrateFromLocalStorage` para exponer una variante `importFromJson(storedData: string)` que **bypasee el guard 3** (flag `daily-budget-data-migrated`) — el import es una acción explícita del usuario, no la migración automática.
   - Mantener guard 2 (DB vacía): en el flujo de import, si queda DB con filas tras el paso 2, es un bug → lanzar error en vez de skip silencioso.
4. Persistir: `saveToIndexedDB(db)`.
5. Refrescar la UI: llamar `refresh()` del hook (`hooks/use-budget.tsx`, `loadState`) para que la vista se regenere desde la DB importada.
6. Toast de éxito `t('importSuccess')` con resumen (`N cuentas, M movimientos`). Marcar la flag `daily-budget-data-migrated` para que la migración automática no intente sobre-escribir después.

### FR-5: i18n
Archivo: `contexts/language-context.tsx`

Claves nuevas (es/en), junto a `exportData`:
- `importData` — "Importar datos" / "Import Data"
- `importSuccess` — "Datos importados correctamente" / "Data imported successfully"
- `importErrorInvalidJson` — "El archivo no es un JSON válido" / "File is not valid JSON"
- `importErrorInvalidShape` — "El archivo no tiene el formato esperado" / "File does not have the expected format"
- `importPreviewTitle` — "Importar desde archivo" / "Import from file"
- `importConfirm` — "Confirmar importación" / "Confirm import"
- `importOverwriteWarning` — "Esto reemplazará los datos actuales" / "This will replace current data"
- `importCancel` — reusa `t('cancel')` / `t('cancel')`

### FR-6: Tests
- Unit: `tests/unit/import-json.test.ts` (nuevo, espejo de `tests/unit/migrate-localstorage.test.ts`)
  - Shape válido (formato export actual `daily-budget-export.json`)
  - Shape válido (blob `localStorage` viejo, sin `isSetup` en budget, con derivados)
  - JSON inválido / shape inválido → error, DB intacta
  - Import en DB vacía → datos insertados
  - Import con DB no vacía → reemplazo tras confirmación + backup creado
  - Idempotencia: doble import no duplica filas
  - Bypass del flag `daily-budget-data-migrated`
- E2E (opcional): `tests/ui/import-json.spec.ts` — subir archivo → preview → confirmar → UI muestra datos importados.

---

## 5. Requerimientos No Funcionales

### NFR-1: Sin dependencia de red
- El import es 100% local: file picker + sql.js + IndexedDB. Sin endpoints, sin auth,
  sin llamadas externas (consistente con `sqlite-local` NFR-1).

### NFR-2: Consistencia
- La DB importada pasa por el **mismo mapeo canónico** que la migración automática
  (slugs → UUIDs estables, re-mapeo `account → account_id`, budgets singleton).
- El estado derivado del archivo (`dailyAllowance`, `remainingToday`, `progress`,
  `lastCheckedDay`) **nunca** se importa como autoridad (D3 de `sqlite-local`): se
  recalcula on-demand desde `budgets` + `transactions` vía `lib/cashflow.ts`.
- El saldo de cuenta se deriva de `SUM(transactions.amount)`, no del campo `balance`
  del archivo (D4 de `sqlite-local`). Si el archivo solo trae saldos sin historial,
  se genera una transacción de tipo `adjustment` (misma estrategia que la migración).

### NFR-3: Seguridad e integridad
- El archivo es texto procesado solo server-free / client-side: el parseo no evalúa
  código, no hay `eval`, no hay ejecución de contenido del archivo.
- Tamaño máximo razonable (ej. 10 MB) con abort y feedback si se excede.
- La transacción de inserción es atómica (`BEGIN`/`COMMIT`/`ROLLBACK`): un fallo a
  mitad no deja datos parciales.

### NFR-4: Testeabilidad y no-regresión
- Suite existente intacta: `pnpm test` + `pnpm tsc --noEmit` (pre-commit).
- La refactorización de `migrateFromLocalStorage` no cambia el comportamiento de la
  migración automática (los tests existentes de `migrate-localstorage.test.ts` siguen
  en verde).

---

## 6. Restricciones de Diseño Técnico

### 6.1 Stack
- React 19 + Next.js 16 (=13.2.1) App Router, TypeScript 5, pnpm.
- `sql.js` (WASM) client-side — `lib/db/client.ts` — con persistencia a IndexedDB
  (`lib/db/persistence.ts`).
- `lib/migrate-localstorage.ts` existente como núcleo de mapeo.
- `lib/db/repository.ts` `clearData` para reemplazo.
- `hooks/use-budget.tsx` `refresh()` para recarga post-import.

### 6.2 Estructura de archivos propuesta
```
lib/
  import-json.ts                    // NUEVO: lectura + validación + orchestrador de import
  migrate-localstorage.ts           // MODIFICADO: exponer importFromJson bypass guard 3
components/
  config-form.tsx                   // MODIFICADO: botón "Importar datos" + file input
  import-json-modal.tsx             // NUEVO: preview + confirmación (warning si DB con datos)
contexts/
  language-context.tsx              // MODIFICADO: claves i18n (es/en)
tests/
  unit/import-json.test.ts          // NUEVO (espejo migrate-localstorage.test.ts)
  ui/import-json.spec.ts            // NUEVO (E2E, opcional)
```

### 6.3 Decisiones de diseño

| # | Decisión | Opción elegida | Alternativa | Rationale |
|---|----------|----------------|-------------|-----------|
| D1 | Núcleo de mapeo | **Reutilizar `migrateFromLocalStorage`** (refactor mínima `importFromJson`) | Escribir mapeo nuevo | El shape `LocalStorageData` es idéntico entre blob viejo y export actual; duplicar mapeo = riesgo de divergencia. El mapeo ya está testeado (`migrate-localstorage.test.ts`) |
| D2 | DB no vacía | **Reemplazo con confirmación explícita + backup pre-import** | Skip silencioso (comportamiento actual del guard) / merge | Skip silencioso frustra a quien quiere restaurar; merge no existe para este formato y el sync merge ya cubre claims. Reemplazo con backup y confirmación es lo más seguro y simple |
| D3 | Flag `daily-budget-data-migrated` | **Bypass en el flujo de import** (el usuario importa explícitamente) | Respetar el flag | Si el usuario ya migró antes (flag en localStorage) pero luego quiere importar un JSON exportado, el guard 3 bloquearía su acción explícita — incoherente |
| D4 | Ubicación UI | **Junto a "Exportar datos" en `config-form.tsx`** | Menú separado / settings de sync | La user story pide explícitamente el mismo menú del export; es el lugar donde el usuario ya busca acciones de datos |
| D5 | UX de confirmación | **Preview + confirmación previa a tocar la DB** (patrón import QR) | Import directo | Evita imports accidentales; muestra lo que se va a hacer antes de mutar IndexedDB; mejora progresiva barata |
| D6 | Determinismo de IDs | **uuidv5 por type / por type+name** (mismo esquema de migración) | Reutilizar IDs del archivo como PK | Un archivo exportado de la versión actual trae UUIDs; re-mapearlos por v5(type+name) es determinista y evita colisiones con IDs foráneos inconsistentes; idempotente |

### 6.4 Flujo de datos
```
config-form.tsx (click Importar)
  └─► input[type=file] → file.text()
      └─► lib/import-json.ts: parse + validate shape → preview {accounts, transactions, mode}
          └─► Modal preview → [warning si DB con datos] → confirm
              └─► backup best-effort (saveBackup) → [clearData si reemplazo]
                  └─► importFromJson(...) — transacción atómica, ON CONFLICT DO NOTHING
                      └─► saveToIndexedDB(db) → refresh() del hook → toast éxito
```

---

## 7. Fuera de Alcance

| Ítem | Razón | Trabajo futuro |
|------|-------|----------------|
| Import de snapshot binario (.db export / Uint8Array) | El flujo QR/claims ya cubre sync de snapshots; este change es específicamente para el JSON del export | No se requiere |
| Merge inteligente de JSON importado contra datos existentes | El merge (`mergeDatabases`) opera sobre snapshots de sql.js, no sobre el shape JSON; un merge JSON↔SQLite es ambicioso y fuera del caso de uso (restaurar backup) | Evaluación futura |
| Drag & drop del archivo | Nice to have de UX; el file picker cubre la user story | Evaluación futura |
| Import desde CSV | Formato distinto, requiere mapeo de columnas | PRD futuro si se solicita |
| Multi-archivo / batch import | Un único `data.json` por operación | No se requiere |

---

## 8. Resumen de Criterios de Aceptación

### Must Have
- [ ] Botón "Importar datos" junto a "Exportar datos" en `config-form.tsx`.
- [ ] File picker con `accept="application/json,.json"`.
- [ ] Validación de shape; error claro sin tocar DB si el archivo es inválido.
- [ ] Preview (cuentas/transacciones/modo/fechas) antes de aplicar.
- [ ] Advertencia + confirmación explícita si la DB ya tiene datos (reemplazo).
- [ ] Backup automático best-effort del estado actual antes de reemplazar.
- [ ] Mapeo canónico reutilizando `migrateFromLocalStorage` (UUIDs estables, re-mapeo account_id, budgets singleton).
- [ ] Estado derivado del archivo NO se importa (se recalcula).
- [ ] Persistencia a IndexedDB + `refresh()` del hook post-import.
- [ ] i18n es/en de las claves nuevas.
- [ ] Flag `daily-budget-data-migrated` marcado tras import (evita doble migración automática).
- [ ] `pnpm test` + `pnpm tsc --noEmit` en verde (incl. tests de migración existentes).

### Should Have
- [ ] Test unitario de idempotencia (doble import no duplica).
- [ ] Test unitario de bypass del flag.
- [ ] Test unitario de reemplazo con confirmación + backup.
- [ ] Límite de tamaño de archivo (10 MB) con feedback.

### Nice to Have
- [ ] E2E `tests/ui/import-json.spec.ts` (subir archivo → preview → confirmar → ver datos).
- [ ] Drag & drop del archivo sobre el área de import.

---

## 9. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Archivo corrupto o de shape desconocido | Media | Baja | Parse en try/catch + validación de shape estricta; error claro; jamás tocar DB antes de validar |
| Overwrite accidental de datos actuales | Media | Alta | Backup pre-import best-effort (pattern `applyQrImport`) + confirmación explícita con advertencia; el backup queda listado en la UI de sync para restaurar |
| Break de la migración automática al refactorizar `migrateFromLocalStorage` | Media | Alta | Refactor mínima (extraer `importFromJson`); guard 2/3 intactos para el flujo automático; tests existentes de `migrate-localstorage.test.ts` como red |
| Import duplicado (doble click / re-import) | Media | Baja | `ON CONFLICT(id) DO NOTHING` en transacción; botón disabled en busy; determinismo de IDs v5 |
| Archivo gigante congela la UI | Baja | Media | Límite de 10 MB + feedback; el parseo es síncrono pero acotado por el límite |
| Usuario importa un JSON exportado de la **versión actual** (IDs UUID) y la DB ya tiene esos mismos datos | Media | Media | El re-mapeo v5(type+name) es estable; `ON CONFLICT` evita duplicar; warning de reemplazo da contexto; backup disponible |

---

## 10. Plan de Rollback

1. Revertir `components/config-form.tsx` (quitar botón "Importar datos" y file input).
2. Eliminar `components/import-json-modal.tsx`.
3. Eliminar `lib/import-json.ts`.
4. Revertir `lib/migrate-localstorage.ts` a la versión sin `importFromJson` (migración automática intacta).
5. Revertir `contexts/language-context.tsx` (quitar claves `importData`*, conservar `exportData`).
6. Eliminar `tests/unit/import-json.test.ts` y (`tests/ui/import-json.spec.ts` si existe).
7. Correr suite completa: `pnpm test` + `pnpm tsc --noEmit` → verde (comportamiento previo intacto).
8. Los backups `pre-import-*` creados en IndexedDB son inofensivos (listados en la UI de sync, borrables manualmente).

---

## 11. Dependencias

| Dependencia | Fuente | Propósito |
|-------------|--------|-----------|
| `lib/migrate-localstorage.ts` | Repo existente | Núcleo de mapeo (refactor: `importFromJson`) |
| `lib/db/client.ts` (`getDb`, `exportDb`) | Repo existente | Acceso y snapshot de la DB sql.js |
| `lib/db/persistence.ts` (`saveToIndexedDB`, `saveBackup`) | Repo existente | Persistencia y backups |
| `lib/db/repository.ts` (`clearData`) | Repo existente | Reemplazo cuando la DB tiene datos |
| `hooks/use-budget.tsx` (`refresh`) | Repo existente | Recarga de la UI post-import |
| `components/config-form.tsx` | Repo existente | Ubicación del botón de import |
| `contexts/language-context.tsx` | Repo existente | i18n es/en |
| `tests/unit/migrate-localstorage.test.ts` | Repo existente | Espejo para los tests de import |
| Convención `docs/migrations/*.md` | Regla interna del repo | Ver §Migración |

---

## 12. Métricas de Éxito

| Métrica | Objetivo | Medición |
|---------|----------|----------|
| Recuperación de datos | Usuario recupera cuentas + transacciones + presupuesto desde `data.json` | Test manual + E2E: import → UI muestra los datos |
| No-regresión | 100% pass | `pnpm test` + `pnpm tsc --noEmit` |
| Idempotencia | Doble import no duplica filas | Test unitario `import-json.test.ts` |
| Seguridad del reemplazo | Cero pérdidas sin confirmar | Backup `pre-import-*` creado y confirmación explícita en todo import sobre DB con datos |
| Consistencia de mapeo | Mismo resultado que la migración automática para el mismo input | Test espejo: mismo fixture → mismas filas en ambas rutas |

---

## 13. Fases de Implementación

| Fase | Entregables | Esfuerzo est. |
|------|-------------|---------------|
| **1. Núcleo de import** | `lib/import-json.ts` (parse + validación + orchestrador); refactor `importFromJson` en `migrate-localstorage.ts`; tests unitarios | 1 día |
| **2. UI** | Botón en `config-form.tsx` + `import-json-modal.tsx` (preview, warning, confirm); i18n es/en | 0.5 días |
| **3. Persistencia + refresh** | Backup pre-import, `clearData` si reemplazo, `saveToIndexedDB`, `refresh()` post-import, flag migrado | 0.5 días |
| **4. Tests + Verificación** | Tests de idempotencia/bypass/reemplazo; E2E opcional; suite completa | 0.5 días |

**Total estimado: ~2.5 días**

---

## 14. Documentos Relacionados

- **PRD del pivote**: `docs/requirements/sqlite-local.md` — origen de D3/D4 (estado derivado y saldo no se importan)
- **Migración descriptiva**: `docs/migrations/2026-08-31-sqlite-local.md` — schema previo (localStorage) y schema nuevo (SQLite)
- **Offline-first (v2)**: `docs/requirements/offline-first-ui.md` — arquitectura sql.js + IndexedDB actual
- **Export/import por QR**: `docs/requirements/qr-sync-export.md` — patrón de preview/confirm y backup pre-import (a imitar)
- **Núcleo reutilizable**: `lib/migrate-localstorage.ts`, `tests/unit/migrate-localstorage.test.ts`
- **Export actual**: `components/config-form.tsx` (§ líneas 109–159)

---

## 15. Migración (modelo de datos)

**NO APLICA — sin cambio de schema.**

El import **no modifica** el modelo de datos: las tablas `accounts`, `transactions`,
`budgets`, `recurring_events`, `sync_meta` quedan intactas. El change introduce una
**nueva ruta de ingestión** de datos (archivo JSON → mismo mapeo canónico que la
migración automática). Por la regla del repo (`docs/migrations/YYYY-MM-DD-<change>.md`
solo para cambios de modelo de datos), este change **no requiere archivo de migración
descriptiva**. La regla queda satisfecha por esta declaración explícita en la propuesta.

---

## 16. Aprobación

| Rol | Nombre | Estado | Fecha |
|-----|--------|--------|-------|
| Product Owner | — | Pendiente | — |
| Tech Lead | — | Pendiente | — |
| QA Lead | — | Pendiente | — |

---

*Documento generado como parte del flujo SDD para el change `import-data-json`.*