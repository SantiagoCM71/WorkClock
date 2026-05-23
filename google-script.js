/**
 * WorkClock Pro — Google Apps Script Backend
 *
 * INSTRUCCIONES DE DEPLOY:
 * 1. Abre tu Google Sheet → Extensiones → Apps Script
 * 2. Borra el código existente y pega este archivo completo
 * 3. Implementar → Nueva implementación → Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 4. Copia la URL /exec y pégala en Settings de la app
 *
 * ESTRUCTURA DE LA HOJA "Horas Laboradas":
 * A: Fecha | B: Dia | C: Entrada | D: Salida | E: Horas | F: Descripcion
 */

const SPREADSHEET_ID = '12iuJSea50wuVwWGFHfdCRzah7OEMInOstcOM8ByzLMk';
const SHEET_NAME     = 'Hoja 1';

// Coordenadas de tu lugar de trabajo (para validación GPS futura)
const WORK_LAT  = 3.5261039;
const WORK_LONG = -76.2837987;
const RADIO_METROS = 300;

// --- ROUTER PRINCIPAL ---
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    let result = {};

    if      (action === 'getFullState')            result = getFullState();
    else if (action === 'getCurrentState')       result = getCurrentState();
    else if (action === 'getRecentHistory')       result = getRecentHistory();
    else if (action === 'registrarEntrada')       result = registrarEntrada();
    else if (action === 'registrarSalida')        result = registrarSalida(params.coords);
    else if (action === 'eliminarUltimoRegistro') result = eliminarUltimoRegistro();
    else if (action === 'actualizarRegistro')     result = actualizarRegistro(params.rowNumber, params.nuevaEntrada, params.nuevaSalida);
    else if (action === 'agregarJornadaManual')   result = agregarJornadaManual(params.data);
    else if (action === 'guardarNota')            result = guardarNota(params.rowNumber, params.nota);
    else if (action === 'eliminarRegistro')       result = eliminarRegistro(params.rowNumber);
    else if (action === 'iniciarNuevoMesApp')     result = iniciarNuevoMesApp();
    else if (action === 'generarReporte')         result = generarReporte();
    else throw new Error('Acción desconocida: ' + action);

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error.message });
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: '✅ WorkClock Pro API activa' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- NÓMINA CONSTANTES ---
const NOM_SALARIO_BASE   = 1750905;
const NOM_AUX_TRANSPORTE = 250000;
const NOM_HORAS_LEGALES  = 176;
const NOM_DED_SALUD      = 70000;
const NOM_DED_PENSION    = 70000;
const NOM_QUINCENA_1     = 930000;  // Pago fijo 1ª quincena (ajustar si cambia)

// --- MENÚ DESKTOP EN SHEETS ---
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⏱️ WorkClock Pro')
    .addItem('📊 Actualizar Dashboard', 'generarDashboard')
    .addItem('📋 Generar Reporte Visual', 'generarReporte')
    .addItem('📥 Exportar Mes (Copia)', 'exportarCierreDeMes')
    .addToUi();
}

// --- HELPERS ---
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
}

function getUltimaFila(sheet) {
  const data = sheet.getRange('A:A').getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][0] !== '' && data[i][0] !== null) return i + 1;
  }
  return 1;
}

