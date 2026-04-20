#Requires -RunAsAdministrator
<#
.SYNOPSIS
    FT_FILA — Instalador do Servico de Filas FuelTech
.DESCRIPTION
    Instala dependencias e registra o FT_FILA no Task Scheduler.
    Execute como Administrador. Requer Node.js instalado.
#>
$ErrorActionPreference = "Stop"
$ROOT = Split-Path $MyInvocation.MyCommand.Path -Resolve

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   FT_FILA - Instalador FuelTech" -ForegroundColor Cyan
Write-Host "   $(Get-Date -Format 'dd/MM/yyyy HH:mm')" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# Step 1 — Verifica Node.js
Write-Host "[1/3] Verificando Node.js..." -ForegroundColor Yellow
try {
    $v = & node --version 2>&1
    Write-Host "  OK: Node.js $v" -ForegroundColor Green
} catch {
    Write-Host "  ERRO: Node.js nao encontrado. Instale antes de continuar." -ForegroundColor Red
    exit 1
}

# Step 2 — npm install
Write-Host "[2/3] Instalando dependencias..." -ForegroundColor Yellow
Set-Location $ROOT
& npm install --omit=dev --quiet
if ($LASTEXITCODE -ne 0) { Write-Host "  ERRO: npm install falhou" -ForegroundColor Red; exit 1 }
Write-Host "  OK: Dependencias instaladas" -ForegroundColor Green

# Step 3 — Task Scheduler
Write-Host "[3/3] Registrando no Task Scheduler..." -ForegroundColor Yellow
$taskName  = "FT-FILA-Servico"
$batPath   = Join-Path $ROOT "iniciar-ftfila.bat"
$action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batPath`"" -WorkingDirectory $ROOT
$trigger   = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 `
                -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "  OK: Tarefa '$taskName' registrada" -ForegroundColor Green

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "   Instalacao concluida!" -ForegroundColor Green
Write-Host "   Paineis: http://localhost:4100/" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Iniciando servico..." -ForegroundColor Yellow
Start-Process "cmd.exe" -ArgumentList "/c `"$batPath`"" -NoNewWindow
