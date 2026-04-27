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
│  ft-fila-agent :4002      │          │  ft-fila-agent :4002      │
│  printer.ini (individual) │          │  printer.ini (individual) │
│  Impressora: COM?         │          │  Impressora: COM?         │
└──────────────────────────┘          └──────────────────────────┘
```

**Regras:**
- O **servidor roda sempre no Windows Server** — SQLite, Socket.IO, painéis HTML.
- Cada máquina (expedição/entrega) roda o **ft-fila-agent** (porta 4002) para controlar sua impressora local.
- A TV de senhas **não precisa de agent** — apenas Chrome apontando para `:4100/tv.html`.

---

## Scripts Disponíveis

| Script | Local | Uso |
|--------|-------|-----|
| `instalar-fila-agent.ps1` | `\\serverfs01\Publico\TI\Willian\totem\FT_FILA\` | Instalação completa do agent (primeira vez) |
| `atualizar-fila-agent.ps1` | `\\serverfs01\Publico\TI\Willian\totem\FT_FILA\` | Atualização do agent preservando printer.ini |

---

## Parte 1 — Instalar o Servidor FT_FILA

> O servidor FT_FILA já está instalado no Windows Server como parte da infraestrutura FuelTech.
> Seguir estas etapas apenas ao configurar um servidor do zero.

```powershell
# 1. Copiar arquivos para o servidor
robocopy "FT_FILA" "\\10.100.62.21\c$\Fueltech_PDV\FT_FILA" /E /XD node_modules .git

# 2. Instalar dependências (via SSH ou RDP no servidor)
cd C:\Fueltech_PDV\FT_FILA
& "C:\Program Files\nodejs\npm.cmd" install --omit=dev

# 3. Criar serviço Windows (NSSM)
$n = "C:\ProgramData\chocolatey\lib\NSSM\tools\nssm.exe"
& $n install FT_FILA "C:\Program Files\nodejs\node.exe" "C:\Fueltech_PDV\FT_FILA\src\server.js"
& $n set FT_FILA AppDirectory "C:\Fueltech_PDV\FT_FILA"
& $n set FT_FILA AppStdout    "C:\Fueltech_PDV\FT_FILA\ft-fila.log"
& $n set FT_FILA AppStderr    "C:\Fueltech_PDV\FT_FILA\ft-fila-err.log"
& $n set FT_FILA Start        SERVICE_AUTO_START
Start-Service FT_FILA
```

---

## Parte 2 — Instalar ft-fila-agent (por máquina com impressora)

O agent deve ser instalado em **cada máquina** que tem impressora física:
- PC de Expedição (imprime lista de itens + QR1)
- PC de Entrega (imprime etiqueta + QR2)

### Instalação Automática (recomendado)

Abrir **PowerShell como Administrador** na máquina e executar:

```powershell
powershell -ExecutionPolicy Bypass -File "\\serverfs01\Publico\TI\Willian\totem\FT_FILA\instalar-fila-agent.ps1"
```

O script instala automaticamente:
- Node.js 20 LTS (se não instalado)
- ft-fila-agent como serviço Windows (auto-start, porta 4002)
- Suspensão desabilitada
- Abre `printer.ini` no Notepad para configurar a porta COM

### Via pendrive

Copiar para o pendrive os seguintes itens:

```
instalar-fila-agent.ps1
agent\                    ← pasta completa
```

```powershell
powershell -ExecutionPolicy Bypass -File D:\instalar-fila-agent.ps1
```

### Configurar printer.ini

Arquivo em: `C:\Fueltech_PDV\fila-agent\config\printer.ini`

```ini
[Impressora]
Modelo=Bematech_MP4200TH
Porta=COM9          ; ajustar para a porta COM correta
BaudRate=115200
Colunas=48
```

> Para descobrir a porta COM: Gerenciador de Dispositivos → Portas (COM e LPT).

---

## Parte 3 — Atualização do Agent (após mudanças no código)

Use `atualizar-fila-agent.ps1` para atualizar o ft-fila-agent sem reinstalar.
**Preserva `printer.ini` e logs** — não altera a configuração da máquina.

```powershell
# Abrir PowerShell como Administrador na máquina
powershell -ExecutionPolicy Bypass -File "\\serverfs01\Publico\TI\Willian\totem\FT_FILA\atualizar-fila-agent.ps1"
```

---

## Parte 4 — Configurar Painéis nos Navegadores

### PC de Expedição

```
http://10.100.62.21:4100/expedicao.html
```

Criar atalho na área de trabalho. Pode configurar Chrome para abrir esta URL na inicialização.

### PC de Entrega

```
http://10.100.62.21:4100/entrega.html
```

### TV de Senhas (painel externo — sem agent)

Qualquer TV ou monitor com Chrome:
```
http://10.100.62.21:4100/tv.html
```

### Painel Admin

```
http://10.100.62.21:4100/admin.html
```

---

## Verificação Completa

```powershell
# No servidor: verificar serviço FT_FILA
Get-Service FT_FILA

# No servidor: verificar porta 4100
Invoke-RestMethod http://10.100.62.21:4100/api/fila/status

# Nas máquinas de expedição/entrega: verificar agent
Invoke-RestMethod http://localhost:4002/health
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
| Painel não abre | Servidor offline | `Get-Service FT_FILA` no servidor |
| Impressora não imprime | Agent não rodando | `Get-Service FT_FILA_Agent` na máquina |
| Porta COM incorreta | printer.ini errado | Gerenciador de Dispositivos → checar porta |
| QR code não reconhecido | Status inválido | Admin → cancelar ordem e recriar |
| Senhas não aparecem na TV | WebSocket caiu | Recarregar página (F5) |
| Agent não sobe | Log de erro | `C:\Fueltech_PDV\fila-agent\agent-err.log` |
