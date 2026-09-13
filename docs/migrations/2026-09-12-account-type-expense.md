# Migración: account-type-expense

Fecha: 2026-09-12
Change: `account-type-expense`
PRD: sin PRD (cambio puntual de modelo descubierto durante el diagnóstico de la migración legacy)
Migración SQL: aplicada vía `lib/db/schema.sql` (server) y `lib/db/schema.ts` (cliente sql.js) — ambos espejados; solo afecta bases creadas **nuevas** (el DDL es `CREATE TABLE IF NOT EXISTS`), ver Estrategia de datos.

## Cambio de schema

Se amplía el `CHECK` de `accounts.type` para admitir un tipo de cuenta adicional: `'expense'`.

### Schema previo

```
accounts(
  id TEXT PK,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('daily','savings','investment','custom')),
  icon TEXT NOT NULL DEFAULT 'wallet',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  device_id TEXT DEFAULT NULL
)
```

### Schema nuevo

```
accounts(
  id TEXT PK,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('daily','savings','investment','custom','expense')),
  icon TEXT NOT NULL DEFAULT 'wallet',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT DEFAULT NULL,
  device_id TEXT DEFAULT NULL
)
```

Mismo cambio espejado en:
- `lib/db/schema.sql` (server better-sqlite3 + test de paridad `tests/unit/schema-sync.test.ts`)
- DDL inline en `lib/db/schema.ts` (cliente sql.js)

## Estrategia de datos

- El schema se aplica solo al **crear** una base (client: `initDb()` sin snapshot; server: `db.exec(schema.sql)` con `IF NOT EXISTS`).
- **Bases existentes**: el `CHECK` de la columna `type` no se modifica en tablas ya creadas. Para que `'expense'` sea aceptado en desarrollo:
  - client/browser: borrar IndexedDB `saldo-cero-db` (DevTools → Application → IndexedDB → Delete database) y recargar;
  - server: borrar `data/saldo-cero.db` (+ `-wal`/`-shm`) con el dev server parado.
  - En producción con datos reales habría que emitir `ALTER TABLE accounts DROP/ADD` de la constraint (SQLite reconstruye la tabla) — no aplica mientras el app es local-first sin datos productivos persistentes en esta columna.
- Datos existentes: las filas actuales cumplen el CHECK previo, por lo que siguen siendo válidas; no se requiere reescritura de datos. El tipo `'expense'` solo habilita inserciones futuras.

## Rollback

- Revertir el cambio en ambos archivos (`type` vuelve al CHECK sin `'expense'`).
- Bases nuevas creadas con el CHECK ampliado seguirán leyendo bien (SQLite no valida el CHECK en lecturas), pero cualquier INSERT con `type='expense'` en una base sin migrar fallará con `CHECK constraint failed`.
- Las filas ya insertadas con `type='expense'` tras aplicar el cambio quedarían huérfanas de la constraint: en ese caso, antes de revertir, reasignar `type` a `'custom'` (`UPDATE accounts SET type='custom' WHERE type='expense'`).
- No hay índices nuevos ni columnas nuevas: ningún otro artefacto que deshacer.

## Relación con la migración legacy

Motivo del cambio: la migración de `localStorage['daily-budget-data']` (formato legacy pre-pivote) puede contener cuentas con `type='expense'`; el `CHECK` original las rechazaba con `CHECK constraint failed`. Este cambio habilita la migración de ese formato (ver refactor client-side de `lib/migrate-localstorage.ts`).

## Archivo de ejemplo (plantilla)

```
docs/migrations/YYYY-MM-DD-<change-id>.md
├── Schema previo
├── Schema nuevo
├── Estrategia de datos
├── Rollback
└── Notas de contexto
```