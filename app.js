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
const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbw5bHc_dJBeAgSpmX9yzrXhYcVegOBKq6H15S4571kT1ZtbidEspISeOFIaP96d2MSq/exec';
let webAppUrl = DEFAULT_API_URL;
let isMoneyMode = false;
let appData = { weekStr: '--', monthStr: '--', weekSecs: 0, monthSecs: 0 };
let _prevDigits = ['0','0','0','0','0','0'];
let _lastDiasMes = {};
let _lastWeekSecs = -1;
let _lastMonthSecs = -1;
const ARC_CIRC = 2 * Math.PI * 108;
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

const elDigits = [0,1,2,3,4,5].map(i => document.getElementById('d' + i));
const elStatsGrid  = $('statsGrid');
const elCardWeek   = $('cardWeek');
const elCardMonth  = $('cardMonth');
const elLblWeek    = $('lblWeek');
const elLblMonth   = $('lblMonth');
const elValWeek    = $('valWeek');
const elValMonth   = $('valMonth');

const elBtnAddManual       = $('btnAddManual');
const elBtnGenerarReporte  = $('btnGenerarReporte');
const elBtnNuevoMes        = $('btnNuevoMes');
const elBtnEliminarUlt     = $('btnEliminarUltimo');
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
    _lastDiasMes = c.diasMes || {};
    updateProgressArc(_lastDiasMes);
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
      resetTimerDigits();
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
    _lastDiasMes = data.diasMes || {};
    updateProgressArc(_lastDiasMes);

    // Save to cache for instant next load
    saveToCache(data);
  } finally {
    isRefreshing = false;
    refreshAbort = null;
  }
}

// --- STATS & NÓMINA ---
function secsToHoursStr(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h === 0 && m === 0) return '0m';
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function animateStatCountUp(el, toSecs, duration = 750) {
  const start = performance.now();
  const step = now => {
    if (isMoneyMode) return; // modo COP activo — cancelar animación
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = secsToHoursStr(Math.floor(ease * toSecs));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = secsToHoursStr(toSecs);
  };
  requestAnimationFrame(step);
}

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
    elCardWeek.classList.remove('money-active');
    elCardMonth.classList.remove('money-active');
    if (appData.weekSecs !== _lastWeekSecs) {
      _lastWeekSecs = appData.weekSecs;
      animateStatCountUp(elValWeek, appData.weekSecs);
    }
    if (appData.monthSecs !== _lastMonthSecs) {
      _lastMonthSecs = appData.monthSecs;
      animateStatCountUp(elValMonth, appData.monthSecs);
    }
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
  if (!isMoneyMode) {
    _lastWeekSecs = -1;
    _lastMonthSecs = -1;
  }
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

