# WorkClock Pro — Pending Tasks

Status: `[ ]` pending · `[x]` done · `[~]` in progress · `[!]` blocked

---

## High Priority

- [ ] **Apps Script redeploy needed** — after any change to `google-script.js`, a new deployment version must be created manually in the Apps Script UI. The URL stays the same, only the version increments. This is currently a manual step.

- [ ] **Clean up old Sheet data** — existing rows (before 2026-05-20) have data in columns F (Rango) and G (Ubicacion). New structure only uses F (Descripcion). Old rows have junk in those columns. User can manually delete columns F and G content for old rows, or we can write a migration script.

---

## Features To Implement

- [ ] **Long-press en calendario para editar turnos del día** — al mantener presionado una celda del calendario (~500ms) abrir modal con los turnos de ese día editables. Requiere nueva función en el backend: `getShiftsForDay(fecha)` que retorne los registros (rowNumber, entrada, salida, descripcion) de esa fecha. Pasos:
  1. Agregar `getShiftsForDay` en `google-script.js`
  2. Hacer deploy con `npm run deploy:auto` desde tu PC
  3. En frontend: detectar long-press con `touchstart` + timer 500ms, cancelar en `touchmove`/`touchend`, abrir modal con los turnos del día

- [ ] **GPS / Location feature** — was deferred. User wants to know if they were at the workplace when clocking in/out. Work coordinates: `lat: 3.5261039, lng: -76.2837987`, radius: 300m. Was removed from backend — needs to be re-added as optional, not blocking.

- [ ] **Edit description on existing shifts** — currently the finish modal saves the note right after a shift ends. But there's no way to edit the description of an older shift from the app. The edit modal only handles Entrada/Salida times.

- [ ] **Stats: daily average** — user might want to see average hours per day this month alongside the weekly/monthly totals.

- [ ] **Notification / reminder** — remind user to clock out if a shift has been running for X hours (e.g., 10h). Could use Web Push or a simple timer-based alert.

---

## Quality / Polish

- [ ] **Migrate existing sheet headers** — rename column F header from "Rango" to "Descripcion" and delete columns G (Ubicacion) and H (old Notas). Can be done with a one-time Apps Script function.

- [ ] **Auto-redeploy Apps Script** — investigate `clasp deploy` CLI command to automate the version bump without manual UI steps.

- [ ] **SW update UX** — when a new SW version is available, show a "Actualizar app" toast so the user knows to reload.

---

## Decisions / Notes for Next Agent

- The `getFullState` fallback in `refreshAll()` handles old deployments gracefully — don't remove it.
- `actionEpoch` is the core bug-prevention mechanism — any new async flow must respect it.
- Never use `pointer-events: none` for button disabling on iOS — always use `disabled` attribute.
- The timer is purely visual (JS `setInterval`) — the actual times come from the server.
- `activeStartTime` in localStorage is the source of truth for the timer between sessions.
- All user-facing text is in **Spanish**.
- The app is primarily used on iPhone Safari as a PWA (installed to home screen).
