# Propuesta: qr-sync-export (QR export/import por claim token)

## Intención

Complementar el sync manual multi-dispositivo (change `multi-device-blob-sync`) con un flujo **QR asistido** para intercambiar el `syncCode` + token de despliegue sin teclear. El sync actual requiere que el usuario copie/pegue un código alfanumérico y el token de despliegue (variable `SYNC_TOKEN` del servidor) en la configuración del dispositivo B. Este change introduce un **claim token de un solo uso** (15 min TTL) que Device A genera vía endpoint, Device B consume escaneando un código QR (o tipeando el token), y la respuesta del claim **auto-rellena el `syncCode`** en B. El token `SYNC_TOKEN` del despliegue **nunca viaja en el QR**; debe estar pre-configurado en B o teclearse una sola vez.

## Alcance

### In Scope

| Ítem | Descripción |
|------|-------------|
| `POST /api/sync/claim` | Emite claim token (opaco, 128-bit) y escribe sidecar `saldo-cero-claims/<token>.json` apuntando al blob namespace existente |
| `GET /api/sync/claim/<token>` | Consume claim (sin auth headers; el token es la capability), TTL 15 min, delete-on-read, devuelve `{ bytes, hash, updatedAt, syncCode }` |
| Sidecar lifecycle | Blob `saldo-cero-claims/<token>.json` con `{ syncCode, hash, createdAt, expiresAt }`; limpieza perezosa de expirados |
| QR payload | URL corta `https://<origin>/sync-import?c=<syncCode>&claim=<token>` + fallback de código tipable para E2E (Playwright) |
| Client helpers | `createClaim(conf)` e `importFromClaim(token)` en `lib/sync-client.ts` reutilizando `pullMergePush` + `mergeDatabases` intactos |
| UI Export | "Share via QR" en `components/sync/sync-settings.tsx` → modal con canvas QR (`qrcode`), countdown 15 min, botón "Done/invalidate" |
| UI Import | "Scan QR or enter code" → cámara (`html5-qrcode`) + input texto → preview ("snapshot from {date}, hash {short}") → confirm → merge → auto-fill `syncCode` |
| i18n | Claves `sync.export.*`, `sync.import.*`, `sync.claim.*` en `contexts/language-context.tsx` (es/en) |
| Deps | `qrcode` (generar) + `html5-qrcode` (escanear) en `package.json` |
| Tests unit | `tests/unit/sync-claim.test.ts` (mock blob in-memory, espejo de `sync-protocol.test.ts`) |
| Tests E2E | `tests/ui/sync-qr.spec.ts` (flujo import por fallback de tipeo; cámara opcional en CI) |

### Out of Scope

| Ítem | Razón |
|------|-------|
| WebRTC / sync offline total | Rechazado: complejidad vs. valor; sync manual + claim token cubre caso de uso móvil |
| QR como transporte de datos (bytes del snapshot en el QR) | Rechazado: capacidad insuficiente (1–2 KB típicos del snapshot superan capacidad de QR v40 ≈ 3 KB binario; fragmentación frágil) |
| Cambios de modelo de datos (SQLite) | Los claims viven en blob sidecars, no en la BD; no hay migración de schema |
| Auth distinta a la existente (`x-sync-code` + `x-sync-token`) | Claim issue usa headers actuales; claim consume es capability token sin headers |

## Approach

### Arquitectura condensada

