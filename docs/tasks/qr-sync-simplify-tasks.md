# Tasks: QR Sync Simplificación (claim autocontenido)
**Change ID**: `qr-sync-simplify` | **Fuente**: `docs/requirements/qr-sync-simplify.md` + `docs/design/qr-sync-simplify.md` + `docs/migrations/2026-09-12-qr-sync-simplify.md`
**Orden (C3/B6)**: librería y rutas primero, UI después — evita imports rotos.

## Batch 1: blob-relay — ClaimMeta self-contained
- [x] T1.1 `lib/blob-relay.ts`: `ClaimMeta` → `{ payload, hash, createdAt, expiresAt, status }` (sin `syncCode`); `isClaimMeta` exige `payload` y rechaza sidecar legacy sin él → `getClaim` `null` → 404 (migración). Mantener `createdAt: number` (convención del código actual)
- [x] T1.2 `lib/blob-relay.ts`: eliminar relay de snapshots `SNAPSHOT_EXT`/`META_EXT`/`snapshotPath`/`metaPath`/`SnapshotMeta`/`getSnapshotMeta`/`getSnapshotBytes`/`putSnapshot` (único consumidor = rutas `/api/sync*` que se borran en T2 — verificado: `repository.ts` no los usa); conservar `putClaim/getClaim/markClaimConsumed/deleteClaim/sweepClaims/CLAIM_PREFIX/claimPath/requireClaimToken/BLOB_ACCESS/sha256Hex`

## Batch 2: Rutas servidor (rework claim + remociones)
- [x] T2.1 `app/api/sync/claim/route.ts` POST **anónimo** (sin `checkSyncAuth`): body `{ bytes }` → `base64ToBytes` (inválido/vacío → 400 `bad-request`); `bytes.length > MAX_CLAIM_PAYLOAD_BYTES` (3 MiB decoded) → 413 `claim_too_large`; `sweepClaims(now)`; `token = crypto.randomUUID()`; `putClaim({ payload, hash: sha256Hex(bytes), createdAt, expiresAt: now+900000, status:'open' })`; 200 `{ token, hash, expiresAt }`; fallo de blob → 500 `claim_issue_failed`
- [x] T2.2 `app/api/sync/claim/[token]/route.ts` GET: `requireClaimToken`→404 `claim_not_found`; `getClaim` null→404; expirado→404 `claim_expired`; consumido→404 `claim_consumed`; `markClaimConsumed` **antes** de responder; 200 `{ bytes: payload, hash, createdAt }` — sin `syncCode`, sin `updatedAt` (D9)
- [x] T2.3 `app/api/sync/claim/[token]/route.ts` DELETE: `requireClaimToken`→404; `deleteClaim` idempotente→204 (invalidación "Done"; verificar intacto)
- [x] T2.4 Eliminar: `app/api/sync/route.ts`, `app/api/sync/meta/route.ts`, `app/api/sync/import/route.ts`, `lib/sync-auth.ts` (D5)

## Batch 3: sync-client rework
- [x] T3.1 `lib/sync-client.ts`: **mantener** `bytesToBase64`/`base64ToBytes`/`sha256Hex`; **eliminar** `SyncConfig`/`RemoteMeta`/`SyncResult`/`SyncAuthError`, claves `saldo-cero-sync-code`/`-sync-token`, `getSyncConfig`/`setSyncConfig`/`getSyncCode`/`authHeaders`/`fetchRemoteMeta`/`markSynced`/`pullMergePush`/`syncNow`
- [x] T3.2 `lib/sync-client.ts`: tipos `ClaimIssueResult`/`ClaimFetchError`/`ClaimFetchResult`/`QrImportData` (B3); `buildClaimUrl(origin, token)` → `/sync-import?claim=<token>` sin `c` (D4)
- [x] T3.3 `lib/sync-client.ts`: `createClaim(bytes)` anónimo → POST `{ bytes: bytesToBase64(bytes) }`; errores `'too_large'|'bad-request'|'network'|'server'`
- [x] T3.4 `lib/sync-client.ts`: `fetchClaim(token)` → GET sin headers; mapea 404 a `'expired'|'consumed'|'not_found'`; 200 `{ bytes, hash, createdAt }`; `base64ToBytes`
- [x] T3.5 `lib/sync-client.ts`: renombrar `applyClaimImport`→`applyQrImport(data,{deviceId})` (sin `replaceCode`/auto-fill): `initDb` → backup `pre-claim-*` → `mergeDatabases` pura → `setDb`+`saveToIndexedDB`+`setMeta` (hash + createdAt); mantener convenience `importFromClaim(token,{deviceId})`

