const express  = require('express')
const ordens   = require('../db/ordens')
// printer removido — impressão delegada ao ft-fila-agent via WebSocket
const { getIO } = require('../socket')  // singleton Socket.IO — criado na Task 8

function emitPrint(tipo, dados) {
  const io   = getIO()
  const sala = tipo === 'etiqueta' ? 'entrega' : 'expedicao'
  io?.to(sala).emit('fila:imprimir', { tipo, dados })
  console.log(`[fila] Evento fila:imprimir tipo='${tipo}' → sala '${sala}'`)
}

const router = express.Router()

// ── POST /api/fila — cria nova ordem (chamado pelo totem/PDV) ─────────────────
router.post('/', async (req, res) => {
  const { itens, total, chaveNfce, origem } = req.body
  if (!itens) return res.status(400).json({ ok: false, error: 'itens obrigatório' })

  try {
    const ordem = ordens.criarOrdem({ itens, total, chaveNfce, origem: origem || 'totem' })
    // Notifica painel de expedição em tempo real
    getIO()?.emit('fila:nova', {
      filaId: ordem.id,
      senha:  ordem.senha,
      itens,
      total,
    })
    return res.status(201).json({
      ok:     true,
      filaId: ordem.id,
      senha:  ordem.senha,
      qr2Code: ordem.qr2Code,
    })
  } catch (err) {
    console.error('[fila] Erro ao criar ordem:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila — lista ordens ativas (painel expedição) ───────────────────
router.get('/', (_req, res) => {
  try {
    return res.json(ordens.listarAtivas())
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila/tv — lista SEPARANDO e CHAMADO (painel TV) ─────────────────
router.get('/tv', (_req, res) => {
  try {
    return res.json(ordens.listarTV())
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila/todas — lista todas as ordens (painel admin) ───────────────
router.get('/todas', (_req, res) => {
  try {
    return res.json(ordens.listarTodas())
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ATENÇÃO: rotas específicas ANTES das parametrizadas (/:id) — ordem importa no Express
// POST /scan, GET /status, POST /reset-contador DEVEM vir antes de /:id

// ── POST /api/fila/scan — processa leitura de QR code ───────────────────────
router.post('/scan', async (req, res) => {
  const { qrCode } = req.body
  if (!qrCode) return res.status(400).json({ ok: false, error: 'qrCode obrigatório' })

  try {
    const result = ordens.scanQR(qrCode)

    // Emite evento para todos os painéis
    const io = getIO()
    if (result.status === 'CHAMADO') {
      io?.emit('fila:atualizada', { filaId: result.id, senha: result.senha, status: 'CHAMADO' })
      // Delega impressão da etiqueta QR2 ao ft-fila-agent na máquina de entrega
      const ordem = ordens.buscarPorId(result.id)
      emitPrint('etiqueta', { senha: result.senha, qr2Code: ordem.qr2_code })
      // Notifica painel que operador ficou livre para receber próxima ordem
      if (result.operador) {
        io?.emit('fila:operador-livre', { operador: result.operador })
      }
    } else if (result.status === 'ENTREGUE') {
      io?.emit('fila:entregue', { filaId: result.id, senha: result.senha })
    }

    return res.json({ ok: true, ...result })
  } catch (err) {
    if (err.message === 'QR code não encontrado') return res.status(404).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila/status — health check ──────────────────────────────────────
router.get('/status', (_req, res) => {
  try {
    const ativas = ordens.listarAtivas().length
    return res.json({ ok: true, ativos: ativas, porta: process.env.PORT || 4100 })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/reset-contador — reseta numeração do dia (admin) ──────────
router.post('/reset-contador', (req, res) => {
  try {
    ordens.resetarContador()
    return res.json({ ok: true, msg: 'Contador do dia resetado' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/limpar-tudo — apaga todas as ordens e zera contador (admin) ─
router.post('/limpar-tudo', (req, res) => {
  try {
    ordens.limparTudo()
    getIO()?.emit('fila:atualizada', { reset: true })
    return res.json({ ok: true, msg: 'Todas as ordens removidas e contador zerado' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila/fila-count — conta NOVO sem operador (na fila) ─────────────
router.get('/fila-count', (_req, res) => {
  try {
    return res.json({ ok: true, total: ordens.contarNaFila() })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/operador/:n/proximo — atribui próxima ordem ao operador N ──
router.post('/operador/:n/proximo', async (req, res) => {
  const n = parseInt(req.params.n)
  if (!n || n < 1) return res.status(400).json({ ok: false, error: 'Operador inválido' })

  try {
    // Se operador já tem ordem em separação, devolve ela (idempotente)
    let ordem = ordens.ordemDoOperador(n)
    if (ordem) return res.json({ ok: true, ordem })

    // Pega próxima NOVO sem operador
    const proxima = ordens.proximaOrdemNova()
    if (!proxima) return res.json({ ok: true, ordem: null })

    // Atribui operador N → status SEPARANDO
    ordens.atribuirOperador(proxima.id, n)
    ordem = ordens.buscarPorId(proxima.id)

    // Delega impressão ao ft-fila-agent na máquina de expedição
    emitPrint('lista', {
      senha:   ordem.senha,
      itens:   ordem.itens,
      total:   ordem.total,
      qr1Code: ordem.qr1_code,
    })

    getIO()?.emit('fila:atualizada', { filaId: ordem.id, senha: ordem.senha, status: 'SEPARANDO', operador: n })
    return res.json({ ok: true, ordem })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/:id/imprimir-lista — imprime lista + muda para SEPARANDO ──
router.post('/:id/imprimir-lista', async (req, res) => {
  const id = parseInt(req.params.id)
  const ordem = ordens.buscarPorId(id)
  if (!ordem) return res.status(404).json({ ok: false, error: 'Ordem não encontrada' })

  emitPrint('lista', {
    senha:   ordem.senha,
    itens:   ordem.itens,
    total:   ordem.total,
    qr1Code: ordem.qr1_code,
  })
  ordens.atualizarStatus(id, 'SEPARANDO')
  getIO()?.emit('fila:atualizada', { filaId: id, senha: ordem.senha, status: 'SEPARANDO' })
  return res.json({ ok: true, status: 'SEPARANDO' })
})

// ── POST /api/fila/:id/cancelar — volta para NOVO (admin) ───────────────────
router.post('/:id/cancelar', (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const ordem = ordens.cancelarOrdem(id)
    getIO()?.emit('fila:atualizada', { filaId: id, senha: ordem.senha, status: 'NOVO' })
    return res.json({ ok: true, status: 'NOVO' })
  } catch (err) {
    if (err.message.includes('não encontrada')) return res.status(404).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/:id/rechamar — pisca senha na TV ─────────────────────────
router.post('/:id/rechamar', (req, res) => {
  const id = parseInt(req.params.id)
  const ordem = ordens.buscarPorId(id)
  if (!ordem) return res.status(404).json({ ok: false, error: 'Ordem não encontrada' })
  getIO()?.emit('fila:rechamada', { filaId: id, senha: ordem.senha })
  console.log(`[fila] Rechamada: ${ordem.senha}`)
  return res.json({ ok: true, senha: ordem.senha })
})

module.exports = router
