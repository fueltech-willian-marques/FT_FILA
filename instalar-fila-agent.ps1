# =============================================================================
#  FT_FILA - Instalador do Agent (Expedicao / Entrega)
#  Executar como Administrador:
#  powershell -ExecutionPolicy Bypass -File instalar-fila-agent.ps1
#
#  Arquitetura:
#    Chrome  ->  Servidor Windows (http://10.100.62.21:4100)  [filas]
#    Chrome  ->  ft-fila-agent local (http://localhost:4002)  [impressora]
#
#  O que este script instala nesta maquina:
#    1. Node.js 20 LTS (se nao instalado)
#    2. ft-fila-agent - controla impressora local (porta 4002)
#    3. Servico Windows FT_FILA_Agent (auto-start)
#    4. Suspensao desabilitada
#    5. Abre printer.ini para configurar a porta COM
#
#  NADA do backend FT_FILA roda aqui.
#  O servidor (SQLite, Socket.IO) fica no Windows Server.
# =============================================================================

$ErrorActionPreference = 'Continue'

# -- Configuracao -------------------------------------------------------------
$SERVIDOR_URL   = "http://10.100.62.21:4100"
$SERVIDOR_IP    = "10.100.62.21"
$AGENT_DEST     = "C:\Fueltech_PDV\fila-agent"
$AGENT_SRC_USB  = Join-Path $PSScriptRoot "agent"
$AGENT_SRC_SRV  = "\\$SERVIDOR_IP\c$\Fueltech_PDV\FT_FILA\agent"
$NODE_MSI_URL   = "https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi"
$AGENT_SVC      = "FT_FILA_Agent"
$LOG_FILE       = "C:\Fueltech_PDV\instalar-fila-agent.log"

# -- Helpers ------------------------------------------------------------------
New-Item -ItemType Directory -Path "C:\Fueltech_PDV" -Force | Out-Null
function Log { param($m) $l = "$(Get-Date -Format 'HH:mm:ss') $m"; Write-Host $l; Add-Content $LOG_FILE $l }
function Ok  { Log "  [OK] $args" }
function Err { Log "  [ERRO] $args"; Read-Host "Pressione Enter para sair"; exit 1 }

Log ""
Log "======================================================"
Log "   FT_FILA - Instalador do Agent"
Log "======================================================"
Log "Servidor FT_FILA: $SERVIDOR_URL"
Log "Agent local:      http://localhost:4002"
Log ""

# -- 1. Node.js 20 ------------------------------------------------------------
Log "1. Verificando Node.js..."

