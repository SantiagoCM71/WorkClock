param([switch]$NoClean)

$ErrorActionPreference = "Stop"

function Log($msg)    { Write-Host "[...] $msg" -ForegroundColor Cyan }
function LogOk($msg)  { Write-Host "[OK] $msg" -ForegroundColor Green }
function LogErr($msg) { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }

# 1. Validar sintaxis
Log "Iniciando validación de sintaxis de javascript..."
npm run check
LogOk "Sintaxis de JavaScript verificada con éxito"

# 2. Subir código con Clasp push
Log "Subiendo el código a Google Apps Script HEAD (clasp push)..."
$pushOutput = clasp push --force 2>&1
$pushOutput | Write-Host
LogOk "Código subido a Google Drive correctamente"

# 3. Crear versión inmutable
Log "Creando una nueva versión inmutable en Google Apps Script..."
$versionOutput = clasp version "Deploy automático WorkClock" 2>&1
$versionOutput | Write-Host
$versionNum = ($versionOutput | Select-String "Created version (\d+)").Matches.Groups[1].Value
if (-not $versionNum) {
  LogErr "No se pudo obtener el número de versión de la salida de Clasp."
}
LogOk "Versión inmutable creada con éxito: Versión $versionNum"

# 4. Desplegar como Web App nuevo
Log "Creando un nuevo despliegue de Web App (clasp deploy)..."
$deployOutput = clasp deploy --description "WorkClock v$versionNum" 2>&1
$deployOutput | Write-Host
$deployId = ($deployOutput | Select-String "Deployed ([A-Za-z0-9_-]+)").Matches.Groups[1].Value
if (-not $deployId) {
  LogErr "No se pudo obtener el ID del despliegue (Deployment ID)."
}
$newUrl = "https://script.google.com/macros/s/$deployId/exec"

# 5. Imprimir información de éxito en banner iOS style
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host " 🎉 DESPLIEGUE EXITOSO DE WORKCLOCK PRO" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host " Versión del Script: v$versionNum" -ForegroundColor Yellow
Write-Host " ID del Despliegue:  $deployId" -ForegroundColor Yellow
Write-Host " URL de la Web App:  $newUrl" -ForegroundColor Green
Write-Host "===========================================================" -ForegroundColor Green
Write-Host " 👉 COPIA esta URL y pégala en los Ajustes de tu App." -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""

# 6. Limpieza de deployments antiguos
if (-not $NoClean) {
  Log "Buscando despliegues obsoletos para limpieza..."
  $deployList = clasp deployments 2>&1
  
  # Filtramos todos los IDs de despliegue que no sean el nuevo (deployId) ni el inicial (normalmente "@1" o similar)
  $ids = ($deployList | Select-String "- ([A-Za-z0-9_-]{30,}) @").Matches |
         ForEach-Object { $_.Groups[1].Value } |
         Where-Object { $_ -ne $deployId }

  # Mantenemos los últimos 3 despliegues activos por seguridad, y eliminamos los anteriores
  $toDelete = $ids | Select-Object -SkipLast 3
  
  if ($toDelete) {
    Log "Eliminando $($toDelete.Count) despliegue(s) antiguo(s) obsoletos..."
    foreach ($id in $toDelete) {
      Write-Host "[...] Eliminando ID: $id" -ForegroundColor Gray
      clasp undeploy $id 2>&1 | Out-Null
    }
    LogOk "Limpieza completada. Despliegues obsoletos eliminados."
  } else {
    LogOk "No se requirió limpieza de despliegues (menos de 3 acumulados)."
  }
}

Write-Host ""
LogOk "Despliegue automático de WorkClock completado con éxito."
