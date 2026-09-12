# Spec: Supabase Auth Backend — Fase 1

Change: `supabase-auth-backend`
PRD: `docs/requirements/supabase-auth-backend.md`
Fecha: 2026-08-11
Tipo: **Full spec** (dominio nuevo, no existe spec previo)
Idioma de especificación: RFC 2119 (MUST / SHOULD / MAY)

---

## Dominio: auth/session

### Requisito: Registro con email y contraseña

El sistema MUST permitir a un usuario nuevo registrarse con email y contraseña. Tras un registro exitoso, el sistema MUST crear el usuario en `auth.users`, insertar su fila en `profiles` (vía trigger) e iniciar la sesión automáticamente.

- **Escenario: registro feliz**
  - GIVEN un usuario en `/login` en la pestaña de registro
  - WHEN envía email válido + password ≥ 8 caracteres
  - THEN se crea el usuario, la sesión queda iniciada y se redirige a la app principal
  - AND existe una fila en `profiles` con `id = auth.uid()`

- **Escenario: email ya registrado**
  - GIVEN un email existente en `auth.users`
  - WHEN el usuario intenta registrarse con ese email
  - THEN el sistema MUST mostrar un mensaje de error legible (en el idioma activo) y NO crear sesión

- **Escenario: password débil**
  - GIVEN un formulario de registro
  - WHEN el usuario envía password < 8 caracteres
  - THEN la validación de cliente MUST bloquear el envío con mensaje en `en`/`es`

### Requisito: Inicio de sesión

El sistema MUST autenticar a un usuario existente con email y password y mantener la sesión activa tras recargar la página.

- **Escenario: login feliz**
  - GIVEN un usuario registrado
  - WHEN ingresa credenciales correctas
  - THEN la sesión se establece con cookies httpOnly y se redirige a la app principal

- **Escenario: credenciales inválidas**
  - GIVEN un usuario en `/login`
  - WHEN ingresa email o password incorrectos
  - THEN el sistema MUST mostrar "credenciales inválidas" (en el idioma activo) y permanecer en `/login`

- **Escenario: persistencia tras recarga**
  - GIVEN una sesión activa
  - WHEN el usuario recarga la página
  - THEN la sesión MUST seguir válida (refresh de cookies vía middleware) y la app se renderiza sin pasar por `/login`

### Requisito: Cierre de sesión

El sistema MUST permitir cerrar sesión desde la navbar y MUST NOT borrar el estado local (`localStorage`).

- **Escenario: sign out**
  - GIVEN un usuario autenticado en la app
  - WHEN presiona "Cerrar sesión"
  - THEN las cookies de sesión se limpian y se redirige a `/login`
  - AND `localStorage['daily-budget-data']` permanece intacto

- **Escenario: sign out en dispositivo compartido**
  - GIVEN un usuario cerró sesión
  - WHEN un segundo usuario inicia sesión en el mismo dispositivo
  - THEN el segundo usuario MUST ver su propio espacio (el dato local transicional se mantiene por diseño hasta Fase 2 — ver Dominio transition)

### Requisito: Protección de rutas

El sistema MUST proteger la app principal (rutas privadas) y redirigir a `/login` a usuarios sin sesión válida, sin flash de la app.

- **Escenario: acceso anónimo a ruta privada**
  - GIVEN un visitante sin sesión
  - WHEN intenta acceder a `/`
  - THEN el middleware redirige a `/login`

- **Escenario: resolución de sesión en curso**
  - GIVEN un usuario con cookie de sesión
  - WHEN la app está resolviendo el estado de sesión
  - THEN el sistema MUST mostrar un estado de carga/skeleton y NO renderizar la app ni el login

### Requisito: Estados de carga

El sistema SHOULD mostrar estados de carga mientras se resuelve la sesión para evitar parpadeo de login.

- **Escenario: primer render**
  - GIVEN una sesión válida pendiente de verificación
  - WHEN el layout monta el auth provider
  - THEN se muestra loading hasta resolver `user`/`session`

---

## Dominio: auth/errors

### Requisito: Mensajes de error bilingües

El sistema MUST presentar errores de auth con mensajes legibles en `en` y `es` según el idioma activo (patrón `t()` con claves i18n).

- **Escenario: error en es**
  - GIVEN idioma activo `es`
  - WHEN ocurre un error de auth (email duplicado, credenciales inválidas, fallo de red)
  - THEN el mensaje mostrado es la clave `es` correspondiente

- **Escenario: fallo de red**
  - GIVEN el cliente sin conexión a Supabase
  - WHEN el usuario intenta login/registro
  - THEN el sistema MUST mostrar un error genérico de conexión y permitir reintentar

---

## Dominio: isolation

### Requisito: Aislamiento por usuario (RLS)

El sistema MUST habilitar RLS en `profiles`, `accounts` y `transactions` con políticas own-rows (`auth.uid() = user_id`) para SELECT/INSERT/UPDATE/DELETE.

- **Escenario: usuario A no lee filas de B**
  - GIVEN usuarios A y B con filas propias en `accounts`
  - WHEN A ejecuta `SELECT` sobre `accounts`
  - THEN solo retorna filas con `user_id = A.uid`

- **Escenario: usuario A no modifica filas de B**
  - GIVEN una fila de B en `accounts`
  - WHEN A intenta `UPDATE`/`DELETE` esa fila
  - THEN la operación no afecta filas (0 rows affected)

- **Escenario: registro crea profile**
  - GIVEN un nuevo usuario en `auth.users`
  - WHEN el trigger `handle_new_user` se ejecuta
  - THEN existe una fila en `profiles` con su `id`

---

## Dominio: transition

### Requisito: App operativa sin cambios funcionales

El sistema MUST mantener `localStorage` como fuente de datos durante Fase 1: un usuario autenticado MUST operar la app exactamente como hoy.

- **Escenario: paridad de comportamiento**
  - GIVEN un usuario autenticado
  - WHEN usa la app (crear cuenta, transacción, transferencia)
  - THEN el comportamiento y los datos son idénticos al flujo actual (sin escrituras a Postgres)

- **Escenario: sin sesión = sin app**
  - GIVEN un visitante sin sesión
  - WHEN intenta usar la app
  - THEN solo ve `/login`; la app principal no se renderiza

---

## Dominio: i18n

### Requisito: Claves de auth en en/es

El sistema MUST agregar claves i18n para la UI de auth (`login`, `register`, `logout`, `email`, `password`, `confirmPassword`, mensajes de error) en ambos idiomas, siguiendo el patrón del objeto de traducciones existente.

- **Escenario: cobertura de claves**
  - GIVEN el objeto de traducciones de `contexts/language-context.tsx`
  - WHEN se cambia de idioma en `/login`
  - THEN todos los textos de auth MUST mostrarse en el idioma activo sin claves faltantes

---

## Resumen

| Dominio | Requisitos | Escenarios |
|---------|-----------|------------|
| auth/session | 5 | 10 |
| auth/errors | 1 | 2 |
| isolation | 1 | 3 |
| transition | 1 | 2 |
| i18n | 1 | 1 |

- Happy paths: cubiertos
- Edge cases: cubiertos (email duplicado, password débil, credenciales inválidas, fallo de red)
- Error states: cubiertos

Próximo paso: design (`docs/design/supabase-auth-backend-design.md`) → tasks.
