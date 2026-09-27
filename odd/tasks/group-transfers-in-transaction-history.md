# ODD — Group transfers as a single history entry

## Objetivo
Como usuario quiero ver cada transferencia como **una sola entrada** en el historial de
transacciones, para no leer el mismo movimiento dos veces ni confundir una transferencia
interna con un gasto real.

## Problema / Por qué
`transferFunds` (`hooks/use-budget.tsx:577`) **no guarda transferencias**. Guarda **dos**
transactions sueltas, sin ningún vínculo entre ellas:

| leg | `type` | `amount` | `account` | `description` |
|---|---|---|---|---|
| withdrawal | `'expense'` | `-amount` | from | `description` o `'Transfer to <dest>'` |
| deposit | `'income'` | `+amount` | to | `description` o `'Transfer from <origin>'` |

Consecuencias en el historial actual:

1. Un movimiento de $4201 entre dos cuentas ocupa **dos filas**, lo que hace que el saldo
   total del historial parezca movido el doble.
2. La fila de salida se ve idéntica a un gasto: monto **en rojo**, `type: 'expense'`. La
   plata no salió de la app, y la UI afirma lo contrario.
3. `type: 'transfer'` **no** identifica transferencias de usuario. Ese tipo solo lo usan
   el auto-save diario (`hooks/use-budget.tsx:172`) y el ajuste de budget
   (`hooks/use-budget.tsx:695`), que son movimientos de **una sola pata** por diseño.

Por lo tanto **no se puede agrupar leyendo**: el pairing hay que **grabarlo al escribir**.

## Decisión de diseño (autorizada por el usuario)
Vínculo explícito: campo opcional `transferId` en `Transaction`, generado una sola vez en
`transferFunds` y escrito en **ambas** patas. Se descartó la heurística en tiempo de render
(misma fecha + mismo monto + texto `Transfer to/from`) porque empareja por adivinanza:
dos transferencias del mismo monto el mismo día se pueden cruzar.

**Consecuencia aceptada:** las transferencias ya guardadas en `localStorage` no tienen
`transferId` y siguen mostrándose como dos filas. No hay backfill heurístico a propósito:
inventaría vínculos que la app nunca registró.

## Alcance autorizado (ciclo actual)
Solo el grouping en la vista del historial. El usuario fijo el alcance en
`components/transaction-history.tsx`; el resto de los archivos listados abajo es
**consecuencia mecánica** del modelo de datos, no ampliación de producto.

### Fuera de alcance, registrado
- `RecentTransactions` (`app/page.tsx:204`): sigue mostrando las dos patas. Es superficie
  de overview, no la lista navegable; agruparla cambia el conteo de "últimos 6" y exige su
  propio criterio de orden. Hallazgo, no permiso.
- `components/transactions-list.tsx` (`TransactionList`): está **muerto**, no lo monta
  `app/page.tsx` ni `navbar.tsx`. Deuda técnica aparte.
- El **auto-save diario** y el **ajuste de budget** (`type: 'transfer'`, una pata): se
  siguen renderizando como filas simples. Agruparlos inventaría una contraparte inexistente.

## Diseño
### 1. Modelo de datos
`types/index.ts`: `transferId?: string` opcional en `Transaction`. Opcional y no
serializado aparte: `JSON.stringify` del guardado de `localStorage` y el export de sync
lo arrastran sin tocar nada.

### 2. Escritura — `transferFunds`
Un `uuidv4()` para las dos patas. Es el **único** punto de escritura de transferencias de
usuario: tanto `TransferModal` (`app/page.tsx:284`) como `TransferForm` pasan por acá.

### 3. Import — `replaceAll` (preexistente, se arregla acá)
`hooks/use-budget.tsx:759` reconstruye cada transaction **campo por campo** y **descartaría
`transferId`**. Un import de un backup partiría cada transferencia de nuevo en dos filas.
Se propaga con el mismo patrón condicional que ya usa `hidden` en cuentas (`:756`):
`...(tx.transferId !== undefined ? { transferId: tx.transferId } : {})`.

