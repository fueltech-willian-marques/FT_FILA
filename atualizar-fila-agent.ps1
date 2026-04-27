# =============================================================================
#  FT_FILA - Atualizador do Agent (Expedicao / Entrega)
#  Executar como Administrador:
#  powershell -ExecutionPolicy Bypass -File atualizar-fila-agent.ps1
#
#  O que este script faz:
#    1. Para o servico FT_FILA_Agent
#    2. Copia os arquivos atualizados do agent (pendrive ou servidor)
#       PRESERVA printer.ini e *.log desta maquina
#    3. Executa npm install se package.json foi alterado
#    4. Reinicia o servico FT_FILA_Agent
#    5. Verifica se o agent voltou a responder
#
#  NAO altera: printer.ini, *.log
#  NAO instala: Node.js, NSSM
#  Para instalar do zero use: instalar-fila-agent.ps1
# =============================================================================

$ErrorActionPreference = 'Continue'

# -- Configuracao -------------------------------------------------------------
$AGENT_DEST    = "C:\Fueltech_PDV\fila-agent"
$AGENT_SRC_USB = Join-Path $PSScriptRoot "agent"
$SERVIDOR_IP   = "10.100.62.21"
$AGENT_SRC_SRV = "\\$SERVIDOR_IP\c$\Fueltech_PDV\FT_FILA\agent"
$AGENT_SVC     = "FT_FILA_Agent"
$NPM_CMD       = "C:\Program Files\nodejs\npm.cmd"
$LOG_FILE      = "C:\Fueltech_PDV\atualizar-fila-agent.log"

# -- Helpers ------------------------------------------------------------------
New-Item -ItemType Directory -Path "C:\Fueltech_PDV" -Force | Out-Null
function Log { param($m) $l = "$(Get-Date -Format 'HH:mm:ss') $m"; Write-Host $l; Add-Content $LOG_FILE $l }
function Ok  { Log "  [OK] $args" }
function Err { Log "  [ERRO] $args"; Read-Host "Pressione Enter para sair"; exit 1 }

Log ""
Log "======================================================"
Log "   FT_FILA - Atualizador do Agent"
Log "======================================================"
Log ""

# -- Verificar destino --------------------------------------------------------
if (-not (Test-Path $AGENT_DEST)) {
    Err "Pasta $AGENT_DEST nao encontrada. Execute instalar-fila-agent.ps1 primeiro."
}

# -- Localizar fonte ----------------------------------------------------------
Log "Localizando fonte do agent..."
if (Test-Path $AGENT_SRC_USB) {
    $AGENT_SRC = $AGENT_SRC_USB
    Log "  Fonte: pendrive/local ($AGENT_SRC)"
} elseif (Test-Path $AGENT_SRC_SRV) {
    $AGENT_SRC = $AGENT_SRC_SRV
    Log "  Fonte: servidor via rede ($AGENT_SRC)"
} else {
    Err "Pasta agent nao encontrada nem no pendrive nem no servidor ($AGENT_SRC_SRV)."
}

# -- Verificar mudanca no package.json ----------------------------------------
$pkgSrc = Join-Path $AGENT_SRC "package.json"
$pkgDst = Join-Path $AGENT_DEST "package.json"
$needsNpmInstall = $false
if ((Test-Path $pkgSrc) -and (Test-Path $pkgDst)) {
    $hashSrc = (Get-FileHash $pkgSrc -Algorithm MD5).Hash
    $hashDst = (Get-FileHash $pkgDst -Algorithm MD5).Hash
    if ($hashSrc -ne $hashDst) {
        $needsNpmInstall = $true
        Log "  package.json alterado - npm install sera executado apos copia"
    }
}

# -- Parar servico ------------------------------------------------------------
Log "Parando servico $AGENT_SVC..."
$svc = Get-Service -Name $AGENT_SVC -ErrorAction SilentlyContinue
if ($svc) {
    Stop-Service $AGENT_SVC -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Ok "Servico parado"
} else {
    Log "  Servico nao encontrado (pode estar como tarefa agendada)"
    schtasks /end /tn $AGENT_SVC 2>$null | Out-Null
}

# -- Copiar arquivos ----------------------------------------------------------
Log "Copiando arquivos atualizados..."
Log "  De: $AGENT_SRC"
Log "  Para: $AGENT_DEST"
Log "  (preservando printer.ini e logs)"
robocopy $AGENT_SRC $AGENT_DEST /E /XD node_modules .git /XF "*.log" printer.ini /NFL /NDL /NJH /NJS | Out-Null
Ok "Arquivos copiados"

# -- npm install (somente se package.json mudou) ------------------------------
if ($needsNpmInstall) {
    Log "Atualizando dependencias (npm install)..."
    if (Test-Path $NPM_CMD) {
        Set-Location $AGENT_DEST
        & $NPM_CMD install --omit=dev --loglevel=error | Out-Null
        Ok "Dependencias atualizadas"
    } else {
        Log "  npm nao encontrado em $NPM_CMD - pulando npm install"
    }
}

# -- Reiniciar servico --------------------------------------------------------
Log "Reiniciando servico $AGENT_SVC..."
$svc = Get-Service -Name $AGENT_SVC -ErrorAction SilentlyContinue
if ($svc) {
    Start-Service $AGENT_SVC -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $AGENT_SVC -ErrorAction SilentlyContinue
    if ($svc.Status -eq 'Running') {
        Ok "Servico reiniciado (Running)"
    } else {
        Log "  Aviso: servico nao esta Running (status: $($svc.Status))"
    }
} else {
    schtasks /run /tn $AGENT_SVC 2>$null | Out-Null
    Ok "Tarefa agendada reiniciada"
}

# -- Verificar health ---------------------------------------------------------
Log ""
Log "Aguardando agent responder..."
Start-Sleep -Seconds 5
$agentOk = $false
for ($i = 0; $i -lt 6; $i++) {
    try {
        $h = Invoke-RestMethod "http://localhost:4002/health" -TimeoutSec 3
        if ($h.ok -or $h.status -eq 'ok') {
            Ok "Agent respondendo em http://localhost:4002"
            $agentOk = $true
            break
        }
    } catch { }
    if ($i -lt 5) { Start-Sleep -Seconds 3 }
}

if (-not $agentOk) {
    Log "  Aviso: agent nao respondeu. Verifique o log em $AGENT_DEST\agent-err.log"
}

# -- Resumo -------------------------------------------------------------------
Log ""
Log "======================================================"
Log "   Atualizacao concluida!"
Log "======================================================"
Log "  Agent (local):      http://localhost:4002/health"
Log "  Servico:            $AGENT_SVC"
Log "  Log agent:          $AGENT_DEST\agent.log"
Log "  Log atualizacao:    $LOG_FILE"
Log ""

Read-Host "Pressione Enter para fechar"
