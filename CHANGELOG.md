# WorkClock Pro — Changelog

---

## [Current] — 2026-05-23 — Reporte Visual + Bug Fixes

> Backend: v58 · SW cache: workclock-v40

### Added
- **Reporte Visual de Mes** (`generarReporteMes`) — nueva hoja de Google Sheets generada automáticamente con diseño ejecutivo profesional
  - Header emerald con título "INFORME MENSUAL — MES AÑO" y fecha de generación
  - 3 KPI cards: Horas Trabajadas, Jornadas, Cumplimiento
  - Sección **LIQUIDACIÓN NÓMINA**: Quincena 1 (anticipo fijo $930.000) · NETO TOTAL · A PAGAR QUINCENA 2
  - Tabla de todos los turnos del mes: Fecha · Día · Entrada · Salida · Horas (sin columna Descripción)
  - Filas alternadas, horas en verde, columnas anchas (sin truncado de texto)
  - Cuadrícula oculta (`setHiddenGridlines(true)`) — aspecto limpio, listo para PDF/compartir
- **Botón "Reporte Visual"** en la fila de acciones de la app (entre Agregar Jornada y Nuevo Mes)
- **`generarReporte` API action** en Apps Script — llamado desde la app o el menú de Sheets
- **Generación automática al cerrar mes** — `iniciarNuevoMesApp` genera el reporte antes de limpiar
- Ítem "📋 Generar Reporte Visual" en el menú ⏱️ WorkClock Pro de Google Sheets
- **`NOM_QUINCENA_1 = 930_000`** — constante de nómina para anticipo fijo de primera quincena

### Fixed
- **COP currency format ($930.00 → $930.000)** — en locale es-CO, Google Sheets interpreta el punto como separador decimal en strings pre-formateados. Solución: pasar número puro a `setValue()` y aplicar `setNumberFormat('"$"#,##0')` — Sheets renderiza el separador de miles correcto (punto) según el locale
- **exportCSV columna incorrecta** — el CSV usaba `r.rango` (campo eliminado) en lugar de `r.descripcion`; encabezado actualizado a `Fecha,Dia,Entrada,Salida,Horas,Descripcion`; las comillas dentro de la descripción se escapan correctamente (`""`)
- **"Limpiar Cache" incompleto** — el botón solo borraba `activeStartTime` pero no `wc_cache`; ahora limpia ambas entradas de localStorage y resetea los trackers `_lastWeekSecs/_lastMonthSecs`
- **XSS en historial** — la descripción del turno se inyectaba como `innerHTML`; ahora se asigna con `textContent` para prevenir ejecución de HTML/scripts

### Changed
- Action row: 2 botones → 3 botones (layout grid `1fr 1fr 1fr`); botones más compactos con icono arriba + texto abajo
- Sección liquidación: "LIQUIDACIÓN" → "LIQUIDACIÓN NÓMINA"
- Columna Descripción eliminada del reporte visual (reporte más limpio sin notas internas)
- "A PAGAR — Q2" → "A PAGAR — QUINCENA 2"
- Header "A PAGAR — QUINCENA 2" fondo cambiado a `#047857` (más oscuro que el valor)
- Columnas del reporte ensanchadas de ~544px a ~950px para llenar A4 con márgenes angostos en PDF
- Spacer rows reducidos (14px → 6px) para reporte más compacto
- Font size 9 → 10 en headers de tabla, datos y fila total
- SW cache bumped a v40
- CONTEXT.md actualizado con sección completa del reporte visual (layout, celdas merged, lecciones aprendidas)

---

## [2026-05-23]

### Added
- **4 pro animations:**
  - **Timer digit flip** — cada dígito del cronómetro hace flip vertical (scaleY) al cambiar, como marcador deportivo
  - **Count-up stats** — horas de semana/mes cuentan de 0 al valor real (750ms ease-out cúbico) al cargar datos nuevos
  - **Progress arc** — anillo SVG verde alrededor del botón se llena según horas trabajadas hoy (meta: 8h); se vuelve dorado al 100%; actualiza cada segundo durante turno activo
  - **Particles** — 16 puntos de color explotan desde el botón al iniciar (verde) y terminar (naranja) un turno

### Fixed
- **Timer no se actualizaba al editar hora de entrada del turno activo** — al guardar el modal de edición sin hora de salida, se recalcula `activeStartTime` con la nueva hora y el cronómetro salta al tiempo correcto inmediatamente
- **Toggle horas ↔ COP no revertía** — `animateStatCountUp` usaba `requestAnimationFrame` sin posibilidad de cancelarse; si el usuario tocaba las cards mientras la animación corría, el loop sobreescribía el texto COP con horas. Corregido: la animación se cancela si `isMoneyMode` es true; los trackers `_lastWeekSecs/_lastMonthSecs` se resetean al salir del modo COP para forzar re-render

### Changed
- Service Worker cache bumped a v22
- `margin-bottom` de `timer-status` aumentado a 48px para evitar que el anillo pulsante se superponga al texto "Trabajando desde…"

---

## [2026-05-22]

