# Migración descriptiva: QR Sync Simplificación

**Change ID**: `qr-sync-simplify`
**Fecha**: 2026-09-12

---

## Schema previo

### Sidecars de claims (`saldo-cero-claims/<token>.json` — Vercel Blob, no SQLite)

```ts
type ClaimMetaV1 = {
  syncCode: string          // namespace remoto al que apunta el claim
  hash: string
  createdAt: number         // epoch ms
  expiresAt: number
  status: 'open' | 'consumed'
}
```

El claim **apuntaba** al snapshot almacenado bajo `saldo-cero-<syncCode>.db` (relay Vercel Blob). Además existía el sync LWW por código: `app/api/sync*` (GET/POST/meta/import) + `lib/sync-auth.ts` con `x-sync-code` / `x-sync-token` y el namespace `saldo-cero-<syncCode>.db` + `saldo-cero-<syncCode>.db.json` (metadata).

## Schema nuevo

### Sidecars de claims (`saldo-cero-claims/<token>.json` — Vercel Blob)

```ts
type ClaimMetaV2 = {
  payload: string           // snapshot completo, base64 (inline, autocontenido)
  hash: string              // sha256 del payload decoded
  createdAt: number         // epoch ms
  expiresAt: number
  status: 'open' | 'consumed'
}
```

- Se **elimina** `syncCode` (el claim ya no referencia ningún namespace).
- Se **añade** `payload` (los bytes del snapshot viajan inline).
- Igualdad de contrato: TTL 15 min, single-use (`status: consumed`), lazy sweep en cada `POST`, `DELETE` idempotente.

### Eliminación del modelo de sync por código

- Rutas eliminadas: `GET/POST /api/sync`, `GET /api/sync/meta`, `POST /api/sync/import`.
- `lib/sync-auth.ts`, `SyncConfig`/`syncNow`/`fetchRemoteMeta`/`getSyncCode` en `lib/sync-client.ts`, y las claves `localStorage['saldo-cero-sync-code']` / `saldo-cero-sync-token` dejan de existir.
- Los namespaces `saldo-cero-<syncCode>.db` y `saldo-cero-<syncCode>.db.json` quedan **sin productores** (solo se escriben desde el sync por código, ahora eliminado).

## Estrategia de datos

1. **Claims existentes (`ClaimMetaV1`)**: quedan **inválidos**. El type guard del schema nuevo rechaza sidecars sin `payload` (el GET devuelve 404). Además, todos los claims emitidos antes de este cambio tienen `expiresAt` pasado (TTL 15 min) → el lazy sweep en el primer `POST /api/sync/claim` los purga. **Sin backfill**: no hay traducción posible de pointer→payload sin los bytes, y no se necesitan.
2. **Sidecars `saldo-cero-claims/*` huérfanos (v1)**: purgados por el sweep lazy (best-effort por item) en la siguiente emisión. Entrega de datos: ninguna operación depende de ellos.
3. **Resto de claims**: no hay claims "vivos" legítimos en el momento del deploy — si los hubiera (emitidos < 15 min antes), quedan inalcanzables por el type guard y se purgan el siguiente sweep. Impacto: un usuario que tuviera un QR a medio usar debería regenerarlo; ventana de 15 min, baja probabilidad.
4. **Namespaces `saldo-cero-<syncCode>.db(.json)` existentes**: **residuo** (huérfanos, sin escritores ni lectores). No se borran en este change (evitar data loss si se activa rollback y por seguridad de no tocar blobs con `del` masivo). Se documentan como limpieza manual futura (p. ej. `blob list` + `del` fuera de banda) una vez confirmado que no hay rollback.
5. **SQLite local (`IndexedDB`)**: sin cambios de schema. Solo se limpian las claves de config de sync en `localStorage` que ya no se usan (`saldo-cero-sync-code`, `saldo-cero-sync-token`) — no destructivo, y opcional a nivel de migración (el código simplemente las ignora).

## Rollback

Revertir el cambio a `qr-sync-export`:
1. Restaurar `ClaimMetaV1` + `getSnapshotBytes`/`getSnapshotMeta`/rutas `/api/sync*` + `lib/sync-auth.ts` + UI de sync por código (`SyncButton`, config UI, `syncNow`/`SyncConfig` en `sync-client.ts`).
2. **Pérdida esperada**: los claims v2 no son leíbles por el code v1 (type guard) — expiran solos en ≤ 15 min; no hay datos persistentes perdidos porque el payload v2 nunca fue el store principal (el store principal era/es el `.db` por código... que en el modelo v2 no se escribía). En cualquier caso, los snapshots del usuario viven en `IndexedDB` local; el QR es solo transporte.
3. Los sidecars v2 sobrantes se purgan con el sweep de v1 (schema v1 con `status` no coincidente → best-effort), o manualmente.
4. `docs/design/qr-sync-simplify.md` y este archivo se invalidan; se reactiva `qr-sync-export`.

## Equivalencia con el change

- Ficheros: este documento es el único archivo de migración (regla del repo: migración solo para cambios de modelo de datos — aquí el modelo de datos del sidecar cambia, de ahí su presencia, a diferencia de NFR-1 de `qr-sync-export`).