# WorkClock Pro — Project Context

> Last updated: 2026-05-20  
> For any agent (Codex, Antigravity, Claude, etc.) picking up this project.

---

## What This Is

A **PWA (Progressive Web App)** work-hours tracker with a **Google Sheets backend**.  
The user registers work shifts (start/end times) from their iPhone via Safari.  
Data is stored in a Google Sheet. No server, no database — Apps Script is the API.

**Live URL:** Deployed on GitHub Pages via GitHub Actions.  
**Repo:** `https://github.com/SantiagoCM71/WorkClock`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, HTML, CSS (no frameworks) |
| Hosting | GitHub Pages (auto-deploy on push to `main`) |
| Backend API | Google Apps Script (REST via `doPost`) |
| Database | Google Sheets |
| Offline | Service Worker (`sw.js`, cache `workclock-v3`) |

---

## File Structure

```
WorkClock/
├── index.html          # App UI (single page)
├── index.css           # Styles (iOS dark glassmorphism theme)
├── app.js              # All frontend logic (~750 lines)
├── sw.js               # Service Worker (cache: workclock-v3)
├── manifest.json       # PWA manifest
├── google-script.js    # Google Apps Script backend (source of truth)
├── appsscript.json     # Apps Script config
├── .clasp.json         # Clasp CLI config (gitignored)
├── CONTEXT.md          # THIS FILE
├── CHANGELOG.md        # History of changes
├── TODO.md             # Pending tasks
└── .github/
    └── workflows/
        └── deploy.yml  # GitHub Actions → GitHub Pages
```

---

## Google Sheets Structure

**Spreadsheet ID:** `12iuJSea50wuVwWGFHfdCRzah7OEMInOstcOM8ByzLMk`  
**Main sheet:** `Hoja 1`  
**Dashboard sheet:** `Dashboard` (formula-based, auto-updates)

### Column Layout (`Hoja 1`)
| Col | Name | Type | Notes |
|-----|------|------|-------|
| A | Fecha | Date `yyyy-MM-dd` | |
| B | Dia | String | `Lun`, `Mar`, etc. |
| C | Entrada | Time `HH:mm:ss` | Set by `registrarEntrada()` |
| D | Salida | Time `HH:mm:ss` | Set by `registrarSalida()` |
| E | Horas | Formula `[h]:mm:ss` | `=IF(D<C, 1+D-C, D-C)` |
| F | Descripcion | String | Notes added in finish modal |

Row 1 is the header. Data starts at row 2.

---

## API (Google Apps Script)

**Deployed URL (hardcoded in app.js):**
```
https://script.google.com/macros/s/AKfycbw1X-9KmoFH63FuUX6eNaKAD1YdIkORQ6In6g8veOLPTH3JhG27P6Kursw5YvrKSj-O/exec
```

**Script ID (for clasp):** `1E-9vJWmDWR-saHVokvP100rh1REekSy7jgAnEJGP06qbpR12Swg_JvoK`

### Available Actions (doPost)
| Action | Params | Returns |
|--------|--------|---------|
| `getFullState` | — | active state + history + stats (single optimized call) |
| `getCurrentState` | — | `{ active, startTime, startTimestamp }` (legacy) |
| `getRecentHistory` | — | `{ history[], semanaTotal, mesTotal, ... }` (legacy) |
| `registrarEntrada` | — | `{ success, startTimestamp }` |
| `registrarSalida` | `{ coords }` | `{ success, entrada, salida, lastRow }` |
| `guardarNota` | `{ rowNumber, nota }` | `{ success }` |
| `eliminarRegistro` | `{ rowNumber }` | `{ success }` |
| `eliminarUltimoRegistro` | — | `{ success }` |
| `actualizarRegistro` | `{ rowNumber, nuevaEntrada, nuevaSalida }` | `{ success }` |
| `agregarJornadaManual` | `{ data: { fecha, entrada, salida, descripcion } }` | `{ success }` |
| `iniciarNuevoMesApp` | — | `{ success, archivoCreado }` |

