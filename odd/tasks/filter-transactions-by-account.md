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

_(se completa al cerrar T1)_

## Próximo paso
T1 → assessment RDD → commit de unidad de trabajo.
