# ODD — Filter transactions by account

## Objetivo
Como usuario quiero filtrar las transacciones listadas por cuenta, para poder
enfocarme en los movimientos de una cuenta concreta sin scrollear todo el historial.

## Problema / Por qué
`TransactionHistory` renderiza **todas** las transacciones de todos los tipos, sin
ningún tipo de filtro ni búsqueda. Con muchas cuentas (y el proyecto ya soporta
cuentas de usuario arbitrarias, no solo `daily`/`savings`) el historial es una lista
plana: no hay forma de responder "¿cuánto gasté en Inversiones este mes?" sin leer
fila por fila. La columna `account` ya está presente y formateada en las dos
variantes (tabla desktop y cards mobile), así que el dato para filtrar existe; solo
falta el control.

## Alcance autorizado (ciclo actual)
**Solo `TransactionHistory`**, que es la lista navegable real. Decisión explícita del
usuario en la sesión actual.

El componente se monta en **dos** superficies, y el filtro aparece en ambas sin
trabajo duplicado:
- `app/page.tsx:203` — superficie desktop `history` (sidebar, `lg+`)
- `components/navbar.tsx:103` — tab mobile `history` (`<lg`)

### Superficies explícitamente fuera de alcance
- `RecentTransactions` (`app/page.tsx:204`, overview desktop): queda sin filtro.
  Filtrar una card de "últimos 6" es UX dudoso y exigiría estado compartido en
  `use-budget`, que es superficie y riesgo que no se autorizaron.
- `TransactionList` (`components/transactions-list.tsx`): está **muerto**, no lo
  monta `app/page.tsx` ni `navbar.tsx`; solo lo referencian sus propios tests. No se
  toca. Queda registrada como deuda técnica aparte.

## Diseño
1. Estado local `accountFilter: string` en `TransactionHistory`, con el centinela
   `'all'`. Local, no compartido: no se levanta a `use-budget` ni a `app/page.tsx`.
2. Control `Select` de shadcn (`components/ui/select.tsx`, ya presente y ya usado
   por `DailyBudgetStatus` para su dropdown de balance) en el `CardHeader`, con una
   opción `allAccounts` + una por cuenta de `accounts`.
   - Se listan **todas** las cuentas, incluidas las `hidden`. Ocultar una cuenta es
     esconderla de los totales (`hideAccount`), no negar el acceso a su historial.
3. `Transaction.account` es un `string` plano con el `id` de la cuenta
   (`types/index.ts:59`), así que el filtro es un `===` sobre ids. Sin tipo nuevo.
4. El filtro se aplica sobre `sortedTransactions` (ya ordenado por fecha desc), por
   lo que desktop y mobile recortan exactamente el mismo conjunto.

### Empty state: dos mensajes, no uno
Este es el punto de correctitud que no es obvio:
- `transactions.length === 0` → `noTransactions` ("Aún no hay transacciones") — no hay
  datos, el filtro es irrelevante.
- hay transacciones pero el filtro activo no matchea ninguna →
  `noTransactionsInAccount` ("No hay transacciones en esta cuenta").

Reusar `noTransactions` para el segundo caso sería una mentira de UI: diría que no
tenés datos cuando sí tenés, solo que ninguno es de esa cuenta.

## Restricciones / convenciones
- Artefactos técnicos y código **en inglés**; este doc sigue la convención del repo.
- i18n: claves planas agregadas en la sección `// Transaction History` de **ambos**
  locales (`en` y `es`). `t` es `(key: string) => string`, sin enforcement de tipos.
- No se agregan primitivos de UI nuevos ni dependencias.
- Modo TDD: **no configurado** en el proyecto (no hay clave `tdd` en
  `opencode.json`). Se corre en modo estándar: implementación y tests en la misma
  unidad de trabajo, con verificaciones funcionales. No se inventa ceremonia
  RED-first que el proyecto no pide.
- Límite de planificación: ~400 líneas autorales por unidad de trabajo (heurística,
  no puerta). No recortar espacios, comentarios ni tests para entrar en el número.

## Tarea

### T1 — Filtro por cuenta en `TransactionHistory` (con i18n y tests)
- [ ] `components/transaction-history.tsx`: estado `accountFilter`, `Select` en el
      `CardHeader`, recorte de `sortedTransactions`, segundo empty state.
- [ ] `contexts/language-context.tsx`: `filterByAccount`, `allAccounts`,
      `noTransactionsInAccount` en `en` y `es`.
- [ ] `tests/unit/transaction-history.test.tsx`: archivo **nuevo** — hoy no hay
      cobertura unitaria para este componente.

## Criterios de aceptación
- [ ] Con el filtro en `allAccounts` se ve exactamente la lista actual (sin
      regresión de desktop ni mobile).
- [ ] Elegir una cuenta deja visible solo las transacciones de esa cuenta.
- [ ] Cambiar a otra cuenta actualiza la lista sin remount.
- [ ] Con el filtro activo y cero coincidencias aparece el mensaje de "sin
      transacciones en esta cuenta", NO el de "Aún no hay transacciones".
- [ ] Las claves nuevas existen en `en` y `es`; ninguna renderiza la clave cruda.
- [ ] `pnpm test` verde y `pnpm lint` sin errores nuevos.
- [ ] `pnpm exec tsc --noEmit` limpio.