`updateTransaction` **no** necesita cambios: `components/modals/transaction-modal.tsx:82`
hace `{ ...transaction, ... }`, así que editar una pata conserva el vínculo.

### 4. Borrado — `removeTransfer(transferId, refund)`
`removeTransaction` lee `transactions` del **closure del render**. Llamarla dos veces
seguidas para borrar las dos patas hace que la segunda `setTransactions` (calculada sobre
el mismo array viejo) **resucita la primera**: la pata borrada reaparece. Por eso el grupo
necesita una API propia, atómica:

- Un solo `setTransactions` filtrando por `transferId`.
- Un solo `setAccounts`: por cuenta, `balance - sum(amount de sus patas)`. Es la misma
  aritmética de `removeTransaction` (`balance - amount`) aplicada por pata, pero en una
  sola actualización de estado.
- `remainingToday`/`progress`: se ajustan **una** vez con la **suma neta** de las patas de
  hoy, no una vez por pata. Para una transferencia esa suma es 0 (una pata `+X`, otra
  `-X`), así que el allowance diario no se altera: correcto, porque mover plata entre
  cuentas propias no es gasto del día. `removeTransaction` aplicado dos veces no es una
  alternativa: ya está roto por el closure.

### 5. Agrupación en `TransactionHistory`
- Orden: `sortedTransactions` (fecha desc) → **filas** → filtro de cuenta. El filtro tiene
  que ir **después** del grouping, no antes.
- `useMemo` sobre `sortedTransactions`. Agrupa por `transferId`, preservando el orden de
  primera aparición.
- Un grupo con **exactamente 2** patas es una transferencia. Un grupo con otra cantidad
  (dato corrupto, o una transferencia a medio borrar) se degrada a filas simples en vez de
  inventar la contraparte que falta.
- `from` = la pata negativa; `to` = la positiva. Si los signos no se pueden distinguir, la
  fila se muestra igual con el orden en que llegaron las patas.
- Filtro de cuenta: una fila de transferencia es visible si el filtro es `null` o si
  **cualquiera** de sus dos cuentas matchea. Ocultar una pata del otro lado sería mentir:
  la transferencia sí tocó esa cuenta. La fila muestra las dos cuentas completas igual.
- Monto: `Math.abs(pata negativa)`. **No** se pinta en rojo: la plata no salió de la app.
  Pintarla en rojo contradice la razón de ser de este cambio.
- Descripción: si **ambas** patas comparten la misma description no vacía, esa es la nota
  que escribió el usuario y se muestra. Si difieren, son los defaults generados
  (`'Transfer to X'` / `'Transfer from Y'`, prefijos distintos por construcción) y se
  muestra `t('transferBetweenAccounts')`. Es determinista, no heurístico.
- Flecha: `ArrowRight` de `lucide-react`, `aria-hidden`, con un `→` `sr-only` para que la
  dirección no se pierda en lectores de pantalla.
- Delete: `DeleteTransactionModal` recibe la pata negativa como transaction representativa
  con la **description ya resuelta** (la del grupo) y el `accountName` combinado. El modal
  solo lee `description`, `Math.abs(amount)` y `accountName`, así que no necesita cambios.
  `handleDelete` despacha `removeTransfer(transferId, refund)` para filas agrupadas y
  `removeTransaction(id, refund)` para las simples.

### 6. i18n
Claves en la sección `// Transaction History` de **ambos** locales:
- `transferBetweenAccounts`: 'Transfer between accounts' / 'Transferencia entre cuentas'
- `unknownAccount`: **faltaba** en el diccionario. `t` hace
  `translations[language][key] || key` (`contexts/language-context.tsx:505`), así que hoy
  renderiza el texto crudo `unknownAccount`. Se agrega porque la fila de transferencia usa
  exactamente ese fallback (cuenta borrada) y no quiero shippear una etiqueta cruda en el
  camino nuevo. Bug preexistente, corregido acá.

