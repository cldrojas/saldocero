# ODD — Desktop UI (GitHub issue #10)

## Objetivo
Implementar la versión desktop de la UI (issue #10): shell de layout con sidebar
persistente a `lg:` (1024px+), dashboard Resumen con presupuesto + cuentas +
movimientos recientes, acciones siempre visibles y atajos de teclado, sin
regresión en los flujos mobile existentes (setup, transacciones, transferencias,
QR sync, ajustes).

## Problema / Por qué
La app es mobile-first de una sola columna: en viewport desktop (≥1024px) se ve el
mismo chrome mobile (tab bar, FAB, columna angosta) y muchísimo espacio horizontal
sin uso. Superficies que podrían verse juntas (presupuesto, cuentas, historial)
quedan ocultas detrás de tabs. Ya hay fragmentos responsive (`md:` table history,
`md:grid-cols-2` accounts), pero no hay un shell desktop que los orqueste.

## Alcance autorizado (ciclo actual)
Fases A, B, C, D, F y G del blueprint de #10, en rama nueva `feat/desktop-ui`
desde `origin/main` (PR #69 ya mergeado):
- **A — Shell**: `components/layout/app-shell.tsx` + `components/layout/sidebar-nav.tsx`.
  A `lg:`: sidebar fija (Resumen · Cuentas · Historial · Sincronizar · Ajustes) + content area.
  Debajo de `lg:`: el chrome `Tabs` actual EXACTO. El estado de superficie activa se
  levanta para que ambos shells manejen los mismos componentes de contenido.
- **B — Dashboard Resumen**: 2 columnas a `lg:` — col1 `DailyBudgetStatus`, col2
  `AccountsList` (grid) + nuevo `RecentTransactions` (últimos N movimientos,
  reutilizando helpers de datos de `TransactionHistory`).
- **C — Acciones desktop + shortcuts**: en la sidebar "Nueva transacción" y
  "Transferir" (sin FAB a `lg:`); hook `use-hotkeys`: `N` transacción, `T`
  transferencia, `1..4` navegación de secciones. Mobile no afectado.
- **D — Modales en desktop**: `DialogContent` ya es `max-w-lg`; pulir/ajustar
  anchos y centrado en desktop sin tocar mobile.
- **F — Superficies Sync + Ajustes**: en `lg:` expuestas como secciones del
  sidebar (reusar `SyncQrModal` y `ConfigForm` en el content area) sin pasar por
  la hamburguesa.
- **G — Tests, i18n, docs**: claves nuevas es/en; unit tests del shell y del hook
  de hotkeys; specs Playwright en viewport desktop (1280×800: shell renderiza,
  acciones alcanzables, sin FAB); actualizar sección de estructura de `README.md`.

### Fuera de alcance en este ciclo
- **Fase E** (historial desktop: búsqueda + filtro por cuenta + paginación) →
  siguiente ciclo. Los criterios de aceptación de #10 no la exigen (la tabla `md:`
  ya es usable en 1280×800 sin scroll horizontal).
- Wrappers nativos (Tauri/Electron), PWA, agregación bancaria (out of scope del ticket).

## Restricciones / Notas
- Cero regresión mobile: cada flujo (setup, transacciones, transferencias, QR
  sync, ajustes) sigue funcionando a ancho de teléfono.
- Reusar el design system existente (shadcn/ui, Tailwind, Radix). Sin librerías nuevas.
- SSR/hydration: seguir el patrón canónico del repo (estado inicial determinista +
  hidratación en `useEffect` post-mount; no leer localStorage en initializers).
- El estado activo hoy vive en `Navbar` como `<Tabs defaultValue="accounts">`
  NO controlado — hay que levantarlo (`activeSurface`) para que el sidebar (desktop)
  y los tabs (mobile) manejen el mismo contenido.
- `use-mobile` existente es `<768px`; el shell desktop usa `lg:` (1024px+). Para
  lógica JS (hotkeys, FAB) hace falta un guard ≥1024px (nuevo `use-desktop` o
  media query dentro del shell).
- Nombres de tabs están hardcodeados ("Cuentas"/"Historial") sin pasar por `t()` —
  limpiar de paso al levantar el estado (existen claves `accounts`/`history`).
- Deuda E2E conocida pre-existente (fuera de CI, `tests.yml` corre tsc + vitest):
  `config-form.spec.ts` 9/9 y `language-selector.spec.ts` 3/3 fallan hoy. Fase F
  probablemente arregla los de config-form de paso; NO es criterio de aceptación.
- Gates del repo: `pnpm exec vitest run` + `pnpm tsc --noEmit` + `pnpm lint`
  (+ `next build` como smoke opcional).

## Delivery (decidido 2026-09-19)
Strategy: `feature-branch-chain`. Tracker: `feat/desktop-ui` (desde `origin/main`,
acumula la integración; solo la tracker mergea a main). Cada PR apunta a la rama
del PR anterior para diffs de review enfocados. Pendiente: crear los PRs al cierre
de cada slice (decisión del usuario bajo política ordinaria del repo).

Cortes planificados:
- PR1 — T1 shell → base: tracker `feat/desktop-ui`; rama `feat/desktop-ui-shell`.
- PR2 — T2 dashboard + T4 modales → base: rama PR1; rama `feat/desktop-ui-dashboard`.
- PR3 — T3 acciones + hotkeys → base: rama PR2; rama `feat/desktop-ui-actions`.
- PR4 — T5 sync/ajustes → base: rama PR3; rama `feat/desktop-ui-sync`.
- PR5 — T6 i18n + tests + docs → base: rama PR4; rama `feat/desktop-ui-tests`.

Nota i18n: las claves nuevas se agregan en el slice que las usa (distribuidas);
T6 cubre resto de copy desktop + tests + README.

## Tareas (work-unit commits en los branches de slice)
- [x] T1 — Shell de layout (Fase A): `app-shell.tsx` + `sidebar-nav.tsx`; levantar
  `activeSurface`; `lg:` sidebar fijo + content; `<lg:` Tabs actuales iguales
  (controlados por el mismo estado); limpiar nombres hardcodeados → claves i18n.
- [x] T2 — Dashboard Resumen (Fase B): grid 2 columnas a `lg:` con
  `DailyBudgetStatus` + `AccountsList` + `RecentTransactions` (helper de formato de
  fecha compartido extraído de `transaction-history.tsx`).
- [x] T3 — Acciones + hotkeys (Fase C): acciones "Nueva transacción"/"Transferir"
  en sidebar; FAB oculto a `lg:`; `hooks/use-hotkeys.ts` (`n` `t` `1..5` — el
  blueprint decía `1..4`, hay 5 secciones) con guard
  de viewport y tooltips/aria para descubrimiento.
- [x] T4 — Modales en desktop (Fase D): verificado sin cambio 2026-09-19 —
  `DialogContent`/`AlertDialogContent` ya son `w-full max-w-lg` centrados y
  `max-w-lg` en desktop cumple el criterio; mobile intacto.
- [x] T5 — Sync + Ajustes en sidebar (Fase F): secciones que renderizan
  `ConfigForm` (ajustes) y `SyncPanel` (sync, extraído de `SyncQrModal`) en el
  content area a `lg:`, sin hamburguesa; mobile intacto.
- [x] T6 — i18n + tests + docs (Fase G): claves es/en (sidebar, copy desktop);
  unit tests `app-shell` + `use-hotkeys`; specs Playwright 1280×800 (shell,
  acciones, sin FAB); README estructura.

## Criterios de aceptación (de #10)
- [x] A ≥1024px la sidebar + overview muestran presupuesto, cuentas y movimientos
  recientes sin abrir tabs. (sonda a 1280 + `desktop-shell.spec.ts`)
- [x] Sin FAB a `lg:`; "Nueva transacción" y "Transferir" siempre visibles en la sidebar.
- [ ] Tabla de historial usable en 1280×800 sin scroll horizontal. **NO verificado**:
  requiere medir `scrollWidth` de la tabla a 1280×800 (no hay asserts de eso todavía).
- [ ] Todos los flujos mobile intactos por debajo de 1024px. **Parcial**: verificado
  que el chrome mobile aparece a 390×844 y desaparece a 1280; los flujos mobile
  completos no están cubiertos porque la suite E2E está rota desde antes (ver
  hallazgo 3 del slice 5).
- [x] Atajos de teclado funcionan y son descubribles (tooltip/aria).
- [x] Claves i18n nuevas presentes en `es` y `en`.
- [ ] Specs Playwright desktop nuevos pasan (`5/5` ✓); specs mobile existentes siguen
  verdes: **no**, están en rojo desde antes por el helper `test-utils.ts` roto (no
  por esta cadena). Repararlos es un PR aparte.

## Progreso
- 2026-09-19: ciclo iniciado. Mapa de anatomía completo (shell en `page.tsx`,
  estado de tabs no controlado en `navbar.tsx`, i18n con claves dotted en
  `language-context.tsx`, `DialogContent` ya `max-w-lg`, Playwright default
  1280×720 Desktop Chrome). Feature doc creado -> `odd/tasks/desktop-ui.md`.
- 2026-09-19: delivery forecast ~900-1200 líneas → supera las ~400 → strategy
  ask-on-risk pendiente de decisión (cadena de PRs vs PR único con size:exception).
- 2026-09-19: delivery decidido por el usuario: `feature-branch-chain` (tracker
  `feat/desktop-ui` + slices encadenados).
- 2026-09-19: T1 implementado. `AppSurface` en types; `components/layout/app-shell.tsx`
  + `sidebar-nav.tsx` (lg: sidebar fijo Resumen/Cuentas/Historial); estado levantado a
  `page.tsx` (modales + FAB hosteados en la raíz compartidos por ambos shells); tabs
  mobile controlados (`lg:hidden`), labels vía i18n; FAB `lg:hidden`. Gates: tsc ✓,
  vitest 116/116 ✓, lint 0 errors (5 warnings pre-existentes). → commit `422c8a3`

## Progreso slice 2 (rama `feat/desktop-ui-dashboard`)
- 2026-09-19: T2 implementado. `lib/transaction-date.ts` (helper compartido),
  `components/recent-transactions.tsx` (últimos 6 movimientos), overview desktop en
  grid 2 col `lg:` (24rem + 1fr), claves `overview.recentTransactions` es/en.
  T4 verificado sin cambio (D está satisfecho por `max-w-lg` existente).
  Gates: tsc ✓, vitest 116/116 ✓, lint 0 errors. → commit `8955284`

## Progreso slice 3 (rama `feat/desktop-ui-actions`)
- 2026-09-19: T3 implementado. `hooks/use-hotkeys.ts` (`n`/`t`/`1..3`, guard
  `matchMedia('(min-width: 1024px)')`, ignora inputs y modificadores; los handlers
  se sincronizan vía ref EN UN EFECTO porque el lint del React Compiler prohíbe
  tocar refs durante el render). `sidebar-nav.tsx`: acciones "Nueva transacción"
  (Plus) y "Transferir" (ArrowRightLeft) siempre visibles con
  `aria-keyshortcuts`/`title`; ítems de nav con atajos 1/2/3. Clave
  `sidebar.newTransaction` es/en. Hotkeys sólo activas con budget configurado y
  cuentas (no secuestran setup/empty). Gates: tsc ✓, vitest 116/116 ✓, lint 0
  errors. → commit `d22414e`

## Progreso slice 4 (rama `feat/desktop-ui-sync`)
- 2026-09-19: T5 implementado. Hallazgo: la hamburguesa (`HeaderMenu` Sheet) es
  `sm:hidden`, o sea que en desktop **Ajustes y Sync eran inalcanzables** — esto es
  lo que cierra la Fase F. Nuevo `components/sync/sync-section.tsx`
  (selector Exportar/Importar + panel, remount por `key` para resetear el flujo).
  `components/sync/sync-qr-modal.tsx` ahora exporta `SyncPanel` (el cuerpo del
  flujo, agnóstico del Dialog) + `SyncQrModal` (wrapper fino con título/descripción
  Radix) EN EL MISMO MÓDULO: primero se extrajo a un archivo aparte
  (`sync-panel.tsx`) y se consolidó de vuelta porque mudar 540 líneas entre
  archivos inflaba el diff de review a 1238 líneas sin cambiar una línea de
  lógica. Sección Ajustes = `ConfigForm` inline. Sidebar: ítems Sync (RefreshCw) y
  Ajustes (Settings) con atajos 4/5 → **desvío consciente del ticket**: el
  blueprint decía `1..4`, pero hay 5 secciones; los atajos cubren 1..5. Claves
  `sidebar.sync` y `sidebar.settings` es/en. Gates: tsc ✓, vitest 116/116 ✓,
  lint 0 errors, `next build` ✓ (SSR de las secciones nuevas). Diff del slice:
+344/−205 = 549 (sobre las 400) → requiere `size:exception`. → commit `2475652`
## Progreso slice 5 (rama `feat/desktop-ui-tests`)
- 2026-09-19: T6 implementado. Auditoría de i18n: todas las claves usadas por los
  componentes nuevos existen en es/en (los `labelKey` del sidebar son
  `sidebar.overview|sync|settings`, `accounts`, `history`). Único literal sin
  traducir: `aria-label="Main navigation"`, consistente con la convención
  existente (`header-menu.tsx` usa "Open menu" / "Menu options" en inglés).
- Tests unitarios nuevos: `tests/unit/app-shell.test.tsx` (6 tests: 5 secciones en
  orden, `aria-keyshortcuts` 1-5, `aria-current` en una sola, callbacks sin estado
  propio, acciones visibles y cableadas) y `tests/unit/use-hotkeys.test.tsx`
  (9 tests: disparo, case-insensitive, viewport <1024, guardas de input/textarea/
  contenteditable, modificadores, repeat, tecla sin handler, handlers frescos sin
  re-suscripción, cleanup al desmontar). Suite: 116 → **131 tests**.
- Tests E2E nuevos: `tests/ui/desktop-shell.spec.ts` (5 tests a 1280×800: 5
  secciones y chrome mobile oculto, cambio de superficie sin recargar, sync con
  sus dos modos, atajos 1/5/n/t, y paridad mobile a 390×844). 5/5 en verde.
  No clickea "Compartir vía QR" a propósito: eso pegaría contra `/api/sync/claim`.
- Hallazgos de test (documentados en los specs):
  1. `tests/ui/e2e-constants.ts` lee credenciales en el import → sin `.env.e2e`
     **rompe la colección** de cualquier spec que lo importe (por eso
     `sync-qr.spec.ts` no se puede ni colectar acá). El spec nuevo evita ese
     import y define su helper de idioma local.
  2. `waitForSelector('h1')` no prueba hidratación: la app renderiza el SetupForm
     (cuyo input tiene `autoFocus`) antes de hidratar y el `h1` existe en ambos
     estados. Los atajos no disparaban porque el foco estaba en ese input; el
     `beforeEach` ahora espera la sidebar (sólo existe hidratada).
  3. **Deuda pre-existente, NO regresión**: `ensureConfiguredState`/
     `ensureSetupState` (`tests/ui/test-utils.ts`, intacto en este ciclo) llaman
     `page.reload()` sin `goto` previo → la página queda en `about:blank` y
     `waitForAppReady` espera 30s al vacío. Verificado con sonda: `reload()` sin
     navegación = `about:blank` / 0 `h1`. Por eso `transfer-form.spec.ts` (13) y
     parte de `config-form.spec.ts` (9) / `language-selector.spec.ts` (3) están en
     rojo desde antes de este ciclo; `test-utils.ts` no fue tocado por esta rama.
     Además varios de esos specs asumen chrome mobile al viewport default (1280).
- Gates: tsc ✓, vitest 131/131 ✓, lint 0 errors (5 warnings pre-existentes),
  next build ✓, Playwright `desktop-shell.spec.ts` 5/5 ✓.

## Progreso cierre (tracker `feat/desktop-ui`)
- 2026-09-20: tracker sincronizado con `feat/desktop-ui-sync` (contenido final de
  #75). PRs de la cadena #70/#71/#72/#73/#75 mergeados; sin PR de tracker a main
  hasta este cierre.
