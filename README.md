# FT_FILA — Sistema de Gestão de Filas FuelTech

Sistema de filas e senhas de atendimento para as lojas físicas da FuelTech. Quando um cliente finaliza uma compra no totem (FT_PDV), uma senha de retirada é gerada automaticamente. A equipe da loja usa os painéis de expedição e entrega para processar os pedidos.

---

## Arquitetura

```
┌─────────────────────────────────────────────────┐
│  Servidor Windows 10.100.62.21:4100              │
│  Serviço Windows: FT_FILA (NSSM)                │
│  C:\Fueltech_PDV\FT_FILA\                        │
└─────────────────────────────────────────────────┘
        │ Socket.IO
        ├────────────────────────────────────────┐
        ▼                                        ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│  PC Expedição            │     │  PC Entrega              │
│  /expedicao.html         │     │  /entrega.html           │
│  ft-fila-agent :4002    │     │  ft-fila-agent :4002    │
│  Impressora: lista+QR1  │     │  Impressora: etiqueta+QR2│
└─────────────────────────┘     └─────────────────────────┘

┌─────────────────────────┐
│  TV de Senhas            │
│  /tv.html                │
└─────────────────────────┘
```

---

## Fluxo de Atendimento

```
1. Totem → POST /api/fila → gera senha A-042 (NOVO)
2. Expedição → clica "Próxima" → imprime lista + QR1 (SEPARANDO)
3. Scan QR1 → senha aparece na TV (CHAMADO)
4. Entrega → scan QR2 → pedido entregue (ENTREGUE)
```

---

## Painéis

| URL | Painel | Quem usa |
|-----|--------|---------|
| `/expedicao.html` | Expedição | Operadores de separação |
| `/tv.html` | TV Senhas | Tela de chamada para clientes |
| `/entrega.html` | Entrega | Operadores de entrega |
| `/admin.html` | Admin | Gestão e histórico |

---

## Instalação

Ver: [INSTALACAO.md](INSTALACAO.md)

**Resumo:**
- Servidor: serviço Windows `FT_FILA` na porta 4100 (já instalado em 10.100.62.21)
- Máquinas com impressora: instalar `ft-fila-agent` (pasta `agent/`)
- Abrir painéis em Chrome apontando para `http://10.100.62.21:4100`

---

## Desenvolvimento Local

```bash
npm install
npm run dev       # porta 4100

# Agent (em outra aba):
cd agent && npm install && npm run dev   # porta 4002
```

---

## Stack

| Componente | Tecnologia |
|------------|-----------|
| Servidor | Node.js 20 + Express + Socket.IO |
| Banco | SQLite (better-sqlite3) |
| Frontend | HTML/CSS/JS puro |
| Agent | Node.js 20 + Express (porta 4002) |
| Impressão | ESC/POS serial (Bematech MP-4200 TH) |

---

## Licença

Proprietário — FuelTech Ltda. Uso interno.
