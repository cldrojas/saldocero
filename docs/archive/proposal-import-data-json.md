# Propuesta: import-data-json (Importar data.json — recuperación de datos localStorage → DB local)

## Intención

Agregar un flujo de **importación manual de datos** que complementa el pivote
`sqlite-local` (archivado) y el change `offline-first-ui` (v2). La migración automática
solo cubre el caso de `localStorage` presente en el **mismo browser**; este change cubre
el caso de un **archivo JSON exportado manualmente** (`daily-budget-export.json` o el
blob `daily-budget-data` de `localStorage`), que hoy no tiene vía de recuperación.

El usuario selecciona su archivo desde el **mismo contenedor** del botón "Exportar datos"
(`config-form.tsx`), la app valida el shape, muestra un **preview** (cuentas,
transacciones, modo, fechas), pide confirmación explícita si la DB ya tiene datos, y
persiste usando el **mismo mapeo canónico** que la migración automática
(`lib/migrate-localstorage.ts`).

## Alcance

### In Scope

| # | Item | Fuente |
|---|------|--------|
| FR-1 | Botón "Importar datos" junto a "Exportar datos" + `<input type=file accept="application/json,.json">` | `docs/requirements/import-data-json.md` §4 |
| FR-2 | Lectura + validación de shape estricta (JSON inválido → `invalid_json`; shape desconocido → `invalid_shape`; jamás tocar DB antes de validar) | §4 FR-2 |
| FR-3 | Preview + confirmación explícita; warning de reemplazo si `accounts` tiene filas | §4 FR-3, US-2 |
| FR-4 | Aplicación: backup pre-import best-effort (`saveBackup('pre-import-<ts>')`), `clearData()` si reemplazo, núcleo `importFromJson` (bypass guard 3), `saveToIndexedDB`, `refresh()`, flag `daily-budget-data-migrated` | §4 FR-4 |
| FR-5 | i18n es/en de claves nuevas (`importData`, `importSuccess`, `importErrorInvalidJson`, `importErrorInvalidShape`, `importPreviewTitle`, `importConfirm`, `importOverwriteWarning`) | §4 FR-5 |
| FR-6 | Tests unitarios `tests/unit/import-json.test.ts` (espejo de `migrate-localstorage.test.ts`): shape válido (export actual y blob viejo), shape inválido con DB intacta, import DB vacía, reemplazo + backup, idempotencia, bypass del flag; E2E opcional | §4 FR-6 |

### Out of Scope

| Item | Razón | Trabajo futuro |
|------|-------|----------------|
| Import de snapshot binario (.db export / Uint8Array) | El flujo QR/claims ya cubre sync de snapshots; este change es específicamente para JSON del export | No se requiere |
| Merge inteligente JSON ↔ datos existentes | `mergeDatabases` opera sobre snapshots sql.js, no sobre el shape JSON | Evaluación futura |
| Drag & drop del archivo | Nice to have; el file picker cubre la user story | Evaluación futura |
| Import desde CSV | Formato distinto, requiere mapeo de columnas | PRD futuro si se solicita |
| Multi-archivo / batch import | Un único `data.json` por operación | No se requiere |

## Approach

### Arquitectura condensada

```
config-form.tsx (click Importar datos)
  └─► input[type=file] → file.text() (límite 10 MB con feedback)
      └─► lib/import-json.ts (NUEVO): parse + validate shape → preview {accounts, transactions, mode, fechas}
          └─► components/import-json-modal.tsx (NUEVO): preview + [warning si DB con datos] + confirm explícita
              └─► backup best-effort: exportDb(await getDb()) → saveBackup(bytes, 'pre-import-<ts>')
                  └─► [clearData() si reemplazo confirmado]
                      └─► importFromJson(...) — transacción atómica BEGIN/COMMIT/ROLLBACK, ON CONFLICT(id) DO NOTHING
                          └─► saveToIndexedDB(db) → refresh() del hook → toast éxito + flag daily-budget-data-migrated
```

### Detalles clave

- **D1 — Núcleo de mapeo reutilizado**: refactor mínima de `migrateFromLocalStorage`
  (`lib/migrate-localstorage.ts`) para exponer `importFromJson(storedData: string)`.
  El shape `LocalStorageData` es idéntico entre blob viejo y export actual; duplicar el
  mapeo = riesgo de divergencia. Tests existentes de `migrate-localstorage.test.ts` como
  red de no-regresión.
- **D2 — DB no vacía = reemplazo con confirmación explícita + backup pre-import**
  (patrón `applyQrImport`). Ni skip silencioso (frustra al que quiere restaurar) ni merge
  (no existe para este formato). Backup queda listado en la UI de sync.
- **D3 — Bypass del flag `daily-budget-data-migrated`** en el flujo de import: el import
  es una acción explícita del usuario, no la migración automática. Guard 2 (DB vacía) se
  mantiene y en el flujo de import se convierte en **error si tras `clearData()` quedan
  filas** (bug → lanzar en lugar de skip silencioso). Tras el import exitoso se **marca** el
  flag para que la migración automática no intente sobre-escribir después.
- **D4 — UI junto a "Exportar datos"** en `config-form.tsx` (`t('exportData')` ~línea 158);
  botón `t('importData')` con `variant="secondary"`, disabled en busy. Export actual es la
  fuente del file picker (`accept="application/json,.json"`).
- **D5 — UX de preview + confirmación** previa a tocar la DB (patrón import QR): evita
  imports accidentales y muestra lo que se hará antes de mutar IndexedDB.