function calcularDistancia(lat1, lon1) {
  const R = 6371e3;
  const p1 = WORK_LAT * Math.PI / 180;
  const p2 = lat1    * Math.PI / 180;
  const dP = (lat1 - WORK_LAT) * Math.PI / 180;
  const dL = (lon1 - WORK_LONG) * Math.PI / 180;
  const a = Math.sin(dP/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dL/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatoHoras(segundos) {
  if (!segundos || segundos === 0) return '0 min';
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

// --- ACCIONES API ---

// OPTIMIZED: Single call returns active state + history + stats
function getFullState() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const displayValues = sheet.getDataRange().getDisplayValues(); // for reliable column E parsing
  const tz = Session.getScriptTimeZone();

  // Default empty response
  const empty = { active: false, history: [], semanaTotal: '0 min', mesTotal: '0 min', semanaSegundos: 0, mesSegundos: 0 };
  if (values.length <= 1) return empty;

  const hoy = new Date();
  const startOfMonth = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  startOfMonth.setHours(0, 0, 0, 0);
  const dow = hoy.getDay();
  const diffLunes = hoy.getDate() - dow + (dow === 0 ? -6 : 1);
  const startOfWeek = new Date(hoy.getFullYear(), hoy.getMonth(), diffLunes);
  startOfWeek.setHours(0, 0, 0, 0);

  let historyData = [];
  let segsSemana = 0;
  let segsMes    = 0;
  let activeInfo = { active: false };
  let diasMes = {};  // { "1": hours, "2": hours, ... } — day of month → decimal hours worked

  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    if (!row[0]) continue;

    // Detect active shift (first open one found from bottom)
    if (!activeInfo.active && row[2] !== '' && (!row[3] || row[3] === '')) {
      const startTime = row[2] instanceof Date
        ? Utilities.formatDate(row[2], tz, 'h:mm a')
        : row[2];
      // Provide epoch ms for accurate timer reconstruction
      let startTimestamp = null;
      if (row[2] instanceof Date && row[0] instanceof Date) {
        const d = new Date(row[0]);
        const t = row[2];
        d.setHours(t.getHours(), t.getMinutes(), t.getSeconds(), 0);
        startTimestamp = d.getTime();
      }
      activeInfo = { active: true, startTime, startTimestamp };
      // Mark today as active (in progress) in calendar
      const activeDay = (row[0] instanceof Date ? row[0] : new Date(row[0])).getDate();
      if (!diasMes[activeDay]) diasMes[activeDay] = -1; // -1 = active/in progress, no hours yet
    }

    const rowDate = row[0] instanceof Date ? row[0] : new Date(row[0]);

    // Accumulate totals — parse column E from display text for reliability
    // (raw values can be Date objects with broken getHours() or numbers with ambiguous scale)
    if (row[4] !== '' && row[4] !== null) {
      let segs = 0;
      const displayE = displayValues[i] ? displayValues[i][4] : '';
      if (displayE && displayE.includes(':')) {
        // Parse display format like "9:30:00" or "0:45:00"
        const parts = displayE.split(':');
        segs = (parseInt(parts[0]) || 0) * 3600 + (parseInt(parts[1]) || 0) * 60 + (parseInt(parts[2]) || 0);
      } else if (typeof row[4] === 'number') {
        segs = Math.round(row[4] * 86400);
      }
      if (segs > 0 && rowDate >= startOfMonth) {
        segsMes += segs;
        const dayNum = rowDate.getDate();
        diasMes[dayNum] = (diasMes[dayNum] || 0) + segs / 3600;
      }
      if (segs > 0 && rowDate >= startOfWeek) segsSemana += segs;
    }

    // Last 7 rows for visible history
    if (historyData.length < 7) {
      const fecha   = row[0] instanceof Date ? Utilities.formatDate(row[0], tz, 'dd/MM') : row[0];
      const entrada = row[2] instanceof Date ? Utilities.formatDate(row[2], tz, 'h:mm a') : (row[2] || '--');
      const salida  = row[3] instanceof Date ? Utilities.formatDate(row[3], tz, 'h:mm a') : (row[3] || '--');
      const in24    = row[2] instanceof Date ? Utilities.formatDate(row[2], tz, 'HH:mm') : '';
      const out24   = row[3] instanceof Date ? Utilities.formatDate(row[3], tz, 'HH:mm') : '';

      let horas = '--';
      if (row[4] !== '' && row[4] !== null) {
        const dE = displayValues[i] ? displayValues[i][4] : '';
        let s = 0;
        if (dE && dE.includes(':')) {
          const p = dE.split(':');
          s = (parseInt(p[0]) || 0) * 3600 + (parseInt(p[1]) || 0) * 60 + (parseInt(p[2]) || 0);
        } else if (typeof row[4] === 'number') {
          s = Math.round(row[4] * 86400);
        }
        const hrs  = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        horas = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      }

      historyData.push({
        rowNumber: i + 1, fecha, dia: row[1] || '', entrada, salida, in24, out24, horas,
        descripcion: row[5] || ''
      });
    }
  }

  return {
    ...activeInfo,
    history:        historyData,
    semanaTotal:    formatoHoras(segsSemana),
    mesTotal:       formatoHoras(segsMes),
    semanaSegundos: segsSemana,
    mesSegundos:    segsMes,
    diasMes:        diasMes
  };
}

// Legacy endpoints — redirect to getFullState for backwards compat
function getCurrentState() { const s = getFullState(); return { active: s.active, startTime: s.startTime, startTimestamp: s.startTimestamp }; }
function getRecentHistory() { const s = getFullState(); return { history: s.history, semanaTotal: s.semanaTotal, mesTotal: s.mesTotal, semanaSegundos: s.semanaSegundos, mesSegundos: s.mesSegundos }; }

function registrarEntrada() {
  const sheet = getSheet();
  const ahora = new Date();
  const tz = Session.getScriptTimeZone();

  // PROTECCIÓN: verificar que no haya ya un turno activo antes de crear uno nuevo
  const lastRow = getUltimaFila(sheet);
  if (lastRow > 1) {
    const numCheck = Math.min(lastRow - 1, 10);
    const startCheck = lastRow - numCheck + 1;
    const vals = sheet.getRange(startCheck, 1, numCheck, 4).getValues();
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i][2] !== '' && (!vals[i][3] || vals[i][3] === '')) {
        // Ya hay turno activo — no crear duplicado
        return { success: true, message: 'Turno ya activo' };
      }
    }
  }

  const nuevaFila = lastRow + 1;
  const dias = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

  sheet.getRange(nuevaFila, 1, 1, 6).setValues([[
    Utilities.formatDate(ahora, tz, 'yyyy-MM-dd'),
    dias[ahora.getDay()],
    Utilities.formatDate(ahora, tz, 'HH:mm:ss'),
    '',
    '',
    ''
  ]]);
  return { success: true };
}

function registrarSalida(coords) {
  const sheet = getSheet();
  const lastRow = getUltimaFila(sheet);
  if (lastRow <= 1) throw new Error('No hay turno activo');

  // Buscar en TODAS las filas recientes (no solo 5) para encontrar turnos abiertos
  const numRows = Math.min(lastRow - 1, 30);
  const startRow = lastRow - numRows + 1;
  const values = sheet.getRange(startRow, 1, numRows, 4).getValues();
  const tz = Session.getScriptTimeZone();
  const horaSalida = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');

  // Cerrar TODOS los turnos abiertos (por si hay duplicados fantasma)
  let cerrados = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (row[2] !== '' && (!row[3] || row[3] === '')) {
      const rowIndex = startRow + i;
      sheet.getRange(rowIndex, 4, 1, 2).setValues([[
        horaSalida,
        '=IF(RC[-1]<RC[-2], 1+RC[-1]-RC[-2], RC[-1]-RC[-2])'
      ]]);
      sheet.getRange(rowIndex, 5).setNumberFormat('[h]:mm:ss');
      cerrados++;
    }
  }

  if (cerrados === 0) throw new Error('No hay turno activo');

  // Return shift times for the finish modal
  let entradaStr = '', salidaStr = horaSalida;
  // Find the entry time from the last closed row
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][2] !== '') {
      entradaStr = values[i][2] instanceof Date
        ? Utilities.formatDate(values[i][2], tz, 'HH:mm:ss')
        : String(values[i][2]);
      break;
    }
  }

  return { success: true, cerrados, entrada: entradaStr, salida: salidaStr, lastRow: lastRow };
}

function eliminarUltimoRegistro() {
  const sheet = getSheet();
  const lastRow = getUltimaFila(sheet);
  if (lastRow <= 1) throw new Error('No hay registros');
  sheet.getRange(lastRow, 1, 1, 6).clearContent();
  return { success: true };
}

