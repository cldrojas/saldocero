# ODD — Registrar una transferencia con fecha pasada (p. ej. ayer)

## Objetivo
Como usuario quiero poder registrar una transferencia que ocurrió en una **fecha pasada**
(por ejemplo ayer), para no verme forzado a sellarla con la fecha de hoy.

## Problema / Por qué
`transferFunds` **no acepta fecha**: sella ambas patas con `date: today` en duro.

| archivo | línea | qué hace |
|---|---|---|
| `hooks/use-budget.tsx` | 643 | pata de salida: `date: today` |
| `hooks/use-budget.tsx` | 655 | pata de entrada: `date: today` |

`TransferModal` (`components/modals/transfer-modal.tsx`) no tiene campo de fecha: solo
monto, origen, destino y nota. En cambio `TransactionModal` (gastos/ingresos) **ya** monta
un `DatePicker` con `allowPrevious` (`components/modals/transaction-modal.tsx:250-258`), así
que el patrón existe en la app pero nunca se aplicó a las transferencias.

El `DatePicker` ya resuelve exactamente lo pedido:
`disabled={(date) => allowPrevious ? date > new Date() : date < new Date()}`
(`components/date-picker.tsx:55`) → con `allowPrevious` el pasado se habilita y el futuro se
bloquea. No hace falta ningún primitivo nuevo.

## Decisión de diseño
Reusar `DatePicker` en `TransferModal` con `allowPrevious`, con **hoy** como valor por
defecto — idéntico al modal de gastos/ingresos, para que la app se sienta consistente.
Propagar la fecha por `onTransfer({..., date})` → `transferFunds({..., date})` → **ambas**
patas de la transferencia. Si no se pasa fecha, se mantiene `today` (no rompe llamadas
existentes ni tests).

Se descarta "solo ayer" como caso especial: un selector de fecha con default hoy cubre ayer
y cualquier fecha pasada sin agregar lógica condicional.

## Alcance autorizado (ciclo actual)
- `components/modals/transfer-modal.tsx`: estado `date` (default `new Date()`), campo
  `DatePicker` con `t('date')` y `allowPrevious`, incluir `date` en el payload de
  `onTransfer`, reset a hoy tras enviar.
- `hooks/use-budget.tsx`: `transferFunds` acepta `date?: Date`; ambas patas usan `date ?? today`.
- `app/page.tsx`: pasa `onTransfer={transferFunds}` — el tipo de `onTransfer` vive en el
  modal, así que es compatibilidad mecánica, no cambio de producto.
- `contexts/language-context.tsx`: la clave `date` **ya existe** en `en` (`'Date'`) y `es`
  (`'Fecha'`) → **sin cambios**.
- Tests: `tests/unit/use-budget.test.tsx` (ambas patas con la fecha dada; default hoy si se
  omite) y un test de componente para `TransferModal` (selección de fecha + payload) siguiendo
  el patrón de `tests/unit/transaction-modal.test.tsx` y el mock de `DatePicker` de
  `tests/unit/setup-form.test.tsx`.

### Fuera de alcance, registrado
- **Fechas futuras / transferencias programadas.** El usuario pidió el pasado; `allowPrevious`
  bloquea el futuro a propósito, igual que el modal de gastos.
- **`components/transfer-form.tsx` (`TransferForm`)**: está **muerto**, no lo monta ninguna
  superficie (solo lo referencia su propio archivo). No se toca.
- **Daily allowance.** Las transferencias no mueven `remainingToday`/`progress` por invariante
  documentada (`odd/tasks/group-transfers-in-transaction-history.md`, D1). Una fecha pasada
  tampoco debe moverlo, y no lo hará: el allowance filtra por `isToday(t.date)`, así que una
  pata de ayer simplemente queda fuera del día. No se agrega lógica.
- **Backfill de transferencias existentes.** No aplica: solo cambia la fecha de escritura nueva.

## Restricciones / convenciones
- Artefactos técnicos, código y comentarios **en inglés**; este doc sigue la convención del
  repo (los anteriores también están en español).
- No se agregan dependencias ni primitivos de UI nuevos.
- Modo TDD: **no configurado** en el proyecto (no hay `opencode.json`). Modo estándar:
  implementación y tests en la misma unidad de trabajo.
- Límite de planificación ~400 líneas autorales (heurística, no puerta). No recortar espacios,
  comentarios ni tests para entrar en el número.

## Tarea

### T1 — Fecha en la transferencia (hook + modal + tests)
- [x] `hooks/use-budget.tsx`: `transferFunds` acepta `date?: Date`; ambas patas usan `date ?? today`.
- [x] `components/modals/transfer-modal.tsx`: estado `date`, `DatePicker` con `allowPrevious`
      y label `t('date')`, `date` en el payload, reset a hoy tras enviar.
- [x] `tests/unit/use-budget.test.tsx`: transferencia con fecha explícita deja ambas patas con
      esa fecha; sin fecha => hoy.
- [x] Test de componente `TransferModal`: elegir una fecha pasada dispara `onTransfer` con esa
      fecha; sin tocar el selector => hoy.
- [x] `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm exec vitest run` verdes.

## Criterios de aceptación
- [x] El modal de transferencia muestra un selector de fecha con **hoy** por defecto.
- [x] Se puede elegir **ayer** y cualquier fecha pasada; el futuro queda deshabilitado.
- [x] Las **dos** patas de la transferencia comparten la fecha elegida.
- [x] La fecha elegida se refleja en el historial (misma fecha para el grupo).
- [x] Sin elegir fecha, el comportamiento es **idéntico al actual** (hoy).
- [x] `pnpm exec vitest run`, `pnpm lint`, `pnpm exec tsc --noEmit` limpios.

## Verificación
- `pnpm exec vitest run`
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- E2E (`pnpm test:ui`) no se toca: `playwright.config.ts` en `.gitignore` y el `webServer`
  falla por ENOSPC (deuda preexistente documentada). La cobertura va en unit.

## Progreso

### T1 — COMPLETADO

### Verificación
- `pnpm exec vitest run`: **172 passed** (16 archivos; 165 antes en este branch point)
- `pnpm lint`: **0 errores**, 5 warnings preexistentes
- `pnpm exec tsc --noEmit`: sin errores
- Spot check del padre: se re-ejecutó `pnpm exec vitest run` → 172 passed (verificación de registro).

### Commits
- `3fd4f2b` — `feat(transfer): allow registering a transfer with a past date`
  (transfer-modal.tsx, use-budget.tsx, transfer-modal.test.tsx, use-budget.test.tsx)
- `fc329b8` — `docs(odd): record transfer past-date task document`

### Revisión nativa (RDD on, decidido por global)
- Preflight STATUS con `--base-ref main --committed-only` → `fresh_target_ready`, riesgo **medium**.
- Envelope `gentle-ai.review-integration.consent/v3` presentado; el humano eligió
  **"Omitir esta vez"** (`consent: "declined_this_candidate"`) — decline **candidate-scoped**,
  NO el kill switch. No se ejecutó ninguna lente y no se creó registro de revisión.
- Camino off de RDD aplicado: `gentle-ai review assess` over el diff del writer → medium,
  cubierto por la auto-verificación del writer + el spot check del padre.

## Próximo paso
Push y PR son decisión del usuario (no se hizo push). Si se abre PR, es un change
single-PR: 5 archivos, 293 líneas cambiadas, dentro del presupuesto de ~400.
