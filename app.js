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
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbyVzZTJ3DR6r0q2dHVecrNeRaHaXpQ7JOpHazwz8mpte30tNU0ncrPmPhoHRQUYPW3h/exec';
let webAppUrl = DEFAULT_API_URL;
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
const elConnStatus       = $('connectionStatus');
const elBtnExportCSV     = $('btnExportCSV');
const elBtnResetLocal    = $('btnResetLocal');

const elFinishModal    = $('finishModal');
const elFinishNote     = $('finishNote');
const elFinishStart    = $('finishStart');
const elFinishEnd      = $('finishEnd');
const elFinishTotal    = $('finishTotal');
const elBtnFinishSkip  = $('btnFinishSkip');
const elBtnFinishSave  = $('btnFinishSave');

const elToast        = $('toastNotification');
const elToastMessage = $('toastMessage');

let finishRowNumber = null; // row to attach note to after finishing

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
  setupGreetingAndDate();
  loadSettings();
  setupEventListeners();

  // 1) Render cached data INSTANTLY (no network wait)
  renderFromCache();

  // 2) Then sync with backend in background
  refreshAll();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // Force check for SW updates every time the app opens
      reg.update().catch(() => {});
      // Auto-activate new SW without waiting for all tabs to close
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (newSW) {
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'activated') {
              // New SW activated — reload to get fresh assets
              window.location.reload();
            }
          });
        }
      });
    }).catch(() => {});
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
      mesSegundos: fullState.mesSegundos,
      diasMes: fullState.diasMes || {}
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
    renderCalendar(c.diasMes || {});
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
  // Auto-test connection on load
  autoTestConnection();
}

