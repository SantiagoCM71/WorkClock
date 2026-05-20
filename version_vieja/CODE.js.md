# Código de Google Apps Script (Versión Vieja)

```javascript
const SPREADSHEET_ID = '12iuJSea50wuVwWGFHfdCRzah7OEMInOstcOM8ByzLMk';
const SHEET_NAME = 'Hoja 1';
const WORK_LAT = 3.5261039; 
const WORK_LONG = -76.2837987;
const RADIO_PERMITIDO_METROS = 300; 

// --- ENDPOINT PRINCIPAL (API REST) ---
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    let result = {};

    if (action === 'getCurrentState') result = getCurrentState();
    else if (action === 'getRecentHistory') result = getRecentHistory();
    else if (action === 'registrarEntrada') result = registrarEntrada();
    else if (action === 'registrarSalida') result = registrarSalida(params.coords);
    else if (action === 'eliminarUltimoRegistro') result = eliminarUltimoRegistro();
    else if (action === 'actualizarRegistro') result = actualizarRegistro(params.rowNumber, params.nuevaEntrada, params.nuevaSalida);
    else if (action === 'agregarJornadaManual') result = agregarJornadaManual(params.data);
    else if (action === 'iniciarNuevoMesApp') result = iniciarNuevoMesApp();

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ error: error.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Para verificar que la API está viva desde el navegador
function doGet(e) {
  return ContentService.createTextOutput("✅ API WorkClock Pro Activa").setMimeType(ContentService.MimeType.TEXT);
}

// --- MENÚ DESKTOP ---
function onOpen() {
  SpreadsheetApp.getUi().createMenu('⏱️ WorkClock Pro')
    .addItem('📥 Exportar Mes (Copia)', 'exportarCierreDeMes')
    .addToUi();
}

// --- LÓGICA CORE ---
function getUltimaFilaTurnos(sheet) {
  const data = sheet.getRange("A:A").getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][0] !== "" && data[i][0] !== null) return i + 1;
  }
  return 1;
}

function calcularDistancia(lat1, lon1) {
  const R = 6371e3; const p1 = WORK_LAT * Math.PI/180; const p2 = lat1 * Math.PI/180;
  const dP = (lat1-WORK_LAT) * Math.PI/180; const dL = (lon1-WORK_LONG) * Math.PI/180;
  const a = Math.sin(dP/2) * Math.sin(dP/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dL/2) * Math.sin(dL/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function registrarEntrada() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); const sheet = ss.getSheetByName(SHEET_NAME);
  const ahora = new Date(); const tz = Session.getScriptTimeZone();
  const nuevaFila = getUltimaFilaTurnos(sheet) + 1;
  sheet.getRange(nuevaFila, 1, 1, 7).setValues([[ Utilities.formatDate(ahora, tz, "yyyy-MM-dd"), ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"][ahora.getDay()], Utilities.formatDate(ahora, tz, "HH:mm:ss"), "", "", "En curso...", "" ]]);
  return { success: true };
}

function registrarSalida(coords) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = getUltimaFilaTurnos(sheet);
  if (lastRow <= 1) throw new Error("No hay turno");
  const numRows = Math.min(lastRow - 1, 5); const startRow = lastRow - numRows + 1;
  const values = sheet.getRange(startRow, 1, numRows, 4).getValues();
  const tz = Session.getScriptTimeZone();
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (row[2] !== "" && (!row[3] || row[3] === "")) {
      const rowIndex = startRow + i; let e_sitio = "Sin GPS";
      if (coords) { const dist = calcularDistancia(coords.lat, coords.lng); e_sitio = dist <= RADIO_PERMITIDO_METROS ? "✅ En sitio" : "🚩 Fuera"; }
      const horaSalida = Utilities.formatDate(new Date(), tz, "HH:mm:ss");
      const coordStr = coords ? coords.lat + "," + coords.lng : "N/A";
      sheet.getRange(rowIndex, 4, 1, 4).setValues([[ horaSalida, '=IF(RC[-1]<RC[-2], 1+RC[-1]-RC[-2], RC[-1]-RC[-2])', e_sitio, coordStr ]]);
      sheet.getRange(rowIndex, 5).setNumberFormat('[h]:mm:ss');
      return { success: true };
    }
  }
  throw new Error("No hay turno");
}

// ... Resto del código original salvaguardado ...
function getCurrentState() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = getUltimaFilaTurnos(sheet); if (lastRow <= 1) return { active: false };
  const numRows = Math.min(lastRow - 1, 5); const startRow = lastRow - numRows + 1;
  const values = sheet.getRange(startRow, 1, numRows, 4).getValues(); const tz = Session.getScriptTimeZone();
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (row[2] !== "" && (!row[3] || row[3] === "")) return { active: true, startTime: (row[2] instanceof Date ? Utilities.formatDate(row[2], tz, "h:mm a") : row[2]) };
  }
  return { active: false };
}

function getRecentHistory() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); const sheet = ss.getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues(); const tz = Session.getScriptTimeZone();
  if (values.length <= 1) return { history: [], semanaTotal: "0 min", mesTotal: "0 min", semanaSegundos: 0, mesSegundos: 0 };
  const hoy = new Date(); const startOfMonth = new Date(hoy.getFullYear(), hoy.getMonth(), 1); startOfMonth.setHours(0,0,0,0);
  let dayOfWeek = hoy.getDay(); let diffToMonday = hoy.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const startOfWeek = new Date(hoy.getFullYear(), hoy.getMonth(), diffToMonday); startOfWeek.setHours(0,0,0,0);
  let historyData = []; let totalSegundosSemana = 0; let totalSegundosMes = 0;
  
  for (let i = values.length - 1; i >= 1; i--) {
    const row = values[i]; const fechaVal = row[0]; if (!fechaVal) continue;
    const rowDate = fechaVal instanceof Date ? fechaVal : new Date(fechaVal);
    if (row[4] !== "" && row[4] !== null) {
      let segs = 0; if (row[4] instanceof Date) segs = (row[4].getHours() * 3600) + (row[4].getMinutes() * 60) + row[4].getSeconds(); else if (typeof row[4] === 'number') segs = Math.round(row[4] * 86400);
      if (rowDate >= startOfMonth) totalSegundosMes += segs; if (rowDate >= startOfWeek) totalSegundosSemana += segs;
    }
    if (historyData.length < 5) {
      let f = fechaVal instanceof Date ? Utilities.formatDate(fechaVal, tz, "dd/MM") : fechaVal;
      let inT = row[2] instanceof Date ? Utilities.formatDate(row[2], tz, "h:mm a") : row[2];
      let outT = row[3] instanceof Date ? Utilities.formatDate(row[3], tz, "h:mm a") : (row[3] || "--:--");
      let h = "--:--";
      if (row[4] !== "" && row[4] !== null) {
        let s = (row[4] instanceof Date) ? (row[4].getHours() * 3600) + (row[4].getMinutes() * 60) + row[4].getSeconds() : Math.round(row[4] * 86400);
        let hrs = Math.floor(s / 3600); let mins = Math.floor((s % 3600) / 60); h = (hrs > 0 ? hrs + "h " : "") + mins + "m";
      }
      historyData.push({ rowNumber: i + 1, fecha: f, entrada: inT, salida: outT, in24: row[2] instanceof Date ? Utilities.formatDate(row[2], tz, "HH:mm") : "", out24: row[3] instanceof Date ? Utilities.formatDate(row[3], tz, "HH:mm") : "", horas: h, rango: row[5] });
    }
  }
  function formato(s) { if (s === 0) return "0 min"; let h = Math.floor(s/3600); let m = Math.floor((s%3600)/60); return h > 0 ? `${h}h ${m}m` : `${m} min`; }
  return { history: historyData, semanaTotal: formato(totalSegundosSemana), mesTotal: formato(totalSegundosMes), semanaSegundos: totalSegundosSemana, mesSegundos: totalSegundosMes };
}

function eliminarUltimoRegistro() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = getUltimaFilaTurnos(sheet);
  if (lastRow > 1) { sheet.getRange(lastRow, 1, 1, 7).clearContent(); return { success: true }; }
  throw new Error("No hay registros");
}

function actualizarRegistro(rowNumber, nuevaEntrada, nuevaSalida) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); const sheet = ss.getSheetByName(SHEET_NAME);
  let inVal = nuevaEntrada ? nuevaEntrada + ":00" : ""; let outVal = nuevaSalida ? nuevaSalida + ":00" : "";
  sheet.getRange(rowNumber, 3).setValue(inVal);
  if (outVal !== "") {
    sheet.getRange(rowNumber, 4).setValue(outVal);
    sheet.getRange(rowNumber, 5).setFormula('=IF(RC[-1]<RC[-2], 1+RC[-1]-RC[-2], RC[-1]-RC[-2])').setNumberFormat('[h]:mm:ss');
  } else {
    sheet.getRange(rowNumber, 4).clearContent(); sheet.getRange(rowNumber, 5).clearContent();
  }
  return { success: true };
}

function agregarJornadaManual(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); const sheet = ss.getSheetByName(SHEET_NAME);
  const partes = data.fecha.split("-"); const fObj = new Date(partes[0], partes[1]-1, partes[2], 12,0,0);
  const dia = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"][fObj.getDay()];
  const nuevaFila = getUltimaFilaTurnos(sheet) + 1;
  
  sheet.getRange(nuevaFila, 1, 1, 7).setValues([[ data.fecha, dia, data.entrada + ":00", data.salida + ":00", '=IF(RC[-1]<RC[-2], 1+RC[-1]-RC[-2], RC[-1]-RC[-2])', "✍️ Manual", "N/A" ]]);
  sheet.getRange(nuevaFila, 5).setNumberFormat('[h]:mm:ss');
  
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).sort({column: 1, ascending: true});
  return { success: true };
}

function iniciarNuevoMesApp() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID); const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = getUltimaFilaTurnos(sheet);
  if (lastRow <= 1) throw new Error("No hay registros");
  
  let dObj = new Date(sheet.getRange(lastRow, 1).getValue()); if(isNaN(dObj.getTime())) dObj = new Date();
  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const nombreHoja = meses[dObj.getMonth()] + "_" + dObj.getFullYear();
  
  let exportSheet = ss.getSheetByName(nombreHoja); if (exportSheet) ss.deleteSheet(exportSheet);
  exportSheet = sheet.copyTo(ss); exportSheet.setName(nombreHoja);
  const dataRange = exportSheet.getDataRange(); dataRange.copyTo(dataRange, {contentsOnly: true});
  exportSheet.deleteColumn(6); exportSheet.deleteColumn(6);
  sheet.getRange(2, 1, lastRow - 1, 7).clearContent();
  return { success: true };
}

function exportarCierreDeMes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(); const sheet = ss.getSheetByName(SHEET_NAME);
  const hoy = new Date(); const nombreHoja = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][hoy.getMonth()] + "_" + hoy.getFullYear();
  let exportSheet = ss.getSheetByName(nombreHoja); if (exportSheet) ss.deleteSheet(exportSheet);
  exportSheet = sheet.copyTo(ss); exportSheet.setName(nombreHoja);
  const dataRange = exportSheet.getDataRange(); dataRange.copyTo(dataRange, {contentsOnly: true});
  exportSheet.deleteColumn(6); exportSheet.deleteColumn(6);
}
```