```
Device A (export)                          Device B (import)
─────────────────────────────────────────────────────────────────────
1. User: "Share via QR"
2. POST /api/sync/claim (auth headers)
   └─► Server: randomUUID() → token
       └─► Blob put: saldo-cero-claims/<token>.json
           { syncCode, hash, createdAt, expiresAt (+15min) }
       └─► Returns: { token, syncCode, hash, expiresAt }
3. QR canvas: "https://<origin>/sync-import?c=<syncCode>&claim=<token>"
4. Countdown 15 min; "Done" → DEL sidecar (invalidación temprana)

                                                    5. User: escanea QR / tipea token
                                                    6. GET /api/sync/claim/<token> (NO auth)
                                                       └─► Server: read sidecar → TTL check
                                                           └─► getSnapshotBytes(syncCode)
                                                               └─► DEL sidecar (single-use)
                                                       └─► Returns: { bytes, hash, updatedAt, syncCode }
                                                    7. Client: importFromClaim(token)
                                                       └─► initDb(bytes) → mergeDatabases(local, remote)
                                                       └─► saveToIndexedDB + setMeta(hash, updatedAt)
                                                       └─► Auto-fill syncCode from claim response
```

### Detalles clave

- **Claim token**: `crypto.randomUUID()` (128-bit opaco). No es JWT, no lleva payload sensible.
- **Sidecar key**: `saldo-cero-claims/<token>.json` (prefijo fijo, separado de namespace `saldo-cero-<code>.db`).
- **TTL**: 15 min (`expiresAt = Date.now() + 15*60*1000`). Expirados se limpian en próximo `POST /claim` (lazy sweep) o job cron opcional (fuera de este change).
- **Single-use**: `GET /claim/<token>` hace `del(sidecar)` atómico antes de responder. Re-intento → 404.
- **SyncCode auto-fill**: La respuesta del claim incluye `syncCode`. Device B lo guarda en `localStorage` (`saldo-cero-sync-code`) si no existía. El `SYNC_TOKEN` de despliegue **no** se deriva del claim; B debe tenerlo pre-configurado (settings heredados del QR previo o tecleado una vez).
- **Merge inmutable**: `mergeDatabases(local, remote, deviceId)` (líneas 1–140 en `lib/db/merge.ts`) **no cambia**; es pura y sincrónica. `importFromClaim` la reutiliza tal cual.

## Áreas Afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `app/api/sync/claim/route.ts` | Nuevo | POST issue claim + GET consume claim (un archivo, dos handlers) |
| `lib/blob-relay.ts` | Modificado | Helpers `putClaim`, `getAndDeleteClaim`, `listExpiredClaims` (lazy sweep) |
| `lib/sync-client.ts` | Modificado | `createClaim(conf)` + `importFromClaim(token)` exportados |
| `components/sync/sync-settings.tsx` | Modificado | Botón "Share via QR" + integración modal |
| `components/sync/sync-qr-modal.tsx` | Nuevo | Wizard export (QR canvas + countdown + invalidate) + wizard import (cámara + input + preview + confirm) |
| `contexts/language-context.tsx` | Modificado | Claves i18n `sync.export.*`, `sync.import.*`, `sync.claim.*` (es/en) |
| `package.json` | Modificado | `qrcode` + `html5-qrcode` en `dependencies` |
| `tests/unit/sync-claim.test.ts` | Nuevo | Protocolo claim: issue, consume, TTL, replay, concurrencia, sidecar cleanup |
| `tests/ui/sync-qr.spec.ts` | Nuevo | E2E import por fallback tipado; cámara opcional; verifica auto-fill syncCode |

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Race condition single-use: dos dispositivos consumen el mismo token | Baja | Media | `GET /claim/<token>` hace `del` atómico (Vercel Blob `delete` antes de `get`); 404 en segundo intento; test de carrera en `sync-claim.test.ts` |
| Replay por foto del QR (usuario guarda captura) | Media | Baja | TTL 15 min + single-use → foto inútil tras consumo o expiración; UI muestra countdown y botón "Done" para invalidar temprano |
| Claims no consumidos acumulan basura en blob | Media | Baja | Lazy sweep en `POST /claim` (borra expirados antes de crear uno nuevo); job cron opcional fuera de scope |
| Cámara no disponible / permisos iOS Safari | Alta | Media | Fallback tipado **obligatorio** y probado en E2E; `html5-qrcode` degrada a input texto si `navigator.mediaDevices` ausente |
| Config B incompleta post-merge (falta `SYNC_TOKEN`) | Media | Alta | Claim response incluye `syncCode` → auto-fill; UI muestra banner "Configura tu token de despliegue en Settings" si `saldo-cero-sync-token` ausente; docs en modal import |
| Fuga de `SYNC_TOKEN` si se incluye por error en claim | N/A (decisión fija) | Crítico | **Decisión fija**: claim **nunca** lleva `SYNC_TOKEN`. Documentado en proposal + code review checklist |