function toggleCalTip(cell) {
  const wasActive = cell.classList.contains('show-tip');
  // Close all other tips
  document.querySelectorAll('.cal-day.show-tip').forEach(el => el.classList.remove('show-tip'));
  if (!wasActive) cell.classList.add('show-tip');
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

function resetTimerDigits() {
  _prevDigits = ['0','0','0','0','0','0'];
  elDigits.forEach(el => {
    el.classList.remove('flipping-out', 'flipping-in');
    el.textContent = '0';
  });
}

function flipDigit(el, newVal) {
  el.classList.remove('flipping-in', 'flipping-out');
  el.classList.add('flipping-out');
  setTimeout(() => {
    el.textContent = newVal;
    el.classList.remove('flipping-out');
    el.classList.add('flipping-in');
    setTimeout(() => el.classList.remove('flipping-in'), 140);
  }, 90);
}

function updateTimerDigits(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  const vals = [...pad(h), ...pad(m), ...pad(s)];
  vals.forEach((v, i) => {
    if (v !== _prevDigits[i]) {
      flipDigit(elDigits[i], v);
      _prevDigits[i] = v;
    }
  });
}

function startTimerUI(startTime) {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    const ms = Date.now() - startTime;
    updateTimerDigits(ms);
    if (_lastDiasMes[new Date().getDate()] === -1) updateProgressArc(_lastDiasMes);
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

// --- PROGRESS ARC ---
function updateProgressArc(diasMes) {
  const arcFill = $('arcFill');
  const arcSvg  = $('progressArc');
  const today   = new Date().getDate();
  let todayHours = diasMes[today];
  if (todayHours === undefined || todayHours === null) todayHours = 0;
  if (todayHours === -1) {
    todayHours = activeStartTime ? (Date.now() - activeStartTime) / 3600000 : 0;
  }
  if (todayHours <= 0) { arcSvg.classList.remove('visible'); return; }
  const progress = Math.min(todayHours / 8, 1);
  arcFill.style.strokeDashoffset = ARC_CIRC * (1 - progress);
  arcFill.classList.toggle('arc-complete', progress >= 1);
  arcSvg.classList.add('visible');
}

// --- PARTICLES ---
function spawnParticles(type) {
  const wrapper = elBtnAction.closest('.action-btn-wrapper');
  const palette = type === 'start'
    ? ['#34C759','#30D158','#4CD964','#00E676','#69F0AE']
    : ['#FF9500','#FF6B00','#FF453A','#FF9F0A','#FFD60A'];
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const angle = Math.random() * Math.PI * 2;
    const dist  = 55 + Math.random() * 75;
    const size  = 4 + Math.random() * 6;
    const dur   = (0.5 + Math.random() * 0.5).toFixed(2);
    const tx    = (Math.cos(angle) * dist).toFixed(1);
    const ty    = (Math.sin(angle) * dist).toFixed(1);
    const color = palette[Math.floor(Math.random() * palette.length)];
    p.style.cssText = `width:${size}px;height:${size}px;background:${color};top:calc(50% - ${size/2}px);left:calc(50% - ${size/2}px);--tx:${tx}px;--ty:${ty}px;--dur:${dur}s`;
    wrapper.appendChild(p);
    setTimeout(() => p.remove(), (parseFloat(dur) + 0.15) * 1000);
  }
}

// --- ACTION BUTTON (START/STOP) ---
function burstAnimation(type) {
  spawnParticles(type);
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
        resetTimerDigits();
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
        resetTimerDigits();
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
      resetTimerDigits();
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
    const hasDesc = !!r.descripcion;

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
        <span class="shift-item-note${hasDesc ? '' : ' empty-note'}"></span>
        <button class="btn-delete-shift" data-row="${r.rowNumber}" aria-label="Eliminar">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    // Set description via textContent to prevent XSS
    card.querySelector('.shift-item-note').textContent = r.descripcion || 'Sin descripción';

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

    // Si hay turno activo y se editó sin hora de salida → es el turno corriendo
    // Recalcular activeStartTime con la nueva hora de entrada
    if (activeStartTime && !elEditOut.value && elEditIn.value) {
      const [h, m] = elEditIn.value.split(':').map(Number);
      const newStart = new Date();
      newStart.setHours(h, m, 0, 0);
      // Solo actualizar si la nueva hora es en el pasado (sanity check)
      if (newStart.getTime() < Date.now()) {
        activeStartTime = newStart.getTime();
        localStorage.setItem('activeStartTime', JSON.stringify(activeStartTime));
        startTimerUI(activeStartTime);
      }
    }

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

// --- GENERAR REPORTE VISUAL ---
async function handleGenerarReporte() {
  showToast('Generando reporte...');
  elBtnGenerarReporte.disabled = true;
  elBtnGenerarReporte.textContent = '...';

  const r = await apiCall('generarReporte');

  elBtnGenerarReporte.disabled = false;
  elBtnGenerarReporte.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
    Reporte Visual`;

  if (r && r.success) {
    showToast('Reporte creado: ' + (r.reportName || 'OK'));
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
    csv += 'Fecha,Dia,Entrada,Salida,Horas,Descripcion\r\n';
    data.history.forEach(r => {
      const desc = (r.descripcion || '').replace(/"/g, '""'); // escape inner quotes
      csv += `${r.fecha},${r.dia || ''},${r.entrada},${r.salida},${r.horas},"${desc}"\r\n`;
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
  elBtnGenerarReporte.addEventListener('click', handleGenerarReporte);
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
      localStorage.removeItem('wc_cache');
      activeStartTime = null;
      if (timerInterval) clearInterval(timerInterval);
      resetTimerDigits();
      setActionButtonState(false);
      _lastWeekSecs = -1;
      _lastMonthSecs = -1;
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
