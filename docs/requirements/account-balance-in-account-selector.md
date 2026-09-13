# PRD: Mostrar saldo actual de la cuenta en el selector de cuenta al agregar gasto/ingreso

## 1. Resumen Ejecutivo

### 1.1 Propósito
Mostrar el saldo actual de cada cuenta junto a su nombre en el dropdown de selección de cuenta del formulario de transacción (gasto e ingreso). El usuario necesita saber cuánto tiene disponible en cada cuenta antes de registrar un gasto sin tener que volver al tab de cuentas.

### 1.2 Change ID
`account-balance-in-account-selector`

### 1.3 Estado
**Ready for implementation** — cambio de UI atómico sobre campo existente (`Account.balance`). No requiere migración de datos.

---

## 2. Planteamiento del Problema

### 2.1 Estado Actual
- El formulario de transacción (`components/modals/transaction-modal.tsx`) recibe `accounts` pero su prop está tipado como `{ id: string; name: string }[]`.
- El `<Select>` de cuenta renderiza solo `{acc.name}` en cada `<SelectItem>` (línea 219).
- El saldo (`Account.balance`) ya existe en el modelo y el caller (`components/navbar.tsx`) lo pasa completo, pero el modal lo descarta por el tipado.

### 2.2 Pain Points
1. **Decisión a ciegas**: al registrar un gasto, el usuario no ve cuánto queda en la cuenta; debe alternar al tab de cuentas o adivinar.
2. **Contexto partido**: el dato del saldo ya está en memoria al abrir el modal; no aprovecharlo es fricción gratuita.

### 2.3 Oportunidad
El saldo ya vive en `accounts[].balance` y el modal ya tiene `formatCurrency` vía `useCurrency()`. El cambio es exponer el campo en el tipado y renderizarlo en la opción del dropdown.

---

## 3. Historia de Usuario

### US-1: Ver saldo en el selector de cuenta
**Como** usuario registrando un gasto (o ingreso)
**Quiero** ver el saldo actual de cada cuenta junto a su nombre en el dropdown de selección
**Para que** pueda elegir la cuenta correcta sabiendo cuánto tiene disponible, sin salir del formulario

**Criterios de aceptación:**
- [ ] Cada opción del dropdown de cuenta muestra el nombre y el saldo formateado con `formatCurrency`.
- [ ] El trigger del dropdown sigue mostrando únicamente el nombre de la cuenta seleccionada (sin duplicar el saldo).
- [ ] El saldo negativo se distingue visualmente (color rojo).
- [ ] El cambio aplica tanto al flujo de gasto como al de ingreso y al de edición.

---

## 4. Requerimientos Funcionales

### FR-1: Ampliar tipado del prop `accounts` del modal
Cambiar el tipo de `accounts` en `TransactionModal` de `{ id: string; name: string }[]` a `Account[]` (importar `Account` de `@/types`). El campo `balance` ya existe en el modelo; no hay cambio de schema ni migración.

### FR-2: Renderizar saldo en las opciones del dropdown
En el `SelectItem` de cada cuenta, renderizar un layout de dos columnas:
- Nombre de la cuenta (izquierda).
- Saldo formateado con `formatCurrency(acc.balance)` (derecha), con clase `tabular-nums` para alineación de dígitos y color `text-muted-foreground`; rojo (`text-red-600 dark:text-red-500`) si `balance < 0`.

### FR-3: Mantener el trigger limpio
Pasar children al `<SelectValue>` con el nombre de la cuenta seleccionada para que el trigger no herede el texto compuesto (nombre + saldo) del `ItemText`.

### FR-4: Sin cambios de persistencia
No se introduce nuevo estado ni campo: `Account.balance` ya persiste vía `use-budget.tsx` (localStorage). Sin migración de base de datos.

---

## 5. Alcance

### Dentro
- `components/modals/transaction-modal.tsx` (tipado + render del `SelectItem`).
- Test unitario del modal (nuevo: `tests/unit/transaction-modal.test.tsx`).

### Fuera
- `TransferModal` (lista cuentas origen/destino, fuera del flujo "agregar gasto").
- Depósitos/retiros por tarjeta de cuenta (no usan el modal de transacción).
- Cálculo de saldos (no se modifica la lógica de `use-budget.tsx`).

---

## 6. Riesgos

- **Radix Select**: el `ItemText` con children complejos puede filtrar texto extra al trigger. Mitigación: FR-3 controla el `SelectValue` con children explícito.
- **Formato CLP**: `formatCurrency` ya resuelve el formato por moneda/idioma; el test no debe acoplarse a un símbolo hardcodeado más allá del comportamiento definido.