### 7. Superficies de montaje
`TransactionHistory` se monta en `app/page.tsx:203` (desktop) y
`components/navbar.tsx:103` (mobile). El prop `removeTransfer` es **requerido** en ambas,
para que el compilador garantice que ninguna superficie se quede sin él. `NavbarProps`
declara los tipos a mano (`:24`) y hay que agregar el campo ahí también.

## Restricciones / convenciones
- Artefactos técnicos, código y comentarios **en inglés**; este doc sigue la convención del
  repo (el anterior también está en español).
- No se agregan dependencias ni primitivos de UI nuevos.
- Modo TDD: **no configurado** en el proyecto (no hay clave `tdd` en `opencode.json`). Modo
  estándar: implementación y tests en la misma unidad de trabajo.
- Límite de planificación: ~400 líneas autorales (heurística, no puerta). No recortar
  espacios, comentarios ni tests para entrar en el número.

## Tarea

### T1 — Vínculo `transferId` + fila agrupada (con i18n y tests)
- [x] `types/index.ts`: `transferId?: string` en `Transaction`.
- [x] `hooks/use-budget.tsx`: `transferFunds` escribe el id en ambas patas; `replaceAll`
      propaga el campo; `removeTransfer(transferId, refund)` atómico; export en el return.
- [x] `components/transaction-history.tsx`: prop `removeTransfer`, grouping a filas, filtro
      por cuenta sobre filas, fila de transferencia en tabla y cards, flecha con icono,
      delete del grupo.
- [x] `components/navbar.tsx`: `removeTransfer` en `NavbarProps`, destructuring y paso.
- [x] `app/page.tsx`: `removeTransfer` del hook y paso a `TransactionHistory`.
- [x] `contexts/language-context.tsx`: `transferBetweenAccounts` y `unknownAccount` en `en`
      y `es`.
- [x] `tests/unit/transaction-history.test.tsx`: casos de transferencia.
- [x] `tests/unit/use-budget.test.tsx`: `transferFunds` escribe el mismo id en las dos
      patas; `removeTransfer` borra las dos y la segunda pata no reaparece.

## Criterios de aceptación
- [x] Una transferencia creada desde el modal se ve como **una** fila: "Transfer between
      accounts", monto, fecha, y `Origen -> Destino` con flecha de icono.
- [x] Un gasto y un ingreso normales siguen viéndose exactamente como antes.
- [x] El monto de la transferencia **no** se pinta en rojo.
- [x] Con nota del usuario, la fila muestra esa nota; sin nota, el rótulo genérico.
- [x] El filtro por cuenta muestra la transferencia si matchea **cualquiera** de sus dos
      cuentas, y la fila muestra las dos.
- [x] Borrar la fila agrupada borra **las dos** patas de una sola vez (regresión del
      closure: la segunda pata no reaparece).
- [x] Un grupo con `transferId` pero != 2 patas se degrada a filas simples, no a una fila
      con contraparte inventada.
- [x] Importar un backup conserva el grouping.
- [x] Las claves nuevas existen en `en` y `es`; ninguna renderiza la clave cruda.
- [x] `pnpm test` verde, `pnpm lint` sin errores nuevos, `pnpm exec tsc --noEmit` limpio.

## Verificación
- `pnpm exec vitest run`
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- E2E (`pnpm test:ui`) no se toca: la suite tiene trampas conocidas de harness documentadas
  en memoria del proyecto; la cobertura de este cambio va en unit.

## Progreso

### T1 — CERRADA
Commit `743a77f` en `feat/group-transfers-in-history` (base `12b82c9`).
10 archivos, 948 líneas cambiadas. `size:exception` aprobada por el maintainer: el
vínculo se graba en `transferFunds` y se lee en el listado, así que un PR que haga
solo una de las dos partes está roto por diseño y no es divisible en slices útiles.

### Evidencia de verificación
- `pnpm exec vitest run`: **160/160 en 14 archivos** (140 antes, +20 nuevos).
  El hook pre-commit de husky corre la suite completa: verde en el commit.
