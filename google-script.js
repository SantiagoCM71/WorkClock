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

// --- MENÚ DESKTOP EN SHEETS ---
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⏱️ WorkClock Pro')
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
