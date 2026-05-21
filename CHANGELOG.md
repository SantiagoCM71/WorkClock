# WorkClock Pro — Changelog

---

## [Current] — 2026-05-20

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
