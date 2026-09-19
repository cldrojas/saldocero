# 💸 Saldo Cero

> _Libera tu mente del estrés financiero._

**Saldo Cero** es una app minimalista de finanzas personales diseñada para ayudarte a tomar decisiones con claridad. No necesitas conectar cuentas bancarias ni entender contabilidad: solo anota lo esencial y nosotros hacemos el resto.

---

## ✨ ¿Qué es Saldo Cero?

Una herramienta simple y directa para:

- 📌 Saber cuánto dinero tienes realmente  
- 📅 Organizar tus pagos y cobros  
- 🚨 Evitar olvidos y gastos fantasmas  
- 📈 Tomar decisiones financieras sin ansiedad

Sin curvas de aprendizaje. Sin publicidad. Sin humo.

---

## 🧠 Filosofía

- **Menos fricción, más claridad**  
- **Privacidad por defecto** (tus datos son tuyos)  
- **Cero estrés, cero deudas, cero enredos**

Pensada para personas que:

- Se estresan al ver su cuenta
- Quieren ahorrar pero no logran hacerlo
- Sienten que su plata "se va sola"
- Necesitan control, pero sin Excel ni apps bancarias confusas

---

## 🗂 Estructura del Proyecto

```
/app            # Directorio de Next.js (pages, layouts, estilos globales)
|-- globals.css
|-- layout.tsx
|-- page.tsx    # Componente principal DailyBudgetApp

/components     # Componentes de UI y funcionalidades
|-- accounts-list.tsx
|-- circular-progress.tsx
|-- config-form.tsx
|-- daily-budget-status.tsx
|-- date-picker.tsx
|-- error-boundary.tsx
|-- language-currency-selector.tsx
|-- navbar.tsx
|-- recent-transactions.tsx
|-- setup-form.tsx
|-- theme-provider.tsx
|-- transaction-history.tsx
|-- transactions-list.tsx
|-- transfer-form.tsx
|-- header-menu.tsx  # Iconos inline en desktop; hamburguesa + Sheet debajo de sm
/components/layout  # Shell responsive
|-- app-shell.tsx    # Sidebar fija a lg+ y area de contenido
|-- sidebar-nav.tsx  # Secciones y acciones del sidebar (atajos 1-5, n, t)
/components/modals  # Componentes modales
/components/sync    # Flujo QR (claim) y su seccion de escritorio
|-- sync-qr-modal.tsx  # SyncPanel (flujo) + SyncQrModal (wrapper de Dialog)
|-- sync-section.tsx   # Seccion de sync inline para desktop
/components/ui      # Primitivas de UI (buttons, dialogs, etc.)

/contexts       # React Context providers (currency, language)
/hooks          # Custom React hooks
/lib            # Funciones utilitarias
/public         # Static assets (icons, images)
/styles         # Estilos globales
/types          # Definiciones de tipos TypeScript
/tests          # Archivos de tests (unit y e2e)
```

---

## 🛠 Tecnologías

- **Frontend:** Next.js (React), Tailwind CSS, Radix UI, TypeScript
- **State Management:** React Context, Custom Hooks
- **Styling:** Tailwind CSS, PostCSS
- **Icons & UI:** Lucide, Radix UI Primitives
- **Testing:** Vitest (unit/integration), Playwright (UI)
- **Backend:** Enchufe (serverless-first con Cloudflare Workers)
- **Database:** Enchufe (Cloudflare D1 compatible con SQLite, opcional PostgreSQL)
- **Infraestructura:** Cloudflare Workers, Cloudflare D1 (planificado)

---

## 🏗 Arquitectura

- **Frontend:** Construido con Next.js usando App Router y React Server Components para óptimo rendimiento y escalabilidad.
- **Layout responsive:** Un solo árbol de estado de "superficie activa" alimenta dos chromes: sidebar fija a `lg` (1024px+) con secciones y acciones visibles, y tab bar + FAB por debajo. La superficie es estado del dueño (`app/page.tsx`); el sidebar no navega, notifica.
- **Componentización:** Componentes UI modulares y hooks para mantenibilidad y reutilización.
- **State:** Gestionado via React Context y custom hooks para budget, lenguaje y moneda.
- **Backend:** Diseñado para ser serverless-first (Cloudflare Workers), adaptable a cualquier backend REST/GraphQL.
- **Database:** Cloudflare D1 (SQLite-compatible, serverless), con opción de cambiar a PostgreSQL u otras bases de datos.
- **Seguridad:** No se vende ni comparte datos de usuarios; la privacidad es un valor fundamental.

---

## 🚀 Instrucciones de Configuración

### Prerrequisitos

- Node.js (v18+ recomendado)
- pnpm (o npm/yarn)
- Docker (para PostgreSQL, si se requiere backend)

### 1. Clonar el Repositorio

```sh
git clone https://github.com/cldrojas/daily-budget.git
cd daily-budget
```

### 2. Instalar Dependencias

```sh
pnpm install
# o
npm install
```

### 3. Ejecutar el Frontend

```sh
pnpm dev
# o
npm run dev
```

### 4. (Opcional) Configurar PostgreSQL con Docker

Si quieres usar PostgreSQL localmente:

```sh
docker run --name saldo-cero-db -e POSTGRES_PASSWORD=yourpassword -p 5432:5432 -d postgres
```

Actualiza tus variables de entorno según sea necesario.

### 5. Ejecutar Tests

Este repositorio usa Vitest para tests unitarios/de integración y Playwright para tests de UI.

- Ejecutar tests unitarios:

```sh
pnpm test          # ejecuta vitest (tests unitarios en tests/unit/**)
pnpm test:coverage # ejecutar con coverage
```

- Ejecutar tests de UI con Playwright (inicia `pnpm dev` automáticamente):

```sh
pnpm test:ui
pnpm test:ui:headed # ejecutar con navegador visible
```

CI: Hay un workflow de GitHub Actions en `.github/workflows/tests.yml` que ejecuta `pnpm tsc --noEmit`, tests unitarios y tests de UI de Playwright en push/PR a main.

---

## 🧩 Utilidades internas

- [`lib/cashflow.ts`](./lib/cashflow.ts) — cálculo de saldo diario a partir de un saldo inicial y una lista de movimientos. Ver documentación completa en [docs/cashflow.md](./docs/cashflow.md).

---

## 📝 Notas

- La implementación actual está enfocada al frontend. La integración de backend y base de datos está diseñada para ser modificable y serverless-friendly.
- Para producción, considera desplegar en Vercel, Cloudflare, o plataformas similares.

---

## 🧑‍💻 ¿Quién está detrás?

Proyecto personal de [Daniel](https://github.com/cldrojas), ingeniero informático con hambre de claridad financiera y diseño funcional.  
Inspirado por el caos, construido con cariño.
