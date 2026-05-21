/* ==========================================================================
   WORKCLOCK PRO — LÓGICA DE APLICACIÓN (GOOGLE SHEETS BACKEND)
   ========================================================================== */

const NOMINA = {
  salarioBase: 1750905,
  auxTransporte: 250000,
  horasLegalesMes: 176,
  deduccionSalud: 70000,
  deduccionPension: 70000
};

// --- ESTADO ---
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbw1X-9KmoFH63FuUX6eNaKAD1YdIkORQ6In6g8veOLPTH3JhG27P6Kursw5YvrKSj-O/exec';
let webAppUrl = localStorage.getItem('webAppUrl') || DEFAULT_API_URL;
let isMoneyMode = false;
let appData = { weekStr: '--', monthStr: '--', weekSecs: 0, monthSecs: 0 };
let timerInterval = null;
let activeStartTime = JSON.parse(localStorage.getItem('activeStartTime')) || null;
let editingRowNumber = null;
let isActionBusy = false;    // bloquea el botón durante una acción
let isRefreshing = false;    // bloquea refresh durante una acción
let actionEpoch = 0;         // monotonic counter — stale async responses are discarded
let historySeq = 0;          // sequence counter for updateHistory deduplication
let refreshAbort = null;     // AbortController for in-flight refresh calls
let actionAbort = null;      // AbortController for in-flight action calls

// --- DOM ---
const $ = id => document.getElementById(id);

const elGreeting       = $('headerGreeting');
const elDateBadge      = $('currentDateBadge');
const elTimerDisplay   = $('timerDisplay');
const elTimerStatus    = $('timerStatusLabel');
const elBtnAction      = $('btnAction');
const elBtnActionLabel = $('btnActionLabel');

const elStatsGrid  = $('statsGrid');
const elCardWeek   = $('cardWeek');
const elCardMonth  = $('cardMonth');
const elLblWeek    = $('lblWeek');
const elLblMonth   = $('lblMonth');
const elValWeek    = $('valWeek');
const elValMonth   = $('valMonth');

const elBtnAddManual     = $('btnAddManual');
const elBtnNuevoMes      = $('btnNuevoMes');
const elBtnEliminarUlt   = $('btnEliminarUltimo');
const elHistoryList      = $('historyList');
const elEmptyState       = $('emptyState');
const elHistoryHint      = $('historyHint');

const elEditModal    = $('editModal');
const elEditDate     = $('editDate');
const elEditIn       = $('editIn');
const elEditOut      = $('editOut');
const elBtnCancelEdit = $('btnCancelEdit');
const elBtnSaveEdit  = $('btnSaveEdit');

const elManualModal    = $('manualModal');
const elManDate        = $('manDate');
const elManIn          = $('manIn');
const elManOut         = $('manOut');
const elBtnCancelMan   = $('btnCancelManual');
const elBtnSaveMan     = $('btnSaveManual');

const elSettingsModal    = $('settingsModal');
const elBtnSettings      = $('btnSettings');
const elBtnCloseSettings = $('btnCloseSettings');
const elInputUrl         = $('inputSheetUrl');
const elBtnTestConn      = $('btnTestConnection');
const elConnStatus       = $('connectionStatus');
const elBtnExportCSV     = $('btnExportCSV');
const elBtnResetLocal    = $('btnResetLocal');

