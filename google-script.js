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
    }

    const rowDate = row[0] instanceof Date ? row[0] : new Date(row[0]);

    // Accumulate totals
    if (row[4] !== '' && row[4] !== null) {
      let segs = 0;
      if (row[4] instanceof Date)        segs = row[4].getHours() * 3600 + row[4].getMinutes() * 60 + row[4].getSeconds();
      else if (typeof row[4] === 'number') segs = Math.round(row[4] * 86400);
      if (rowDate >= startOfMonth) segsMes    += segs;
      if (rowDate >= startOfWeek)  segsSemana += segs;
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
        let s = row[4] instanceof Date
          ? row[4].getHours() * 3600 + row[4].getMinutes() * 60 + row[4].getSeconds()
          : Math.round(row[4] * 86400);
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
    mesSegundos:    segsMes
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
// --- DASHBOARD v2 — 100% FÓRMULAS (auto-actualización en tiempo real)
// =====================================================================
function generarDashboard() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const tz = Session.getScriptTimeZone();
  const DASH = 'Dashboard';
  const S = SHEET_NAME; // 'Hoja 1'

  // --- Crear / limpiar hoja ---
  let d = ss.getSheetByName(DASH);
  if (d) {
    d.clearContents(); d.clearFormats(); d.clearNotes();
    d.getCharts().forEach(c => d.removeChart(c));
    d.setConditionalFormatRules([]);
  } else {
    d = ss.insertSheet(DASH, 0);
  }

  // === PALETA ===
  const HD = '#1b5e20', HM = '#2e7d32', HL = '#4caf50', HX = '#a5d6a7';
  const LG = '#e8f5e9', W = '#ffffff', G1 = '#f5f5f5', G2 = '#fafafa';
  const BO = '#c8e6c9', TX = '#212121', TS = '#616161', RD = '#c62828', GO = '#f9a825';

  // === COLUMNAS ===
  [[1,20],[2,160],[3,130],[4,130],[5,130],[6,30],[7,160],[8,160],[9,20],[10,1],[11,1]]
    .forEach(([c,w]) => d.setColumnWidth(c,w));
  d.setTabColor(HM);
  d.hideColumns(10, 2);

  // Fondo base
  d.getRange(1,1,75,9).setBackground(W).setFontColor(TX).setFontFamily('Arial');

  // ══════════════════════════════════════════
  //  HELPER FORMULAS (columna J, oculta)
  //  Estas fórmulas se recalculan SOLAS
  // ══════════════════════════════════════════
  const YC = `(YEAR('${S}'!A2:A2000)=YEAR(TODAY()))`;
  const MC = `(MONTH('${S}'!A2:A2000)=MONTH(TODAY()))`;
  const NE = `('${S}'!A2:A2000<>"")`;
  const HN = `(ISNUMBER('${S}'!E2:E2000))`;
  const SP = `${YC}*${MC}*${NE}`;                // SUMPRODUCT base
  const CF = `">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1)`;   // COUNTIFS >=
  const CT = `"<"&DATE(YEAR(TODAY()),MONTH(TODAY())+1,1)`;  // COUNTIFS <

  // J1: total horas (fracción de día) — se auto-actualiza
  d.getRange('J1').setFormula(`=IFERROR(SUMPRODUCT(${SP}*${HN}*('${S}'!E2:E2000)),0)`);
  // J2: horas decimales
  d.getRange('J2').setFormula(`=J1*24`);
  // J3: registros del mes
  d.getRange('J3').setFormula(`=IFERROR(COUNTIFS('${S}'!A2:A2000,${CF},'${S}'!A2:A2000,${CT},'${S}'!A2:A2000,"<>"),0)`);
  // J4: cumplimiento %
  d.getRange('J4').setFormula(`=IFERROR(J2/${NOM_HORAS_LEGALES}*100,0)`);
  // J5: salario causado
  d.getRange('J5').setFormula(`=IFERROR(ROUND(${NOM_SALARIO_BASE}*J2/${NOM_HORAS_LEGALES},0),0)`);
  // J6: aux transporte causado
  d.getRange('J6').setFormula(`=IFERROR(ROUND(${NOM_AUX_TRANSPORTE}*J2/${NOM_HORAS_LEGALES},0),0)`);
  // J7: neto a pagar
  d.getRange('J7').setFormula(`=MAX(J5+J6-${NOM_DED_SALUD}-${NOM_DED_PENSION},0)`);
  // J8: en sitio
  d.getRange('J8').setFormula(`=IFERROR(COUNTIFS('${S}'!A2:A2000,${CF},'${S}'!A2:A2000,${CT},'${S}'!F2:F2000,"*En sitio*"),0)`);
  // J9: fuera
  d.getRange('J9').setFormula(`=IFERROR(COUNTIFS('${S}'!A2:A2000,${CF},'${S}'!A2:A2000,${CT},'${S}'!F2:F2000,"*Fuera*"),0)`);
  // J10: sin GPS / otros
  d.getRange('J10').setFormula(`=MAX(J3-J8-J9,0)`);

  // ══════════════════════════════════════════
  //  HEADER (filas 1–4)
  // ══════════════════════════════════════════
  d.setRowHeight(1, 6);
  d.setRowHeight(2, 55);
  d.setRowHeight(3, 28);
  d.setRowHeight(4, 5);

  d.getRange(2,1,2,9).setBackground(HD);
  d.getRange('B2:E2').merge()
    .setValue('📊  WorkClock Pro — Dashboard')
    .setFontSize(20).setFontWeight('bold').setFontColor(W)
    .setVerticalAlignment('middle');
  d.getRange('G2:H2').merge()
    .setFormula(`="🗓️  "&UPPER(TEXT(TODAY(),"MMMM YYYY"))`)
    .setFontSize(14).setFontWeight('bold').setFontColor(HX)
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setBackground(HD);
  d.getRange('B3:E3').merge()
    .setValue('Control de Tiempo, Nómina y Asistencia')
    .setFontSize(10).setFontColor(HX).setVerticalAlignment('middle').setBackground(HD);
  d.getRange('G3:H3').merge()
    .setValue('🔄 ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
    .setFontSize(8).setFontColor(HX).setHorizontalAlignment('right')
    .setVerticalAlignment('middle').setBackground(HD);

  // ══════════════════════════════════════════
  //  KPI CARDS (filas 5–10)  — con FÓRMULAS
  // ══════════════════════════════════════════
  d.setRowHeight(5, 12);
  d.setRowHeight(6, 20);   // label
  d.setRowHeight(7, 50);   // value
  d.setRowHeight(8, 20);   // sub
  d.setRowHeight(9, 5);    // gap card bottom
  d.setRowHeight(10, 10);  // gap

  // Definición de cards: [col, span, label, formula, sub, isDark]
  const cards = [
    [2, 1, '⏱️  HORAS DEL MES',   '=TEXT(J1,"[h]:mm:ss")',       NOM_HORAS_LEGALES+'h legales', false],
    [3, 1, '📋  JORNADAS',         '=J3&""',                      'Registros del mes',            false],
    [4, 1, '🎯  CUMPLIMIENTO',     '=TEXT(J4/100,"0.0%")',        'vs objetivo mensual',          false],
    [5, 1, '💰  SALARIO CAUSADO',  '=TEXT(J5,"$#,##0")',          'Base proporcional',            false],
    [7, 1, '💵  NETO A PAGAR',     '=TEXT(J7,"$#,##0")',          'Después de deducciones',       true],
    [8, 1, '📊  TOTAL BRUTO',      '=TEXT(J5+J6,"$#,##0")',       'Salario + Auxilio',            false],
  ];

  cards.forEach(([col, span, label, formula, sub, dark]) => {
    const bg  = dark ? HM  : LG;
    const tv  = dark ? W   : HD;
    const ts  = dark ? HX  : TS;

    d.getRange(5, col, 5, span).setBackground(bg);
    if (span > 1) {
      d.getRange(6,col,1,span).merge();
      d.getRange(7,col,1,span).merge();
      d.getRange(8,col,1,span).merge();
    }
    d.getRange(6,col).setValue(label).setFontSize(8).setFontWeight('bold')
      .setFontColor(ts).setBackground(bg).setHorizontalAlignment('center').setVerticalAlignment('bottom');
    const vc = d.getRange(7,col);
    vc.setFormula(formula);
    vc.setFontSize(20).setFontWeight('bold').setFontColor(tv).setBackground(bg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    d.getRange(8,col).setValue(sub).setFontSize(8).setFontColor(ts).setBackground(bg)
      .setHorizontalAlignment('center').setVerticalAlignment('top');
    d.getRange(5,col,5,span)
      .setBorder(true,true,true,true,false,false,BO,SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  });

  // ══════════════════════════════════════════
  //  BARRA DE PROGRESO — SPARKLINE (fila 11–12)
  // ══════════════════════════════════════════
  d.setRowHeight(11, 34);
  d.setRowHeight(12, 10);
  d.getRange(11,1,1,9).setBackground(LG);

  d.getRange('B11').setValue('Progreso:')
    .setFontSize(9).setFontWeight('bold').setFontColor(HM).setVerticalAlignment('middle').setBackground(LG);
  d.getRange('C11:E11').merge()
    .setFormula(`=IFERROR(SPARKLINE({J2,MAX(${NOM_HORAS_LEGALES}-J2,0)},{"charttype","bar";"max",${NOM_HORAS_LEGALES};"color1","#4caf50";"color2","#e0e0e0"}),"")`)
    .setVerticalAlignment('middle').setBackground(LG);
  d.getRange('G11:H11').merge()
    .setFormula(`=TEXT(J4/100,"0.0%")&"  ("&TEXT(J1,"[h]:mm")&"h de ${NOM_HORAS_LEGALES}h)"`)
    .setFontSize(10).setFontWeight('bold').setFontColor(HM)
    .setHorizontalAlignment('right').setVerticalAlignment('middle').setBackground(LG);

  // ══════════════════════════════════════════
  //  SECCIÓN IZQUIERDA: Distribución (filas 13–19)
  //  SECCIÓN DERECHA:   Liquidación  (filas 13–21)
  // ══════════════════════════════════════════
  d.setRowHeight(13, 30);

  // --- Título distribución ---
  d.getRange('B13:E13').merge()
    .setValue('📍  Distribución de Asistencia')
    .setFontSize(12).setFontWeight('bold').setFontColor(HD).setVerticalAlignment('middle');

  // --- Título liquidación ---
  d.getRange('G13:H13').merge()
    .setValue('💼  Liquidación del Mes')
    .setFontSize(12).setFontWeight('bold').setFontColor(HD).setVerticalAlignment('middle');

  // --- Distribución tabla ---
  const dH = 14; // dist header row
  [14,15,16,17].forEach(r => d.setRowHeight(r, 28));

  ['Estado','Registros','%','Mini gráfico'].forEach((h,i) => {
    d.getRange(dH, 2+i).setValue(h)
      .setBackground(HM).setFontColor(W).setFontSize(9).setFontWeight('bold')
      .setHorizontalAlignment(i===0?'left':'center').setVerticalAlignment('middle');
  });

  const dist = [
    ['✅  En sitio',        '=J8',  '=IFERROR(TEXT(J8/J3,"0.0%"),"-")',  '=IFERROR(SPARKLINE({J8,J3-J8},{"charttype","bar";"color1","#2e7d32";"color2","#e0e0e0";"max",J3}),"")'],
    ['🚩  Fuera',           '=J9',  '=IFERROR(TEXT(J9/J3,"0.0%"),"-")',  '=IFERROR(SPARKLINE({J9,J3-J9},{"charttype","bar";"color1","#c62828";"color2","#e0e0e0";"max",J3}),"")'],
    ['📱  Sin GPS / Manual','=J10', '=IFERROR(TEXT(J10/J3,"0.0%"),"-")', '=IFERROR(SPARKLINE({J10,J3-J10},{"charttype","bar";"color1","#9e9e9e";"color2","#e0e0e0";"max",J3}),"")'],
  ];

  dist.forEach(([lbl,cnt,pct,spark], i) => {
    const rw = dH + 1 + i;
    const bg = i%2===0 ? W : G1;
    [[2,lbl],[3,cnt],[4,pct],[5,spark]].forEach(([c,v]) => {
      const cell = d.getRange(rw,c);
      if (String(v).startsWith('=')) cell.setFormula(v); else cell.setValue(v);
      cell.setBackground(bg).setFontSize(9).setVerticalAlignment('middle')
        .setHorizontalAlignment(c===2?'left':'center');
    });
  });
  d.getRange(dH,2,4,4).setBorder(true,true,true,true,true,true,BO,SpreadsheetApp.BorderStyle.SOLID);

  // --- SPARKLINE donut de cumplimiento debajo de distribución ---
  d.setRowHeight(18, 10);
  d.setRowHeight(19, 26);
  d.getRange('B19:E19').merge()
    .setFormula(`=IFERROR(SPARKLINE({J4,MAX(100-J4,0)},{"charttype","bar";"max",100;"color1","#4caf50";"color2","#e0e0e0"}),"")`)
    .setVerticalAlignment('middle');

  // --- Liquidación tabla ---
  [14,15,16,17,18,19,20,21].forEach(r => d.setRowHeight(r, Math.max(d.getRowHeight(r)||28, 28)));

  const liq = [
    {l:'Concepto',           v:'Valor',                     hdr:true},
    {l:'Salario Causado',    v:'=TEXT(J5,"$ #,##0")',        hdr:false},
    {l:'Auxilio Transporte', v:'=TEXT(J6,"$ #,##0")',        hdr:false},
    {l:'(-) Salud',          v:'=TEXT(-'+NOM_DED_SALUD+',"$ #,##0")',  hdr:false, red:true},
    {l:'(-) Pensión',        v:'=TEXT(-'+NOM_DED_PENSION+',"$ #,##0")',hdr:false, red:true},
    {l:'Total Bruto',        v:'=TEXT(J5+J6,"$ #,##0")',     hdr:false},
    {l:'NETO A PAGAR',       v:'=TEXT(J7,"$ #,##0")',        hdr:false, total:true},
  ];

  liq.forEach((r, i) => {
    const rw = 14 + i;
    let bg = i%2===0 ? W : G1;
    let lc = TX, vc = TX;

    if (r.hdr)   { bg = HM; lc = W; vc = W; }
    if (r.total) { bg = HD; lc = W; vc = GO; }
    if (r.red)   { vc = RD; }

    d.getRange(rw,7).setValue(r.l).setBackground(bg).setFontColor(lc).setFontSize(r.total?11:9)
      .setFontWeight(r.hdr||r.total?'bold':'normal').setVerticalAlignment('middle');

    const vCell = d.getRange(rw,8);
    if (r.v.startsWith('=')) vCell.setFormula(r.v); else vCell.setValue(r.v);
    vCell.setBackground(bg).setFontColor(vc).setFontSize(r.total?11:9)
      .setFontWeight(r.hdr||r.total?'bold':'normal')
      .setHorizontalAlignment('right').setVerticalAlignment('middle');
  });
  d.getRange(14,7,liq.length,2).setBorder(true,true,true,true,true,true,BO,SpreadsheetApp.BorderStyle.SOLID);

  // Info período
  d.setRowHeight(21, 22);
  d.setRowHeight(22, 22);
  d.getRange('G21:H21').merge()
    .setFormula(`="📅 Período: 01/"&TEXT(MONTH(TODAY()),"00")&"/"&YEAR(TODAY())&" — "&DAY(EOMONTH(TODAY(),0))&"/"&TEXT(MONTH(TODAY()),"00")&"/"&YEAR(TODAY())`)
    .setFontSize(8).setFontColor(TS).setBackground(LG).setVerticalAlignment('middle');
  d.getRange('G22:H22').merge()
    .setValue('🎯 Objetivo: '+NOM_HORAS_LEGALES+'h  |  Base: $'+NOM_SALARIO_BASE.toLocaleString('es-CO'))
    .setFontSize(8).setFontColor(TS).setBackground(LG).setVerticalAlignment('middle');

  // ══════════════════════════════════════════
  //  TABLA REGISTROS — FÓRMULA FILTER (auto-update!)
  // ══════════════════════════════════════════
  d.setRowHeight(23, 15);
  d.setRowHeight(24, 32);
  d.setRowHeight(25, 28);

  d.getRange('B24:H24').merge()
    .setValue('📋  Registros del Mes  —  se actualizan automáticamente al agregar datos')
    .setFontSize(12).setFontWeight('bold').setFontColor(HD).setVerticalAlignment('middle');

  // Headers
  ['Fecha','Día','Entrada','Salida','Horas','','Rango'].forEach((h,i) => {
    d.getRange(25, 2+i).setValue(h)
      .setBackground(HM).setFontColor(W).setFontSize(9).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
  });

  // FILTER fórmula — ordena por fecha desc, muestra todo el mes
  d.getRange(26, 2).setFormula(
    `=IFERROR(SORT(FILTER(`+
    `CHOOSE({1,2,3,4,5,6,7},`+
    `'${S}'!A2:A2000,`+
    `'${S}'!B2:B2000,`+
    `IF('${S}'!C2:C2000<>"",TEXT('${S}'!C2:C2000,"h:mm AM/PM"),"--"),`+
    `IF('${S}'!D2:D2000<>"",TEXT('${S}'!D2:D2000,"h:mm AM/PM"),"--"),`+
    `IF('${S}'!E2:E2000<>"",TEXT('${S}'!E2:E2000,"[h]:mm:ss"),"--"),`+
    `"",`+
    `IF('${S}'!F2:F2000<>"",'${S}'!F2:F2000,"--")),`+
    `YEAR('${S}'!A2:A2000)=YEAR(TODAY()),`+
    `MONTH('${S}'!A2:A2000)=MONTH(TODAY()),`+
    `'${S}'!A2:A2000<>""`+
    `),1,FALSE),"")`
  );

  // Formatear la columna de fechas
  d.getRange(26, 2, 40, 1).setNumberFormat('dd/MM/yyyy');
  // Formatear el área de datos
  d.getRange(26, 2, 40, 7).setFontSize(9).setVerticalAlignment('middle')
    .setHorizontalAlignment('center');
  // Borde
  d.getRange(25, 2, 42, 7)
    .setBorder(true,true,true,true,true,true,BO,SpreadsheetApp.BorderStyle.SOLID);

  // Conditional formatting para Rango
  const rangoArea = d.getRange(26, 8, 40, 1);
  d.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('En sitio').setFontColor(HM).setRanges([rangoArea]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('Fuera').setFontColor(RD).setRanges([rangoArea]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('Manual').setFontColor(TS).setRanges([rangoArea]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('En curso').setFontColor('#e65100').setRanges([rangoArea]).build(),
  ]);

  // Alternating colors para filas de datos
  for (let i = 0; i < 35; i++) {
    const bg = i % 2 === 0 ? W : G1;
    d.getRange(26 + i, 2, 1, 7).setBackground(bg);
  }

  // ══════════════════════════════════════════
  //  CHART — Horas por día (SPARKLINE columnas)
  // ══════════════════════════════════════════
  d.setRowHeight(67, 15);
  d.setRowHeight(68, 28);
  d.setRowHeight(69, 55);

  d.getRange('B68:H68').merge()
    .setValue('📈  Horas Trabajadas por Día (sparkline)')
    .setFontSize(12).setFontWeight('bold').setFontColor(HD).setVerticalAlignment('middle');

  // SPARKLINE column chart basado en los datos del mes
  d.getRange('B69:H69').merge()
    .setFormula(
      `=IFERROR(SPARKLINE(`+
      `FILTER('${S}'!E2:E2000*24,`+
      `YEAR('${S}'!A2:A2000)=YEAR(TODAY()),`+
      `MONTH('${S}'!A2:A2000)=MONTH(TODAY()),`+
      `'${S}'!A2:A2000<>"",`+
      `ISNUMBER('${S}'!E2:E2000)),`+
      `{"charttype","column";"color","#4caf50";"ymin",0;"ymax",10;"empty","ignore"}),"")`
    )
    .setVerticalAlignment('middle');

  // ══════════════════════════════════════════
  //  FOOTER
  // ══════════════════════════════════════════
  d.setRowHeight(70, 8);
  d.setRowHeight(71, 25);
  d.getRange('B71:H71').merge()
    .setFormula(`="⚡ WorkClock Pro  |  Dashboard generado: "&TEXT(NOW(),"dd/MM/yyyy HH:mm")&"  |  Los datos se actualizan automáticamente"`)
    .setFontSize(8).setFontColor(TS).setHorizontalAlignment('center').setBackground(LG);

  // ══════════════════════════════════════════
  //  POSICIONAR AL INICIO + INSTALAR TRIGGER
  // ══════════════════════════════════════════
  ss.setActiveSheet(d);
  ss.moveActiveSheet(1);
  _instalarAutoRefresh();

  SpreadsheetApp.getUi().alert(
    '✅ Dashboard v2 creado con éxito.\n\n'+
    '• Todos los KPIs, la tabla y el gráfico se actualizan AUTOMÁTICAMENTE.\n'+
    '• Solo ejecuta "Actualizar Dashboard" si necesitas re-generar el formato.\n'+
    '• Agrega jornadas desde la app o directamente en "Hoja 1" y el dashboard se actualiza solo.'
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
