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

// --- MENÚ DESKTOP EN SHEETS ---
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⏱️ WorkClock Pro')
    .addItem('📊 Actualizar Dashboard', 'generarDashboard')
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

  // Eliminar hoja del mismo nombre si existe
  let exportSheet = ss.getSheetByName(nombreHoja);
  if (exportSheet) ss.deleteSheet(exportSheet);

  // Copiar y limpiar columnas GPS / Rango antes de guardar el archivo
  exportSheet = sheet.copyTo(ss);
  exportSheet.setName(nombreHoja);
  const dr = exportSheet.getDataRange();
  dr.copyTo(dr, { contentsOnly: true });

  // Limpiar la hoja principal (mantener fila de cabecera si la hay)
  sheet.getRange(2, 1, lastRow - 1, 7).clearContent();
  return { success: true, archivoCreado: nombreHoja };
}

// =====================================================================
// --- DASHBOARD v3 — Diseño profesional inspirado en UI moderna
// =====================================================================
function generarDashboard() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tz = Session.getScriptTimeZone();
  const DASH = 'Dashboard';
  const S = SHEET_NAME;

  // --- Crear / limpiar hoja ---
  let d = ss.getSheetByName(DASH);
  if (d) {
    d.clearContents(); d.clearFormats(); d.clearNotes();
    d.getCharts().forEach(c => d.removeChart(c));
    d.setConditionalFormatRules([]);
  } else {
    d = ss.insertSheet(DASH, 0);
  }

  // === PALETA MODERNA ===
  const P  = '#006a39';   // primary green
  const PD = '#004d29';   // primary dark
  const PL = '#e8f5e9';   // primary light bg
  const PM = '#c8e6c9';   // primary medium
  const W  = '#ffffff';
  const BG = '#f8f9fa';   // background
  const G1 = '#f3f4f5';   // alt row
  const G2 = '#e7e8e9';   // borders
  const TX = '#191c1d';   // text
  const TS = '#616161';   // text secondary
  const RD = '#ba1a1a';   // red/error
  const GO = '#f9a825';   // gold
  const BL = '#0058bb';   // blue accent

  // === COLUMNAS (10 cols usables, J-K ocultas para fórmulas) ===
  [[1,16],[2,120],[3,120],[4,120],[5,120],[6,120],[7,16],[8,120],[9,120],[10,120],[11,16],[12,1],[13,1]]
    .forEach(([c,w]) => d.setColumnWidth(c,w));
  d.setTabColor(P);
  d.hideColumns(12, 2);

  // Fondo base
  d.getRange(1,1,80,11).setBackground(BG).setFontColor(TX).setFontFamily('Arial');

  // ══════════════════════════════════════════
  //  HELPER FORMULAS (columna L, oculta)
  // ══════════════════════════════════════════
  const YC = `(YEAR('${S}'!A2:A2000)=YEAR(TODAY()))`;
  const MC = `(MONTH('${S}'!A2:A2000)=MONTH(TODAY()))`;
  const NE = `('${S}'!A2:A2000<>"")`;
  const HN = `(ISNUMBER('${S}'!E2:E2000))`;
  const SP = `${YC}*${MC}*${NE}`;
  const CF = `">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1)`;
  const CT = `"<"&DATE(YEAR(TODAY()),MONTH(TODAY())+1,1)`;

  d.getRange('L1').setFormula(`=IFERROR(SUMPRODUCT(${SP}*${HN}*('${S}'!E2:E2000)),0)`);  // horas fracción
  d.getRange('L2').setFormula(`=L1*24`);                                                    // horas decimales
  d.getRange('L3').setFormula(`=IFERROR(COUNTIFS('${S}'!A2:A2000,${CF},'${S}'!A2:A2000,${CT},'${S}'!A2:A2000,"<>"),0)`);
  d.getRange('L4').setFormula(`=IFERROR(L2/${NOM_HORAS_LEGALES}*100,0)`);                   // cumplimiento %
  d.getRange('L5').setFormula(`=IFERROR(ROUND(${NOM_SALARIO_BASE}*L2/${NOM_HORAS_LEGALES},0),0)`);
  d.getRange('L6').setFormula(`=IFERROR(ROUND(${NOM_AUX_TRANSPORTE}*L2/${NOM_HORAS_LEGALES},0),0)`);
  d.getRange('L7').setFormula(`=MAX(L5+L6-${NOM_DED_SALUD}-${NOM_DED_PENSION},0)`);

  // ══════════════════════════════════════════
  //  HEADER (filas 1–3)
  // ══════════════════════════════════════════
  d.setRowHeight(1, 8);
  d.setRowHeight(2, 50);
  d.setRowHeight(3, 24);
  d.setRowHeight(4, 8);

  d.getRange(2,1,2,11).setBackground(P);
  d.getRange('B2:F2').merge()
    .setValue('⏱️  WorkClock Pro — Control de Tiempo')
    .setFontSize(18).setFontWeight('bold').setFontColor(W).setVerticalAlignment('middle');
  d.getRange('H2:J2').merge()
    .setFormula(`="🗓️  "&UPPER(TEXT(TODAY(),"MMMM YYYY"))`)
    .setFontSize(13).setFontWeight('bold').setFontColor('#a5d6a7')
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setBackground(P);
  d.getRange('B3:F3').merge()
    .setValue('Dashboard de gestión de horas trabajadas y nómina')
    .setFontSize(9).setFontColor('#a5d6a7').setVerticalAlignment('middle').setBackground(P);
  d.getRange('H3:J3').merge()
    .setValue('🔄 ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
    .setFontSize(8).setFontColor('#a5d6a7').setHorizontalAlignment('right')
    .setVerticalAlignment('middle').setBackground(P);

  // ══════════════════════════════════════════
  //  KPI CARDS (filas 5–9) — 5 tarjetas
  // ══════════════════════════════════════════
  d.setRowHeight(5, 18);  // label
  d.setRowHeight(6, 40);  // value
  d.setRowHeight(7, 16);  // sub
  d.setRowHeight(8, 6);   // gap

  const kpis = [
    { col:2, label:'⏱️ HORAS DEL MES',    val:'=TEXT(L1,"[h]:mm:ss")', sub:NOM_HORAS_LEGALES+'h legales' },
    { col:4, label:'📋 JORNADAS',          val:'=L3&" registros"',     sub:'Días trabajados' },
    { col:6, label:'🎯 CUMPLIMIENTO',      val:'=TEXT(L4/100,"0.0%")', sub:'vs '+NOM_HORAS_LEGALES+'h objetivo' },
    { col:8, label:'💰 SALARIO CAUSADO',   val:'=TEXT(L5,"$ #,##0")',  sub:'Base proporcional' },
    { col:10,label:'💵 NETO A PAGAR',      val:'=TEXT(L7,"$ #,##0")',  sub:'Después de deducciones' },
  ];

  kpis.forEach(({col, label, val, sub}, idx) => {
    const isLast = idx === kpis.length - 1;
    const bg = isLast ? PD : W;
    const tc = isLast ? W  : P;
    const sc = isLast ? '#a5d6a7' : TS;
    const lc = isLast ? '#a5d6a7' : TS;

    d.getRange(5, col, 3, 1).setBackground(bg);
    d.getRange(5, col).setValue(label).setFontSize(7).setFontWeight('bold')
      .setFontColor(lc).setHorizontalAlignment('center').setVerticalAlignment('bottom');
    const vc = d.getRange(6, col);
    vc.setFormula(val);
    vc.setFontSize(18).setFontWeight('bold').setFontColor(tc).setBackground(bg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    d.getRange(7, col).setValue(sub).setFontSize(7).setFontColor(sc).setBackground(bg)
      .setHorizontalAlignment('center').setVerticalAlignment('top');
    d.getRange(5, col, 3, 1)
      .setBorder(true,true,true,true,false,false, G2, SpreadsheetApp.BorderStyle.SOLID);
  });

  // ══════════════════════════════════════════
  //  BARRA DE PROGRESO (fila 9)
  // ══════════════════════════════════════════
  d.setRowHeight(9, 30);
  d.getRange(9,1,1,11).setBackground(PL);
  d.getRange(9, 2).setValue('Progreso mensual:')
    .setFontSize(9).setFontWeight('bold').setFontColor(P).setVerticalAlignment('middle').setBackground(PL);
  d.getRange(9, 4, 1, 3).merge()
    .setFormula(`=IFERROR(SPARKLINE({L2,MAX(${NOM_HORAS_LEGALES}-L2,0)},{"charttype","bar";"max",${NOM_HORAS_LEGALES};"color1","${P}";"color2","#e0e0e0"}),"")`)
    .setVerticalAlignment('middle').setBackground(PL);
  d.getRange(9, 8, 1, 3).merge()
    .setFormula(`=TEXT(L4/100,"0.0%")&"  ("&TEXT(L1,"[h]:mm")&" de ${NOM_HORAS_LEGALES}h)"`)
    .setFontSize(9).setFontWeight('bold').setFontColor(P)
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setBackground(PL);

  // ══════════════════════════════════════════
  //  CHART — Horas por día (fila 10–14)
  // ══════════════════════════════════════════
  d.setRowHeight(10, 8);
  d.setRowHeight(11, 22);
  d.setRowHeight(12, 60);
  d.setRowHeight(13, 8);

  d.getRange('B11:J11').merge()
    .setValue('📈  Horas trabajadas por día')
    .setFontSize(11).setFontWeight('bold').setFontColor(TX).setVerticalAlignment('middle');

  d.getRange('B12:J12').merge()
    .setFormula(
      `=IFERROR(SPARKLINE(`+
      `FILTER('${S}'!E2:E2000*24,`+
      `YEAR('${S}'!A2:A2000)=YEAR(TODAY()),`+
      `MONTH('${S}'!A2:A2000)=MONTH(TODAY()),`+
      `'${S}'!A2:A2000<>"",`+
      `ISNUMBER('${S}'!E2:E2000)),`+
      `{"charttype","column";"color","${P}";"ymin",0;"ymax",12;"empty","ignore"}),"")`
    )
    .setVerticalAlignment('middle').setBackground(W)
    .setBorder(true,true,true,true,false,false, G2, SpreadsheetApp.BorderStyle.SOLID);

  // ══════════════════════════════════════════
  //  LIQUIDACIÓN DEL MES (filas 14–23)
  // ══════════════════════════════════════════
  d.setRowHeight(14, 26);
  d.getRange('B14:F14').merge()
    .setValue('💼  Liquidación del Mes')
    .setFontSize(11).setFontWeight('bold').setFontColor(TX).setVerticalAlignment('middle');
  d.getRange('H14:J14').merge()
    .setValue('📊  Resumen')
    .setFontSize(11).setFontWeight('bold').setFontColor(TX).setVerticalAlignment('middle');

  // Liquidación tabla (izquierda)
  const liqStart = 15;
  const liqRows = [
    { l:'Concepto',           v:'Monto',                          hdr:true },
    { l:'Salario Causado',    v:'=TEXT(L5,"$ #,##0")',             hdr:false },
    { l:'Auxilio Transporte', v:'=TEXT(L6,"$ #,##0")',             hdr:false },
    { l:'(-) Salud',          v:'=TEXT(-'+NOM_DED_SALUD+',"$ #,##0")',  hdr:false, red:true },
    { l:'(-) Pensión',        v:'=TEXT(-'+NOM_DED_PENSION+',"$ #,##0")',hdr:false, red:true },
    { l:'Total Bruto',        v:'=TEXT(L5+L6,"$ #,##0")',          hdr:false, bold:true },
    { l:'NETO A PAGAR',       v:'=TEXT(L7,"$ #,##0")',             hdr:false, total:true },
  ];

  liqRows.forEach((r, i) => {
    const rw = liqStart + i;
    d.setRowHeight(rw, 26);
    let bg = i % 2 === 0 ? W : G1;
    let lc = TX, vc = TX;

    if (r.hdr)   { bg = P;  lc = W; vc = W; }
    if (r.total) { bg = PD; lc = W; vc = GO; }
    if (r.red)   { vc = RD; }

    d.getRange(rw, 2, 1, 3).merge().setValue(r.l).setBackground(bg).setFontColor(lc)
      .setFontSize(r.total ? 11 : 9).setFontWeight(r.hdr||r.total||r.bold ? 'bold' : 'normal')
      .setVerticalAlignment('middle');

    const vCell = d.getRange(rw, 5, 1, 2).merge();
    if (r.v.startsWith('=')) vCell.setFormula(r.v); else vCell.setValue(r.v);
    vCell.setBackground(bg).setFontColor(vc).setFontSize(r.total ? 12 : 10)
      .setFontWeight(r.hdr||r.total||r.bold ? 'bold' : 'normal')
      .setHorizontalAlignment('right').setVerticalAlignment('middle');
  });
  d.getRange(liqStart, 2, liqRows.length, 5)
    .setBorder(true,true,true,true,true,true, G2, SpreadsheetApp.BorderStyle.SOLID);

  // Resumen (derecha)
  const resStart = 15;
  const resRows = [
    { l:'Horas trabajadas',   v:'=TEXT(L1,"[h]:mm:ss")', icon:'⏱️' },
    { l:'Jornadas registradas', v:'=L3&" días"',         icon:'📋' },
    { l:'Cumplimiento',       v:'=TEXT(L4/100,"0.0%")',  icon:'🎯' },
    { l:'Horas objetivo',     v:NOM_HORAS_LEGALES+'h',  icon:'🎪' },
    { l:'Salario base',       v:'$ '+NOM_SALARIO_BASE.toLocaleString('es-CO'), icon:'💰' },
  ];

  resRows.forEach(({l, v, icon}, i) => {
    const rw = resStart + i;
    d.setRowHeight(rw, Math.max(d.getRowHeight(rw) || 26, 26));
    const bg = i % 2 === 0 ? W : G1;
    d.getRange(rw, 8, 1, 2).merge().setValue(icon + '  ' + l)
      .setBackground(bg).setFontSize(9).setFontColor(TS).setVerticalAlignment('middle');
    const vc = d.getRange(rw, 10);
    if (String(v).startsWith('=')) vc.setFormula(v); else vc.setValue(v);
    vc.setBackground(bg).setFontSize(10).setFontWeight('bold').setFontColor(TX)
      .setHorizontalAlignment('right').setVerticalAlignment('middle');
  });
  d.getRange(resStart, 8, resRows.length, 3)
    .setBorder(true,true,true,true,true,true, G2, SpreadsheetApp.BorderStyle.SOLID);

  // Período info
  const periodoRow = resStart + resRows.length;
  d.setRowHeight(periodoRow, 22);
  d.getRange(periodoRow, 8, 1, 3).merge()
    .setFormula(`="📅 "&TEXT(DATE(YEAR(TODAY()),MONTH(TODAY()),1),"dd/MM/yyyy")&" — "&TEXT(EOMONTH(TODAY(),0),"dd/MM/yyyy")`)
    .setFontSize(8).setFontColor(TS).setBackground(PL).setVerticalAlignment('middle').setHorizontalAlignment('center');

  // ══════════════════════════════════════════
  //  TABLA REGISTROS (filas 23+)
  // ══════════════════════════════════════════
  const tblTitle = 23;
  const tblHead  = 24;
  const tblData  = 25;

  d.setRowHeight(tblTitle, 8);
  d.setRowHeight(tblTitle + 1, 28);
  d.setRowHeight(tblHead, 24);

  d.getRange(tblTitle+1, 2, 1, 9).merge()
    .setValue('📋  Registros del Mes — se actualizan automáticamente')
    .setFontSize(11).setFontWeight('bold').setFontColor(TX).setVerticalAlignment('middle');

  // Headers — 5 columnas: Fecha, Día, Entrada, Salida, Horas, (spacer), Descripción
  const headers = ['Fecha', 'Día', 'Entrada', 'Salida', 'Horas', '', 'Descripción', '', ''];
  headers.forEach((h, i) => {
    if (i === 5 || i === 7 || i === 8) return; // skip spacer cols
    const cell = d.getRange(tblHead, 2 + i);
    cell.setValue(h).setBackground(P).setFontColor(W).setFontSize(9).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
  });
  // Merge Descripción header across 3 cols
  d.getRange(tblHead, 8, 1, 3).merge().setValue('Descripción')
    .setBackground(P).setFontColor(W).setFontSize(9).setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  // Spacer col header
  d.getRange(tblHead, 7).setBackground(P);

  // FILTER fórmula — fecha, día, entrada, salida, horas, spacer, descripción
  d.getRange(tblData, 2).setFormula(
    `=IFERROR(SORT(FILTER(`+
    `CHOOSE({1,2,3,4,5,6,7},`+
    `'${S}'!A2:A2000,`+
    `'${S}'!B2:B2000,`+
    `IF('${S}'!C2:C2000<>"",TEXT('${S}'!C2:C2000,"h:mm AM/PM"),"--"),`+
    `IF('${S}'!D2:D2000<>"",TEXT('${S}'!D2:D2000,"h:mm AM/PM"),"--"),`+
    `IF('${S}'!E2:E2000<>"",TEXT('${S}'!E2:E2000,"[h]:mm:ss"),"--"),`+
    `"",`+
    `IF('${S}'!F2:F2000<>"",'${S}'!F2:F2000,"—")),`+
    `YEAR('${S}'!A2:A2000)=YEAR(TODAY()),`+
    `MONTH('${S}'!A2:A2000)=MONTH(TODAY()),`+
    `'${S}'!A2:A2000<>""`+
    `),1,FALSE),"")`
  );

  // Format data area
  d.getRange(tblData, 2, 40, 1).setNumberFormat('dd/MM/yyyy');
  d.getRange(tblData, 2, 40, 9).setFontSize(9).setVerticalAlignment('middle')
    .setHorizontalAlignment('center');
  // Descripción col left-aligned and merged
  for (let i = 0; i < 40; i++) {
    d.getRange(tblData + i, 8, 1, 3).merge()
      .setHorizontalAlignment('left');
  }

  // Alternating row colors
  for (let i = 0; i < 40; i++) {
    d.getRange(tblData + i, 2, 1, 9).setBackground(i % 2 === 0 ? W : G1);
  }

  // Border for full table
  d.getRange(tblHead, 2, 41, 9)
    .setBorder(true,true,true,true,true,true, G2, SpreadsheetApp.BorderStyle.SOLID);

  // ══════════════════════════════════════════
  //  FOOTER
  // ══════════════════════════════════════════
  const footRow = tblData + 41;
  d.setRowHeight(footRow, 24);
  d.getRange(footRow, 2, 1, 9).merge()
    .setFormula(`="⚡ WorkClock Pro v3  |  Generado: "&TEXT(NOW(),"dd/MM/yyyy HH:mm")&"  |  Los datos se actualizan automáticamente"`)
    .setFontSize(8).setFontColor(TS).setHorizontalAlignment('center').setBackground(PL)
    .setVerticalAlignment('middle');

  // ══════════════════════════════════════════
  //  POSICIONAR + TRIGGER
  // ══════════════════════════════════════════
  ss.setActiveSheet(d);
  ss.moveActiveSheet(1);
  _instalarAutoRefresh();

  SpreadsheetApp.getUi().alert(
    '✅ Dashboard v3 creado con éxito.\n\n'+
    '• KPIs, tabla y gráfico se actualizan AUTOMÁTICAMENTE.\n'+
    '• Columna "Descripción" reemplaza Rango/Ubicación.\n'+
    '• Ejecuta "Actualizar Dashboard" solo si necesitas regenerar formato.'
  );
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
    d.getRange('G3').setValue('🔄 ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
      .setFontSize(8).setFontColor('#a5d6a7').setBackground('#1b5e20')
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
