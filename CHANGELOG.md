# WorkClock Pro — Changelog

---

## [Current] — 2026-05-22

### Changed
- **Removed manual API URL configuration** — URL is now hardcoded, no user setup needed
- **Auto-connection test on app load** — badge in settings shows "Conectado" / "Sin conexión" automatically
- Settings modal simplified: removed URL input + "Probar" button
- Empty state text updated ("Inicia tu primer turno" instead of "Configura la URL")
- Service Worker cache bumped to v6

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
