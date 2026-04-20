const express  = require('express')
const ordens   = require('../db/ordens')
const printer  = require('../services/printer')
const { getIO } = require('../socket')  // singleton Socket.IO — criado na Task 8

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
      // Imprime etiqueta QR2 automaticamente
      const ordem = ordens.buscarPorId(result.id)
      printer.printEtiquetaEntrega(result.senha, ordem.qr2_code).catch(e =>
        console.warn('[printer] Etiqueta QR2 falhou:', e.message)
      )
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

// ── POST /api/fila/:id/imprimir-lista — imprime lista + muda para SEPARANDO ──
router.post('/:id/imprimir-lista', async (req, res) => {
  const id = parseInt(req.params.id)
  const ordem = ordens.buscarPorId(id)
  if (!ordem) return res.status(404).json({ ok: false, error: 'Ordem não encontrada' })

  try {
    await printer.printListaSeparacao({
      senha:   ordem.senha,
      itens:   ordem.itens,
      total:   ordem.total,
      qr1Code: ordem.qr1_code,
    })
    ordens.atualizarStatus(id, 'SEPARANDO')
    getIO()?.emit('fila:atualizada', { filaId: id, senha: ordem.senha, status: 'SEPARANDO' })
    return res.json({ ok: true, status: 'SEPARANDO' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
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

module.exports = router
