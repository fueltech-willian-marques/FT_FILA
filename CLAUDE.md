# FT_FILA — Contexto do Projeto para Claude Code

> **Leia este arquivo inteiro antes de qualquer ação.** Ele documenta decisões técnicas, arquitetura validada e estado atual do projeto.

---

## O que é este projeto

**FT_FILA** é o sistema de gestão de filas e senhas de atendimento das lojas físicas da **FuelTech**.

Quando o cliente finaliza uma compra no totem (FT_PDV), o sistema gera automaticamente uma **senha de retirada** (ex: `A-042`). A equipe da loja usa o painel de expedição para separar e entregar os pedidos. O painel de TV exibe as senhas chamadas em tempo real.

**Não confundir com RabbitMQ:** FT_FILA é um software de fila de atendimento físico. RabbitMQ é infraestrutura de mensageria assíncrona usada pelo FT_PDV para registrar vendas no Protheus.

---

## Stack

- **Backend:** Node.js Express + Socket.IO (porta 4100)
- **Banco:** PostgreSQL 16 — mesmo servidor do FT_PDV (`ftpdv` database, `postgresql://ftpdv:ftpdv@localhost:5432/ftpdv`)
- **Frontend:** HTML/JS/CSS puro (arquivos estáticos em `public/`)
- **Agent:** Node.js Express (porta 4002) — instalado em cada máquina com impressora

---

## Arquitetura — dois componentes

```
┌─────────────────────────────────────────────────────┐
│              Windows Server (10.100.62.21)           │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  FT_FILA Server  (porta 4100)               │    │
│  │  - Gerencia ordens no SQLite                │    │
│  │  - Serve painéis HTML                       │    │
│  │  - Emite eventos Socket.IO                  │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  Máquina de Expedição  (sala Socket.IO: 'expedicao')     │
│  ┌───────────────────────────────────────────────────┐  │
│  │  ft-fila-agent (porta 4002)                       │  │
│  │  - Imprime lista de separação (QR1)               │  │
│  │  - Imprime etiqueta de entrega (QR2)              │  │
│  └───────────────────────────────────────────────────┘  │
│  Chrome → expedicao.html  (join-room 'expedicao')        │
└─────────────────────────────────────────────────────────┘

Nota: entrega.html lê QR2 para marcar ENTREGUE mas NÃO imprime.
Toda impressão (lista + etiqueta) é feita pela sala 'expedicao'.
```

---

## Estrutura de pastas

```
FT_FILA/
├── CLAUDE.md                  ← este arquivo
├── INSTALACAO.md              ← guia instalação para técnicos
├── package.json
├── config/
│   └── fila.ini               ← porta do servidor, config de impressora
├── data/
│   └── fila.db                ← SQLite (criado automaticamente)
├── public/                    ← painéis estáticos (servidos pelo servidor)
│   ├── expedicao.html         ← painel da equipe de expedição
│   ├── tv.html                ← painel TV (exibe senhas chamadas)
│   ├── entrega.html           ← painel de entrega (scan QR2)
│   └── admin.html             ← painel administrativo
└── src/
│   ├── server.js              ← Express + Socket.IO
│   ├── socket.js              ← singleton Socket.IO
│   ├── config/
│   │   └── settings.js        ← lê fila.ini
│   ├── db/
│   │   ├── database.js        ← inicializa SQLite, cria tabelas, migrations
│   │   └── ordens.js          ← CRUD de ordens (toda lógica de negócio)
│   ├── routes/
│   │   ├── fila.js            ← /api/fila (criação, listagem, scan, operadores)
│   │   ├── printer.js         ← /api/printer (proxy para ft-fila-agent)
│   │   └── qrcode.js          ← geração de QR codes
│   └── services/
│       └── printer.js         ← ESC/POS direto (legado, substituído pelo agent)
└── agent/                     ← ft-fila-agent (instalado por máquina)
    ├── package.json
    ├── config/
    │   └── printer.ini        ← porta COM e baudrate da impressora local
    └── src/
        ├── routes/
        │   └── print.js       ← POST /print/lista e /print/etiqueta
        └── server.js          ← Express porta 4002
```

