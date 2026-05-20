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
 * A: Fecha | B: Dia | C: Entrada | D: Salida | E: Horas | F: Rango | G: Ubicacion
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

    if      (action === 'getCurrentState')       result = getCurrentState();
    else if (action === 'getRecentHistory')       result = getRecentHistory();
    else if (action === 'registrarEntrada')       result = registrarEntrada();
    else if (action === 'registrarSalida')        result = registrarSalida(params.coords);
    else if (action === 'eliminarUltimoRegistro') result = eliminarUltimoRegistro();
    else if (action === 'actualizarRegistro')     result = actualizarRegistro(params.rowNumber, params.nuevaEntrada, params.nuevaSalida);
    else if (action === 'agregarJornadaManual')   result = agregarJornadaManual(params.data);
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

function getCurrentState() {
  const sheet = getSheet();
  const lastRow = getUltimaFila(sheet);
  if (lastRow <= 1) return { active: false };

  const numRows = Math.min(lastRow - 1, 5);
  const startRow = lastRow - numRows + 1;
  const values = sheet.getRange(startRow, 1, numRows, 4).getValues();
  const tz = Session.getScriptTimeZone();

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (row[2] !== '' && (!row[3] || row[3] === '')) {
      const startTime = row[2] instanceof Date
        ? Utilities.formatDate(row[2], tz, 'h:mm a')
        : row[2];
      return { active: true, startTime };
    }
  }
  return { active: false };
}

function getRecentHistory() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone();

  if (values.length <= 1) {
    return { history: [], semanaTotal: '0 min', mesTotal: '0 min', semanaSegundos: 0, mesSegundos: 0 };
  }

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

  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i];
    if (!row[0]) continue;

    const rowDate = row[0] instanceof Date ? row[0] : new Date(row[0]);

    // Acumular totales
    if (row[4] !== '' && row[4] !== null) {
      let segs = 0;
      if (row[4] instanceof Date)        segs = row[4].getHours() * 3600 + row[4].getMinutes() * 60 + row[4].getSeconds();
      else if (typeof row[4] === 'number') segs = Math.round(row[4] * 86400);
      if (rowDate >= startOfMonth) segsMes    += segs;
      if (rowDate >= startOfWeek)  segsSemana += segs;
    }

    // Últimas 7 filas para el historial visible
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
        rowNumber: i + 1,
        fecha,
        entrada,
        salida,
        in24,
        out24,
        horas,
        rango: row[5] || ''
      });
    }
  }

  return {
    history:        historyData,
    semanaTotal:    formatoHoras(segsSemana),
    mesTotal:       formatoHoras(segsMes),
    semanaSegundos: segsSemana,
    mesSegundos:    segsMes
  };
}

function registrarEntrada() {
  const sheet = getSheet();
  const ahora = new Date();
  const tz = Session.getScriptTimeZone();
  const nuevaFila = getUltimaFila(sheet) + 1;
  const dias = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];

  sheet.getRange(nuevaFila, 1, 1, 7).setValues([[
    Utilities.formatDate(ahora, tz, 'yyyy-MM-dd'),
    dias[ahora.getDay()],
    Utilities.formatDate(ahora, tz, 'HH:mm:ss'),
    '',
    '',
    'En curso...',
    ''
  ]]);
  return { success: true };
}

function registrarSalida(coords) {
  const sheet = getSheet();
  const lastRow = getUltimaFila(sheet);
  if (lastRow <= 1) throw new Error('No hay turno activo');

  const numRows = Math.min(lastRow - 1, 5);
  const startRow = lastRow - numRows + 1;
  const values = sheet.getRange(startRow, 1, numRows, 4).getValues();
  const tz = Session.getScriptTimeZone();

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (row[2] !== '' && (!row[3] || row[3] === '')) {
      const rowIndex = startRow + i;
      let rango = 'Sin GPS';
      if (coords && coords.lat) {
        const dist = calcularDistancia(coords.lat, coords.lng);
        rango = dist <= RADIO_METROS ? '✅ En sitio' : '🚩 Fuera';
      }
      const horaSalida = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');
      const coordStr   = coords ? `${coords.lat},${coords.lng}` : 'N/A';

      sheet.getRange(rowIndex, 4, 1, 4).setValues([[
        horaSalida,
        '=IF(RC[-1]<RC[-2], 1+RC[-1]-RC[-2], RC[-1]-RC[-2])',
        rango,
        coordStr
      ]]);
      sheet.getRange(rowIndex, 5).setNumberFormat('[h]:mm:ss');
      return { success: true };
    }
  }
  throw new Error('No hay turno activo');
}