const elToast        = $('toastNotification');
const elToastMessage = $('toastMessage');

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
  setupGreetingAndDate();
  loadSettings();
  setupEventListeners();

  // 1) Render cached data INSTANTLY (no network wait)
  renderFromCache();

  // 2) Then sync with backend in background
  if (webAppUrl) {
    refreshAll();
  } else {
    checkActiveShiftState();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// --- LOCAL CACHE (instant load) ---
function saveToCache(fullState) {
  try {
    localStorage.setItem('wc_cache', JSON.stringify({
      ts: Date.now(),
      active: fullState.active,
      startTime: fullState.startTime,
      startTimestamp: fullState.startTimestamp,
      history: fullState.history,
      semanaTotal: fullState.semanaTotal,
      mesTotal: fullState.mesTotal,
      semanaSegundos: fullState.semanaSegundos,
      mesSegundos: fullState.mesSegundos
    }));
  } catch(e) { /* quota exceeded — ignore */ }
}

function renderFromCache() {
  try {
    const raw = localStorage.getItem('wc_cache');
    if (!raw) return;
    const c = JSON.parse(raw);
    // Show cached stats immediately
    appData = {
      weekStr: c.semanaTotal || '0 min',
      monthStr: c.mesTotal || '0 min',
      weekSecs: c.semanaSegundos || 0,
      monthSecs: c.mesSegundos || 0
    };
    renderStats();
    renderHistory(c.history || []);
    // Restore active shift UI from cache
    if (c.active && c.startTimestamp) {
      activeStartTime = c.startTimestamp;
      localStorage.setItem('activeStartTime', JSON.stringify(activeStartTime));
      setActionButtonState(true);
      startTimerUI(activeStartTime);
      elTimerStatus.textContent = 'Turno activo';
      elTimerStatus.style.color = 'var(--system-orange)';
    }
  } catch(e) { /* corrupt cache — ignore */ }
}

// --- GREETING & DATE ---
function setupGreetingAndDate() {
  const now = new Date();
  const h = now.getHours();
  elGreeting.textContent = h >= 6 && h < 12 ? '¡Buenos días!' : h < 19 ? '¡Buenas tardes!' : '¡Buenas noches!';

  let ds = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  elDateBadge.textContent = ds.charAt(0).toUpperCase() + ds.slice(1);
}

// --- SETTINGS ---
function loadSettings() {
  if (webAppUrl) {
    elInputUrl.value = webAppUrl;
    setConnBadge('connected', 'Configurado');
  } else {
    setConnBadge('disconnected', 'No Configurado');
  }
}

function setConnBadge(status, text) {
  elConnStatus.className = 'connection-status';
  elConnStatus.classList.add(
    status === 'connected' ? 'badge-connected' :
    status === 'testing'   ? 'badge-testing'   : 'badge-disconnected'
  );
  elConnStatus.textContent = text;
}

// --- API ---
async function apiCall(action, params = {}, signal = null) {
  if (!webAppUrl) {
    showToast('Configura la URL en Ajustes');
    return null;
  }
  try {
    const fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...params })
    };
    if (signal) fetchOpts.signal = signal;
    const res = await fetch(webAppUrl, fetchOpts);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    // Silently ignore aborted requests — they are intentional
    if (e.name === 'AbortError') return null;
    showToast('Error: ' + e.message);
    return null;
  }
}

// --- REFRESH (single API call) ---
async function refreshAll() {
  if (isActionBusy) return;
  if (isRefreshing && refreshAbort) refreshAbort.abort();
  isRefreshing = true;
  const myEpoch = actionEpoch;
  refreshAbort = new AbortController();
  const signal = refreshAbort.signal;

  try {
    // ONE call returns active state + history + stats
    const data = await apiCall('getFullState', {}, signal);

    // Discard stale response
    if (actionEpoch !== myEpoch || isActionBusy) return;
    if (!data) return;

    // --- Active shift state ---
    if (data.active) {
      setActionButtonState(true);
      elTimerStatus.textContent = 'Trabajando desde ' + data.startTime;
      elTimerStatus.style.color = 'var(--system-orange)';
      if (!activeStartTime) {
        activeStartTime = data.startTimestamp || Date.now();
        localStorage.setItem('activeStartTime', JSON.stringify(activeStartTime));
      }
      startTimerUI(activeStartTime);
    } else {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      activeStartTime = null;
      localStorage.removeItem('activeStartTime');
      setActionButtonState(false);
      elTimerDisplay.textContent = '00:00:00';
      elTimerStatus.textContent = 'Turno inactivo';
      elTimerStatus.style.color = 'var(--text-secondary)';
    }

    // --- Stats + History ---
    appData = {
      weekStr: data.semanaTotal || '0 min',
      monthStr: data.mesTotal || '0 min',
      weekSecs: data.semanaSegundos || 0,
      monthSecs: data.mesSegundos || 0
    };
    renderStats();
    renderHistory(data.history || []);

    // Save to cache for instant next load
    saveToCache(data);
  } finally {
    isRefreshing = false;
    refreshAbort = null;
  }
}