function actualizarRegistro(rowNumber, nuevaEntrada, nuevaSalida) {
  const sheet = getSheet();
  const inVal  = nuevaEntrada ? nuevaEntrada + ':00' : '';
  const outVal = nuevaSalida  ? nuevaSalida  + ':00' : '';

  sheet.getRange(rowNumber, 3).setValue(inVal);

  if (outVal !== '') {
    sheet.getRange(rowNumber, 4).setValue(outVal);
    sheet.getRange(rowNumber, 5)
      .setFormula('=IF(RC[-1]<RC[-2], 1+RC[-1]-RC[-2], RC[-1]-RC[-2])')
      .setNumberFormat('[h]:mm:ss');
  } else {
    sheet.getRange(rowNumber, 4).clearContent();
    sheet.getRange(rowNumber, 5).clearContent();
  }
  return { success: true };
}

function agregarJornadaManual(data) {
  const sheet = getSheet();
  const partes = data.fecha.split('-');
  const fObj   = new Date(partes[0], partes[1] - 1, partes[2], 12, 0, 0);
  const dia    = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'][fObj.getDay()];
  const nuevaFila = getUltimaFila(sheet) + 1;

  sheet.getRange(nuevaFila, 1, 1, 6).setValues([[
    data.fecha,
    dia,
    data.entrada + ':00',
    data.salida  + ':00',
    '=IF(RC[-1]<RC[-2], 1+RC[-1]-RC[-2], RC[-1]-RC[-2])',
    data.descripcion || ''
  ]]);
  sheet.getRange(nuevaFila, 5).setNumberFormat('[h]:mm:ss');

  // Reordenar por fecha
  if (sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).sort({ column: 1, ascending: true });
  }
  return { success: true };
}

function guardarNota(rowNumber, nota) {
  const sheet = getSheet();
  sheet.getRange(rowNumber, 6).setValue(nota || '');
  return { success: true };
}

function eliminarRegistro(rowNumber) {
  const sheet = getSheet();
  if (rowNumber <= 1) throw new Error('Fila inválida');
  sheet.getRange(rowNumber, 1, 1, 6).clearContent();
  return { success: true };
}

function iniciarNuevoMesApp() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getSheet();
  const lastRow = getUltimaFila(sheet);
  if (lastRow <= 1) throw new Error('No hay registros para archivar');

  let dObj = new Date(sheet.getRange(lastRow, 1).getValue());
  if (isNaN(dObj.getTime())) dObj = new Date();

  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const nombreHoja = meses[dObj.getMonth()] + '_' + dObj.getFullYear();

  // 1) Generar reporte visual ANTES de limpiar (lee los datos actuales)
  try { generarReporteMes(SHEET_NAME); } catch(e) { /* no bloquear el cierre de mes si falla */ }

  // 2) Eliminar hoja del mismo nombre si existe
  let exportSheet = ss.getSheetByName(nombreHoja);
  if (exportSheet) ss.deleteSheet(exportSheet);

  // 3) Copiar y limpiar columnas GPS / Rango antes de guardar el archivo
  exportSheet = sheet.copyTo(ss);
  exportSheet.setName(nombreHoja);
  const dr = exportSheet.getDataRange();
  dr.copyTo(dr, { contentsOnly: true });

  // 4) Limpiar la hoja principal (mantener fila de cabecera)
  sheet.getRange(2, 1, lastRow - 1, 7).clearContent();
  return { success: true, archivoCreado: nombreHoja };
}

// =====================================================================
// --- REPORTE VISUAL DE MES
// =====================================================================