---

## Banco de dados (SQLite)

### Banco de dados

PostgreSQL 16 — banco `ftpdv` (mesmo do FT_PDV). URL em `config/fila.ini [Postgres] Url`.
Tabelas: `ordens` e `contador_dia` (criadas automaticamente no startup via `db.init()`).
QR codes armazenados **sem hífen** (UUID hex puro, 32 chars) para compatibilidade com scanners HID em teclado ABNT2.

### Tabela `ordens`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | INTEGER PK | Auto-incremento |
| `senha` | TEXT | Ex: `A-042` |
| `status` | TEXT | NOVO / SEPARANDO / CHAMADO / ENTREGUE |
| `qr1_code` | TEXT UNIQUE | UUID para scan de separação |
| `qr2_code` | TEXT UNIQUE | UUID para scan de entrega |
| `itens` | TEXT | JSON dos itens da venda |
| `chave_nfce` | TEXT | Chave 44 dígitos da NFC-e |
| `total` | REAL | Valor total |
| `origem` | TEXT | `totem` ou outro |
| `operador` | INTEGER | Número do operador (1, 2, ...) |
| `criado_em` | TEXT | ISO 8601 |
| `atualizado_em` | TEXT | ISO 8601 |

### Tabela `contador_dia`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `data` | TEXT PK | YYYY-MM-DD |
| `proximo` | INTEGER | Próximo número da sequência do dia |

Senhas são resetadas automaticamente a cada dia. O formato é `A-NNN` (ex: `A-001` a `A-999`).

---

## Fluxo completo de uma ordem

```
Totem finaliza venda
  └─ POST /api/fila { itens, total, chaveNfce, origem:'totem' }
     └─ cria ordem, gera senha A-NNN, gera QR1 e QR2 (UUIDs únicos)
     └─ emite: fila:nova { filaId, senha, itens, total }
     └─ retorna: { ok, filaId, senha, qr2Code }

Painel Expedição (expedicao.html)
  └─ operador clica "Próxima"
     └─ POST /api/fila/operador/1/proximo
        └─ atribui operador N, muda status → SEPARANDO
        └─ emite: fila:imprimir → sala 'expedicao' (ft-fila-agent imprime lista + QR1)
        └─ emite: fila:atualizada { status:'SEPARANDO', operador:N }

Operador termina separação → scan do QR1 impresso
  └─ POST /api/fila/scan { qrCode: '<uuid do QR1>' }
     └─ muda status → CHAMADO
     └─ emite: fila:atualizada { status:'CHAMADO' }
     └─ emite: fila:imprimir → sala 'expedicao' (ft-fila-agent imprime etiqueta + QR2)
     └─ emite: fila:operador-livre { operador:N }

Painel TV (tv.html) exibe senha em destaque

Painel Entrega (entrega.html) → operador scan QR2 da etiqueta
  └─ POST /api/fila/scan { qrCode: '<uuid do QR2>' }
     └─ muda status → ENTREGUE
     └─ emite: fila:entregue { filaId, senha }
```

---

## API REST

### POST `/api/fila` — cria ordem
```json
{ "itens": [...], "total": 89.90, "chaveNfce": "431...", "origem": "totem" }
```
Retorna: `{ ok, filaId, senha, qr2Code }`

### GET `/api/fila` — ordens ativas (não ENTREGUE)
### GET `/api/fila/tv` — ordens SEPARANDO e CHAMADO (painel TV)
### GET `/api/fila/todas` — todas as ordens (admin)
### GET `/api/fila/status` — health check
### GET `/api/fila/fila-count` — total na fila (NOVO sem operador)

### POST `/api/fila/scan` — processa scan de QR1 ou QR2
```json
{ "qrCode": "<uuid>" }
```
- QR1 (SEPARANDO → CHAMADO): delega impressão da etiqueta ao agent de entrega
- QR2 (CHAMADO → ENTREGUE): registra entrega

### POST `/api/fila/operador/:n/proximo` — operador N pega próxima ordem
- Idempotente: se já tem ordem SEPARANDO, retorna ela
- Delega impressão da lista ao agent de expedição