// --- STATS & NÓMINA ---
function renderStats() {
  if (isMoneyMode) {
    elLblWeek.textContent = 'Neto Sem';
    elLblMonth.textContent = 'Neto Mes';
    elValWeek.textContent = calcNetoCOP(appData.weekSecs);
    elValMonth.textContent = calcNetoCOP(appData.monthSecs);
    elCardWeek.classList.add('money-active');
    elCardMonth.classList.add('money-active');
  } else {
    elLblWeek.textContent = 'Esta Semana';
    elLblMonth.textContent = 'Este Mes';
    elValWeek.textContent = appData.weekStr;
    elValMonth.textContent = appData.monthStr;
    elCardWeek.classList.remove('money-active');
    elCardMonth.classList.remove('money-active');
  }
}

function calcNetoCOP(secs) {
  if (!secs || secs <= 0) return '$0';
  const h = secs / 3600;
  const p = h / NOMINA.horasLegalesMes;
  const neto = (NOMINA.salarioBase * p) + (NOMINA.auxTransporte * p) - NOMINA.deduccionSalud - NOMINA.deduccionPension;
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.max(0, neto));
}

function toggleMoneyMode() {
  if (navigator.vibrate) navigator.vibrate(10);
  isMoneyMode = !isMoneyMode;
  renderStats();
}

// --- TIMER UI ---
function checkActiveShiftState() {
  if (activeStartTime) {
    setActionButtonState(true);
    startTimerUI(activeStartTime);
    elTimerStatus.textContent = 'Turno activo';
    elTimerStatus.style.color = 'var(--system-orange)';
  }
}

function setActionButtonState(active) {
  if (active) {
    elBtnAction.className = 'action-btn state-stop';
    elBtnActionLabel.textContent = 'Terminar Turno';
  } else {
    elBtnAction.className = 'action-btn state-start';
    elBtnActionLabel.textContent = 'Iniciar Turno';
  }
}