### Added
- **Dashboard v3** — complete redesign of Google Sheets Dashboard
  - 5 KPI cards in a row: Horas Trabajadas, Jornadas, Cumplimiento, Salario Causado, Neto Estimado
  - Progress bar sparkline for monthly hours completion
  - Hours-per-day column chart sparkline
  - Liquidación table (left) + Resumen table (right) side by side
  - Records table with Descripción column (replaces old Rango/Ubicación)
  - Modern green color scheme (#006a39 primary)
  - Helper formulas in hidden column L
  - Columns L-M hidden for clean presentation
  - Run from Google Sheets menu: WorkClock Pro → Actualizar Dashboard

### Changed
- **Removed manual API URL configuration** — URL is now hardcoded, no user setup needed
- **Auto-connection test on app load** — badge in settings shows "Conectado" / "Sin conexión" automatically
- Settings modal simplified: removed URL input + "Probar" button
- Empty state text updated ("Inicia tu primer turno" instead of "Configura la URL")
- **Hero screen layout** — timer/button/stats/actions fill viewport exactly, calendar/history below fold
- **Calendar hours fix** — uses `getDisplayValues()` to parse column E correctly (fixes 516h/1216h bug)
- **Calendar tooltips** — now float as popups above cells instead of inline text
- **PWA auto-update** — SW `reg.update()` + auto-reload when new version activates
- Service Worker cache bumped to v17
- Backend deployed as v41

---

## [2026-05-22]

### Added
- **Attendance calendar** — GitHub-style grid showing worked days
  - Green = worked, dark green = 6+ hours, orange pulsing = active shift
  - Blue ring = today, dimmed = future days
  - Tap a day to see hours worked (tooltip)
  - Data comes from `diasMes` field in `getFullState`
- **Pro animations**
  - Burst effect on successful start (green) / stop (orange)
  - State transition animation (scale bounce) on button change
  - Staggered slide-in for history cards (each card delayed 50ms)
  - Pop-in animation for calendar day cells
- **Auto-deploy script** (`npm run deploy:auto`) — single command deploys backend + frontend
  - Validates syntax, pushes to Apps Script, creates version + deployment
  - Auto-updates `DEFAULT_API_URL` in app.js with new deployment URL
  - Bumps SW cache version, commits, pushes to GitHub Pages
  - Cleans up old deployments (keeps last 4)
- **Fallback for `getFullState`** — if backend not redeployed, falls back to legacy 2-call approach

### Changed
- Sheet columns simplified: removed Rango + Ubicacion, replaced with Descripcion (col F)
- `deploy-auto.ps1` rewritten — removed Telegram logic, added GitHub Pages integration
- Service Worker cache bumped to v4

---

## [2026-05-20]

### Added
- **Finish shift modal** ("Turno Finalizado") — appears after ending a shift
  - Textarea for notes/description (saved to column F "Descripcion")
  - Shows Inicio / Fin / Total summary with real server times
  - "Saltar" (skip) and "Guardar Turno" buttons
- **Per-shift delete** — trash icon 🗑 on each history card (calls `eliminarRegistro`)
- **Date + Day in history** — cards now show `20/05 — Mie` instead of just `20/05`
- **Description field in manual shift modal** — optional notes when adding a shift manually
- **`getFullState` API action** — single backend call returns active state + history + stats
- **Local cache** (`wc_cache` in localStorage) — app renders instantly on open from cache
- **`renderFromCache()`** — shows cached data before API responds (zero perceived load time)
- **Fallback** — if `getFullState` not recognized (old deployment), falls back to legacy 2-call approach

### Changed
- Sheet columns simplified: **removed Rango and Ubicacion**, replaced with **Descripcion** (col F)
- `registrarSalida` returns `{ entrada, salida, lastRow }` for finish modal
- `refreshAll()` now uses single `getFullState` call instead of two sequential calls
- Service Worker bumped to `workclock-v3`

---

## [2026-05-20] — Speed Optimization

### Changed
- `refreshAll()` now makes **1 API call** instead of 2 sequential calls (~50% faster)
- New `getFullState` backend function merges `getCurrentState` + `getRecentHistory`
- `startTimestamp` returned from backend for accurate timer reconstruction
- Legacy `getCurrentState` and `getRecentHistory` preserved for backwards compat

---

## [2026-05-20] — Bug Fix: 10 Critical Button Issues

### Fixed
- **Duplicate shifts on double-tap** — `actionEpoch` counter discards stale responses
- **Button stuck in wrong state** — state snapshot/restore on API failure
- **Ghost clicks on iOS Safari** — `touchend` + `preventDefault()` + `disabled` attribute
- **Optimistic state before API confirms** — state only changes after `r.success`
- **Race condition refresh vs action** — `AbortController` cancels in-flight refreshes
- **Stale async overwriting fresh state** — `actionEpoch` staleness detection
- **`registrarEntrada` duplicates** — checks for existing active shift first
- **`registrarSalida` not finding shift** — searches 30 rows, closes ALL open shifts
- **Button using `pointer-events: none`** — replaced with `disabled` attribute (iOS reliable)
- CSS: added `touch-action: manipulation` on `.action-btn`

---

## [2026-05-20] — Dashboard v2

### Added
- Formula-based Dashboard sheet (auto-updates when data changes)
- SPARKLINE progress bar for monthly hours
- KPI cards: Horas, Jornadas, Cumplimiento, Salario Causado, Neto, Total Bruto
- FILTER formula table showing all current month records
- Column chart of daily hours via SPARKLINE
- `onChange` trigger updates Dashboard timestamp automatically

---

## [2026-05-19] — Initial Stable Version

### Added
- PWA with Service Worker (offline support)
- Google Sheets backend via Apps Script
- Start/Stop shift tracking with real server timestamps
- Timer display (local JS, visual only — not saved)
- Stats cards: Esta Semana / Este Mes (tappable → nómina mode in COP)
- History list (last 7 shifts)
- Edit shift modal
- Manual shift entry modal
- "Nuevo Mes" — archives current sheet to a new tab
- Settings modal with API URL configuration
- iOS dark glassmorphism design
- GitHub Pages deployment via GitHub Actions
- Hardcoded default API URL (no setup needed for user)
- Nómina calculation: salario proporcional, aux transporte, deducciones salud/pensión