### POST `/api/fila/:id/imprimir-lista` — re-imprime lista (manual)
### POST `/api/fila/:id/cancelar` — volta ordem para NOVO
### POST `/api/fila/:id/rechamar` — pisca senha na TV
### POST `/api/fila/reset-contador` — reseta numeração do dia
### POST `/api/fila/limpar-tudo` — remove todas as ordens e zera contador (reset completo)
### GET `/api/fila/view/:token` — status da ordem pelo token qr2Code (somente leitura, para cliente)
```json
{ "ok": true, "senha": "A-042", "status": "CHAMADO", "criadoEm": "..." }
```

---

## Socket.IO — eventos emitidos pelo servidor

| Evento | Quando | Payload |
|--------|--------|---------|
| `fila:nova` | nova ordem criada | `{ filaId, senha, itens, total }` |
| `fila:atualizada` | status mudou | `{ filaId, senha, status, operador? }` |
| `fila:entregue` | ordem entregue | `{ filaId, senha }` |
| `fila:rechamada` | rechamada manual | `{ filaId, senha }` |
| `fila:operador-livre` | operador ficou disponível | `{ operador }` |
| `fila:imprimir` | delega impressão ao agent | `{ tipo:'lista'|'etiqueta', dados }` |

### Salas Socket.IO
- `expedicao` — recebe TODOS os eventos `fila:imprimir` (tanto `tipo='lista'` quanto `tipo='etiqueta'`)
  - `expedicao.html` filtra: Socket.IO só processa `tipo='lista'`; etiqueta é impressa via fetch direto após scan QR1

O navegador de expedição emite `join-room 'expedicao'` ao carregar.

---

## ft-fila-agent (porta 4002)

Processo Node.js local instalado em cada máquina com impressora física.
O browser (`expedicao.html`, `entrega.html`) escuta o evento `fila:imprimir` via Socket.IO do servidor central e faz `POST http://localhost:4002/print/lista` ou `/print/etiqueta`.

```
fila.ini [Impressora].PrintProxyUrl=http://localhost:4000
```
Quando `PrintProxyUrl` está definido, as impressões são delegadas ao FT_PDV backend.
Quando vazio, o ft-fila-agent usa a porta COM configurada em `agent/config/printer.ini`.

### Modelos de impressora suportados

| Modelo (`printer.ini`) | Impressora física | Corte | BaudRate | Porta |
|------------------------|-------------------|-------|----------|-------|
| `Bematech_MP4200TH` | MP-4200 **HS** (RS-232) | `ESC m` proprietário — 10 linhas | 115200 | `COM3` (cabo DB9) |
| `Bematech_MP4200TH` | MP-4200 **TH** (USB-CDC) | `ESC m` proprietário — 10 linhas | 115200 | `COM9` (porta virtual — Gerenciador de Dispositivos) |
| `ElginI9` | Elgin I9 (USB driver) | `GS V 0` ESC/POS — 5 linhas | 9600 | `USB001` (driver Windows — agent usa `rawprint.ps1`) |
| `ElginI9` | Elgin I9 (USB-CDC) | `GS V 0` ESC/POS — 5 linhas | 115200 | `COM5` (porta virtual — Gerenciador de Dispositivos) |

**Tipos de porta suportados em `printer.ini`:**
- `Porta=COM5` — porta serial ou USB-CDC (driver cria COM virtual). Usa `serialport`.
- `Porta=USB001` — porta de impressora Windows instalada via driver. Agent usa `rawprint.ps1` (WritePrinter API via winspool.drv) — envia ESC/POS diretamente ao spooler RAW.

Para saber qual porta: **Gerenciador de Dispositivos → Portas (COM e LPT)** (USB-CDC) ou **Impressoras e Scanners → propriedades → porta** (USB001/LPT).

Configurado em `agent/config/printer.ini` — o agent relê ao iniciar (reiniciar após alteração).

---

## Configuração — `config/fila.ini`

```ini
[Servidor]
Porta=4100

[Impressora]
Porta=COM9
BaudRate=115200
Colunas=48
Modelo=Bematech_MP4200TH
PrintProxyUrl=http://localhost:4000   ; vazio = impressora própria
```

