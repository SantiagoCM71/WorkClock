const fs = require('fs');
const path = require('path');

// Validate google-script.js syntax before deploying
const files = [path.join(__dirname, '../google-script.js')];

let hasError = false;
files.forEach(f => {
  if (!fs.existsSync(f)) {
    console.error('[ERROR] Archivo no existe: ' + f);
    hasError = true;
    return;
  }
  try {
    new Function(fs.readFileSync(f, 'utf8'));
    console.log('[ok] Sintaxis valida: ' + path.basename(f));
  } catch (e) {
    console.error('[ERROR] Sintaxis en ' + path.basename(f) + ': ' + e.message);
    hasError = true;
  }
});

if (hasError) process.exit(1);
else console.log('[OK] Validacion completada sin errores.');
