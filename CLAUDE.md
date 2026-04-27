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
- **Banco:** SQLite via `better-sqlite3` (arquivo `data/fila.db`)
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

┌─────────────────────────────────────┐
│  Máquina de Expedição               │
│  ┌───────────────────────────────┐  │
│  │  ft-fila-agent (porta 4002)   │  │
│  │  - Recebe eventos WebSocket   │  │
│  │  - Imprime ESC/POS na local   │  │
│  └───────────────────────────────┘  │
│  Chrome → http://10.100.62.21:4100  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Máquina de Entrega                 │
│  ┌───────────────────────────────┐  │
│  │  ft-fila-agent (porta 4002)   │  │
│  │  - Recebe eventos WebSocket   │  │
│  │  - Imprime etiqueta QR2       │  │
│  └───────────────────────────────┘  │
│  Chrome → http://10.100.62.21:4100  │
└─────────────────────────────────────┘
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
     └─ emite: fila:imprimir → sala 'entrega' (ft-fila-agent imprime etiqueta + QR2)
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
- `expedicao` — painéis de expedição (recebem `fila:imprimir tipo=lista`)
- `entrega` — painéis de entrega (recebem `fila:imprimir tipo=etiqueta`)

O navegador emite `join-room 'expedicao'` ou `join-room 'entrega'` ao carregar.

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

| Modelo | Corte | BaudRate padrão | Conexão |
|--------|-------|-----------------|---------|
| `Bematech_MP4200TH` | `ESC m` (proprietário) — 10 linhas de avanço | 115200 | Serial / USB-CDC |
| `ElginI9` | `GS V 0` (padrão ESC/POS) — 5 linhas de avanço | 9600 | USB-CDC (aparece como COM) |

A Elgin i9 conectada via USB cria uma porta COM virtual (USB-CDC). Identificar a porta em **Gerenciador de Dispositivos → Portas (COM e LPT)**.

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

## Scripts de deploy

| Script | Onde fica | Uso |
|--------|-----------|-----|
| `instalar-fila-agent.ps1` | `\\serverfs01\Publico\TI\Willian\totem\FT_FILA\` | Primeira instalação do agent |
| `atualizar-fila-agent.ps1` | `\\serverfs01\Publico\TI\Willian\totem\FT_FILA\` | Atualização preservando config |

**Agent destino:** `C:\Fueltech_PDV\fila-agent\`
**Config impressora:** `C:\Fueltech_PDV\fila-agent\config\printer.ini`
**Serviço Windows:** `FT_FILA_Agent` (NSSM ou Task Scheduler, auto-start)

## O que ainda falta / próximos passos

- [ ] Instalar ft-fila-agent nas máquinas de expedição e entrega
  - Executar `instalar-fila-agent.ps1` como Administrador em cada PC
  - Configurar `printer.ini` com a porta COM correta
- [ ] Testar fluxo completo com QR scan via câmera ou leitor de código
- [ ] Configurar rechamada automática após X minutos sem entrega
- [ ] Relatórios de ordens por dia/período (painel admin)
