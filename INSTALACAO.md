# Instalação FT_FILA

> Guia para técnicos instalarem o sistema de gestão de filas FuelTech.
>
> O FT_FILA é composto por dois componentes:
> - **Servidor central** (roda no Windows Server junto com o FT_PDV)
> - **ft-fila-agent** (roda em cada máquina com impressora: expedição e entrega)

---

## Arquitetura

```
┌────────────────────────────────────────────────────────────┐
│  Servidor Windows (10.100.62.21)                           │
│  C:\Fueltech_PDV\FT_FILA\                                  │
│                                                            │
│  Serviço Windows: FT_FILA (porta 4100)                     │
│  - Banco SQLite: data\fila.db                              │
│  - Painéis HTML: public\                                   │
└────────────────────────────────────────────────────────────┘
        │ Socket.IO (ws://10.100.62.21:4100)
        ├──────────────────────────────────────────────────┐
        ▼                                                  ▼
┌──────────────────────────┐          ┌──────────────────────────┐
│  PC de Expedição          │          │  PC de Entrega            │
│  Chrome → :4100/expedicao │          │  Chrome → :4100/entrega  │
│                           │          │                           │
│  ft-fila-agent (porta 4002)│         │  ft-fila-agent (porta 4002)│
│  Impressora: COM?         │          │  Impressora: COM?         │
└──────────────────────────┘          └──────────────────────────┘
```

---

## Parte 1 — Instalar o Servidor FT_FILA

> O servidor FT_FILA já está instalado como parte do servidor central FuelTech.
> Seguir estas etapas apenas se estiver configurando um servidor do zero.

Ver guia completo em: [INSTALACAO-SERVIDOR.md](../FT_PDV/INSTALACAO-SERVIDOR.md)

**Resumo:**
```powershell
# 1. Copiar arquivos para o servidor
robocopy "FT_FILA" "\\10.100.62.21\c$\Fueltech_PDV\FT_FILA" /E /XD node_modules .git

# 2. Instalar dependências
ssh administrator@10.100.62.21
Set-Location C:\Fueltech_PDV\FT_FILA
& "C:\Program Files\nodejs\npm.cmd" install --omit=dev

# 3. Criar serviço Windows (NSSM)
$n = "C:\ProgramData\chocolatey\lib\NSSM\tools\nssm.exe"
& $n install FT_FILA "C:\Program Files\nodejs\node.exe" "C:\Fueltech_PDV\FT_FILA\src\server.js"
& $n set FT_FILA AppDirectory "C:\Fueltech_PDV\FT_FILA"
& $n set FT_FILA Start SERVICE_AUTO_START
Start-Service FT_FILA
```

---

## Parte 2 — Instalar ft-fila-agent (por máquina)

O agent deve ser instalado em **cada máquina** que tem impressora física:
- PC de Expedição (imprime lista de itens + QR1)
- PC de Entrega (imprime etiqueta + QR2)

### 2.1. Pré-requisitos

- Windows 10/11 64-bit
- Node.js 18+ instalado: https://nodejs.org/
- Impressora térmica conectada via USB/serial (ex: Bematech MP-4200 TH em COM9)

### 2.2. Copiar arquivos do agent

Copiar a pasta `FT_FILA\agent\` para a máquina local:
```
C:\Fueltech_FILA-agent\
```

### 2.3. Instalar dependências

```cmd
cd C:\Fueltech_FILA-agent
npm install --omit=dev
```

### 2.4. Configurar impressora

Editar `C:\Fueltech_FILA-agent\config\printer.ini`:

```ini
[Impressora]
Porta=COM9         ; ajustar para a porta COM correta
BaudRate=115200    ; para Bematech MP-4200 TH
Colunas=48
Modelo=Bematech_MP4200TH
```

> Para descobrir a porta COM: Gerenciador de Dispositivos → Portas (COM e LPT).

### 2.5. Testar o agent

```cmd
node C:\Fueltech_FILA-agent\server.js
```

Deve mostrar:
```
╔═══════════════════════════════════════╗
║  FT_FILA Agent — http://localhost:4002  ║
╚═══════════════════════════════════════╝
```

### 2.6. Criar serviço Windows (auto-start)

**Com NSSM (recomendado):**
```powershell
# Instalar NSSM primeiro se não instalado:
# choco install nssm -y  OU  baixar de https://nssm.cc/download

$n = "C:\path\to\nssm.exe"
$node = "C:\Program Files\nodejs\node.exe"
& $n install FT_FILA_Agent $node "C:\Fueltech_FILA-agent\server.js"
& $n set FT_FILA_Agent AppDirectory "C:\Fueltech_FILA-agent"
& $n set FT_FILA_Agent AppStdout "C:\Fueltech_FILA-agent\agent.log"
& $n set FT_FILA_Agent AppStderr "C:\Fueltech_FILA-agent\agent-err.log"
& $n set FT_FILA_Agent Start SERVICE_AUTO_START
Start-Service FT_FILA_Agent
```

**Com Task Scheduler (alternativa):**
```powershell
schtasks /create /tn "FT_FILA Agent" `
  /tr "`"C:\Program Files\nodejs\node.exe`" C:\Fueltech_FILA-agent\server.js" `
  /sc ONSTART /delay 0000:15 /rl HIGHEST /f
```

---

## Parte 3 — Configurar Painéis nos Navegadores

### PC de Expedição

Abrir Chrome e navegar para:
```
http://10.100.62.21:4100/expedicao.html
```

Criar atalho na área de trabalho ou configurar auto-start.

### PC de Entrega

Abrir Chrome e navegar para:
```
http://10.100.62.21:4100/entrega.html
```

### TV de Senhas (painel externo)

Qualquer TV ou monitor com Chrome:
```
http://10.100.62.21:4100/tv.html
```

### Painel Admin

Acesso via rede para gerenciamento:
```
http://10.100.62.21:4100/admin.html
```

---

## Verificação Completa

```powershell
# No servidor: verificar serviço FT_FILA
Get-Service FT_FILA

# No servidor: verificar porta 4100
netstat -an | findstr 4100

# Nos PCs: verificar agent na porta 4002
netstat -an | findstr 4002
# Ou: Invoke-RestMethod http://localhost:4002/health
```

---

## Fluxo de Uso — Resumo para Operadores

```
1. Totem: cliente finaliza compra → senha A-NNN gerada automaticamente

2. Painel Expedição (PC expedição):
   - Nova senha aparece na lista
   - Operador clica "Próxima" → impressora imprime lista de itens + QR1
   - Operador separa os itens
   - Quando pronto, escaneia o QR1 impresso
   - Senha aparece na TV chamando o cliente

3. Painel TV: exibe senha em destaque

4. Painel Entrega (PC entrega):
   - Cliente chega e apresenta etiqueta QR2 (impressa automaticamente no passo 2)
   - Operador escaneia o QR2
   - Ordem marcada como ENTREGUE

5. Painel Admin: histórico completo, reset de contador diário
```

---

## Resolução de Problemas

| Problema | Causa Provável | Solução |
|----------|---------------|---------|
| Painel não abre | Servidor offline | Verificar `Get-Service FT_FILA` no servidor |
| Impressora não imprime | Agent não rodando | Verificar `Get-Service FT_FILA_Agent` na máquina |
| Porta COM incorreta | printer.ini errado | Gerenciador de Dispositivos → checar porta |
| QR code não reconhecido | Status inválido | Admin → cancelar ordem e recriar |
| Senhas não aparecem na TV | WebSocket caiu | Recarregar página (F5) |