# Detectar node.exe em qualquer instalacao (PATH, NVM, pasta padrao)
function Find-NodeExe {
    $found = Get-Command "node.exe" -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    $candidates = @(
        "C:\Program Files\nodejs\node.exe",
        "C:\nvm4w\nodejs\node.exe",
        "C:\nvm\nodejs\node.exe",
        "$env:APPDATA\nvm\nodejs\node.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return $null
}

$nodeExe = Find-NodeExe
$npmCmd  = "C:\Program Files\nodejs\npm.cmd"
$nodeOk  = $false
if ($nodeExe) {
    $ver = & $nodeExe --version 2>$null
    if ($ver -match '^v2[0-9]') { $nodeOk = $true; Ok "Node.js $ver em $nodeExe" }
    else { Log "  Node.js $ver encontrado - versao antiga, instalando v20..." }
}
if (-not $nodeOk) {
    Log "  Baixando Node.js 20 LTS..."
    $msi = "$env:TEMP\node-v20-x64.msi"
    try {
        (New-Object Net.WebClient).DownloadFile($NODE_MSI_URL, $msi)
        Log "  Instalando Node.js..."
        Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn ADDLOCAL=ALL" -Wait
        Remove-Item $msi -Force
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine")
        $nodeExe  = Find-NodeExe
        if (-not $nodeExe) { Err "node.exe nao encontrado apos instalacao" }
        Ok "Node.js instalado em $nodeExe"
    } catch {
        Err "Falha ao baixar/instalar Node.js: $_"
    }
}
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine")
# Localizar npm apos refresh
$found = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
if ($found) { $npmCmd = $found.Source }
elseif (Test-Path (Join-Path (Split-Path $nodeExe) "npm.cmd")) {
    $npmCmd = Join-Path (Split-Path $nodeExe) "npm.cmd"
}
if (-not (Test-Path $npmCmd)) { Start-Sleep -Seconds 5 }

# -- 2. Copiar ft-fila-agent --------------------------------------------------
Log "2. Copiando ft-fila-agent..."
if (Test-Path $AGENT_SRC_USB) {
    $AGENT_SRC = $AGENT_SRC_USB
    Log "  Fonte: local/pendrive ($AGENT_SRC)"
} elseif (Test-Path $AGENT_SRC_SRV) {
    $AGENT_SRC = $AGENT_SRC_SRV
    Log "  Fonte: servidor via rede ($AGENT_SRC)"
} else {
    Err "Pasta 'agent' nao encontrada. Coloque a pasta 'agent' na mesma pasta deste script."
}
New-Item -ItemType Directory -Path $AGENT_DEST -Force | Out-Null
robocopy $AGENT_SRC $AGENT_DEST /E /XD node_modules .git /XF "*.log" /NFL /NDL /NJH /NJS | Out-Null
Ok "ft-fila-agent copiado para $AGENT_DEST"

# -- 3. npm install -----------------------------------------------------------
Log "3. Instalando dependencias do agent..."
Set-Location $AGENT_DEST
& $npmCmd install --omit=dev --loglevel=error | Out-Null
Ok "Dependencias instaladas"

# -- 4. Servico Windows para o agent (NSSM) -----------------------------------
Log "4. Configurando servico Windows (ft-fila-agent)..."

$nssm = $null
$nssmCandidates = @(
    "C:\ProgramData\chocolatey\lib\NSSM\tools\nssm.exe",
    "C:\Fueltech_PDV\nssm\nssm.exe"
)
foreach ($c in $nssmCandidates) { if (Test-Path $c) { $nssm = $c; break } }

if (-not $nssm) {
    Log "  NSSM nao encontrado - tentando baixar..."
    $nssmDir = "C:\Fueltech_PDV\nssm"
    New-Item -ItemType Directory -Path $nssmDir -Force | Out-Null
    $nssmZip = "$env:TEMP\nssm.zip"
    $nssmUrls = @(
        "https://nssm.cc/release/nssm-2.24.zip",
        "https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip"
    )
    foreach ($url in $nssmUrls) {
        try {
            Log "  Baixando de $url ..."
            (New-Object Net.WebClient).DownloadFile($url, $nssmZip)
            Expand-Archive $nssmZip -DestinationPath "$env:TEMP\nssm-extract" -Force
            $nssmExe = Get-ChildItem "$env:TEMP\nssm-extract" -Recurse -Filter "nssm.exe" |
                       Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1
            if (-not $nssmExe) {
                $nssmExe = Get-ChildItem "$env:TEMP\nssm-extract" -Recurse -Filter "nssm.exe" | Select-Object -First 1
            }
            Copy-Item $nssmExe.FullName "$nssmDir\nssm.exe" -Force
            Remove-Item $nssmZip, "$env:TEMP\nssm-extract" -Recurse -Force
            $nssm = "$nssmDir\nssm.exe"
            Ok "NSSM instalado em $nssm"
            break
        } catch {
            Log "  Falha em $url - tentando proximo..."
        }
    }
}

sc.exe stop   $AGENT_SVC 2>$null | Out-Null
sc.exe delete $AGENT_SVC 2>$null | Out-Null
schtasks /delete /tn $AGENT_SVC /f 2>$null | Out-Null
Start-Sleep -Seconds 2

$agentEntry = Join-Path $AGENT_DEST "server.js"

if ($nssm) {
    & $nssm install  $AGENT_SVC $nodeExe $agentEntry            | Out-Null
    & $nssm set      $AGENT_SVC AppDirectory  $AGENT_DEST       | Out-Null
    & $nssm set      $AGENT_SVC AppStdout     "$AGENT_DEST\agent.log"     | Out-Null
    & $nssm set      $AGENT_SVC AppStderr     "$AGENT_DEST\agent-err.log" | Out-Null
    & $nssm set      $AGENT_SVC Start         SERVICE_AUTO_START | Out-Null
    Start-Service $AGENT_SVC -ErrorAction SilentlyContinue
    Ok "Servico $AGENT_SVC criado via NSSM (porta 4002, auto-start)"
} else {
    Log "  NSSM indisponivel - usando Task Scheduler para o agent..."
    $agentTaskXml = @"
<TaskDefinition xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><BootTrigger><Delay>PT5S</Delay><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>4</Priority></Settings>
  <Actions><Exec>
    <Command>$nodeExe</Command>
    <Arguments>$agentEntry</Arguments>
    <WorkingDirectory>$AGENT_DEST</WorkingDirectory>
  </Exec></Actions>
</TaskDefinition>
"@
    $tmpXml = "$env:TEMP\ftfila-agent-task.xml"
    [System.IO.File]::WriteAllText($tmpXml, $agentTaskXml, [System.Text.Encoding]::ASCII)
    schtasks /create /tn $AGENT_SVC /xml $tmpXml /f | Out-Null
    Remove-Item $tmpXml -Force
    schtasks /run /tn $AGENT_SVC | Out-Null
    Ok "Tarefa '$AGENT_SVC' criada via Task Scheduler (porta 4002, auto-start)"
}

# -- 5. Desabilitar suspensao -------------------------------------------------
Log "5. Desabilitando suspensao..."
powercfg /change standby-timeout-ac  0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac  0
Ok "Suspensao desabilitada"

# -- 6. Atalhos na area de trabalho ------------------------------------------
Log "6. Criando atalhos na area de trabalho..."

$chrome   = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
$chrome86 = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
$chromePath = $null
foreach ($c in @($chrome, $chrome86)) { if (Test-Path $c) { $chromePath = $c; break } }
if (-not $chromePath) {
    $found = Get-Command "chrome.exe" -ErrorAction SilentlyContinue
    if ($found) { $chromePath = $found.Source }
    else        { $chromePath = $chrome; Log "  Aviso: Chrome nao encontrado - instale e os atalhos funcionarao" }
}

# Desktop do usuario atual (quem rodou o script) E desktop publico
$desktops = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("CommonDesktopDirectory")
) | Select-Object -Unique
$wsh = New-Object -ComObject WScript.Shell