## Batch 4: UI
- [x] T4.1 `components/sync/sync-qr-modal.tsx` export: emisión anónima (`createClaim(exportDb(localDb))`); QR `buildClaimUrl(origin, token)`; countdown mm:ss → "Done" → DELETE (Escape/backdrop NO invalida); `too_large` → error amigable
- [x] T4.2 `components/sync/sync-qr-modal.tsx` import: parsea **solo** `claim` (sin `c`); preview `createdAt` formateado + 8 chars del hash (D9); **eliminar** banner `token_banner` + diálogo `replace_confirm`; merge vía `applyQrImport` + reload de página
- [x] T4.3 `components/sync/sync-settings.tsx`: quitar inputs code/token + `setSyncConfig` + sección primer push (`needsFirstPush`) + `syncNow`/`SyncResult`; mantener botones QR (abren `SyncQrModal`), backups+restaurar, meta solo lectura, `key={qrMode ?? 'closed'}`
- [x] T4.4 `app/sync-import/page.tsx`: deep link solo `?claim=<token>` (sin `c`); `importFromClaim` directo; visita sin params → modal genérico; `<Suspense>` intacto
- [x] T4.5 `app/page.tsx`: quitar `SyncButton` (líneas ~7/49); eliminar `components/sync/sync-button.tsx` (B6)

## Batch 5: i18n
- [x] T5.1 `contexts/language-context.tsx`: añadir `sync.claim.error_too_large` es/en; eliminar `sync.import.token_banner` + `sync.claim.replace_confirm`; mantener `sync.export.*`/`sync.import.*`/resto `sync.claim.*`; sin interpolación en `t()` (B5)

## Batch 6: Tests + gate
- [x] T6.1 Eliminar `tests/unit/sync-protocol.test.ts`, `tests/unit/sync-import.test.ts`, `tests/unit/sync-button.test.tsx`, `tests/ui/sync-first-push.spec.ts`, `tests/ui/sync-dual-device.spec.ts` (D5)
- [x] T6.2 Rework `tests/unit/sync-claim.test.ts`: POST anónimo 200 sidecar inline /400/413/500; GET `{bytes,hash,createdAt}` sin `syncCode`; replay→consumed; expirado; desconocido; token inválido; carrera 1×200/1×404; sweep lazy en POST; DELETE temprano→204→404; NFR-3 (sidecar+respuesta sin `sync-code`/`sync-token`)
- [x] T6.3 Rework `tests/unit/sync-client.test.ts`: helpers (roundtrip, sha256Hex); `buildClaimUrl` sin `c`; `createClaim` 413→`too_large`; `fetchClaim` mapeo 404; `applyQrImport` backup+merge+persistencia; sin config/syncNow
- [x] T6.4 Rework `tests/unit/sync-settings.test.tsx`: quitar tests de code/token + primer push; mantener backups→restaurar + apertura modal QR
- [x] T6.5 Rework `tests/ui/sync-qr.spec.ts` (stub relay :3100): POST anónimo guarda `{payload}`→GET inline; flujo tipable A exporta→B pega token→preview `createdAt`→confirm→merge→reload; "Done"→404 consumed; oversize→error amigable; deep link sin `c`
- [x] T6.6 Gate: `pnpm tsc --noEmit` + `pnpm test` + `pnpm test:ui` verdes; sin regresiones en `merge.test.ts`/`repository.test.ts`/`persistence.test.ts`/`schema-sync.test.ts`; auditar que no queden imports huérfanos de módulos eliminados

---
*Checklist SDD para `qr-sync-simplify`. Cada tarea: 1 fichero/unidad lógica, 1 sesión. Batches 1-3 antes de 4 (C3: evitar imports rotos).*