- `pnpm lint`: **0 errores**, 5 warnings, los mismos preexistentes
  (`account-modal.tsx:48`, `use-budget.tsx:85/145/189`, `use-toast.ts:21`).
  `removeTransfer` no agregó un `exhaustive-deps` nuevo: es una función simple, no
  un `useCallback`.
- `pnpm exec tsc --noEmit`: **exit 0**.

### Mutación verificada por el padre (no por el writer)
- Se eliminó el anclaje de la fila al primer leg → **4 tests fallan**.
- Se forzó emitir toda fila de transferencia (`if (true) continue`) → **8 tests fallan**.
El mecanismo de grouping está realmente cubierto, no decorativo.

### Revisión R3 Reliability — ejecutada por el padre, NO por la lente despachada
El dispatch de la lente falló con `OpenCode's free tier can only be used from within
OpenCode` (mismo bloqueo de host registrado en el ciclo anterior). A pedido explícito
del usuario la ejecuté yo, con probes medidos. **La transacción nativa quedó intacta y
sin aprobar**: no se fabricó un `review.capture-result`.

- **R3-1 (WARNING) — `removeTransfer` deja `remainingToday`/`progress` intactos.**
  Medido: con un gasto real de 200 y una transferencia de 300, al borrar la
  transferencia con refund el balance de `daily` vuelve 500 → 800 pero
  `remainingToday` sigue en 0 y `progress` en 0: la plata que vuelve no se ve en el
  allowance del día. La guarda `todayNet !== 0` vuelve esa rama **código muerto** para
  toda transferencia bien formada (la neta siempre es 0), así que el código *parece*
  manejar el allowance cuando estructuralmente no puede.
  **No es regresión:** el camino preexistente `removeTransaction` sobre una pata da
  `remainingToday` 300 y `progress` **300%**, o sea peor y visiblemente absurdo.
  Clasificado preexistente, pero la afirmación del doc de que la elección es
  "correcta" está sin evidencia y su consecuencia observable es inconsistente.

- **R3-2 (WARNING) — clave de React duplicada si un `id` importado equivale a un
  `transferId`.** Medido: React emite el warning de "same key". Alcanzable por
  `replaceAll`: `validateImportJson` no valida unicidad de ids ni colisión con
  `transferId`. Consecuencia: reconciliación de filas incorrecta.
  Fix barato: namespacear las claves de render (`tx:` vs `tr:`).

- **R3-3 (SUGGESTION) — falta cubrir el orden.** Ningún test afirma la posición de una
  fila agrupada entre filas simples, ni un grupo cuyas patas traen **fechas distintas**
  (alcanzable por import). Verificado a mano: esa fila se ancla en la pata más reciente
  y ordena bien. El comportamiento es correcto pero no está probado.

### Lo que los tests sí compran
- `never colors a transfer amount as a loss` tiene aserción de control (la fila de Rent
  SÍ está en rojo): no es un selector vacuo.
- El test de regresión del closure documenta el mecanismo real y afirma la pata
  **opuesta** a la intuición ingenua.
- El test de import afirma `'transferId' in plain === false`: fija el spread condicional,
  no solo el valor.
- Los tests de degradación de 1 y 3 patas fijan el contrato de "no inventar contraparte".

### Consistencia viva, fuera de alcance
`RecentTransactions` sigue mostrando las dos patas: overview e historial ahora no
coinciden en el número de movimientos. Documentado, no corregido.

## Deuda técnica conocida — NO tocado en este change

Decidido por el maintainer: documentar, no arreglar. Cada ítem registra la
medición que lo prueba, el alcance real y qué NO cubre. Ninguno es un blocker.

### D1 — El refund de una transferencia no mueve el allowance del día
- **Síntoma:** con un gasto real de 200 y una transferencia de 300, al borrar la
  transferencia con refund el balance de `daily` vuelve 500 → 800 pero
  `remainingToday` sigue en 0 y `progress` en 0. La plata que vuelve no aparece en
  el allowance del día.