async function autoTestConnection() {
  setConnBadge('testing', 'Verificando...');
  try {
    const res = await fetch(webAppUrl, { method: 'GET', mode: 'cors' });
    const data = await res.json();
    if (data && (data.status === 'ok' || data.status === 'success')) {
      setConnBadge('connected', 'Conectado');
    } else {
      setConnBadge('disconnected', 'Sin respuesta');
    }
  } catch {
    setConnBadge('disconnected', 'Sin conexión');
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
    let data = await apiCall('getFullState', {}, signal);

    // Fallback: if backend doesn't recognize getFullState yet (old deployment),
    // use the legacy two-call approach so the app never breaks
    if (!data || data.error) {
      const [state, hist] = await Promise.all([
        apiCall('getCurrentState', {}, signal),
        apiCall('getRecentHistory', {}, signal)
      ]);
      if (state && hist) {
        data = { ...state, ...hist };
      }
    }

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
    renderCalendar(data.diasMes || {});

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

// --- CALENDAR ---
function renderCalendar(diasMes) {
  const grid = $('calendarGrid');
  const titleEl = $('calendarTitle');
  if (!grid || !titleEl) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();

  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  titleEl.textContent = `${meses[month]} ${year}`;

  // Clear existing day cells (keep headers)
  grid.querySelectorAll('.cal-day').forEach(el => el.remove());

  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Convert Sunday=0 to Monday-start: Mon=0, Tue=1, ..., Sun=6
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  // Empty cells for offset
  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('span');
    empty.className = 'cal-day empty';
    empty.style.setProperty('--i', i);
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('span');
    cell.style.setProperty('--i', startOffset + d);
    cell.textContent = d;

    const hours = diasMes[d] || 0;
    let cls = 'cal-day';

    if (d > today) {
      cls += ' future';
    } else if (hours === -1) {
      cls += ' active-shift';
    } else if (hours >= 6) {
      cls += ' worked-high';
    } else if (hours > 0) {
      cls += ' worked';
    } else {
      cls += ' no-work';
    }

    if (d === today) cls += ' today';
    cell.className = cls;

    // Tooltip (shown on tap via .show-tip class)
    if (hours > 0) {
      const tip = document.createElement('span');
      tip.className = 'cal-tooltip';
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      tip.textContent = `${h}h ${m}m`;
      cell.appendChild(tip);
      cell.addEventListener('click', () => toggleCalTip(cell));
    } else if (hours === -1) {
      const tip = document.createElement('span');
      tip.className = 'cal-tooltip';
      tip.textContent = 'En curso...';
      cell.appendChild(tip);
      cell.addEventListener('click', () => toggleCalTip(cell));
    }

    grid.appendChild(cell);
  }
}

// --- TAP CALENDARIO: INFO DEL DÍA ---
let _dayShiftsCurrent = []; // turnos del modal actual (para delegación)

function openDayShifts(day, month, year) {
  const dd = String(day).padStart(2, '0');
  const mm = String(month + 1).padStart(2, '0');
  const formatos = [dd + '/' + mm, year + '-' + mm + '-' + dd, day + '/' + (month + 1), mm + '/' + dd];
  const turnos = _lastHistory.filter(r => formatos.some(f => r.fecha === f));
  _dayShiftsCurrent = turnos;
  const diasMesHours = _lastDiasMes[day] || 0;

  // Crear modal dinámico si no existe (una sola vez)
  let modal = $('dayShiftsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'dayShiftsModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = '<div class="ios-modal day-shifts-modal"><div class="modal-handle"></div><div id="dayShiftsBody"></div></div>';
    document.body.appendChild(modal);

    const closeIt = () => {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    };

    // Cerrar al tocar el overlay (fuera del contenido)
    modal.addEventListener('click', e => {
      if (e.target === modal) closeIt();
    });

    // Delegación: cualquier click en .day-shift-item, .modal-close-btn, .day-add-shift-btn
    $('dayShiftsBody').addEventListener('click', e => {
      if (e.target.closest('.modal-close-btn')) {
        closeIt();
        return;
      }
      const addBtn = e.target.closest('.day-add-shift-btn');
      if (addBtn) {
        closeIt();
        openManualModal();
        if (addBtn.dataset.fecha) elManDate.value = addBtn.dataset.fecha;
        return;
      }
      const item = e.target.closest('.day-shift-item');
      if (item) {
        const idx = parseInt(item.dataset.idx, 10);
        const t = _dayShiftsCurrent[idx];
        if (!t) return;
        closeIt();
        openEditModal(t.rowNumber, t.fecha, t.in24, t.out24);
      }
    });
  }

  const dias  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dObj = new Date(year, month, day);
  const diaName = dias[dObj.getDay()];
  const fechaLarga = `${day} de ${meses[month]}, ${year}`;

  // Calcular horas totales del día y porcentaje de jornada (8h)
  let horasNum = 0;
  let statusLabel = '';
  let statusClass = '';
  let valueHTML = '';
  let isActive = false;

  if (diasMesHours === -1) {
    isActive = true;
    statusLabel = 'Turno en curso';
    statusClass = 'status-active';
    valueHTML = `<span class="day-hero-value">En curso</span>`;
  } else if (diasMesHours > 0) {
    horasNum = diasMesHours;
    const h = Math.floor(horasNum);
    const m = Math.round((horasNum - h) * 60);
    const fullJornada = horasNum >= 8;
    statusLabel = fullJornada ? 'Jornada completa ✓' : 'Jornada parcial';
    statusClass = fullJornada ? 'status-full' : 'status-partial';
    valueHTML = `
      <span class="day-hero-num">${h}</span><span class="day-hero-unit">h</span>
      <span class="day-hero-num">${m.toString().padStart(2,'0')}</span><span class="day-hero-unit">m</span>`;
  } else {
    statusLabel = 'Sin actividad';
    statusClass = 'status-empty';
    valueHTML = `<span class="day-hero-value">—</span>`;
  }

  const pct = Math.min(100, Math.round((horasNum / 8) * 100));
  // SVG progress ring (r=54, c≈339.29)
  const C = 339.29;
  const dashOffset = C - (C * pct / 100);

  let html = `
    <div class="day-modal-header">
      <div class="day-modal-head-text">
        <div class="day-modal-day">${diaName}</div>
        <div class="day-modal-date">${fechaLarga}</div>
      </div>
      <button class="modal-close-btn day-modal-close" type="button" aria-label="Cerrar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>
    </div>

    <div class="day-hero ${statusClass}">
      <div class="day-hero-ring">
        <svg viewBox="0 0 120 120" class="day-ring-svg">
          <circle cx="60" cy="60" r="54" class="day-ring-bg"/>
          <circle cx="60" cy="60" r="54" class="day-ring-fg"
                  stroke-dasharray="${C}" stroke-dashoffset="${dashOffset}"
                  style="${isActive ? 'animation: dayRingPulse 2s ease-in-out infinite;' : ''}"/>
        </svg>
        <div class="day-hero-content">
          ${valueHTML}
          <div class="day-hero-label">${isActive ? '' : 'de 8h jornada'}</div>
        </div>
      </div>
      <div class="day-hero-status">${statusLabel}</div>
    </div>`;

  if (turnos.length > 0) {
    html += `<div class="day-shifts-section">
      <div class="day-shifts-section-title">
        <span>${turnos.length === 1 ? 'TURNO' : 'TURNOS'}</span>
        <span class="day-shifts-section-count">${turnos.length}</span>
      </div>
      <div class="day-shifts-list">`;
    turnos.forEach((t, i) => {
      html += `
        <div class="day-shift-item" role="button" tabindex="0" data-idx="${i}">
          <div class="day-shift-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div class="day-shift-body">
            <div class="day-shift-times-row">
              <span class="day-shift-time-in">${t.entrada}</span>
              <span class="day-shift-arrow">→</span>
              <span class="day-shift-time-out">${t.salida || '··:··'}</span>
            </div>
            <div class="day-shift-hrs-badge">${t.horas}</div>
          </div>
          <div class="day-shift-edit-chevron" aria-label="Editar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>`;
    });
    html += '</div></div>';
  } else if (diasMesHours > 0) {
    html += `
    <div class="day-section-sep"></div>
    <div class="day-info-card">
      <div class="day-info-card-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <line x1="12" y1="14" x2="12" y2="16"/><circle cx="12" cy="18" r="0.8" fill="currentColor" stroke="none"/>
        </svg>
      </div>
      <div class="day-info-card-body">
        <p class="day-info-card-title">Fuera del historial reciente</p>
        <p class="day-info-card-sub">Los últimos 7 turnos son editables. Este quedó más atrás — edítalo directamente en Google Sheets.</p>
      </div>
    </div>
    <div class="day-section-sep"></div>
    <button class="day-add-shift-btn" type="button" data-fecha="${year}-${mm}-${dd}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Agregar otro turno
    </button>`;
  } else {
    html += `
    <div class="day-section-sep"></div>
    <div class="day-rest-state">
      <div class="day-rest-icon-wrap">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </div>
      <p class="day-rest-title">Día libre</p>
      <p class="day-rest-sub">Sin turnos registrados</p>
    </div>
    <div class="day-section-sep"></div>
    <button class="day-add-shift-btn" type="button" data-fecha="${year}-${mm}-${dd}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Registrar turno para este día
    </button>`;
  }

  $('dayShiftsBody').innerHTML = html;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

// Close calendar tooltips when tapping outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.cal-day')) {
    document.querySelectorAll('.cal-day.show-tip').forEach(el => el.classList.remove('show-tip'));
  }
});

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
function burstAnimation(type) {
  elBtnAction.classList.add('state-transitioning');
  setTimeout(() => {
    elBtnAction.classList.remove('state-transitioning');
    elBtnAction.classList.add(type === 'start' ? 'burst-start' : 'burst-stop');
    setTimeout(() => elBtnAction.classList.remove('burst-start', 'burst-stop'), 600);
  }, 200);
}

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
        burstAnimation('start');
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

        // Show finish modal with shift summary
        finishRowNumber = r.lastRow || null;
        elFinishStart.textContent = r.entrada || '--';
        elFinishEnd.textContent = r.salida || '--';
        // Calculate total from entry/exit strings
        elFinishTotal.textContent = calcTotalFromTimes(r.entrada, r.salida);
        elFinishNote.value = '';
        openModal(elFinishModal);
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

    const diaLabel = r.dia ? ` — ${r.dia}` : '';
    const descText = r.descripcion || 'Sin descripción';
    const descClass = r.descripcion ? '' : 'empty-note';

    card.innerHTML = `
      <div class="shift-item-top">
        <span class="shift-item-date">${r.fecha}${diaLabel}</span>
        <span class="shift-item-duration">${r.horas}</span>
      </div>
      <div class="shift-item-times">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>${r.entrada} — ${r.salida}</span>
      </div>
      <div class="shift-item-bottom">
        <span class="shift-item-note ${descClass}">${descText}</span>
        <button class="btn-delete-shift" data-row="${r.rowNumber}" aria-label="Eliminar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    // Attach delete handler
    card.querySelector('.btn-delete-shift').addEventListener('click', (e) => handleDeleteShift(r.rowNumber, e));

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
    salida: elManOut.value,
    descripcion: $('manDesc') ? $('manDesc').value.trim() : ''
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
// testConnection removed — auto-test on load via autoTestConnection()

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

// --- FINISH MODAL HELPERS ---
function calcTotalFromTimes(entrada, salida) {
  if (!entrada || !salida || entrada === '--' || salida === '--') return '0m';
  const toSecs = t => { const p = t.split(':'); return (+p[0])*3600 + (+p[1])*60 + (+(p[2]||0)); };
  let diff = toSecs(salida) - toSecs(entrada);
  if (diff < 0) diff += 86400; // overnight shift
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function handleFinishSave() {
  if (!finishRowNumber) { closeModal(elFinishModal); refreshAll(); return; }
  const nota = elFinishNote.value.trim();
  elBtnFinishSave.textContent = 'Guardando...';
  elBtnFinishSave.disabled = true;
  if (nota) await apiCall('guardarNota', { rowNumber: finishRowNumber, nota });
  elBtnFinishSave.textContent = 'Guardar Turno';
  elBtnFinishSave.disabled = false;
  finishRowNumber = null;
  closeModal(elFinishModal);
  showToast('Turno guardado');
  refreshAll();
}

function handleFinishSkip() {
  finishRowNumber = null;
  closeModal(elFinishModal);
  showToast('Turno finalizado');
  burstAnimation('stop');
  refreshAll();
}

async function handleDeleteShift(rowNumber, e) {
  e.stopPropagation(); // don't open edit modal
  if (!confirm('¿Eliminar este registro?')) return;
  const r = await apiCall('eliminarRegistro', { rowNumber });
  if (r && r.success) {
    showToast('Registro eliminado');
    refreshAll();
  }
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

  elBtnFinishSave.addEventListener('click', handleFinishSave);
  elBtnFinishSkip.addEventListener('click', handleFinishSkip);
  elFinishModal.addEventListener('click', e => { if (e.target === elFinishModal) handleFinishSkip(); });

  elBtnSettings.addEventListener('click', () => openModal(elSettingsModal));
  elBtnCloseSettings.addEventListener('click', () => {
    closeModal(elSettingsModal);
  });
  elSettingsModal.addEventListener('click', e => { if (e.target === elSettingsModal) elBtnCloseSettings.click(); });

  elBtnExportCSV.addEventListener('click', exportCSV);
  elBtnResetLocal.addEventListener('click', () => {
    if (confirm('¿Limpiar cache local? Los datos en Google Sheets no se tocan.')) {
      localStorage.removeItem('activeStartTime');
      activeStartTime = null;
      if (timerInterval) clearInterval(timerInterval);
      elTimerDisplay.textContent = '00:00:00';
      setActionButtonState(false);
      showToast('Cache limpiado');
      refreshAll();
    }
  });

  // Resync with backend when tab becomes visible again (handles sleep/background)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isActionBusy) {
      refreshAll();
    }
  });
}
