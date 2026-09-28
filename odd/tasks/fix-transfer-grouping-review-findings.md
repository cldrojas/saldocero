# Fix — hallazgos de revisión del grouping de transferencias

## Objetivo

Cerrar tres defectos en el grouping de transferencias que se subió en #80, los tres
encontrados por una **revisión independiente posterior a mergear la feature a `main`**,
y los tres reproducidos antes con probes en runtime. Todos son alcanzables por import:
`replaceAll` conserva el `id` y la `date` que cada pata tenía en el archivo, y
`validateImportJson` no valida ni la unicidad de los ids ni la coherencia de fechas entre
las patas de un mismo `transferId`. El camino normal de `transferFunds` no puede producir
ninguno. Los ítems de deuda D1, D2 y D3 en `group-transfers-in-transaction-history.md`
eran factualmente incorrectos y este change los corrige allá.

## Hallazgo 1 — `removeTransfer` corrompía el allowance del día

`hooks/use-budget.tsx`, `removeTransfer`. El bloque que se borraba nettaba las patas
fechadas hoy y movía `remainingToday`/`progress` cuando esa neta no era 0.
`transferFunds` sella ambas patas con `today`, así que la neta es 0 y el bloque nunca
corría sobre datos locales — por eso se leía como código muerto. Con datos importados
de fechas de pata divergentes la neta es una pata suelta, la rama se ejecuta y acredita
una cantidad que nunca se descontó en ningún lado:

- **daily** — `remainingToday` 0 → **300**, `progress` 0 → **342.86%**, persistido en
  `daily-budget-data` y sobreviviendo un reload.
- **track** — `dailyAllowance` es 0, así que la división por cero dejó `progress` en
  **`Infinity`**, que `JSON.stringify` escribe como **`null`**. Ese blob es exactamente
  lo que `components/sync/sync-qr-modal.tsx` manda por sync QR, así que el valor malo
  podía llegar a otro dispositivo.

Remedido durante este fix: en track mode es `progress = Infinity` en estado, `null` en
disco. El efecto de cambio de día solo corre cuando cambia el día, que es exactamente
como los valores se persisten.

**Fix:** la mutación de `remainingToday`/`progress` se borró directamente. Una
transferencia no es gasto — la plata se queda dentro de la app — así que `transferFunds`
nunca mueve el allowance y su inversa tampoco debe. Vale para todo caso, fechas
divergentes incluidas. El comentario engañoso se reemplazó por el invariante real; no
queda ninguna guarda fingiendo proteger algo.

## Hallazgo 2 — una fila agrupada podía mostrar una fecha más vieja que la fila de arriba

`components/transaction-history.tsx`, `buildHistoryRows` / `toRowView`. La **posición**
de la fila se anclaba en `legs[0]` (la primera vista = la más reciente) mientras que la
`date` mostrada venía de `from`, elegida por **signo**. Cuando la pata positiva es más
nueva que la negativa, una fila etiquetada con la fecha vieja renderizaba encima de una
con fecha más nueva — patas `+300` de hoy y `-300` de hace cinco días, más un gasto de
`-50` de hace dos días, renderizaron como
`["22 Sep Transfer between...", "25 Sep Noise..."]`.

**Fix:** la pata de anclaje se carga en la `HistoryRow` de transferencia y es la que
`toRowView` renderiza como fecha, así que posición y etiqueta vienen de la misma pata y
no pueden discrepar. Una fila `single` no se ve afectada, y un grupo bien formado comparte
una fecha entre sus dos patas, así que el camino normal no cambia.

## Hallazgo 3 — un grupo cuyas patas comparten un `id` se renderizaba dos veces

`components/transaction-history.tsx`, `buildHistoryRows`. El anclaje era
`if (transaction.id !== legs[0].id) continue`. Con ambas patas llevando el mismo `id` las
dos iteraciones pasaban el chequeo y la fila se empujaba dos veces — contenido duplicado
visible, no solo un warning (4 warnings "same key" de React: 2 filas desktop + 2 mobile).

**Fix:** el grupo ya no se ancla en la identidad de las patas. Un `Set<string>` de
`transferId`s ya emitidos en la pasada decide la emisión, lo cual es independiente del
orden y no asume que los ids sean únicos. `legs[0]` sigue siendo el ancla para posición y
fecha.

**También cerrado, a costo efectivo cero:** las claves de render llevan namespace por tipo
de fila — `tx:${id}` para `single`, `tr:${transferId}` para `transfer` — tanto en
`HistoryRow.key` como en `RowView.key`. Esto cierra el ítem de deuda preexistente de "clave
de React duplicada", donde una transacción importada con `id` igual al `transferId` de
otra producía el mismo warning.

## Verificación

- `pnpm exec vitest run`: **165/165 en 14 archivos** (160 base + 5 nuevos).
- `pnpm exec tsc --noEmit`: **exit 0**. `pnpm lint`: **0 errores**, 5 warnings
  preexistentes, sin cambio.
- **Verificado por mutación:** contra las fuentes pre-fix, revertir
  `components/transaction-history.tsx` falla los 3 tests nuevos de history (los 22
  existentes siguen pasando); restaurar el bloque de `removeTransfer` falla los 2 tests
  nuevos del hook con `remainingToday` 300 contra el 0 esperado (los 24 existentes siguen
  pasando). No es vacuo.

## Fuera de alcance

- El bug preexistente de `progress` en `removeTransaction` (borrar una sola pata infla
  `progress` más allá del 100%). Sin tocar a propósito.
- D4: `RecentTransactions` sigue mostrando las dos patas, así que overview e historial no
  coinciden en el conteo de movimientos. Sigue abierto. El refactor de
  `calculateDailyAllowance` tampoco se tocó.

## Próximo paso

1. Push y PR son decisión del usuario. Tipo de commit `fix`, scope `history` + `budget`.
2. Vale la pena considerarlo por separado: validar coherencia de fechas y unicidad de ids
   en `validateImportJson` eliminaría la superficie de import que these tres hallazgos
   compartían, en vez de depender de que los consumidores sean defensivos.
