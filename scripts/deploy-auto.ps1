param(
  [switch]$NoClean,
  [int]$KeepDeployments = 4
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location -LiteralPath $Root

function Info($msg)  { Write-Host "[...] $msg" -ForegroundColor Yellow }
function Ok($msg)    { Write-Host " [OK] $msg" -ForegroundColor Green }
function Fail($msg)  { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   WORKCLOCK PRO — Deploy Automatico (Backend + Frontend)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# --- Pre-checks ---
if (-not (Test-Path -LiteralPath ".clasp.json")) {
  Fail "Falta .clasp.json con el scriptId del proyecto."
}

# --- 1. Validar sintaxis ---
Info "Validando sintaxis de google-script.js..."
$checkResult = & node scripts/check-gas.js 2>&1
$checkResult | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Fail "Error de sintaxis. Corrige antes de deployar." }
Ok "Sintaxis valida"

# --- 2. Push codigo a Apps Script ---
Info "Subiendo codigo a Google Apps Script (clasp push)..."
$pushOutput = & npx clasp push 2>&1
$pushOutput | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { Fail "clasp push fallo" }
Ok "Codigo subido a Apps Script"

# --- 3. Crear version inmutable ---
Info "Creando version inmutable..."
$desc = "auto deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$versionOutput = & npx clasp version $desc 2>&1
$versionOutput | ForEach-Object { Write-Host $_ }
$versionMatch = [regex]::Match(($versionOutput -join "`n"), "Created version\s+(\d+)|version\s+(\d+)", "IgnoreCase")
if (-not $versionMatch.Success) { Fail "No pude leer el numero de version" }
$versionNum = if ($versionMatch.Groups[1].Value) { $versionMatch.Groups[1].Value } else { $versionMatch.Groups[2].Value }
Ok "Version creada: v$versionNum"

# --- 4. Nuevo deployment Web App ---
Info "Creando nuevo deployment Web App..."
$deployOutput = & npx clasp deploy --versionNumber $versionNum --description "WorkClock v$versionNum" 2>&1
$deployOutput | ForEach-Object { Write-Host $_ }
$deployMatch = [regex]::Match(($deployOutput -join "`n"), "(AKfy[0-9A-Za-z_-]+)")
if (-not $deployMatch.Success) { Fail "No pude leer el deployment ID" }
$deploymentId = $deployMatch.Groups[1].Value
$newUrl = "https://script.google.com/macros/s/$deploymentId/exec"
Ok "Nuevo deployment: $newUrl"

# --- 5. Actualizar URL en app.js ---
Info "Actualizando DEFAULT_API_URL en app.js..."
$appJsPath = Join-Path $Root "app.js"
$appJs = Get-Content -LiteralPath $appJsPath -Raw -Encoding utf8
$oldUrlPattern = "const DEFAULT_API_URL = '.*?';"
$newUrlLine = "const DEFAULT_API_URL = '$newUrl';"
if ($appJs -match $oldUrlPattern) {
  $appJs = $appJs -replace $oldUrlPattern, $newUrlLine
  [System.IO.File]::WriteAllText($appJsPath, $appJs, [System.Text.UTF8Encoding]::new($false))
  Ok "app.js actualizado con nueva URL"
} else {
  Write-Host " [!] No encontre DEFAULT_API_URL en app.js — actualiza manualmente" -ForegroundColor Magenta
}

# --- 6. Bump Service Worker cache ---
Info "Bumping Service Worker cache version..."
$swPath = Join-Path $Root "sw.js"
$sw = Get-Content -LiteralPath $swPath -Raw -Encoding utf8
$swMatch = [regex]::Match($sw, "workclock-v(\d+)")
if ($swMatch.Success) {
  $oldVer = [int]$swMatch.Groups[1].Value
  $newVer = $oldVer + 1
  $sw = $sw -replace "workclock-v$oldVer", "workclock-v$newVer"
  [System.IO.File]::WriteAllText($swPath, $sw, [System.Text.UTF8Encoding]::new($false))
  Ok "Service Worker: workclock-v$oldVer -> workclock-v$newVer"
} else {
  Write-Host " [!] No encontre version del SW en sw.js" -ForegroundColor Magenta
}

# --- 7. Git commit + push ---
Info "Committing y pusheando a GitHub..."
& git add app.js sw.js google-script.js 2>&1 | Out-Null
$commitMsg = "deploy: auto v$versionNum — $newUrl"
& git commit -m $commitMsg 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
  Write-Host " [!] Nada que commitear (archivos sin cambios)" -ForegroundColor Magenta
} else {
  & git push origin main 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { Fail "git push fallo" }
  Ok "Pusheado a GitHub — Pages se despliega en ~1-2 min"
}

# --- 8. Limpiar deployments viejos ---
if (-not $NoClean) {
  Info "Limpiando deployments antiguos..."
  $listOutput = & npx clasp deployments 2>&1
  if ($LASTEXITCODE -eq 0) {
    $items = @()
    foreach ($line in (($listOutput -join "`n") -split "`n")) {
      $m = [regex]::Match($line.Trim(), "^- (AKfy[0-9A-Za-z_-]+) @(\d+)")
      if ($m.Success) { $items += [pscustomobject]@{ Id = $m.Groups[1].Value; Version = [int]$m.Groups[2].Value } }
    }
    $keepIds = @{}
    $keepIds[$deploymentId] = $true
    $items | Sort-Object Version -Descending | Select-Object -First $KeepDeployments | ForEach-Object { $keepIds[$_.Id] = $true }
    $deleted = 0
    foreach ($item in $items) {
      if ($keepIds.ContainsKey($item.Id)) { continue }
      & npx clasp undeploy $item.Id 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { $deleted++ }
    }
    Ok "Limpieza: $deleted deployment(s) eliminados, $($items.Count - $deleted) conservados"
  }
}

# --- Resultado final ---
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   DEPLOY EXITOSO — WorkClock Pro" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   Version:     v$versionNum" -ForegroundColor White
Write-Host "   Deployment:  $deploymentId" -ForegroundColor White
Write-Host "   API URL:     $newUrl" -ForegroundColor White
Write-Host "   GitHub:      push completado (Pages auto-deploy)" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""
