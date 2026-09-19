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
- [ ] T2 — Dashboard Resumen (Fase B): grid 2 columnas a `lg:` con
  `DailyBudgetStatus` + `AccountsList` + `RecentTransactions` (helper de formato de
  fecha compartido extraído de `transaction-history.tsx`).
- [ ] T3 — Acciones + hotkeys (Fase C): acciones "Nueva transacción"/"Transferir"
  en sidebar; FAB oculto a `lg:`; `hooks/use-hotkeys.ts` (`n` `t` `1..4`) con guard
  de viewport y tooltips/aria para descubrimiento.
- [ ] T4 — Modales en desktop (Fase D): verificar/ajustar anchos de
  `DialogContent`/`AlertDialogContent` y centrado a desktop; mobile intacto.
- [ ] T5 — Sync + Ajustes en sidebar (Fase F): secciones que renderizan
  `ConfigForm` (ajustes) y `SyncQrModal` (sync) en el content area a `lg:`, sin
  hamburguesa; mobile intacto.
- [ ] T6 — i18n + tests + docs (Fase G): claves es/en (sidebar, copy desktop);
  unit tests `app-shell` + `use-hotkeys`; specs Playwright 1280×800 (shell,
  acciones, sin FAB) sin romper los specs mobile existentes; README estructura.

## Criterios de aceptación (de #10)
- [ ] A ≥1024px la sidebar + overview muestran presupuesto, cuentas y movimientos
  recientes sin abrir tabs.
- [ ] Sin FAB a `lg:`; "Nueva transacción" y "Transferir" siempre visibles en la sidebar.
- [ ] Tabla de historial usable en 1280×800 sin scroll horizontal.
- [ ] Todos los flujos mobile intactos por debajo de 1024px.
- [ ] Atajos de teclado funcionan y son descubribles (tooltip/aria).
- [ ] Claves i18n nuevas presentes en `es` y `en`.
- [ ] Specs Playwright desktop nuevos pasan; specs mobile existentes siguen verdes.

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