---

## Painéis HTML

| Painel | URL | Uso |
|--------|-----|-----|
| Expedição | `/expedicao.html` | Operador visualiza e separa pedidos |
| TV Senhas | `/tv.html` | Tela grande exibe senhas chamadas |
| Entrega | `/entrega.html` | Operador confirma entrega via scan |
| Admin | `/admin.html` | Gestão geral, histórico, reset de contador |

---

## Implantação no servidor (estado atual — 2026-04-24)

**Servidor:** Windows Server 2022 — 10.100.62.21  
**Caminho:** `C:\Fueltech_PDV\FT_FILA\`  
**Serviço Windows:** `FT_FILA` (NSSM), auto-start  
**Porta:** 4100 (LISTENING 0.0.0.0)  
**Log:** `C:\Fueltech_PDV\FT_FILA\ft-fila.log`

---

## O que está implementado

- [x] CRUD completo de ordens (criar, listar, buscar, atualizar, cancelar)
- [x] Senhas diárias no formato A-NNN (resetam à meia-noite)
- [x] Dois QR codes por ordem (QR1 separação + QR2 entrega)
- [x] Atribuição de operadores (multi-operador com idempotência)
- [x] Fluxo NOVO → SEPARANDO → CHAMADO → ENTREGUE
- [x] Painéis HTML: expedição, TV, entrega, admin
- [x] Socket.IO tempo real (todos os painéis sincronizados)
- [x] ft-fila-agent (agente local de impressão por máquina)
- [x] Impressão delegada via Socket.IO (servidor → browser → agent)
- [x] health check `/api/fila/status`
- [x] `instalar-fila-agent.ps1` — instalador automático do agent (Node.js + NSSM + printer.ini)
- [x] `atualizar-fila-agent.ps1` — atualizador do agent preservando printer.ini e logs
- [x] Suporte a múltiplos modelos de impressora: `Bematech_MP4200TH` e `ElginI9` (campo `Modelo` no `printer.ini`)
- [x] **Correção impressão etiqueta de entrega** (2026-04-27):
  - `emitPrint` envia todos os eventos para sala `'expedicao'` (era `'entrega'` — nenhum browser na sala)
  - `expedicao.html` Socket.IO filtra apenas `tipo='lista'`; etiqueta é impressa via `fetch localhost:4002/print/etiqueta` diretamente no handler de scan QR1
- [x] **`POST /api/fila/limpar-tudo`** — apaga todas as ordens e zera o contador (reset completo para testes)
- [x] **`GET /api/fila/view/:token`** — endpoint público que resolve o token `qr2Code` (UUID) para status da senha (usado pelo QR de acompanhamento no cupom fiscal)

## Scripts de deploy

| Script | Onde fica | Uso |
|--------|-----------|-----|
| `instalar-fila-agent.ps1` | `\\serverfs01\Publico\TI\Willian\totem\FT_FILA\` | Primeira instalação do agent |
| `atualizar-fila-agent.ps1` | `\\serverfs01\Publico\TI\Willian\totem\FT_FILA\` | Atualização preservando config |

**Agent destino:** `C:\Fueltech_PDV\fila-agent\`
**Config impressora:** `C:\Fueltech_PDV\fila-agent\config\printer.ini`
**Serviço Windows:** `FT_FILA_Agent` (NSSM ou Task Scheduler, auto-start)

## O que ainda falta / próximos passos

- [ ] **Reiniciar serviço FT_FILA no servidor** após atualização de `src/routes/fila.js` (necessário via RDP — SSH exit 255):
  ```
  Restart-Service FT_FILA
  ```
- [ ] Instalar ft-fila-agent na máquina de expedição
  - Executar `instalar-fila-agent.ps1` como Administrador
  - Configurar `printer.ini` com a porta COM correta (USB001 para Elgin I9 via driver)
- [ ] Testar fluxo completo com QR scan via câmera ou leitor de código de barras
- [ ] Configurar rechamada automática após X minutos sem entrega
- [ ] Relatórios de ordens por dia/período (painel admin)