## Verificación
- `pnpm test` (vitest, incluye el archivo nuevo)
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- E2E (`pnpm test:ui`) no se toca: la suite tiene trampas conocida de harness
  documentadas en memoria del proyecto; este cambio es de UI de bajo riesgo y su
  cobertura va en unit.

## Progreso

### T1 — CERRADA
- [x] `components/transaction-history.tsx`: estado `accountFilter`, `Select` en el
      `CardHeader`, recorte de `sortedTransactions`, segundo empty state.
- [x] `contexts/language-context.tsx`: `filterByAccount`, `allAccounts`,
      `noTransactionsInAccount` en `en` y `es`.
- [x] `tests/unit/transaction-history.test.tsx`: 9 tests, archivo nuevo.

Commits (rama `feat/filter-transactions-by-account`, base `208bd85`):
- `d1a57e7` — `feat(history): filter transactions by account` (unidad de trabajo)
- `efebbd5` — `chore: ignore local .codegraph index` (higiene de tooling)
- `<responsive>` — ajuste de layout del `CardHeader` (aportado por el usuario): pasa a
  `flex-col items-center` y recién a `sm:` se vuelve `flex-row justify-between`. En
  viewports angostos (≈320px) una fila fija con un `Select` de `11rem` más el título
  quedaba apretada. Reverificado: 140/140, `tsc` exit 0, lint 0 errores.

### Criterios de aceptación — todos verificados
- [x] `allAccounts` reproduce la lista actual, sin regresión desktop ni mobile
- [x] Elegir una cuenta deja solo sus transacciones
- [x] Cambiar de cuenta actualiza sin remount
- [x] Filtro activo sin coincidencias → mensaje de "sin transacciones en esta cuenta",
      NO "Aún no hay transacciones"
- [x] Claves nuevas en `en` y `es`; ninguna renderiza la clave cruda
- [x] `pnpm test` verde, `pnpm lint` sin errores nuevos, `tsc --noEmit` limpio

### Evidencia de verificación
- `pnpm exec vitest run`: **140/140 en 14 archivos** (incluye 9 nuevos). El hook
  pre-commit de husky corre la suite completa: verde en ambos commits.
- `pnpm lint`: **0 errores**, 5 warnings, todos preexistentes en
  `account-modal.tsx` / `use-budget.tsx` / `use-toast.ts`. Ninguno en archivos tocados.
- `pnpm exec tsc --noEmit`: **exit 0**.

### Mutación verificada (el test no es decorativo)
El test de colisión de id se validó por mutación: con el centinela hardcodeado
`'all'` (derivación eliminada) el test
`does not confuse an account named "All"` **falla**; restaurada la derivación, pasa.
Confirma que el hole era real y que el test lo cubre. También se comprobó que la
protección depende de la **derivación** y no del literal: con candidato inicial
`'all'` + loop, el test igual pasa.

### Revisión RDD — ABIERTA, BLOQUEADA POR EL ENTORNO
- Assessment: `gentle-ai.review-assessment/v1` → **medium**, `executable_change`.
  Contract: en medium el candidate es el PR slice; se cerró por fin de feature.
- Transacción congelada: lineage `review-891f3657880b2f45`,
  `candidate_tree 1017e0e`, budget de corrección 171, **1 lente** (`review-reliability`).
- Consentimiento del usuario: `granted` (relay completo del envelope consent/v3).
- **Pendiente:** la lente R3 no pudo despacharse. El host responde
  `OpenCode's free tier can only be used from within OpenCode` — no es un defecto de
  Gentle AI sino del runtime cliente, así que no procede handoff. La captura NO se
  fabricó a mano.
- Estado: la transacción sigue **intacta y reanudable**, ofreciendo el mismo slot
  (`review-reliability`, order 0, `subject-hash sha256:ce7d00a9…`). Resolver el
  despacho de subagentes y relanzar el STATUS ligado retoma el review sin perder
  la autoridad.

### Fuera de alcance, registrado
- **Bug preexistente, NO tocado:** `t('unknownAccount')` se usa en
  `transactions-list.tsx`, `transaction-history.tsx` y `recent-transactions.tsx`, pero
  la clave **no existe** en el diccionario. Como `t` hace
  `translations[language][key] || key` (`contexts/language-context.tsx:505`), hoy
  renderiza el texto crudo `unknownAccount`. Solo afecta a transacciones cuya cuenta
  fue borrada. Hallazgo, no permiso de ampliar alcance.
- **Deuda técnica, NO tocado:** `components/transactions-list.tsx` (`TransactionList`)
  está muerto; no lo monta nadie, solo sus tests.

## Próximo paso
1. Resolver el límite de despacho de subagentes del runtime, o decidir delivery sin
   review — la entrega es decisión del usuario bajo política del repo.
2. Si se retoma el review: correr el STATUS ligado al lineage
   `review-891f3657880b2f45` y despachar la lente desde un host que pueda.
3. Este bloque de progreso quedó **sin commitear a propósito**: cambiar bytes del
   working tree invalidaría el `candidate_tree` congelado y dejaría el review sin
   reanudabilidad.