- **D6 — Determinismo de IDs**: mismo esquema que la migración — `uuidv5` por `type`
  (`daily`/`savings`/`investment`) y por `type+name` (custom), namespace fijo
  `3f8e4a12-...` en `MIGRATION_NAMESPACE`. `ON CONFLICT(id) DO NOTHING` → idempotente.
- **NFR-2 — Estado derivado nunca se importa como autoridad**: `dailyAllowance`,
  `remainingToday`, `progress`, `lastCheckedDay` y `balance` del archivo se descartan; el
  saldo se deriva de `SUM(transactions.amount)` (sin `adjustment`: si no hay movimientos, el
  saldo derivado queda en `0`), el resto se recalcula vía `lib/cashflow.ts`. Mismo contract que D3/D4 de `sqlite-local`.
- **Validación de shape estricta**: `type` de cuentas debe estar dentro del CHECK del
  schema (`daily`, `savings`, `investment`, `custom`, `expense`) para **fallar temprano**
  con error claro en lugar de SQL error a mitad de transacción.
- **No cambio de modelo de datos**: no requiere archivo `docs/migrations/*.md`.

## Áreas Afectadas

| Archivo | Cambio | Tipo |
|---------|--------|------|
| `lib/import-json.ts` | NUEVO: lectura + validación + orchestrador | Nuevo |
| `lib/migrate-localstorage.ts` | MODIFICADO: exponer `importFromJson` (bypass guard 3) | Refactor mínima |
| `components/config-form.tsx` | MODIFICADO: botón "Importar datos" + file input junto al export (~línea 159) | Modificado |
| `components/import-json-modal.tsx` | NUEVO: preview + confirmación (warning si DB con datos) | Nuevo |
| `contexts/language-context.tsx` | MODIFICADO: claves i18n es/en junto a `exportData` (en ~línea 46, es ~línea 260) | Modificado |
| `tests/unit/import-json.test.ts` | NUEVO: espejo de `migrate-localstorage.test.ts` | Nuevo |
| `tests/ui/import-json.spec.ts` | NUEVO (E2E, opcional): subir archivo → preview → confirmar → ver datos | Nuevo |

## Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| Overwrite accidental de datos actuales | Media | Alta | Backup pre-import best-effort + confirmación explícita con warning; backup listado en UI de sync |
| Break de la migración automática al refactorizar | Media | Alta | Refactor mínima (`importFromJson`); guards 2/3 intactos en flujo automático; tests `migrate-localstorage.test.ts` como red |
| Archivo de shape desconocido / corrupto | Media | Baja | Parse en try/catch + validación estricta; error claro; jamás tocar DB antes de validar |
| Import duplicado (doble click / re-import) | Media | Baja | `ON CONFLICT(id) DO NOTHING` en transacción; botón disabled en busy; IDs v5 deterministas |

## Migración

**NO APLICA — sin cambio de modelo de datos.**

El import **no modifica** el schema: `accounts`, `transactions`, `budgets`,
`recurring_events`, `sync_meta` quedan intactas. Introduce una **nueva ruta de ingestión**
(archivo JSON → mismo mapeo canónico que la migración automática). Por la convención del
repo (`docs/migrations/YYYY-MM-DD-<change>.md` solo para cambios de modelo de datos),
este change **no requiere archivo de migración descriptiva**; la regla queda satisfecha por
esta declaración explícita.

## Plan de Rollback

1. Revertir `components/config-form.tsx` (quitar botón "Importar datos" y file input).
2. Eliminar `components/import-json-modal.tsx`.
3. Eliminar `lib/import-json.ts`.
4. Revertir `lib/migrate-localstorage.ts` a la versión sin `importFromJson` (migración automática intacta).
5. Revertir `contexts/language-context.tsx` (quitar claves `importData`*, conservar `exportData`).
6. Eliminar `tests/unit/import-json.test.ts` y `tests/ui/import-json.spec.ts` si existe.
7. Correr `pnpm test` + `pnpm tsc --noEmit` → verde.
8. Los backups `pre-import-*` en IndexedDB son inofensivos (listados en UI de sync, borrables manualmente).

## Criterios de Éxito

- [ ] Botón "Importar datos" junto a "Exportar datos" en `config-form.tsx`.
- [ ] File picker con `accept="application/json,.json"`.
- [ ] Validación de shape; error claro sin tocar DB si el archivo es inválido.
- [ ] Preview (cuentas/transacciones/modo/fechas) antes de aplicar.
- [ ] Advertencia + confirmación explícita si la DB ya tiene datos (reemplazo).
- [ ] Backup automático best-effort del estado actual antes de reemplazar.
- [ ] Mapeo canónico reutilizando `migrateFromLocalStorage` (UUIDs estables, re-mapeo `account_id`, budgets singleton).
- [ ] Estado derivado del archivo NO se importa (se recalcula).
- [ ] Persistencia a IndexedDB + `refresh()` del hook post-import.
- [ ] i18n es/en de las claves nuevas.
- [ ] Flag `daily-budget-data-migrated` marcado tras import.
- [ ] `pnpm test` + `pnpm tsc --noEmit` en verde (incl. tests de migración existentes).
- [ ] (Should) Tests de idempotencia, bypass del flag y reemplazo + backup.
- [ ] (Should) Límite de tamaño de archivo (10 MB) con feedback.
- [ ] (Nice) E2E `tests/ui/import-json.spec.ts`.

---

*Propuesta generada como parte del flujo SDD para el change `import-data-json`.
Fuente de verdad: `docs/requirements/import-data-json.md` (PRD).*