$atalhos = @(
    @{ Nome = "FT FILA - TV";        URL = "$SERVIDOR_URL/tv.html"         },
    @{ Nome = "FT FILA - Separacao"; URL = "$SERVIDOR_URL/expedicao.html"  },
    @{ Nome = "FT FILA - Entrega";   URL = "$SERVIDOR_URL/entrega.html"    }
)
foreach ($d in $desktops) {
    foreach ($a in $atalhos) {
        $link = $wsh.CreateShortcut("$d\$($a.Nome).lnk")
        $link.TargetPath = $chromePath
        $link.Arguments  = "--new-window --start-maximized `"$($a.URL)`""
        $link.Save()
    }
}
Ok "Atalhos criados: FT FILA - TV, Separacao, Entrega"

# -- 7. printer.ini - configurar impressora ----------------------------------
Log "7. Configurando printer.ini do agent..."
$printerIni = "$AGENT_DEST\config\printer.ini"

# Criar config/ e printer.ini padrao se nao existir (ex: share sem o arquivo)
New-Item -ItemType Directory -Path "$AGENT_DEST\config" -Force | Out-Null
if (-not (Test-Path $printerIni)) {
    $iniDefault = "[Impressora]`r`n; Modelos: Bematech_MP4200TH | ElginI9`r`nModelo=Bematech_MP4200TH`r`nPorta=COM3`r`n; BaudRate: Bematech=115200 | ElginI9=9600`r`nBaudRate=115200`r`nColunas=48`r`n"
    [System.IO.File]::WriteAllText($printerIni, $iniDefault, [System.Text.Encoding]::ASCII)
    Log "  printer.ini padrao criado"
}
Log ""
Log "======================================================"
Log "  Configure a impressora desta maquina:"
Log ""
Log "  [Impressora] Porta  - porta COM da impressora"
Log "  [Impressora] Modelo - Bematech_MP4200TH | ElginI9"
Log "  [Impressora] BaudRate - Bematech=115200 | ElginI9=9600"
Log ""
Log "  Gerenciador de Dispositivos > Portas (COM e LPT)"
Log "======================================================"
Log ""
Start-Process notepad.exe $printerIni
Log "Aguardando fechar o Notepad para reiniciar o agent..."
Wait-Process -Name notepad -ErrorAction SilentlyContinue

Log "Reiniciando $AGENT_SVC..."
try {
    Stop-Service  $AGENT_SVC -Force -ErrorAction Stop
    Start-Sleep -Seconds 2
    Start-Service $AGENT_SVC -ErrorAction Stop
    Ok "Agent reiniciado com nova configuracao"
} catch {
    Log "  Aviso: $_ - tentando iniciar diretamente..."
    Start-Process $nodeExe -ArgumentList $agentEntry -WorkingDirectory $AGENT_DEST -WindowStyle Hidden
    Ok "Agent iniciado como processo (servico sera ativo no proximo boot)"
}

# -- Resumo -------------------------------------------------------------------
Log ""
Log "======================================================"
Log "   Instalacao concluida!"
Log "======================================================"
Log "  Servidor FT_FILA:  $SERVIDOR_URL"
Log "  Agent (local):     http://localhost:4002/health"
Log "  Servico:           $AGENT_SVC  (auto-start)"
Log "  Log agent:         $AGENT_DEST\agent.log"
Log "  Log instalacao:    $LOG_FILE"
Log ""
Log "Paineis (atalhos criados na area de trabalho):"
Log "  FT FILA - TV        -> $SERVIDOR_URL/tv.html"
Log "  FT FILA - Separacao -> $SERVIDOR_URL/expedicao.html"
Log "  FT FILA - Entrega   -> $SERVIDOR_URL/entrega.html"
Log "  Admin:                 $SERVIDOR_URL/admin.html"
Log ""

Start-Sleep -Seconds 3
try {
    $h = Invoke-RestMethod "http://localhost:4002/health" -TimeoutSec 5
    Ok "Agent respondendo"
} catch {
    Log "  Aviso: agent ainda nao respondeu (pode estar inicializando)"
}
try {
    $h = Invoke-RestMethod "$SERVIDOR_URL/api/fila/status" -TimeoutSec 5
    Ok "Servidor FT_FILA respondendo"
} catch {
    Log "  Aviso: servidor nao respondeu em $SERVIDOR_URL - verifique a rede"
}

Read-Host "Pressione Enter para fechar"
