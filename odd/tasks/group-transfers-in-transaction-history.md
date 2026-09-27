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
- [ ] `types/index.ts`: `transferId?: string` en `Transaction`.
- [ ] `hooks/use-budget.tsx`: `transferFunds` escribe el id en ambas patas; `replaceAll`
      propaga el campo; `removeTransfer(transferId, refund)` atómico; export en el return.
- [ ] `components/transaction-history.tsx`: prop `removeTransfer`, grouping a filas, filtro
      por cuenta sobre filas, fila de transferencia en tabla y cards, flecha con icono,
      delete del grupo.
- [ ] `components/navbar.tsx`: `removeTransfer` en `NavbarProps`, destructuring y paso.
- [ ] `app/page.tsx`: `removeTransfer` del hook y paso a `TransactionHistory`.
- [ ] `contexts/language-context.tsx`: `transferBetweenAccounts` y `unknownAccount` en `en`
      y `es`.
- [ ] `tests/unit/transaction-history.test.tsx`: casos de transferencia.
- [ ] `tests/unit/use-budget.test.tsx`: `transferFunds` escribe el mismo id en las dos
      patas; `removeTransfer` borra las dos y la segunda pata no reaparece.

## Criterios de aceptación
- [ ] Una transferencia creada desde el modal se ve como **una** fila: "Transfer between
      accounts", monto, fecha, y `Origen -> Destino` con flecha de icono.
- [ ] Un gasto y un ingreso normales siguen viéndose exactamente como antes.
- [ ] El monto de la transferencia **no** se pinta en rojo.
- [ ] Con nota del usuario, la fila muestra esa nota; sin nota, el rótulo genérico.
- [ ] El filtro por cuenta muestra la transferencia si matchea **cualquiera** de sus dos
      cuentas, y la fila muestra las dos.
- [ ] Borrar la fila agrupada borra **las dos** patas de una sola vez (regresión del
      closure: la segunda pata no reaparece).
- [ ] Un grupo con `transferId` pero != 2 patas se degrada a filas simples, no a una fila
      con contraparte inventada.
- [ ] Importar un backup conserva el grouping.
- [ ] Las claves nuevas existen en `en` y `es`; ninguna renderiza la clave cruda.
- [ ] `pnpm test` verde, `pnpm lint` sin errores nuevos, `pnpm exec tsc --noEmit` limpio.

## Verificación
- `pnpm exec vitest run`
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- E2E (`pnpm test:ui`) no se toca: la suite tiene trampas conocidas de harness documentadas
  en memoria del proyecto; la cobertura de este cambio va en unit.

## Progreso

_(pendiente)_

## Próximo paso
_(pendiente)_