**`doGet`** returns `{ status: 'ok' }` for connection testing.

### Deploy Process (IMPORTANT)
When `google-script.js` changes, you must:
1. Run `npx clasp push --force` to upload to Apps Script
2. In Apps Script UI: **Implementar → Administrar implementaciones → ✏️ → Nueva versión → Implementar**
3. The URL stays the same — only the version number changes.

---

## Frontend Key Concepts (`app.js`)

### State Variables
```js
webAppUrl       // API URL (localStorage or DEFAULT_API_URL)
activeStartTime // epoch ms of current shift start (localStorage)
isActionBusy    // true while start/stop API call is in-flight
isRefreshing    // true while refresh is in-flight
actionEpoch     // monotonic counter — discard stale async responses
historySeq      // deduplication counter for updateHistory
refreshAbort    // AbortController for refresh calls
actionAbort     // AbortController for action calls
finishRowNumber // row number to attach note after finishing shift
```

### Critical Flow: `handleAction()`
1. Guard: if `isActionBusy`, return immediately
2. Increment `actionEpoch` — invalidates all in-flight refreshes
3. Abort any in-flight refresh (`refreshAbort.abort()`)
4. `lockButton()` — sets `disabled` attribute (reliable on iOS Safari)
5. Snapshot current state (for rollback on failure)
6. Call API (`registrarEntrada` or `registrarSalida`)
7. On success: commit new state, show finish modal (if stopping)
8. On failure: **restore snapshot** — never leaves UI in bad state
9. `unlockButton()` + trigger `refreshAll()`

### Optimized Refresh: `refreshAll()`
- Calls `getFullState` (single API call for state + history + stats)
- Falls back to `getCurrentState` + `getRecentHistory` if `getFullState` not recognized
- Saves result to `localStorage` cache via `saveToCache()`
- On next app open: `renderFromCache()` renders instantly before API responds

### Button Locking (iOS Safari fix)
```js
// Use disabled attribute, NOT pointer-events: none (unreliable on iOS)
lockButton()   → elBtnAction.disabled = true
unlockButton() → elBtnAction.disabled = false
```

### iOS Ghost Click Prevention
```js
// touchend calls preventDefault() to suppress synthesized click
elBtnAction.addEventListener('touchend', (e) => {
  if (actionTouchHandled) { e.preventDefault(); return; }
  actionTouchHandled = true;
}, { passive: false });
```

---

## Nómina (Payroll) Constants
```js
const NOMINA = {
  salarioBase:       1_750_905,  // COP/month
  auxTransporte:       250_000,  // COP/month
  horasLegalesMes:         176,  // hours/month
  deduccionSalud:       70_000,  // COP/month
  deduccionPension:     70_000   // COP/month
}
```
Tapping the stats cards toggles between "hours mode" and "nómina mode" (shows proportional net pay in COP).

---

## Service Worker
- Cache name: `workclock-v3`
- Caches: `index.html`, `index.css`, `app.js`, `manifest.json`, `assets/icon.png`
- API calls to `script.google.com` are **never** cached
- **To force cache update:** bump `CACHE_NAME` to `workclock-v4`, `v5`, etc. and push

---

---

## Full Deploy Guide

### Prerequisites (one-time setup)
```bash
# Install clasp globally if not present
npm install -g @google/clasp

# Login to Google (opens browser)
npx clasp login

# Verify .clasp.json exists in project root (gitignored)
# It should contain:
# { "scriptId": "1E-9vJWmDWR-saHVokvP100rh1REekSy7jgAnEJGP06qbpR12Swg_JvoK", "rootDir": "." }
```

---

### Deploy Frontend → GitHub Pages

```bash
# Stage specific files (never use git add -A blindly)
git add app.js index.html index.css sw.js

# Commit
git commit -m "describe what changed"

# Push — GitHub Actions triggers automatically
git push origin main

# GitHub Actions deploys to Pages in ~1-2 minutes
# Check status at: https://github.com/SantiagoCM71/WorkClock/actions
```