## Migración

**NO APLICA — sin cambio de modelo de datos.**

Los claims viven como sidecars en Vercel Blob (`saldo-cero-claims/<token>.json`), no en SQLite. El schema de la base de datos (`accounts`, `transactions`, `recurring_events`, `budgets`, `sync_meta`) **no se toca**. Por la regla del repo (`docs/migrations/YYYY-MM-DD-<change>.md` solo para cambios de modelo de datos), este change **no requiere archivo de migración descriptiva**. La regla queda satisfecha por esta declaración explícita en la propuesta.

## Plan de Rollback

1. Eliminar `app/api/sync/claim/route.ts`
2. Revertir `lib/blob-relay.ts` a versión sin helpers de claim
3. Revertir `lib/sync-client.ts` quitando `createClaim` / `importFromClaim`
4. Eliminar `components/sync/sync-qr-modal.tsx`
5. Revertir `components/sync/sync-settings.tsx` quitando botón "Share via QR"
6. Revertir `contexts/language-context.tsx` quitando claves `sync.export.*`, `sync.import.*`, `sync.claim.*`
7. `pnpm remove qrcode html5-qrcode`
8. Eliminar `tests/unit/sync-claim.test.ts` y `tests/ui/sync-qr.spec.ts`
9. Correr suite completa: `pnpm test` + `pnpm tsc --noEmit` → verde (comportamiento previo `multi-device-blob-sync` intacto)

## Criterios de Éxito

- [ ] **First-commit convention**: planning phase (`docs/plan`) es el **primer commit** en rama fresca, tipo `docs(plan):`
- [ ] `POST /api/sync/claim` emite token 128-bit, escribe sidecar, retorna `{ token, syncCode, hash, expiresAt }`
- [ ] `GET /api/sync/claim/<token>` sin auth headers → TTL check → `getSnapshotBytes(syncCode)` → `del(sidecar)` → retorna `{ bytes, hash, updatedAt, syncCode }`
- [ ] Sidecar expira a los 15 min; lazy sweep en siguiente `POST /claim` limpia expirados
- [ ] QR payload: `https://<origin>/sync-import?c=<syncCode>&claim=<token>` — abre en cámara genérica
- [ ] Fallback tipado funcional y probado en E2E (Playwright, `:3100`)
- [ ] `createClaim(conf)` en Device A; `importFromClaim(token)` en Device B reutiliza `pullMergePush` + `mergeDatabases` sin cambios
- [ ] UI Export: modal con QR canvas (`qrcode`), countdown 15 min, botón "Done/invalidate" (DELETE sidecar anticipado)
- [ ] UI Import: cámara (`html5-qrcode`) + input texto → preview ("snapshot from {date}, hash {short}") → confirm → merge → auto-fill `syncCode`
- [ ] i18n claves `sync.export.*`, `sync.import.*`, `sync.claim.*` en es/en
- [ ] Unit tests: `tests/unit/sync-claim.test.ts` (mock blob in-memory, espejo de `sync-protocol.test.ts`)
- [ ] E2E tests: `tests/ui/sync-qr.spec.ts` (import por fallback tipado; cámara opcional en CI)
- [ ] `pnpm test` + `pnpm tsc --noEmit` → **PASS** (sin regresiones en `multi-device-blob-sync`)

---

*Documento generado como parte del flujo SDD para el change `qr-sync-export`. Complementa `multi-device-blob-sync` (archivado 2026-09-11).*