/** Wrapper llamado desde la app (doPost) y desde el menú de Sheets */
function generarReporte() {
  try {
    const rSheet = generarReporteMes(SHEET_NAME);
    return { success: true, reportName: rSheet.getName() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Genera una hoja "Reporte_<Mes>_<Año>" con diseño ejecutivo profesional.
 * Lee datos de `sourceSheetName` (por defecto SHEET_NAME).
 * Retorna el Sheet creado.
 */
function generarReporteMes(sourceSheetName) {
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const src = ss.getSheetByName(sourceSheetName || SHEET_NAME);
  if (!src) throw new Error('No se encontró la hoja: ' + (sourceSheetName || SHEET_NAME));

  const lastRow = getUltimaFila(src);
  if (lastRow <= 1) throw new Error('No hay registros en la hoja');

  const numRows = lastRow - 1;
  const raw = src.getRange(2, 1, numRows, 6).getDisplayValues();

  // --- PERÍODO ---
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
                 'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dp       = (raw[0][0] || '').split('-');
  const monthStr = dp.length >= 2 ? (MESES[parseInt(dp[1],10)-1] || 'Mes') : 'Mes';
  const yearStr  = dp[0] || String(new Date().getFullYear());
  const periodo  = monthStr + ' ' + yearStr;

  // --- CÁLCULOS ---
  let totalSecs = 0, jornadas = 0;
  raw.forEach(r => {
    if (!r[4] || !r[3]) return;
    const p = r[4].split(':');
    if (p.length < 2) return;
    const s = parseInt(p[0],10)*3600 + parseInt(p[1],10)*60 + parseInt(p[2]||0,10);
    if (s > 0) { totalSecs += s; jornadas++; }
  });
  const totalHrs   = totalSecs / 3600;
  const pct        = Math.min(totalHrs / NOM_HORAS_LEGALES * 100, 100);
  const salCausado = Math.round(NOM_SALARIO_BASE   * (totalHrs / NOM_HORAS_LEGALES));
  const auxCausado = Math.round(NOM_AUX_TRANSPORTE * (totalHrs / NOM_HORAS_LEGALES));
  const deduccion  = NOM_DED_SALUD + NOM_DED_PENSION;
  const neto       = Math.max(0, salCausado + auxCausado - deduccion);
  const q2         = Math.max(0, neto - NOM_QUINCENA_1);   // lo que queda por pagar

  const hms = s => { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return m?`${h}h ${m}m`:`${h}h`; };
  // Formato COP: "#,##0" + locale del spreadsheet convierte la coma en separador
  // de miles. En es-CO → punto → "$930.000". Se aplica como setNumberFormat().
  const COP_FMT = '"$"#,##0';

  // --- SHEET ---
  const rName = 'Reporte_' + monthStr + '_' + yearStr;
  let rSheet  = ss.getSheetByName(rName);
  if (rSheet) ss.deleteSheet(rSheet);
  rSheet = ss.insertSheet(rName);

  // --- PALETA ---
  const ACC  = '#059669', ACCD = '#047857', ACCL = '#ECFDF5', ACCT = '#D1FAE5';
  const W    = '#FFFFFF', BG   = '#F0FDF4', BD   = '#D1FAE5';
  const TX   = '#0F172A', TX2  = '#64748B', TX3  = '#94A3B8';
  const DARK = '#1E293B', DGRY = '#334155', LGRY = '#F1F5F9';
  const RED  = '#EF4444';

  // --- COLUMNAS (sin Descripción) ---
  // A(gutter) B(Fecha) C(Día) D(Entrada) E(Salida) F(Horas) G(gutter)
  // Total ~950px — "Ajustar al tamaño" escala verticalmente, necesitamos más ancho
  [[1,10],[2,230],[3,100],[4,210],[5,210],[6,180],[7,10]]
    .forEach(([c,w]) => rSheet.setColumnWidth(c, w));

  // --- ALTURAS DE FILAS ---
  const H = { SP:4, TITLE:54, SUB:24, SP2:6, LBL:18, KLBL:18, KVAL:50,
              KSUB:15, SP3:6, PLBL:18, PHDR:22, PVAL:44, SP4:6,
              RLBL:18, RHDR:26, RDATA:23, RTOT:26, FOOT:22 };

  rSheet.setRowHeight(1,  H.SP);
  rSheet.setRowHeight(2,  H.TITLE);
  rSheet.setRowHeight(3,  H.SUB);
  rSheet.setRowHeight(4,  H.SP2);
  rSheet.setRowHeight(5,  H.LBL);
  rSheet.setRowHeight(6,  H.KLBL);
  rSheet.setRowHeight(7,  H.KVAL);
  rSheet.setRowHeight(8,  H.KSUB);
  rSheet.setRowHeight(9,  H.SP3);
  rSheet.setRowHeight(10, H.PLBL);
  rSheet.setRowHeight(11, H.PHDR);
  rSheet.setRowHeight(12, H.PVAL);
  rSheet.setRowHeight(13, H.SP4);
  rSheet.setRowHeight(14, H.RLBL);
  rSheet.setRowHeight(15, H.RHDR);
  for (let i = 0; i < numRows; i++) rSheet.setRowHeight(16 + i, H.RDATA);
  const TOTROW = 16 + numRows;
  rSheet.setRowHeight(TOTROW,   H.RTOT);
  rSheet.setRowHeight(TOTROW+1, H.SP);

  const tz      = Session.getScriptTimeZone();
  const genDate = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy  HH:mm');

  // ── TÍTULO ──
  rSheet.getRange(2,1,1,7).merge()
    .setValue('INFORME MENSUAL — ' + periodo.toUpperCase())
    .setBackground(ACC).setFontColor(W).setFontSize(16).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setFontFamily('Arial');

  rSheet.getRange(3,1,1,7).merge()
    .setValue('WorkClock Pro   ·   Período: ' + periodo + '   ·   Generado el ' + genDate)
    .setBackground(ACCD).setFontColor(ACCT).setFontSize(9)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setFontFamily('Arial');

  // ── SECCIÓN RESUMEN ──
  rSheet.getRange(5,2,1,5).merge()
    .setValue('RESUMEN DEL MES').setFontColor(TX2).setFontSize(8).setFontWeight('bold')
    .setHorizontalAlignment('left').setVerticalAlignment('middle').setFontFamily('Arial');
  rSheet.getRange(5,2)
    .setBorder(false,true,false,false,false,false, ACC, SpreadsheetApp.BorderStyle.SOLID_THICK);

  // Cols B-F (5 cols): B:C=Horas, D=Jornadas, E:F=Cumplimiento
  const kpis = [
    { c:2, sp:2, label:'HORAS TRABAJADAS',  val:hms(totalSecs),    sub:'de '+NOM_HORAS_LEGALES+'h legales' },
    { c:4, sp:1, label:'JORNADAS',          val:String(jornadas),  sub:'días trabajados' },
    { c:5, sp:2, label:'CUMPLIMIENTO',      val:pct.toFixed(1)+'%',sub:(pct>=100?'✓ Meta alcanzada':'en progreso') },
  ];
  kpis.forEach(k => {
    (k.sp>1 ? rSheet.getRange(6,k.c,1,k.sp).merge() : rSheet.getRange(6,k.c))
      .setValue(k.label).setBackground(ACCL).setFontColor(ACCD)
      .setFontSize(7).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setFontFamily('Arial')
      .setBorder(true,true,false,true,false,false, ACC, SpreadsheetApp.BorderStyle.SOLID_THICK);
    (k.sp>1 ? rSheet.getRange(7,k.c,1,k.sp).merge() : rSheet.getRange(7,k.c))
      .setValue(k.val).setBackground(W).setFontColor(ACCD)
      .setFontSize(20).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setFontFamily('Arial')
      .setBorder(false,true,false,true,false,false, BD, SpreadsheetApp.BorderStyle.SOLID);
    (k.sp>1 ? rSheet.getRange(8,k.c,1,k.sp).merge() : rSheet.getRange(8,k.c))
      .setValue(k.sub).setBackground(W).setFontColor(TX2).setFontSize(8)
      .setHorizontalAlignment('center').setVerticalAlignment('top').setFontFamily('Arial')
      .setBorder(false,true,true,true,false,false, BD, SpreadsheetApp.BorderStyle.SOLID);
  });

  // ── SECCIÓN LIQUIDACIÓN ──
  rSheet.getRange(10,2,1,5).merge()
    .setValue('LIQUIDACIÓN NÓMINA').setFontColor(TX2).setFontSize(8).setFontWeight('bold')
    .setHorizontalAlignment('left').setVerticalAlignment('middle').setFontFamily('Arial');
  rSheet.getRange(10,2)
    .setBorder(false,true,false,false,false,false, ACC, SpreadsheetApp.BorderStyle.SOLID_THICK);

  // Cols B-F: B=Quincena1(pagada) | C:D=Neto Total | E:F=A Pagar Quincena 2
  const payHdrs = [
    {c:2,sp:1, lbl:'QUINCENA 1',            bg:DGRY, fg:TX3},
    {c:3,sp:2, lbl:'NETO TOTAL MES',        bg:DARK, fg:W},
    {c:5,sp:2, lbl:'A PAGAR — QUINCENA 2',  bg:ACC,  fg:W},
  ];
  payHdrs.forEach(h => {
    (h.sp>1 ? rSheet.getRange(11,h.c,1,h.sp).merge() : rSheet.getRange(11,h.c))
      .setValue(h.lbl).setBackground(h.bg).setFontColor(h.fg)
      .setFontSize(10).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setFontFamily('Arial');
  });
  // Franja #047857 entre NETO y A PAGAR: borde derecho de D11:D12
  rSheet.getRange(11,4,2,1)
    .setBorder(false, false, false, true, false, false, '#047857', SpreadsheetApp.BorderStyle.SOLID_THICK);

  // Valores como números crudos + setNumberFormat para que Sheets
  // use el separador de miles del locale del spreadsheet (es-CO → punto)
  const payVals = [
    {c:2,sp:1, val:NOM_QUINCENA_1, fg:TX3, bg:LGRY, sz:13, bold:false},
    {c:3,sp:2, val:neto,           fg:TX,  bg:BG,   sz:14, bold:true},
    {c:5,sp:2, val:q2,             fg:W,   bg:ACC,  sz:16, bold:true},
  ];
  payVals.forEach(v => {
    (v.sp>1 ? rSheet.getRange(12,v.c,1,v.sp).merge() : rSheet.getRange(12,v.c))
      .setValue(v.val).setNumberFormat(COP_FMT)
      .setBackground(v.bg).setFontColor(v.fg)
      .setFontSize(v.sz).setFontWeight(v.bold?'bold':'normal')
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setFontFamily('Arial');
  });

  // ── SECCIÓN REGISTROS ──
  rSheet.getRange(14,2,1,5).merge()
    .setValue('REGISTROS DEL MES  (' + numRows + ' entradas)')
    .setFontColor(TX2).setFontSize(8).setFontWeight('bold')
    .setHorizontalAlignment('left').setVerticalAlignment('middle').setFontFamily('Arial');
  rSheet.getRange(14,2)
    .setBorder(false,true,false,false,false,false, ACC, SpreadsheetApp.BorderStyle.SOLID_THICK);

  // Encabezado tabla (5 cols, sin Descripción)
  ['Fecha','Día','Entrada','Salida','Horas'].forEach((h,i) => {
    rSheet.getRange(15, 2+i)
      .setValue(h).setBackground(DARK).setFontColor(W)
      .setFontSize(10).setFontWeight('bold')
      .setHorizontalAlignment(i===4?'right':'left')
      .setVerticalAlignment('middle').setFontFamily('Arial');
  });

  // Datos en lote — 5 columnas, sin Descripción
  if (numRows > 0) {
    const vals   = raw.map(r => [r[0],r[1],r[2],r[3],r[4]]);
    const bgMat  = raw.map((_,i) => Array(5).fill(i%2===0 ? W : BG));
    const fgMat  = raw.map(() => [TX, TX2, TX, TX, ACCD]);
    const bldMat = raw.map(() => ['normal','normal','normal','normal','bold']);

    rSheet.getRange(16,2,numRows,5)
      .setValues(vals).setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle')
      .setFontWeights(bldMat);
    rSheet.getRange(16,2,numRows,5).setBackgrounds(bgMat);
    rSheet.getRange(16,2,numRows,5).setFontColors(fgMat);
    rSheet.getRange(16,2,numRows,4).setHorizontalAlignment('left');
    rSheet.getRange(16,6,numRows,1).setHorizontalAlignment('right');
    rSheet.getRange(16,2,numRows,5)
      .setBorder(false,false,true,false,false,true, BD, SpreadsheetApp.BorderStyle.SOLID);
  }

  // ── FILA TOTAL ──
  rSheet.getRange(TOTROW, 2, 1, 4).merge()
    .setValue('TOTAL  ' + jornadas + ' JORNADAS')
    .setBackground(DARK).setFontColor(ACCT)
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setFontFamily('Arial');
  rSheet.getRange(TOTROW, 6)
    .setValue(hms(totalSecs))
    .setBackground(ACC).setFontColor(W)
    .setFontSize(10).setFontWeight('bold')
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setFontFamily('Arial');

  try { rSheet.setHiddenGridlines(true); } catch(e) {}
  SpreadsheetApp.flush();
  return rSheet;
}

// =====================================================================
// --- DASHBOARD v4 — Diseño premium minimalista
// =====================================================================
function generarDashboard() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tz = Session.getScriptTimeZone();
  const DASH = 'Dashboard';
  const S = SHEET_NAME;

  let d = ss.getSheetByName(DASH);
  if (d) {
    d.clearContents(); d.clearFormats(); d.clearNotes();
    d.getCharts().forEach(c => d.removeChart(c));
    d.setConditionalFormatRules([]);
  } else {
    d = ss.insertSheet(DASH, 0);
  }

  // === PALETA PREMIUM ===
  const DARK  = '#111827';
  const ACC   = '#059669';
  const ACC_D = '#047857';
  const ACC_T = '#6EE7B7';
  const ACC_L = '#ECFDF5';
  const W     = '#FFFFFF';
  const BG    = '#F9FAFB';
  const BD    = '#E5E7EB';
  const TX    = '#111827';
  const TX2   = '#6B7280';
  const TX3   = '#9CA3AF';
  const RED   = '#DC2626';

  // === COLUMNAS (B-I usables, A/J gutters, K-L helpers ocultos) ===
  [[1,28],[2,130],[3,130],[4,130],[5,130],[6,130],[7,130],[8,130],[9,130],[10,28],[11,1],[12,1]]
    .forEach(([c,w]) => d.setColumnWidth(c,w));
  d.setTabColor(ACC);
  d.hideColumns(11, 2);

  // Fondo base
  d.getRange(1,1,75,10).setBackground(BG).setFontColor(TX).setFontFamily('Roboto');

  // === HELPERS (col K, oculta) ===
  const YC = `(YEAR('${S}'!A2:A2000)=YEAR(TODAY()))`;
  const MC = `(MONTH('${S}'!A2:A2000)=MONTH(TODAY()))`;
  const NE = `('${S}'!A2:A2000<>"")`;
  const HN = `(ISNUMBER('${S}'!E2:E2000))`;
  const SP = `${YC}*${MC}*${NE}`;
  const CF = `">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1)`;
  const CT = `"<"&DATE(YEAR(TODAY()),MONTH(TODAY())+1,1)`;

  d.getRange('K1').setFormula(`=IFERROR(SUMPRODUCT(${SP}*${HN}*('${S}'!E2:E2000)),0)`);
  d.getRange('K2').setFormula(`=K1*24`);
  d.getRange('K3').setFormula(`=IFERROR(COUNTIFS('${S}'!A2:A2000,${CF},'${S}'!A2:A2000,${CT},'${S}'!A2:A2000,"<>"),0)`);
  d.getRange('K4').setFormula(`=IFERROR(K2/${NOM_HORAS_LEGALES}*100,0)`);
  d.getRange('K5').setFormula(`=IFERROR(ROUND(${NOM_SALARIO_BASE}*K2/${NOM_HORAS_LEGALES},0),0)`);
  d.getRange('K6').setFormula(`=IFERROR(ROUND(${NOM_AUX_TRANSPORTE}*K2/${NOM_HORAS_LEGALES},0),0)`);
  d.getRange('K7').setFormula(`=MAX(K5+K6-${NOM_DED_SALUD}-${NOM_DED_PENSION},0)`);

  // ═══════════════════════════════════════════
  //  R1: spacer
  // ═══════════════════════════════════════════
  d.setRowHeight(1, 4);

  // ═══════════════════════════════════════════
  //  R2-3: HEADER (dark navy)
  // ═══════════════════════════════════════════
  d.setRowHeight(2, 50);
  d.setRowHeight(3, 22);
  d.getRange(2,1,2,10).setBackground(DARK);

  d.getRange(2,2,1,4).merge().setValue('WorkClock Pro')
    .setFontSize(20).setFontWeight('bold').setFontColor(W).setVerticalAlignment('middle');
  d.getRange(2,7,1,3).merge()
    .setFormula(`=UPPER(TEXT(TODAY(),"MMMM YYYY"))`)
    .setFontSize(14).setFontWeight('bold').setFontColor(ACC_T)
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setBackground(DARK);

  d.getRange(3,2,1,4).merge()
    .setValue('Control de horas trabajadas y nomina')
    .setFontSize(9).setFontColor(TX3).setBackground(DARK).setVerticalAlignment('middle');
  d.getRange(3,7,1,3).merge()
    .setValue('Actualizado ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
    .setFontSize(8).setFontColor(TX2).setBackground(DARK)
    .setHorizontalAlignment('right').setVerticalAlignment('middle');

  // ═══════════════════════════════════════════
  //  R4: spacer
  // ═══════════════════════════════════════════
  d.setRowHeight(4, 16);

  // ═══════════════════════════════════════════
  //  R5-7: KPI CARDS (4 tarjetas con borde superior verde)
  // ═══════════════════════════════════════════
  d.setRowHeight(5, 24);
  d.setRowHeight(6, 50);
  d.setRowHeight(7, 18);

  const kpis = [
    {c:2, lbl:'HORAS TRABAJADAS', f:'=TEXT(K1,"[h]:mm:ss")', sub:`de ${NOM_HORAS_LEGALES}h legales`, clr:TX},
    {c:4, lbl:'JORNADAS',         f:'=K3',                   sub:'dias registrados',                  clr:TX},
    {c:6, lbl:'CUMPLIMIENTO',     f:'=TEXT(K4/100,"0.0%")',  sub:'meta mensual',                      clr:ACC},
    {c:8, lbl:'NETO ESTIMADO',    f:'=TEXT(K7,"$ #,##0")',   sub:'despues de deducciones',            clr:ACC_D},
  ];

  kpis.forEach(({c, lbl, f, sub, clr}) => {
    // Label
    d.getRange(5,c,1,2).merge().setValue(lbl)
      .setBackground(W).setFontSize(7).setFontWeight('bold').setFontColor(TX2)
      .setHorizontalAlignment('center').setVerticalAlignment('bottom');
    // Value
    d.getRange(6,c,1,2).merge().setFormula(f)
      .setBackground(W).setFontSize(24).setFontWeight('bold').setFontColor(clr)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    // Subtitle
    d.getRange(7,c,1,2).merge().setValue(sub)
      .setBackground(W).setFontSize(7).setFontColor(TX3)
      .setHorizontalAlignment('center').setVerticalAlignment('top');
    // Thin borders all around
    d.getRange(5,c,3,2)
      .setBorder(true,true,true,true,false,false, BD, SpreadsheetApp.BorderStyle.SOLID);
    // Thick green top accent
    d.getRange(5,c,1,2)
      .setBorder(true,null,null,null,null,null, ACC, SpreadsheetApp.BorderStyle.SOLID_THICK);
  });

  // ═══════════════════════════════════════════
  //  R8: spacer
  // ═══════════════════════════════════════════
  d.setRowHeight(8, 12);

  // ═══════════════════════════════════════════
  //  R9: PROGRESS BAR
  // ═══════════════════════════════════════════
  d.setRowHeight(9, 34);
  d.getRange(9,2,1,8).setBackground(ACC_L);
  d.getRange(9,2,1,2).merge().setValue('Progreso mensual')
    .setFontSize(9).setFontWeight('bold').setFontColor(ACC_D)
    .setVerticalAlignment('middle').setBackground(ACC_L);
  d.getRange(9,4,1,3).merge()
    .setFormula(`=IFERROR(SPARKLINE({K2,MAX(${NOM_HORAS_LEGALES}-K2,0)},{"charttype","bar";"max",${NOM_HORAS_LEGALES};"color1","${ACC}";"color2","#D1D5DB"}),"")`)
    .setVerticalAlignment('middle').setBackground(ACC_L);
  d.getRange(9,8,1,2).merge()
    .setFormula(`=TEXT(K4/100,"0.0%")&"  ·  "&TEXT(K1,"[h]:mm")&" / ${NOM_HORAS_LEGALES}h"`)
    .setFontSize(9).setFontWeight('bold').setFontColor(ACC_D)
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setBackground(ACC_L);

  // ═══════════════════════════════════════════
  //  R10: spacer
  // ═══════════════════════════════════════════
  d.setRowHeight(10, 14);

  // ═══════════════════════════════════════════
  //  R11-12: DAILY CHART
  // ═══════════════════════════════════════════
  d.setRowHeight(11, 18);
  d.getRange(11,2).setValue('ACTIVIDAD DIARIA')
    .setFontSize(8).setFontWeight('bold').setFontColor(TX3);

  d.setRowHeight(12, 80);
  d.getRange(12,2,1,8).merge()
    .setFormula(
      `=IFERROR(SPARKLINE(`+
      `FILTER('${S}'!E2:E2000*24,`+
      `YEAR('${S}'!A2:A2000)=YEAR(TODAY()),`+
      `MONTH('${S}'!A2:A2000)=MONTH(TODAY()),`+
      `'${S}'!A2:A2000<>"",`+
      `ISNUMBER('${S}'!E2:E2000)),`+
      `{"charttype","column";"color","${ACC}";"ymin",0;"ymax",12;"empty","ignore"}),"")`)
    .setVerticalAlignment('middle').setBackground(W)
    .setBorder(true,true,true,true,false,false, BD, SpreadsheetApp.BorderStyle.SOLID);

  // ═══════════════════════════════════════════
  //  R13: spacer
  // ═══════════════════════════════════════════
  d.setRowHeight(13, 14);

  // ═══════════════════════════════════════════
  //  R14-21: LIQUIDACION + RESUMEN (lado a lado)
  // ═══════════════════════════════════════════
  d.setRowHeight(14, 20);
  d.getRange(14,2,1,2).merge().setValue('LIQUIDACION DEL MES')
    .setFontSize(8).setFontWeight('bold').setFontColor(TX3).setVerticalAlignment('bottom');
  d.getRange(14,6,1,2).merge().setValue('RESUMEN')
    .setFontSize(8).setFontWeight('bold').setFontColor(TX3).setVerticalAlignment('bottom');

  // --- Izquierda: Liquidacion (filas 15-21) ---
  const liq = [
    {l:'Concepto',         v:'Monto',                              hdr:true},
    {l:'Salario Causado',  v:'=TEXT(K5,"$ #,##0")'},
    {l:'Aux. Transporte',  v:'=TEXT(K6,"$ #,##0")'},
    {l:'(-) Salud',        v:`=TEXT(-${NOM_DED_SALUD},"$ #,##0")`, neg:true},
    {l:'(-) Pension',      v:`=TEXT(-${NOM_DED_PENSION},"$ #,##0")`,neg:true},
    {l:'Total Bruto',      v:'=TEXT(K5+K6,"$ #,##0")',             b:true},
    {l:'NETO A PAGAR',     v:'=TEXT(K7,"$ #,##0")',                tot:true},
  ];

  liq.forEach((it, i) => {
    const rw = 15 + i;
    d.setRowHeight(rw, 28);
    let bg = i % 2 === 0 ? W : BG, lc = TX, vc = TX;
    if (it.hdr) { bg = DARK; lc = W; vc = W; }
    if (it.tot) { bg = ACC; lc = W; vc = W; }
    if (it.neg) vc = RED;

    d.getRange(rw,2,1,2).merge().setValue(it.l)
      .setBackground(bg).setFontColor(lc).setFontSize(it.tot ? 10 : 9)
      .setFontWeight(it.hdr||it.tot||it.b ? 'bold' : 'normal')
      .setVerticalAlignment('middle');

    const vCell = d.getRange(rw,4,1,2).merge();
    if (String(it.v).startsWith('=')) vCell.setFormula(it.v);
    else vCell.setValue(it.v);
    vCell.setBackground(bg).setFontColor(vc).setFontSize(it.tot ? 12 : 9)
      .setFontWeight(it.hdr||it.tot||it.b ? 'bold' : 'normal')
      .setHorizontalAlignment('right').setVerticalAlignment('middle');
  });
  d.getRange(15,2,7,4)
    .setBorder(true,true,true,true,false,true, BD, SpreadsheetApp.BorderStyle.SOLID);

  // --- Derecha: Resumen (filas 15-21) ---
  const res = [
    {l:'Indicador',          v:'Valor',                                hdr:true},
    {l:'Horas trabajadas',   v:'=TEXT(K1,"[h]:mm:ss")'},
    {l:'Jornadas',           v:'=K3&" dias"'},
    {l:'Cumplimiento',       v:'=TEXT(K4/100,"0.0%")'},
    {l:'Horas objetivo',     v:`${NOM_HORAS_LEGALES}h`},
    {l:'Salario base',       v:`=TEXT(${NOM_SALARIO_BASE},"$ #,##0")`},
    {l:'Periodo',            v:null, per:true},
  ];

  res.forEach((it, i) => {
    const rw = 15 + i;
    let bg = i % 2 === 0 ? W : BG;
    if (it.hdr) bg = DARK;

    d.getRange(rw,6,1,2).merge().setValue(it.l)
      .setBackground(bg).setFontColor(it.hdr ? W : TX2).setFontSize(9)
      .setFontWeight(it.hdr ? 'bold' : 'normal')
      .setVerticalAlignment('middle');

    const cell = d.getRange(rw,8,1,2).merge();
    if (it.per) {
      cell.setFormula(`=TEXT(DATE(YEAR(TODAY()),MONTH(TODAY()),1),"dd/MM")&" — "&TEXT(EOMONTH(TODAY(),0),"dd/MM")`);
      cell.setBackground(bg).setFontColor(TX2).setFontSize(9)
        .setFontWeight('normal').setHorizontalAlignment('right').setVerticalAlignment('middle');
    } else {
      if (String(it.v).startsWith('=')) cell.setFormula(it.v);
      else cell.setValue(it.v);
      cell.setBackground(bg).setFontColor(it.hdr ? W : TX).setFontSize(10)
        .setFontWeight('bold').setHorizontalAlignment('right').setVerticalAlignment('middle');
    }
  });
  d.getRange(15,6,7,4)
    .setBorder(true,true,true,true,false,true, BD, SpreadsheetApp.BorderStyle.SOLID);

  // ═══════════════════════════════════════════
  //  R22: spacer
  // ═══════════════════════════════════════════
  d.setRowHeight(22, 14);

  // ═══════════════════════════════════════════
  //  R23+: REGISTROS
  // ═══════════════════════════════════════════
  d.setRowHeight(23, 20);
  d.getRange(23,2,1,2).merge().setValue('REGISTROS DEL MES')
    .setFontSize(8).setFontWeight('bold').setFontColor(TX3).setVerticalAlignment('bottom');

  // Header row
  d.setRowHeight(24, 28);
  ['Fecha','Dia','Entrada','Salida','Horas'].forEach((h,i) => {
    d.getRange(24,2+i).setValue(h).setBackground(DARK).setFontColor(W)
      .setFontSize(8).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
  });
  d.getRange(24,7,1,3).merge().setValue('Descripcion')
    .setBackground(DARK).setFontColor(W).setFontSize(8).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  // FILTER formula
  d.getRange(25,2).setFormula(
    `=IFERROR(SORT(FILTER(`+
    `CHOOSE({1,2,3,4,5,6},`+
    `'${S}'!A2:A2000,`+
    `'${S}'!B2:B2000,`+
    `IF('${S}'!C2:C2000<>"",TEXT('${S}'!C2:C2000,"h:mm AM/PM"),"—"),`+
    `IF('${S}'!D2:D2000<>"",TEXT('${S}'!D2:D2000,"h:mm AM/PM"),"—"),`+
    `IF('${S}'!E2:E2000<>"",TEXT('${S}'!E2:E2000,"[h]:mm"),"—"),`+
    `IF('${S}'!F2:F2000<>"",'${S}'!F2:F2000,"—")),`+
    `YEAR('${S}'!A2:A2000)=YEAR(TODAY()),`+
    `MONTH('${S}'!A2:A2000)=MONTH(TODAY()),`+
    `'${S}'!A2:A2000<>""`+
    `),1,FALSE),"")`
  );

  // Format data rows
  const DR = 35;
  d.getRange(25,2,DR,1).setNumberFormat('dd/MM/yyyy');
  d.getRange(25,2,DR,7).setFontSize(9).setVerticalAlignment('middle')
    .setHorizontalAlignment('center');

  for (let i = 0; i < DR; i++) {
    d.setRowHeight(25+i, 24);
    d.getRange(25+i,7,1,3).merge().setHorizontalAlignment('left');
    d.getRange(25+i,2,1,8).setBackground(i % 2 === 0 ? W : BG);
  }

  d.getRange(24,2,DR+1,8)
    .setBorder(true,true,true,true,false,true, BD, SpreadsheetApp.BorderStyle.SOLID);

  // ═══════════════════════════════════════════
  //  FOOTER
  // ═══════════════════════════════════════════
  d.setRowHeight(60, 6);
  d.setRowHeight(61, 22);
  d.getRange(61,2,1,8).merge()
    .setFormula(`="WorkClock Pro v4  ·  "&TEXT(NOW(),"dd/MM/yyyy HH:mm")&"  ·  Actualizacion automatica"`)
    .setFontSize(7).setFontColor(TX3).setHorizontalAlignment('center').setVerticalAlignment('middle');

  // ═══════════════════════════════════════════
  //  FINALIZAR
  // ═══════════════════════════════════════════
  ss.setActiveSheet(d);
  ss.moveActiveSheet(1);
  _instalarAutoRefresh();

  SpreadsheetApp.getUi().alert('Dashboard v4 generado exitosamente.');
}

// --- Instalar trigger de auto-refresh para timestamp ---
function _instalarAutoRefresh() {
  const existing = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '_onChangeDashTimestamp');
  existing.forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('_onChangeDashTimestamp')
    .forSpreadsheet(SpreadsheetApp.openById(SPREADSHEET_ID))
    .onChange()
    .create();
}

function _onChangeDashTimestamp(e) {
  try {
    if (e && e.source) {
      const sheet = e.source.getActiveSheet();
      if (sheet && sheet.getName() === 'Dashboard') return;
    }
    const d = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Dashboard');
    if (!d) return;
    const tz = Session.getScriptTimeZone();
    d.getRange('G3').setValue('Actualizado ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
      .setFontSize(8).setFontColor('#6B7280').setBackground('#111827')
      .setHorizontalAlignment('right').setVerticalAlignment('middle');
  } catch(err) { /* silenciar */ }
}

// --- EXPORTAR MES DESDE MENÚ DESKTOP ---
function exportarCierreDeMes() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getSheet();
  const hoy   = new Date();
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const nombreHoja = meses[hoy.getMonth()] + '_' + hoy.getFullYear();

  let exportSheet = ss.getSheetByName(nombreHoja);
  if (exportSheet) ss.deleteSheet(exportSheet);

  exportSheet = sheet.copyTo(ss);
  exportSheet.setName(nombreHoja);
  const dr = exportSheet.getDataRange();
  dr.copyTo(dr, { contentsOnly: true });

  SpreadsheetApp.getUi().alert(`✅ Exportado como "${nombreHoja}"`);
}