**Workflow file:** `.github/workflows/deploy.yml`  
Triggers on every push to `main`. No extra steps needed.

---

### Deploy Backend → Google Apps Script

#### Step 1 — Push code via clasp
```bash
# From project root (where .clasp.json lives)
npx clasp push

# Expected output:
# - Pushing files…
# └─ appsscript.json
# └─ google-script.js
# Pushed 2 files.

# Use --force only if clasp says "No files to push" but you know there are changes
# (can happen on Windows due to CRLF/LF line ending detection issues)
# npx clasp push --force
```

#### Step 2 — Create new deployment version (MANUAL, required)
> ⚠️ `clasp push` only uploads the code. To make it live, you must create a new version in the UI.

1. Go to [script.google.com](https://script.google.com)
2. Open project **WorkClock Pro**
3. Click **"Implementar"** (top right, blue button)
4. Select **"Administrar implementaciones"**
5. Click the **pencil ✏️** on the active deployment
6. In "Versión" dropdown → select **"Nueva versión"**
7. Click **"Implementar"**
8. ✅ Done — the URL **stays the same**, only the internal version number changes

> **Why is this manual?** Google Apps Script requires a human to authorize new deployments. `clasp deploy` can automate it but requires extra OAuth scopes — not set up in this project.

---

### Deploy Both at Once (typical workflow)

```bash
# 1. Push backend
npx clasp push --force

# 2. Push frontend
git add app.js index.html index.css sw.js google-script.js
git commit -m "feat: describe what changed"
git push origin main

# 3. Then go to Apps Script UI and create new deployment version (see above)
```

---

### Force Safari / PWA Cache Refresh

When frontend files change but users see the old version:

```bash
# Bump the cache version in sw.js
# Change: const CACHE_NAME = 'workclock-v3';
# To:     const CACHE_NAME = 'workclock-v4';  (increment each time)

git add sw.js
git commit -m "Bump SW cache to vN to force update"
git push origin main
```

Users then need to reload the app once (pull-to-refresh in Safari).

---

### Verify Everything Is Working

```bash
# Check GitHub Actions deploy status
# https://github.com/SantiagoCM71/WorkClock/actions

# Test the API directly (should return { status: 'ok' })
curl "https://script.google.com/macros/s/AKfycbw1X-9KmoFH63FuUX6eNaKAD1YdIkORQ6In6g8veOLPTH3JhG27P6Kursw5YvrKSj-O/exec"
```

---

### Key IDs (never change)

| Thing | Value |
|-------|-------|
| GitHub repo | `https://github.com/SantiagoCM71/WorkClock` |
| GitHub Pages URL | `https://santiagocm71.github.io/WorkClock/` |
| Apps Script URL | `https://script.google.com/macros/s/AKfycbw1X-9KmoFH63FuUX6eNaKAD1YdIkORQ6In6g8veOLPTH3JhG27P6Kursw5YvrKSj-O/exec` |
| Apps Script ID | `1E-9vJWmDWR-saHVokvP100rh1REekSy7jgAnEJGP06qbpR12Swg_JvoK` |
| Google Sheet ID | `12iuJSea50wuVwWGFHfdCRzah7OEMInOstcOM8ByzLMk` |
| Sheet name | `Hoja 1` |

---

## Known Issues / History
- Old duplicate shift bugs were caused by race conditions → fixed with `actionEpoch` + `AbortController`
- iOS Safari ghost clicks fixed with `touchend` + `disabled` attribute
- `registrarSalida` searches last 30 rows and closes ALL open shifts (in case of duplicates)
- `registrarEntrada` checks for existing active shift before creating new row
- Safari may cache old SW version — bump `CACHE_NAME` in `sw.js` to force refresh

---

## User Preferences
- Language: Spanish (UI and comments)
- Design: iOS dark theme, glassmorphism, `#0B0B0E` background
- Primary device: iPhone (Safari PWA)
- Currency: COP (Colombian Pesos)