- **Causa raíz:** la guarda `todayNet !== 0` en `removeTransfer` es **código muerto**
  para toda transferencia bien formada, porque la neta de las dos patas siempre es 0.
  La rama del allowance nunca se ejecuta. El código *lee* como si manejara el
  allowance cuando estructuralmente no puede.
- **Por qué no lo arregla este change:** definir la contabilidad correcta del
  allowance es cambio de comportamiento de producto, no refactor. Afecta también al
  camino preexistente.
- **Preexistente, no regresión:** `removeTransaction` sobre una sola pata da
  `remainingToday` 300 y `progress` **300%**. Antes estaba peor y visiblemente absurdo.
  Arreglar solo `removeTransfer` dejaría los dos caminos con reglas distintas.
- **Refactor subyacente sin tocar:** `calculateDailyAllowance` solo corre en el efecto
  de cambio de día, así que un cambio en `transactions` sin cambio en `accounts`
  deja `usedToday`/`progress` desactualizados.
- **Cómo reproducir:** el bloque de measurement de R3-1 arriba.

### D2 — Clave de React duplicada si un `id` importado equivale a un `transferId`
- **Síntoma:** React emite el warning de "same key". Confirmado con captura de
  `console.error`.
- **Causa raíz:** `buildHistoryRows` usa `transaction.id` como clave de fila simple y
  `transferId` como clave de fila agrupada, sin namespace. `replaceAll` acepta ids del
  archivo y `validateImportJson` **no valida unicidad de ids** ni colisión con
  `transferId`.
- **Consecuencia:** reconciliación de filas incorrecta; React puede reusar el contenido
  de otra fila entre renders.
- **Fix barato si se decide:** namespacear las claves de render (`tx:` vs `tr:`), o
  derivar la clave de fila de la posición en la lista ordenada.
- **Alcance real:** solo alcanzable por import o estado local manipulado. No lo
  produce la UI normal.

### D3 — Orden de fila agrupada sin cobertura
- **Síntoma:** ningún test afirma la posición de una fila agrupada entre filas
  simples, ni un grupo cuyas dos patas traen **fechas distintas**.
- **Por qué importa:** un grupo con patas de fechas distintas decide qué fecha muestra
  la fila. Es alcanzable por import, porque `validateImportJson` no valida coherencia
  de fechas entre patas del mismo `transferId`.
- **Verificado a mano, no por test:** esa fila se ancla en la pata más reciente y
  ordena correctamente entre las simples.
- **Lo que sí está cubierto:** el mecanismo de grouping, por mutación. Quitar el
  anclaje al primer leg → 4 tests fallan. Forzar que nunca se emitan filas de
  transferencia → 8 tests fallan.

### D4 — Overview e historial no coinciden en el número de movimientos
- `RecentTransactions` sigue mostrando las dos patas de una transferencia, así que
  el conteo de movimientos del overview y el del historial ahora difieren.
- Fuera de alcance explícito desde el diseño original. Consecuencia visible, no
  corrupción de datos.

### Deuda preexistente ajena a este change
- `components/transactions-list.tsx` (`TransactionList`) está muerto: no lo monta
  `app/page.tsx` ni `navbar.tsx`, solo sus propios tests.
- E2E no ejecutable en este entorno: `playwright.config.ts` está en `.gitignore` y su
  `webServer` lanza `next build`, que falla con ENOSPC (disco lleno). Toda la
  cobertura desktop/mobile es jsdom, no navegador real.

## Próximo paso
1. **Decidido:** D1 y D2 quedan como deuda documentada, no se arreglan en este
   change. Los cuatro ítems están en "Deuda técnica conocida" arriba.
2. La transacción nativa `review-7ded6a98e8523c31` sigue **intacta y reanudable**. No
   quemó autoridad: no hubo captura, y la revisión se hizo a mano por petición
   explícita del usuario. Quien la retome necesita despachar la lente
   `review-reliability` contra el mismo candidate tree `d4274235`.
3. Push y PR son decisión del usuario. Si se abre el PR, el reviewer debería leer
   primero la sección de deuda: D1 y D2 son conocidas y aceptadas, no omisiones.