function startTimerUI(startTime) {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    const ms = Date.now() - startTime;
    elTimerDisplay.innerHTML = formatHMS(ms);
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

function formatHMS(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  const colon = '<span class="blink">:</span>';
  return `${pad(h)}${colon}${pad(m)}${colon}${pad(s)}`;
}

// --- ACTION BUTTON (START/STOP) ---
function lockButton() {
  elBtnAction.disabled = true;
  elBtnAction.setAttribute('aria-disabled', 'true');
  elBtnAction.style.opacity = '0.4';
  elBtnAction.style.transform = 'scale(0.95)';
}
function unlockButton() {
  elBtnAction.disabled = false;
  elBtnAction.removeAttribute('aria-disabled');
  elBtnAction.style.opacity = '';
  elBtnAction.style.transform = '';
}

async function handleAction() {
  // Hard guard — if already processing, reject completely
  if (isActionBusy) return;
  isActionBusy = true;
  actionEpoch++;               // invalidate all in-flight refresh/history responses
  const myEpoch = actionEpoch; // capture for staleness checks

  // Abort any in-flight refresh — it would apply stale data
  if (refreshAbort) { refreshAbort.abort(); refreshAbort = null; }
  isRefreshing = false;

  // Create abort controller for this action
  if (actionAbort) actionAbort.abort();
  actionAbort = new AbortController();
  const signal = actionAbort.signal;

  lockButton();
  if (navigator.vibrate) navigator.vibrate(15);

  // Snapshot current state so we can restore on failure
  const wasActive = !!activeStartTime;
  const savedStartTime = activeStartTime;

  try {
    if (!wasActive) {
      // ═══ INICIAR TURNO ═══
      elBtnActionLabel.textContent = 'Registrando...';
      elTimerStatus.textContent = 'Conectando...';
      elTimerStatus.style.color = 'var(--system-orange)';

      const r = await apiCall('registrarEntrada', {}, signal);

      // If a newer action started while we awaited, bail out silently
      if (actionEpoch !== myEpoch) return;

      if (r && r.success) {
        activeStartTime = r.startTimestamp || Date.now();
        localStorage.setItem('activeStartTime', JSON.stringify(activeStartTime));
        startTimerUI(activeStartTime);
        setActionButtonState(true);
        elTimerStatus.textContent = 'Turno activo';
        elTimerStatus.style.color = 'var(--system-orange)';
        showToast('Turno iniciado');
      } else {
        // Failed — restore clean inactive UI
        setActionButtonState(false);
        elTimerDisplay.textContent = '00:00:00';
        elTimerStatus.textContent = r ? 'Error al iniciar' : 'Sin conexión';
        elTimerStatus.style.color = 'var(--text-secondary)';
      }
    } else {
      // ═══ TERMINAR TURNO ═══
      // Show "finalizing" feedback but do NOT clear activeStartTime yet
      clearInterval(timerInterval);
      timerInterval = null;
      elBtnActionLabel.textContent = 'Finalizando...';
      elTimerStatus.textContent = 'Finalizando...';
      elTimerStatus.style.color = 'var(--text-secondary)';

      const r = await apiCall('registrarSalida', { coords: null }, signal);

      if (actionEpoch !== myEpoch) return;

      if (r && r.success) {
        // Only NOW clear the active state — backend confirmed
        activeStartTime = null;
        localStorage.removeItem('activeStartTime');
        setActionButtonState(false);
        elTimerDisplay.textContent = '00:00:00';
        elTimerStatus.textContent = 'Turno inactivo';
        showToast('Turno finalizado');
      } else {
        // Failed — RESTORE the active state so user can retry
        activeStartTime = savedStartTime;
        startTimerUI(activeStartTime);
        setActionButtonState(true);
        elTimerStatus.textContent = r ? 'Error al finalizar — reintenta' : 'Sin conexión — reintenta';
        elTimerStatus.style.color = 'var(--system-orange)';
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    // Restore previous state on unexpected error
    if (wasActive) {
      activeStartTime = savedStartTime;
      startTimerUI(activeStartTime);
      setActionButtonState(true);
      elTimerStatus.textContent = 'Error — reintenta';
      elTimerStatus.style.color = 'var(--system-orange)';
    } else {
      setActionButtonState(false);
      elTimerDisplay.textContent = '00:00:00';
      elTimerStatus.textContent = 'Error — reintenta';
      elTimerStatus.style.color = 'var(--text-secondary)';
    }
    showToast('Error de conexión');
  } finally {
    // Only unlock if this is still the current action
    if (actionEpoch === myEpoch) {
      isActionBusy = false;
      actionAbort = null;
      unlockButton();
      // Sync with backend — no delay, no setTimeout
      refreshAll();
    }
  }
}

// --- HISTORY RENDER ---
function renderHistory(history) {
  elHistoryList.innerHTML = '';

  if (!history || history.length === 0) {
    elHistoryList.appendChild(elEmptyState);
    elEmptyState.style.display = 'flex';
    elHistoryHint.style.display = 'none';
    return;
  }

  elEmptyState.style.display = 'none';
  elHistoryHint.style.display = 'block';

  history.forEach(r => {
    const card = document.createElement('div');
    card.className = 'shift-item-card';
    card.addEventListener('click', () => openEditModal(r.rowNumber, r.fecha, r.in24, r.out24));

    const rangoClass = r.rango && r.rango.includes('En sitio') ? 'rango-ok' :
                       r.rango && r.rango.includes('Fuera')    ? 'rango-out' :
                       r.rango && r.rango.includes('Manual')   ? 'rango-manual' : 'rango-neutral';

    card.innerHTML = `
      <div class="shift-item-top">
        <span class="shift-item-date">${r.fecha}</span>
        <span class="shift-item-duration">${r.horas}</span>
      </div>
      <div class="shift-item-times">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>${r.entrada} — ${r.salida}</span>
      </div>
      <div class="shift-item-bottom">
        <span class="shift-rango ${rangoClass}">${r.rango || '--'}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </div>
    `;

    elHistoryList.appendChild(card);
  });
}

// --- EDIT MODAL ---
function openEditModal(rowNumber, fecha, in24, out24) {
  editingRowNumber = rowNumber;
  elEditDate.textContent = fecha;
  elEditIn.value = in24 || '';
  elEditOut.value = out24 || '';
  openModal(elEditModal);
}

async function saveEdit() {
  if (!editingRowNumber) return;
  elBtnSaveEdit.textContent = 'Guardando...';
  elBtnSaveEdit.disabled = true;

  const r = await apiCall('actualizarRegistro', {
    rowNumber: editingRowNumber,
    nuevaEntrada: elEditIn.value,
    nuevaSalida: elEditOut.value
  });

  elBtnSaveEdit.textContent = 'Guardar';
  elBtnSaveEdit.disabled = false;

  if (r && r.success) {
    closeModal(elEditModal);
    showToast('Turno actualizado');
    refreshAll();
  }
}

// --- MANUAL MODAL ---
function openManualModal() {
  const today = new Date();
  elManDate.value = today.toISOString().split('T')[0];
  elManIn.value = '';
  elManOut.value = '';
  openModal(elManualModal);
}

async function saveManual() {
  const data = {
    fecha: elManDate.value,
    entrada: elManIn.value,
    salida: elManOut.value
  };
  if (!data.fecha || !data.entrada || !data.salida) {
    showToast('Completa todos los campos');
    return;
  }

  elBtnSaveMan.textContent = 'Agregando...';
  elBtnSaveMan.disabled = true;

  const r = await apiCall('agregarJornadaManual', { data });

  elBtnSaveMan.textContent = 'Guardar';
  elBtnSaveMan.disabled = false;

  if (r && r.success) {
    closeModal(elManualModal);
    showToast('Jornada agregada');
    refreshAll();
  }
}

// --- ELIMINAR ÚLTIMO ---
async function handleEliminarUltimo() {
  if (!confirm('¿Eliminar el último registro?')) return;

  elBtnEliminarUlt.textContent = '...';
  const r = await apiCall('eliminarUltimoRegistro');
  elBtnEliminarUlt.textContent = 'Eliminar Último';

  if (r && r.success) {
    showToast('Registro eliminado');
    refreshAll();
  }
}

// --- NUEVO MES ---
async function handleNuevoMes() {
  if (!confirm('⚠️ ¿Cerrar mes?\nSe archivará toda la data y se empezará de 0.')) return;

  showToast('Archivando mes...');
  const r = await apiCall('iniciarNuevoMesApp');

  if (r && r.success) {
    showToast('Nuevo mes iniciado' + (r.archivoCreado ? ': ' + r.archivoCreado : ''));
    refreshAll();
  }
}

// --- TEST CONNECTION ---
async function testConnection() {
  const url = elInputUrl.value.trim();
  if (!url) { showToast('Introduce una URL'); return; }

  setConnBadge('testing', 'Probando...');
  elBtnTestConn.disabled = true;

  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    const data = await res.json();
    if (data && (data.status === 'ok' || data.status === 'success')) {
      setConnBadge('connected', 'Conectado');
      showToast('Conexión exitosa');
    } else {
      throw new Error();
    }
  } catch {
    setConnBadge('disconnected', 'Error');
    showToast('Error de conexión');
  } finally {
    elBtnTestConn.disabled = false;
  }
}

// --- EXPORT CSV (from current history cache) ---
function exportCSV() {
  showToast('Cargando datos...');
  apiCall('getRecentHistory').then(data => {
    if (!data || !data.history || data.history.length === 0) {
      showToast('No hay datos para exportar');
      return;
    }
    let csv = 'data:text/csv;charset=utf-8,';
    csv += 'Fecha,Entrada,Salida,Horas,Rango\r\n';
    data.history.forEach(r => {
      csv += `${r.fecha},${r.entrada},${r.salida},${r.horas},"${r.rango || ''}"\r\n`;
    });
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `WorkClock_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV descargado');
  });
}

// --- MODALS ---
function openModal(modal) {
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
  modal.classList.remove('active');
  document.body.style.overflow = '';
}

// --- TOAST ---
let toastTimeout = null;
function showToast(msg) {
  elToastMessage.textContent = msg;
  elToast.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elToast.classList.remove('show'), 3000);
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  // --- Action button: disable double-tap-to-zoom and prevent ghost clicks ---
  // CSS touch-action should also be set on .action-btn: touch-action: manipulation;
  elBtnAction.addEventListener('click', handleAction, { passive: false });

  // Prevent iOS Safari from queuing extra touch events that become ghost clicks.
  // A touchend on the action button calls preventDefault to suppress the
  // synthesized click — handleAction is triggered by the first click only.
  // We do NOT add a touchstart handler that calls handleAction because
  // the 'click' event is the reliable cross-platform choice; instead we
  // just prevent the duplicate synthesized click on iOS.
  let actionTouchHandled = false;
  elBtnAction.addEventListener('touchstart', () => {
    actionTouchHandled = false;
  }, { passive: true });
  elBtnAction.addEventListener('touchend', (e) => {
    if (actionTouchHandled) {
      e.preventDefault(); // suppress duplicate click synthesis
      return;
    }
    actionTouchHandled = true;
  }, { passive: false });

  elStatsGrid.addEventListener('click', toggleMoneyMode);

  elBtnAddManual.addEventListener('click', openManualModal);
  elBtnNuevoMes.addEventListener('click', handleNuevoMes);
  elBtnEliminarUlt.addEventListener('click', handleEliminarUltimo);

  elBtnCancelEdit.addEventListener('click', () => closeModal(elEditModal));
  elBtnSaveEdit.addEventListener('click', saveEdit);
  elEditModal.addEventListener('click', e => { if (e.target === elEditModal) closeModal(elEditModal); });

  elBtnCancelMan.addEventListener('click', () => closeModal(elManualModal));
  elBtnSaveMan.addEventListener('click', saveManual);
  elManualModal.addEventListener('click', e => { if (e.target === elManualModal) closeModal(elManualModal); });

  elBtnSettings.addEventListener('click', () => openModal(elSettingsModal));
  elBtnCloseSettings.addEventListener('click', () => {
    const newUrl = elInputUrl.value.trim();
    if (newUrl !== webAppUrl) {
      webAppUrl = newUrl;
      localStorage.setItem('webAppUrl', webAppUrl);
      showToast(webAppUrl ? 'URL guardada' : 'URL eliminada');
      loadSettings();
      if (webAppUrl) refreshAll();
    }
    closeModal(elSettingsModal);
  });
  elSettingsModal.addEventListener('click', e => { if (e.target === elSettingsModal) elBtnCloseSettings.click(); });

  elBtnTestConn.addEventListener('click', testConnection);
  elBtnExportCSV.addEventListener('click', exportCSV);
  elBtnResetLocal.addEventListener('click', () => {
    if (confirm('¿Limpiar cache local? Los datos en Google Sheets no se tocan.')) {
      localStorage.removeItem('activeStartTime');
      activeStartTime = null;
      if (timerInterval) clearInterval(timerInterval);
      elTimerDisplay.textContent = '00:00:00';
      setActionButtonState(false);
      showToast('Cache limpiado');
      if (webAppUrl) refreshAll();
    }
  });

  // Resync with backend when tab becomes visible again (handles sleep/background)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && webAppUrl && !isActionBusy) {
      refreshAll();
    }
  });
}
