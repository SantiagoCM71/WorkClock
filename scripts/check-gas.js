const fs = require('fs');
const path = require('path');

const files = [path.join(__dirname, '../google-script.js')];

let hasError = false;
files.forEach(f => {
  if (!fs.existsSync(f)) {
    console.error(`[ERROR] El archivo no existe: ${f}`);
    hasError = true;
    return;
  }
  try {
    // Intenta compilar el archivo JavaScript leyéndolo en una función anónima
    new Function(fs.readFileSync(f, 'utf8'));
    console.log('[ok] Sintaxis válida en ' + path.basename(f));
  } catch (e) {
    console.error('[ERROR] Error de sintaxis en ' + path.basename(f) + ': ' + e.message);
    hasError = true;
  }
});

if (hasError) {
  process.exit(1);
} else {
  console.log('[OK] Validación de sintaxis Apps Script completada sin errores.');
}