function eliminarUltimoRegistro() {
  const sheet = getSheet();
  const lastRow = getUltimaFila(sheet);
  if (lastRow <= 1) throw new Error('No hay registros');
  sheet.getRange(lastRow, 1, 1, 7).clearContent();
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

  sheet.getRange(nuevaFila, 1, 1, 7).setValues([[
    data.fecha,
    dia,
    data.entrada + ':00',
    data.salida  + ':00',
    '=IF(RC[-1]<RC[-2], 1+RC[-1]-RC[-2], RC[-1]-RC[-2])',
    '✍️ Manual',
    'N/A'
  ]]);
  sheet.getRange(nuevaFila, 5).setNumberFormat('[h]:mm:ss');

  // Reordenar por fecha
  if (sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).sort({ column: 1, ascending: true });
  }
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
// --- DASHBOARD GENERATOR ---
// =====================================================================
function generarDashboard() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const src = getSheet();
  const tz = Session.getScriptTimeZone();
  const DASH_NAME = 'Dashboard';

  // --- Crear o limpiar hoja Dashboard ---
  let d = ss.getSheetByName(DASH_NAME);
  if (d) { d.clear(); } else { d = ss.insertSheet(DASH_NAME, 0); }

  // Eliminar charts existentes
  d.getCharts().forEach(c => d.removeChart(c));

  // --- Leer datos del mes actual ---
  const allData = src.getDataRange().getValues();
  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let registros = [];
  let totalSegs = 0;
  let enSitio = 0;
  let fuera = 0;
  let sinGPS = 0;

  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    if (!row[0]) continue;
    const rd = row[0] instanceof Date ? row[0] : new Date(row[0]);
    if (rd.getMonth() !== mesActual || rd.getFullYear() !== anioActual) continue;

    let segs = 0;
    if (row[4] !== '' && row[4] !== null) {
      if (row[4] instanceof Date) segs = row[4].getHours() * 3600 + row[4].getMinutes() * 60 + row[4].getSeconds();
      else if (typeof row[4] === 'number') segs = Math.round(row[4] * 86400);
    }
    totalSegs += segs;

    const rango = String(row[5] || '');
    if (rango.includes('En sitio')) enSitio++;
    else if (rango.includes('Fuera')) fuera++;
    else sinGPS++;

    registros.push({
      fecha: rd,
      dia: row[1] || '',
      entrada: row[2],
      salida: row[3],
      segs: segs,
      horas: row[4],
      rango: rango,
      ubicacion: row[6] || ''
    });
  }

  const totalRegistros = registros.length;
  const horasDecimal = totalSegs / 3600;
  const horasStr = Math.floor(totalSegs / 3600) + ':' + String(Math.floor((totalSegs % 3600) / 60)).padStart(2, '0') + ':' + String(totalSegs % 60).padStart(2, '0');
  const cumplimiento = NOM_HORAS_LEGALES > 0 ? (horasDecimal / NOM_HORAS_LEGALES) * 100 : 0;
  const propTrabajada = horasDecimal / NOM_HORAS_LEGALES;
  const salarioCausado = Math.round(NOM_SALARIO_BASE * propTrabajada);
  const auxCausado = Math.round(NOM_AUX_TRANSPORTE * propTrabajada);
  const netoPagar = salarioCausado + auxCausado - NOM_DED_SALUD - NOM_DED_PENSION;
  const totalMes = salarioCausado + auxCausado;

  // --- COLORES ---
  const VERDE_OSCURO = '#1b5e20';
  const VERDE        = '#2e7d32';
  const VERDE_CLARO  = '#4caf50';
  const VERDE_FONDO  = '#e8f5e9';
  const BLANCO       = '#ffffff';
  const GRIS_CLARO   = '#f5f5f5';
  const GRIS_BORDE   = '#e0e0e0';
  const TEXTO_OSCURO = '#212121';
  const TEXTO_SEC    = '#616161';
  const ROJO         = '#c62828';
  const NARANJA      = '#e65100';

  // --- CONFIGURAR HOJA ---
  d.setColumnWidth(1, 30);   // margen
  d.setColumnWidth(2, 180);
  d.setColumnWidth(3, 140);
  d.setColumnWidth(4, 140);
  d.setColumnWidth(5, 140);
  d.setColumnWidth(6, 140);
  d.setColumnWidth(7, 140);
  d.setColumnWidth(8, 30);   // margen
  d.setColumnWidth(9, 180);
  d.setColumnWidth(10, 160);
  d.setTabColor(VERDE);

  // Fondo general blanco
  d.getRange(1, 1, 60, 12).setBackground(BLANCO);

  // ==================== HEADER ====================
  d.setRowHeight(1, 10);
  d.setRowHeight(2, 45);
  d.getRange('B2:G2').merge()
    .setValue('📊 WorkClock Pro — Dashboard')
    .setFontSize(18).setFontWeight('bold').setFontColor(VERDE_OSCURO)
    .setVerticalAlignment('middle');

  d.setRowHeight(3, 25);
  d.getRange('B3:G3').merge()
    .setValue('Control de Tiempo, Nómina y Asistencia  |  ' + meses[mesActual] + ' ' + anioActual)
    .setFontSize(10).setFontColor(TEXTO_SEC).setVerticalAlignment('middle');

  // Línea separadora
  d.setRowHeight(4, 4);
  d.getRange('B4:G4').merge().setBackground(VERDE);

  // ==================== KPI CARDS (Row 6-8) ====================
  d.setRowHeight(5, 15);
  d.setRowHeight(6, 22);
  d.setRowHeight(7, 35);
  d.setRowHeight(8, 20);

  const kpis = [
    { col: 2, label: '⏱️ HORAS DEL MES', value: horasStr, sub: NOM_HORAS_LEGALES + ' h legales' },
    { col: 3, label: '📅 REGISTROS', value: totalRegistros, sub: 'Jornadas registradas' },
    { col: 4, label: '📈 CUMPLIMIENTO', value: cumplimiento.toFixed(1) + '%', sub: 'vs. objetivo mensual' },
    { col: 5, label: '💰 SALARIO CAUSADO', value: '$' + salarioCausado.toLocaleString('es-CO'), sub: 'Base proporcional' },
    { col: 6, label: '💵 NETO A PAGAR', value: '$' + Math.max(0, netoPagar).toLocaleString('es-CO'), sub: 'Después de deducciones' },
  ];

  kpis.forEach(k => {
    const isNeto = k.col === 6;
    const cardBg = isNeto ? VERDE : VERDE_FONDO;
    const textColor = isNeto ? BLANCO : VERDE_OSCURO;
    const subColor = isNeto ? '#c8e6c9' : TEXTO_SEC;

    d.getRange(6, k.col).setValue(k.label)
      .setFontSize(8).setFontWeight('bold').setFontColor(subColor).setBackground(cardBg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    d.getRange(7, k.col).setValue(k.value)
      .setFontSize(18).setFontWeight('bold').setFontColor(textColor).setBackground(cardBg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    d.getRange(8, k.col).setValue(k.sub)
      .setFontSize(8).setFontColor(subColor).setBackground(cardBg)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');

    // Bordes de la card
    d.getRange(6, k.col, 3, 1).setBorder(true, true, true, true, false, false, GRIS_BORDE, SpreadsheetApp.BorderStyle.SOLID);
  });

  // ==================== BARRA DE PROGRESO (Row 10) ====================
  d.setRowHeight(9, 15);
  d.setRowHeight(10, 30);
  d.getRange('B10').setValue('Progreso mensual:').setFontSize(9).setFontWeight('bold').setFontColor(TEXTO_OSCURO);
  d.getRange('C10:F10').merge();
  const barText = '█'.repeat(Math.min(Math.round(cumplimiento / 5), 20)) + '░'.repeat(Math.max(20 - Math.round(cumplimiento / 5), 0));
  d.getRange('C10').setValue(barText + '  ' + cumplimiento.toFixed(1) + '% de ' + NOM_HORAS_LEGALES + 'h')
    .setFontFamily('Courier New').setFontSize(11).setFontColor(cumplimiento >= 95 ? VERDE : cumplimiento >= 50 ? NARANJA : ROJO)
    .setVerticalAlignment('middle');

  // ==================== DISTRIBUCIÓN (Row 12) ====================
  d.setRowHeight(11, 15);
  d.setRowHeight(12, 22);
  d.getRange('B12:D12').merge()
    .setValue('📍 Distribución de Asistencia')
    .setFontSize(12).setFontWeight('bold').setFontColor(VERDE_OSCURO);

  d.getRange('F12:G12').merge()
    .setValue('💼 Liquidación del Mes')
    .setFontSize(12).setFontWeight('bold').setFontColor(VERDE_OSCURO);

  // Tabla distribución
  d.setRowHeight(13, 25);
  d.setRowHeight(14, 25);
  d.setRowHeight(15, 25);
  d.setRowHeight(16, 25);

  d.getRange('B13').setValue('Estado').setFontWeight('bold').setFontSize(9).setBackground(VERDE).setFontColor(BLANCO);
  d.getRange('C13').setValue('Cantidad').setFontWeight('bold').setFontSize(9).setBackground(VERDE).setFontColor(BLANCO).setHorizontalAlignment('center');
  d.getRange('D13').setValue('Porcentaje').setFontWeight('bold').setFontSize(9).setBackground(VERDE).setFontColor(BLANCO).setHorizontalAlignment('center');

  const distData = [
    ['✅ En sitio', enSitio, totalRegistros > 0 ? (enSitio / totalRegistros * 100).toFixed(1) + '%' : '0%'],
    ['🚩 Fuera', fuera, totalRegistros > 0 ? (fuera / totalRegistros * 100).toFixed(1) + '%' : '0%'],
    ['📱 Sin GPS / Manual', sinGPS, totalRegistros > 0 ? (sinGPS / totalRegistros * 100).toFixed(1) + '%' : '0%'],
  ];
  distData.forEach((r, idx) => {
    const rowN = 14 + idx;
    const bg = idx % 2 === 0 ? GRIS_CLARO : BLANCO;
    d.getRange(rowN, 2).setValue(r[0]).setFontSize(9).setBackground(bg);
    d.getRange(rowN, 3).setValue(r[1]).setFontSize(9).setBackground(bg).setHorizontalAlignment('center');
    d.getRange(rowN, 4).setValue(r[2]).setFontSize(9).setBackground(bg).setHorizontalAlignment('center');
  });
  d.getRange(13, 2, 4, 3).setBorder(true, true, true, true, true, true, GRIS_BORDE, SpreadsheetApp.BorderStyle.SOLID);

  // ==================== LIQUIDACIÓN (Rows 13-19) ====================
  const liqData = [
    ['Concepto', 'Valor'],
    ['Salario Causado', '$' + salarioCausado.toLocaleString('es-CO')],
    ['Auxilio Transporte', '$' + auxCausado.toLocaleString('es-CO')],
    ['(-) Salud', '-$' + NOM_DED_SALUD.toLocaleString('es-CO')],
    ['(-) Pensión', '-$' + NOM_DED_PENSION.toLocaleString('es-CO')],
    ['Total Mes', '$' + totalMes.toLocaleString('es-CO')],
    ['NETO A PAGAR', '$' + Math.max(0, netoPagar).toLocaleString('es-CO')],
  ];

  liqData.forEach((r, idx) => {
    const rowN = 13 + idx;
    if (idx === 0) {
      d.getRange(rowN, 6).setValue(r[0]).setFontWeight('bold').setFontSize(9).setBackground(VERDE).setFontColor(BLANCO);
      d.getRange(rowN, 7).setValue(r[1]).setFontWeight('bold').setFontSize(9).setBackground(VERDE).setFontColor(BLANCO).setHorizontalAlignment('right');
    } else if (idx === liqData.length - 1) {
      d.getRange(rowN, 6).setValue(r[0]).setFontWeight('bold').setFontSize(11).setBackground(VERDE_OSCURO).setFontColor(BLANCO);
      d.getRange(rowN, 7).setValue(r[1]).setFontWeight('bold').setFontSize(11).setBackground(VERDE_OSCURO).setFontColor(BLANCO).setHorizontalAlignment('right');
    } else {
      const bg = idx % 2 === 0 ? GRIS_CLARO : BLANCO;
      const isDeduction = r[0].startsWith('(-)');
      d.getRange(rowN, 6).setValue(r[0]).setFontSize(9).setBackground(bg).setFontColor(isDeduction ? ROJO : TEXTO_OSCURO);
      d.getRange(rowN, 7).setValue(r[1]).setFontSize(9).setBackground(bg).setHorizontalAlignment('right').setFontColor(isDeduction ? ROJO : TEXTO_OSCURO);
    }
  });
  d.getRange(13, 6, liqData.length, 2).setBorder(true, true, true, true, true, true, GRIS_BORDE, SpreadsheetApp.BorderStyle.SOLID);

  // ==================== INFO PERIODO ====================
  const rowPeriodo = 13 + liqData.length + 1;
  d.getRange(rowPeriodo, 6, 1, 2).merge()
    .setValue('ℹ️ Período: 01/' + String(mesActual + 1).padStart(2, '0') + '/' + anioActual + ' - ' +
             new Date(anioActual, mesActual + 1, 0).getDate() + '/' + String(mesActual + 1).padStart(2, '0') + '/' + anioActual)
    .setFontSize(8).setFontColor(TEXTO_SEC).setBackground(VERDE_FONDO);
  const rowObj = rowPeriodo + 1;
  d.getRange(rowObj, 6, 1, 2).merge()
    .setValue('🎯 Horario objetivo: ' + NOM_HORAS_LEGALES + ':00:00 h')
    .setFontSize(8).setFontColor(TEXTO_SEC).setBackground(VERDE_FONDO);

  // ==================== TABLA REGISTROS RECIENTES ====================
  const tblStart = 18;
  d.setRowHeight(tblStart - 1, 15);
  d.getRange(tblStart, 2, 1, 6).merge()
    .setValue('📋 Registros Recientes')
    .setFontSize(12).setFontWeight('bold').setFontColor(VERDE_OSCURO);

  const tblHeaderRow = tblStart + 1;
  const headers = ['Fecha', 'Día', 'Entrada', 'Salida', 'Horas', 'Rango'];
  headers.forEach((h, idx) => {
    d.getRange(tblHeaderRow, 2 + idx).setValue(h)
      .setFontWeight('bold').setFontSize(9).setFontColor(BLANCO)
      .setBackground(VERDE).setHorizontalAlignment('center');
  });

  // Datos (últimos 15 registros, más recientes primero)
  const recientes = registros.slice(-15).reverse();
  recientes.forEach((r, idx) => {
    const rowN = tblHeaderRow + 1 + idx;
    const bg = idx % 2 === 0 ? BLANCO : GRIS_CLARO;
    const fechaStr = r.fecha instanceof Date ? Utilities.formatDate(r.fecha, tz, 'dd/MM/yyyy') : r.fecha;
    const entStr = r.entrada instanceof Date ? Utilities.formatDate(r.entrada, tz, 'h:mm a') : (r.entrada || '--');
    const salStr = r.salida instanceof Date ? Utilities.formatDate(r.salida, tz, 'h:mm a') : (r.salida || '--');

    let horasStr2 = '--';
    if (r.segs > 0) {
      const hh = Math.floor(r.segs / 3600);
      const mm = Math.floor((r.segs % 3600) / 60);
      const ss2 = r.segs % 60;
      horasStr2 = hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss2).padStart(2, '0');
    }

    d.getRange(rowN, 2).setValue(fechaStr).setFontSize(9).setBackground(bg).setHorizontalAlignment('center');
    d.getRange(rowN, 3).setValue(r.dia).setFontSize(9).setBackground(bg).setHorizontalAlignment('center');
    d.getRange(rowN, 4).setValue(entStr).setFontSize(9).setBackground(bg).setHorizontalAlignment('center');
    d.getRange(rowN, 5).setValue(salStr).setFontSize(9).setBackground(bg).setHorizontalAlignment('center');
    d.getRange(rowN, 6).setValue(horasStr2).setFontSize(9).setBackground(bg).setHorizontalAlignment('center').setFontWeight('bold');

    // Rango con color
    const rangoCell = d.getRange(rowN, 7);
    rangoCell.setValue(r.rango).setFontSize(9).setBackground(bg).setHorizontalAlignment('center');
    if (r.rango.includes('En sitio')) rangoCell.setFontColor(VERDE);
    else if (r.rango.includes('Fuera')) rangoCell.setFontColor(ROJO);
    else rangoCell.setFontColor(TEXTO_SEC);
  });

  // Bordes tabla
  if (recientes.length > 0) {
    d.getRange(tblHeaderRow, 2, recientes.length + 1, 6)
      .setBorder(true, true, true, true, true, true, GRIS_BORDE, SpreadsheetApp.BorderStyle.SOLID);
  }

  // ==================== CHART: Horas por día ====================
  const chartStart = tblHeaderRow + recientes.length + 3;
  d.getRange(chartStart, 2, 1, 4).merge()
    .setValue('📈 Horas Trabajadas por Día')
    .setFontSize(12).setFontWeight('bold').setFontColor(VERDE_OSCURO);

  // Escribir datos para el chart en un rango oculto
  const chartDataStart = chartStart + 1;
  const chartRegistros = registros.slice(-20);
  chartRegistros.forEach((r, idx) => {
    const rowN = chartDataStart + idx;
    const fechaStr = r.fecha instanceof Date ? Utilities.formatDate(r.fecha, tz, 'dd/MM') : '';
    d.getRange(rowN, 2).setValue(fechaStr).setFontSize(8).setFontColor(TEXTO_SEC);
    d.getRange(rowN, 3).setValue(r.segs / 3600).setNumberFormat('0.00').setFontSize(8).setFontColor(TEXTO_SEC);
  });

  if (chartRegistros.length > 0) {
    const chartRange = d.getRange(chartDataStart, 2, chartRegistros.length, 2);
    const chart = d.newChart()
      .setChartType(Charts.ChartType.COLUMN)
      .addRange(chartRange)
      .setPosition(chartDataStart, 4, 0, 0)
      .setOption('title', '')
      .setOption('legend', { position: 'none' })
      .setOption('colors', [VERDE_CLARO])
      .setOption('hAxis', { textStyle: { fontSize: 8 } })
      .setOption('vAxis', { title: 'Horas', minValue: 0 })
      .setOption('bar', { groupWidth: '60%' })
      .setOption('width', 520)
      .setOption('height', 280)
      .build();
    d.insertChart(chart);
  }

  // ==================== FOOTER ====================
  const footerRow = chartDataStart + chartRegistros.length + 2;
  d.getRange(footerRow, 2, 1, 6).merge()
    .setValue('Generado automáticamente por WorkClock Pro — ' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm'))
    .setFontSize(8).setFontColor(TEXTO_SEC).setHorizontalAlignment('center');

  // Mover Dashboard al inicio
  ss.setActiveSheet(d);
  ss.moveActiveSheet(1);

  SpreadsheetApp.getUi().alert('✅ Dashboard actualizado para ' + meses[mesActual] + ' ' + anioActual);
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
