# Frontend HTML — WorkClock Pro (versión Apps Script)

Este archivo preserva el HTML completo que vivía dentro de Google Apps Script
como `index.html`, servido directamente desde el Web App de GAS.

## Notas clave

- **API_URL**: debe pegarse el enlace `/exec` del deployment de Apps Script.
- **NÓMINA hardcodeada**: salario base COP $1.750.905, auxilio transporte $250.000,
  176 horas legales/mes, deducciones salud y pensión ~$70.036 c/u.
- **GPS en salida**: llama `getGPS()` antes de `registrarSalida`, pasa coords al backend.
- **Modo dinero**: tap en las stat-cards alterna entre horas y neto COP proyectado.
- **Modales**: editar turno existente (`edit-modal`) y agregar jornada manual (`manual-modal`).
- **Acciones API usadas**: `getCurrentState`, `getRecentHistory`, `registrarEntrada`,
  `registrarSalida`, `eliminarUltimoRegistro`, `actualizarRegistro`,
  `agregarJornadaManual`, `iniciarNuevoMesApp`.

---

```html
<!DOCTYPE html>
<html lang="es" style="background-color: #0f172a; height: 100vh;">
  <head>
    <meta charset="utf-8">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="WorkClock">
    <meta name="theme-color" content="#0f172a">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover">
    <link rel="apple-touch-icon" href="https://img.icons8.com/3d-fluency/180/lightning-bolt.png">
    <title>⏱️ WorkClock Pro</title>

    <style>
      :root { --bg: #0f172a; --card: #1e293b; --text-main: #f8fafc; --text-dim: #94a3b8; --primary: #38bdf8; --success: #10b981; --danger: #ef4444; --card-darker: #0f172a; }
      html, body { background-color: var(--bg) !important; margin: 0; padding: 0; width: 100%; min-height: 100vh; -webkit-tap-highlight-color: transparent; }
      body { font-family: 'Inter', -apple-system, sans-serif; color: var(--text-main); display: flex; justify-content: center; align-items: flex-start; padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom) 16px; box-sizing: border-box; }
      .card { background: var(--card); padding: 2rem; border-radius: 28px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); width: 100%; max-width: 420px; text-align: center; border: 1px solid rgba(255, 255, 255, 0.08); margin-top: 15px; margin-bottom: 20px; box-sizing: border-box; }
      h2 { font-weight: 800; font-size: 1.75rem; margin-top: 0; letter-spacing: -0.025em; margin-bottom: 1.5rem; }
      h2 span { color: var(--primary); text-shadow: 0 0 15px rgba(56, 189, 248, 0.3); }
      .status-badge { display: inline-block; padding: 14px 24px; border-radius: 20px; background: rgba(255, 255, 255, 0.03); margin-bottom: 2rem; border: 1px solid rgba(255, 255, 255, 0.1); width: 100%; box-sizing: border-box; }
      .status-label { font-size: 0.7rem; text-transform: uppercase; color: var(--text-dim); letter-spacing: 0.12em; margin-bottom: 4px; display: block; font-weight: 600; }
      .status-value { font-weight: 700; font-size: 1rem; color: var(--text-main); }
      .btn { width: 100%; padding: 22px; border: none; border-radius: 20px; color: white; font-weight: 800; font-size: 1.3rem; cursor: pointer; transition: all 0.1s; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 1rem; position: relative; box-sizing: border-box; }
      #btn-entrada { background: linear-gradient(135deg, #10b981, #059669); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 8px 0 #057a55, 0 15px 25px rgba(16, 185, 129, 0.3); }
      #btn-entrada:active { transform: translateY(8px) scale(0.98); box-shadow: inset 0 4px 8px rgba(0, 0, 0, 0.3), 0 0px 0 #057a55; }
      #btn-salida { background: linear-gradient(135deg, #ef4444, #dc2626); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 8px 0 #b91c1c, 0 15px 25px rgba(239, 68, 68, 0.3); }
      #btn-salida:active { transform: translateY(8px) scale(0.98); box-shadow: inset 0 4px 8px rgba(0, 0, 0, 0.3), 0 0px 0 #b91c1c; }
      .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; border: none; }
      .action-buttons { display: flex; gap: 10px; margin-bottom: 2rem; }
      .btn-action { flex: 1; padding: 12px; border-radius: 14px; font-weight: 700; font-size: 0.8rem; cursor: pointer; transition: all 0.2s; }
      .btn-action:active { transform: scale(0.95); }
      .btn-add { background: rgba(56, 189, 248, 0.1); color: var(--primary); border: 1px solid rgba(56, 189, 248, 0.3); }
      .btn-reset { background: rgba(16, 185, 129, 0.1); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
      .stats-container { display: flex; gap: 14px; margin-bottom: 2.5rem; }
      .stat-card { flex: 1; background: var(--card-darker); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 22px; padding: 18px 16px; text-align: left; cursor: pointer; transition: all 0.3s ease; position: relative; overflow: hidden; box-sizing: border-box; }
      .stat-card:active { transform: scale(0.96); }
      .stat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .stat-label { font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; font-weight: 700; }
      .stat-icon { width: 18px; height: 18px; fill: var(--text-dim); }
      .money-active .stat-icon { fill: var(--success); filter: drop-shadow(0 0 5px rgba(16, 185, 129, 0.4)); }
      .stat-value { font-size: 1.15rem; font-weight: 800; color: var(--text-main); font-family: monospace; }
      .money-active .stat-value { color: var(--success); }
      .history-section { border-top: 1px solid rgba(255,255,255,0.08); padding-top: 1.5rem; }
      .history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem; }
      .history-header h3 { font-size: 0.8rem; color: var(--text-dim); margin: 0; text-transform: uppercase; }
      .btn-delete { background: rgba(239, 68, 68, 0.1); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 8px 14px; font-size: 0.65rem; font-weight: 700; cursor: pointer; }
      table { width: 100%; border-collapse: separate; border-spacing: 0 8px; font-size: 0.75rem; }
      th { color: var(--text-dim); font-weight: 500; padding: 0 8px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); text-align: center; }
      .tr-hoverable td { padding: 14px 8px; background: rgba(255,255,255,0.02); text-align: center; cursor: pointer; transition: background 0.2s; }
      .tr-hoverable:active td { background: rgba(56, 189, 248, 0.1); }
      td:first-child { border-radius: 14px 0 0 14px; } td:last-child { border-radius: 0 14px 14px 0; }
      .txt-total { color: var(--primary); font-weight: 700; }
      .hidden { display: none !important; }
      .loader { border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid var(--primary); border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 2rem auto; }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 999; display: flex; justify-content: center; align-items: center; padding: 16px; box-sizing: border-box; backdrop-filter: blur(5px); }
      .modal-box { background: var(--card); border-radius: 24px; padding: 24px; width: 100%; max-width: 340px; border: 1px solid rgba(255,255,255,0.1); box-sizing: border-box; overflow: hidden; }
      .modal-box h3 { margin-top: 0; color: var(--primary); margin-bottom: 5px; font-weight: 800;}
      .input-group { margin-bottom: 18px; text-align: left; width: 100%; box-sizing: border-box; }
      .input-group label { display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 6px; font-weight: 600; text-transform: uppercase; }
      .input-group input { display: block; margin: 0; width: 100%; max-width: 100%; padding: 12px 14px; border-radius: 14px; background-color: var(--card-darker); border: 1px solid rgba(255,255,255,0.1); color: white; font-size: 1.1rem; box-sizing: border-box; color-scheme: dark; font-family: inherit; -webkit-appearance: none; appearance: none; }
      input[type="time"] { background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2394a3b8"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>'); background-repeat: no-repeat; background-position: right 14px center; background-size: 20px; }
      input[type="time"]::-webkit-calendar-picker-indicator, input[type="date"]::-webkit-calendar-picker-indicator { opacity: 0; cursor: pointer; width: 30px; height: 100%; position: absolute; right: 0; }
      .modal-btns { display: flex; gap: 12px; margin-top: 10px; width: 100%; box-sizing: border-box;}
      .btn-cancel { flex: 1; padding: 14px; border-radius: 14px; background: transparent; border: 1px solid var(--text-dim); color: var(--text-main); font-weight: 700; font-size: 0.9rem; cursor: pointer;}
      .btn-save { flex: 1; padding: 14px; border-radius: 14px; background: var(--primary); border: none; color: #0f172a; font-weight: 800; font-size: 0.9rem; cursor: pointer;}
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Work<span>Clock</span> Pro</h2>
      <div id="loading-overlay"><div class="loader"></div><p style="color: var(--text-dim); font-size: 0.85rem;">Sincronizando...</p></div>
      <div id="main-content" class="hidden">
        <div class="status-badge"><span class="status-label" id="status-label">Estado</span><span class="status-value" id="status-text">Cargando...</span></div>
        <button id="btn-entrada" class="btn hidden">Iniciar Turno</button>
        <button id="btn-salida" class="btn hidden">Terminar Turno</button>
        <div class="action-buttons"><button class="btn-action btn-add" onclick="openManualModal()">➕ AGREGAR JORNADA</button><button class="btn-action btn-reset" onclick="handleNuevoMes()">🚀 NUEVO MES</button></div>
        <div class="stats-container hidden" id="stats-container" onclick="toggleMoneyMode()">
          <div class="stat-card" id="card-week"><div class="stat-header"><span class="stat-label" id="lbl-week">Semana</span><div id="icon-week-container"></div></div><span class="stat-value" id="val-week">0 min</span></div>
          <div class="stat-card" id="card-month"><div class="stat-header"><span class="stat-label" id="lbl-month">Mes</span><div id="icon-month-container"></div></div><span class="stat-value" id="val-month">0 min</span></div>
        </div>
        <div class="history-section">
          <div class="history-header"><h3>Actividad Reciente</h3><button id="btn-eliminar" class="btn-delete">Eliminar Último</button></div>
          <table><thead><tr><th style="width: 15%;">Día</th><th style="width: 22%;">Entra</th><th style="width: 22%;">Sale</th><th style="width: 18%;">Total</th><th style="width: 23%;">Sitio</th></tr></thead><tbody id="history-body"></tbody></table>
          <p style="font-size: 0.65rem; color: var(--text-dim); margin-top: 12px; text-align: center;">💡 Toca cualquier fila para editarla</p>
        </div>
      </div>
    </div>

    <div id="edit-modal" class="modal-overlay hidden">
      <div class="modal-box">
        <h3>Editar Turno</h3><p id="edit-date" style="color:var(--text-dim); font-size:0.8rem; margin-bottom:20px;"></p>
        <div class="input-group" style="position: relative;"><label>Entrada</label><input type="time" id="edit-in"></div>
        <div class="input-group" style="position: relative;"><label>Salida</label><input type="time" id="edit-out"></div>
        <div class="modal-btns"><button class="btn-cancel" onclick="closeEditModal()">Cancelar</button><button id="btn-save-edit" class="btn-save" onclick="saveEdit()">Guardar</button></div>
      </div>
    </div>
    <div id="manual-modal" class="modal-overlay hidden">
      <div class="modal-box">
        <h3>Agregar Jornada</h3><p style="color:var(--text-dim); font-size:0.75rem; margin-bottom:15px;">Registro manual</p>
        <div class="input-group" style="position: relative;"><label>Fecha</label><input type="date" id="man-date"></div>
        <div class="input-group" style="position: relative;"><label>Entrada</label><input type="time" id="man-in"></div>
        <div class="input-group" style="position: relative;"><label>Salida</label><input type="time" id="man-out"></div>
        <div class="modal-btns"><button class="btn-cancel" onclick="closeManualModal()">Cancelar</button><button id="btn-save-manual" class="btn-save" onclick="saveManual()">Guardar</button></div>
      </div>
    </div>
    
    <script>
      // ⚠️ PEGA AQUÍ TU ENLACE DE APPS SCRIPT (TERMINADO EN /exec)
      const API_URL = "AQUI_TU_ENLACE_DE_APPS_SCRIPT"; 

      const iconTime = `<svg class="stat-icon" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.7 2.8-.8 1.2z"/></svg>`;
      const iconMoney = `<svg class="stat-icon" viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>`;
      const NOMINA = { salarioBase: 1750905, auxTransporte: 250000, horasLegalesMes: 176, deduccionSaludBase: 70036.2, deduccionPensionBase: 70036.2 };
      
      let isMoneyMode = false; let appData = { weekStr: '0 min', monthStr: '0 min', weekSecs: 0, monthSecs: 0 }; let editingRowNumber = null;

      async function apiCall(action, params = {}) {
        if (API_URL === "AQUI_TU_ENLACE_DE_APPS_SCRIPT") { alert("Falta el enlace API_URL en el código HTML."); return; }
        try {
          const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: action, ...params }), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          return data;
        } catch (e) { alert("Error de servidor: " + e.message); throw e; }
      }

      window.addEventListener('load', () => { document.getElementById('icon-week-container').innerHTML = iconTime; document.getElementById('icon-month-container').innerHTML = iconTime; refreshAll(); });

      function refreshAll() {
        apiCall('getCurrentState').then(ui => {
          document.getElementById('loading-overlay').classList.add('hidden');
          document.getElementById('main-content').classList.remove('hidden');
          renderStatus(ui);
        });
        updateHistoryOnly();
      }

      function renderStatus(s) {
        const t = document.getElementById('status-text'); const l = document.getElementById('status-label');
        if (s.active) {
          document.getElementById('btn-entrada').classList.add('hidden'); document.getElementById('btn-salida').classList.remove('hidden');
          l.innerText = "Turno Activo"; t.innerHTML = `<span style="color:var(--success)">Trabajando</span> desde las ${s.startTime}`;
        } else {
          document.getElementById('btn-entrada').classList.remove('hidden'); document.getElementById('btn-salida').classList.add('hidden');
          l.innerText = "Disponibilidad"; t.innerHTML = `<span style="color:var(--text-main)">Fuera de turno</span>`;
        }
      }

      function getGPS(callback) {
        if (!navigator.geolocation) { callback(null); return; }
        navigator.geolocation.getCurrentPosition( p => callback({ lat: p.coords.latitude, lng: p.coords.longitude }), () => callback(null), { enableHighAccuracy: true, timeout: 4000, maximumAge: 60000 } );
      }

      function getLocalTimeStr() { const n = new Date(); let h = n.getHours(); let m = n.getMinutes(); const a = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; m = m < 10 ? '0' + m : m; return h + ':' + m + ' ' + a; }
      function setLoading(b, t, d=true) { b.disabled = d; b.innerText = t; }

      document.getElementById('btn-entrada').onclick = () => { renderStatus({ active: true, startTime: getLocalTimeStr() }); apiCall('registrarEntrada').then(updateHistoryOnly); };
      document.getElementById('btn-salida').onclick = () => { 
        const btn = document.getElementById('btn-salida'); setLoading(btn, "LOCALIZANDO..."); 
        getGPS(c => { renderStatus({ active: false }); setLoading(btn, "Terminar Turno", false); apiCall('registrarSalida', {coords: c}).then(updateHistoryOnly); }); 
      };
      document.getElementById('btn-eliminar').onclick = () => { if(confirm("⚠️ ¿Eliminar último?")){ const b = document.getElementById('btn-eliminar'); b.innerText = "..."; apiCall('eliminarUltimoRegistro').then(() => { b.innerText = "Eliminar Último"; refreshAll(); }); } };

      function calcularNetoCOP(s) {
        if (!s || s <= 0) return "$ 0";
        let h = s / 3600; let p = h / NOMINA.horasLegalesMes; let n = (NOMINA.salarioBase * p) + (NOMINA.auxTransporte * p) - (NOMINA.deduccionSaludBase + NOMINA.deduccionPensionBase);
        return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.max(0, n));
      }

      function toggleMoneyMode() {
        isMoneyMode = !isMoneyMode;
        [0,1].forEach(idx => {
          const c = document.getElementById(idx===0?'card-week':'card-month'); const i = document.getElementById(idx===0?'icon-week-container':'icon-month-container'); const l = document.getElementById(idx===0?'lbl-week':'lbl-month'); const v = document.getElementById(idx===0?'val-week':'val-month');
          if (isMoneyMode) { c.classList.add('money-active'); i.innerHTML = iconMoney; l.innerText = "Neto " + (idx===0?"Sem":"Mes"); v.innerText = calcularNetoCOP(idx===0?appData.weekSecs:appData.monthSecs); } 
          else { c.classList.remove('money-active'); i.innerHTML = iconTime; l.innerText = (idx===0?"Semana":"Mes"); v.innerText = idx===0?appData.weekStr:appData.monthStr; }
        });
      }

      function updateHistoryOnly() {
        apiCall('getRecentHistory').then(d => {
          appData = { weekStr: d.semanaTotal, monthStr: d.mesTotal, weekSecs: d.semanaSegundos || 0, monthSecs: d.mesSegundos || 0 };
          isMoneyMode = !isMoneyMode; toggleMoneyMode(); document.getElementById('stats-container').classList.remove('hidden');
          const hb = document.getElementById('history-body');
          if (!d.history || d.history.length === 0) { hb.innerHTML = '<tr><td colspan="5" style="text-align:center; opacity:0.5;">Sin registros</td></tr>'; return; }
          hb.innerHTML = d.history.map(r => `<tr class="tr-hoverable" onclick="openEditModal(${r.rowNumber}, '${r.fecha}', '${r.in24}', '${r.out24}')"><td>${r.fecha}</td><td>${r.entrada}</td><td>${r.salida}</td><td class="txt-total"><b>${r.horas}</b></td><td class="txt-rango">${r.rango}</td></tr>`).join('');
        });
      }

      function openEditModal(rn, f, i, o) { editingRowNumber = rn; document.getElementById('edit-date').innerText = f; document.getElementById('edit-in').value = i||""; document.getElementById('edit-out').value = o||""; document.getElementById('edit-modal').classList.remove('hidden'); }
      function closeEditModal() { editingRowNumber = null; document.getElementById('edit-modal').classList.add('hidden'); }
      function saveEdit() {
        if (!editingRowNumber) return; const b = document.getElementById('btn-save-edit'); b.innerText = "Guardando..."; b.disabled = true;
        apiCall('actualizarRegistro', { rowNumber: editingRowNumber, nuevaEntrada: document.getElementById('edit-in').value, nuevaSalida: document.getElementById('edit-out').value }).then(() => { closeEditModal(); b.innerText = "Guardar"; b.disabled = false; refreshAll(); });
      }

      function openManualModal() { document.getElementById('man-date').valueAsDate = new Date(); document.getElementById('manual-modal').classList.remove('hidden'); }
      function closeManualModal() { document.getElementById('manual-modal').classList.add('hidden'); }
      function saveManual() {
        const d = { fecha: document.getElementById('man-date').value, entrada: document.getElementById('man-in').value, salida: document.getElementById('man-out').value };
        if(!d.fecha || !d.entrada || !d.salida) return; const b = document.getElementById('btn-save-manual'); b.innerText = "Agregando..."; b.disabled = true;
        apiCall('agregarJornadaManual', {data: d}).then(() => { closeManualModal(); b.innerText = "Guardar"; b.disabled = false; refreshAll(); });
      }

      function handleNuevoMes() {
        if(confirm("⚠️ ¿Cerrar mes?\nSe archivará y volverá a 0.")){
          document.getElementById('loading-overlay').classList.remove('hidden'); document.getElementById('main-content').classList.add('hidden');
          apiCall('iniciarNuevoMesApp').then(() => { refreshAll(); alert("✅ Nuevo mes iniciado."); });
        }
      }
    </script>
  </body>
</html>
```
