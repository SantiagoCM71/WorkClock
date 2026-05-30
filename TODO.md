# WorkClock Pro — Pending Tasks

Status: `[ ]` pending · `[x]` done · `[~]` in progress · `[!]` blocked

---

## High Priority

- [ ] **Apps Script redeploy needed** — after any change to `google-script.js`, a new deployment version must be created manually in the Apps Script UI. The URL stays the same, only the version increments. This is currently a manual step.

- [ ] **Clean up old Sheet data** — existing rows (before 2026-05-20) have data in columns F (Rango) and G (Ubicacion). New structure only uses F (Descripcion). Old rows have junk in those columns. User can manually delete columns F and G content for old rows, or we can write a migration script.

---

## Features To Implement

- [ ] **Compartir PDF del Reporte Visual desde la app** — el reporte ya existe en Google Sheets (hoja generada por `generarReporte`). El objetivo es que el botón "Reporte Visual" en la app genere el PDF como archivo real y abra el share sheet nativo de iOS (WhatsApp, AirDrop, Guardar en Archivos, etc.) sin links externos.

  ### Cómo funciona
  Apps Script puede exportar cualquier hoja como PDF en bytes (`getAs('application/pdf')`), codificarla en base64, y devolverla al frontend. El frontend convierte base64 → Blob → File y usa la Web Share API para abrir el share sheet nativo de iOS.

  ### Paso 1 — Modificar `google-script.js`
  En la función `doPost`, agregar el case `exportarReportePDF`:
  ```js
  case 'exportarReportePDF': {
    // Primero regenerar el reporte (o usar el existente si ya existe)
    generarReporteMes(); // función ya existente
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // Buscar la hoja del reporte (nombre: "Reporte Mayo 2026" o similar)
    const mesActual = new Date();
    const nombreHoja = 'Reporte ' + mesActual.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
                         .replace(/^\w/, c => c.toUpperCase());
    const hoja = ss.getSheetByName(nombreHoja) || ss.getSheets()[ss.getSheets().length - 1];
    // Exportar solo esa hoja como PDF
    const ssId = ss.getId();
    const gid  = hoja.getSheetId();
    const url  = `https://docs.google.com/spreadsheets/d/${ssId}/export?format=pdf&gid=${gid}&portrait=false&fitw=true&gridlines=false`;
    const token = ScriptApp.getOAuthToken();
    const blob  = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } }).getBlob();
    const b64   = Utilities.base64Encode(blob.getBytes());
    return ContentService.createTextOutput(JSON.stringify({ success: true, pdf: b64, nombre: nombreHoja }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  ```

  ### Paso 2 — Modificar `app.js` (frontend)
  Reemplazar la acción del botón `btnGenerarReporte` para que llame `exportarReportePDF` y use Web Share API:
  ```js
  async function compartirReportePDF() {
    showToast('Generando reporte...');
    const r = await apiCall('exportarReportePDF');
    if (!r || !r.success || !r.pdf) { showToast('Error al generar reporte'); return; }

    // Convertir base64 → Blob → File
    const bytes   = Uint8Array.from(atob(r.pdf), c => c.charCodeAt(0));
    const blob    = new Blob([bytes], { type: 'application/pdf' });
    const archivo = new File([blob], `WorkClock_${r.nombre || 'Reporte'}.pdf`, { type: 'application/pdf' });

    // Web Share API con archivo real (iOS Safari 15+)
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: 'WorkClock Pro — Reporte' });
    } else {
      // Fallback: descarga directa
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = archivo.name;
      link.click();
      URL.revokeObjectURL(url);
    }
  }
  ```
  Cambiar el event listener del botón de `generarReporte()` → `compartirReportePDF()`.

  ### Paso 3 — Deploy
  ```bash
  npm run deploy:auto
  ```

  ### Notas importantes
  - `generarReporteMes()` ya existe en `google-script.js` — solo reutilizarla
  - El nombre de la hoja de reporte puede variar; verificar cómo la nombra `generarReporteMes()` antes de implementar
  - La respuesta base64 puede ser grande (~200-400KB); el timeout de Apps Script es 30s — debería ser suficiente
  - Web Share API con files funciona en iOS Safari 15+ (cubre prácticamente todos los iPhones activos)
  - Si el reporte del mes ya fue generado previamente, considerar no regenerarlo — buscar la hoja existente primero antes de crear una nueva

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
