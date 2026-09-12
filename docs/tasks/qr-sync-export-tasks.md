# Tasks: QR Sync Export/Import
**Change ID**: `qr-sync-export` | **Fuente**: `docs/requirements/spec-qr-sync-export.md` + `docs/design/qr-sync-export.md`

## Phase 1: Dependencias y fundaciones (blob-relay)
- [ ] 1.1 `pnpm add qrcode html5-qrcode && pnpm add -D @types/qrcode` (D10)
- [ ] 1.2 `lib/blob-relay.ts`: importar `list, del` de `@vercel/blob`; exportar `CLAIM_PREFIX`, `claimPath(token)`, `requireClaimToken(token)` (regex UUID v4)
- [ ] 1.3 `lib/blob-relay.ts`: `putClaim(meta,token)` (put allowOverwrite, access public, addRandomSuffix false) y `getClaim(token)` (getOrNull + type guard `ClaimMeta {syncCode,hash,createdAt,expiresAt,status:'open'|'consumed'}`)
- [ ] 1.4 `lib/blob-relay.ts`: `markClaimConsumed` (lee→marca→put), `deleteClaim` (del), `sweepClaims(now)` (list prefijo → purga consumed/expired, best-effort por item)

## Phase 2: Rutas servidor
- [ ] 2.1 `app/api/sync/claim/route.ts` (POST, runtime nodejs, force-dynamic): checkSyncAuth→401; getSnapshotMeta null→404 `snapshot_not_found`; sweepClaims; randomUUID + putClaim; 200 `{token,syncCode,hash,expiresAt}`; error blob→500 `claim_issue_failed`
- [ ] 2.2 `app/api/sync/claim/[token]/route.ts` GET (ctx.params: Promise): requireClaimToken→404 `claim_not_found`; getClaim→404 clasificado `claim_not_found`/`claim_expired`/`claim_consumed`; markClaimConsumed (D4); getSnapshotBytes null→404 `snapshot_not_found`; 200 `{bytes b64, hash, updatedAt, syncCode}` (sin SYNC_TOKEN)
- [ ] 2.3 `app/api/sync/claim/[token]/route.ts` DELETE: requireClaimToken→404; deleteClaim idempotente; 204 (invalidación temprana FR-3)

## Phase 3: Librería cliente + i18n
- [ ] 3.1 `lib/sync-client.ts`: exportar `ClaimIssueResult`, `ClaimFetchError`, `ClaimFetchResult`, `buildClaimUrl(origin,syncCode,token)` (+ encodeURIComponent defensivo)
- [ ] 3.2 `lib/sync-client.ts`: `createClaim(conf)` → POST /api/sync/claim con authHeaders (401→SyncAuthError); `fetchClaim(token)` → GET sin headers, mapea 404 a `ClaimFetchError`, base64ToBytes
- [ ] 3.3 `lib/sync-client.ts`: `applyClaimImport(data,{replaceCode})` → initDb(bytes) → backup `pre-claim-*` → mergeDatabases pura (sin cambios) → setDb + persistencia + markSynced → auto-fill syncCode (ausente/no-op/reemplazo controlado)
- [ ] 3.4 `lib/sync-client.ts`: `importFromClaim(token,opts)` convenience (fetchClaim + applyClaimImport)
- [ ] 3.5 `contexts/language-context.tsx`: claves `sync.export.*`, `sync.import.*`, `sync.claim.*` es/en (tabla FR-7); sin interpolación dentro de `t()`

## Phase 4: UI
- [ ] 4.1 `components/sync/sync-qr-modal.tsx`: modo export (canvas `qrcode`, `ClaimCountdown` separado con mm:ss, token tipable, botón Done→DELETE→cierre; Escape/backdrop NO invalida)
- [ ] 4.2 `components/sync/sync-qr-modal.tsx`: modo import (tabs Cámara `html5-qrcode` + Manual SIEMPRE visible; preview fecha+hash corto → Confirmar/Cancelar; dialog replace si syncCode distinto (FR-6); banner si falta sync-token)
- [ ] 4.3 `components/sync/sync-settings.tsx`: botones "Share via QR"/"Scan QR or enter code" → abren SyncQrModal
- [ ] 4.4 `app/sync-import/page.tsx`: `useSearchParams` envuelto en `<Suspense>`; con c+claim→auto-import embebido; sin params→input manual

## Phase 5: Tests + gate
- [ ] 5.1 Ampliar mock in-memory `@vercel/blob` (harness `sync-protocol.test.ts`) con `list` y `del`
- [ ] 5.2 `tests/unit/sync-claim.test.ts`: issue 200/401 sin credenciales/401 inválidas/404 snapshot; consume 200 + replay `claim_consumed` + TTL `claim_expired` + `claim_not_found` + carrera (mock síncrono: 1×200/1×404) + path traversal; sweep en POST; DELETE temprano→404; NFR-3 (sin SYNC_TOKEN en sidecar ni response)
- [ ] 5.3 `tests/unit/sync-qr-modal.test.tsx`: `buildClaimUrl` + countdown (solo si hay harness react-testing; opcional per D11)
- [ ] 5.4 `tests/ui/sync-qr.spec.ts` (Playwright :3100, relay extendido con rutas claim*): fallback tipado obligatorio (A emite→B pega→preview→confirm→syncCode auto-fill + banner token), export countdown→Done→404 consumed, conflicto syncCode→dialog replace→confirmado
- [ ] 5.5 Gate: `pnpm test` + `pnpm tsc --noEmit` limpios; sin regresiones (`sync-protocol.test.ts`, `merge.test.ts`, `repository.test.ts`); confirmar ausencia de `docs/migrations/qr-sync-export*` (NFR-1) y rollback documentado en propuesta

---
*Checklist SDD para `qr-sync-export`. Cada tarea: 1 fichero/unidad lógica, 1 sesión.*