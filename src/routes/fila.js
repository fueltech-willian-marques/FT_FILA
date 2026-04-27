const express  = require('express')
const ordens   = require('../db/ordens')
const { getIO } = require('../socket')

function emitPrint(tipo, dados) {
  const io   = getIO()
  const sala = tipo === 'etiqueta' ? 'entrega' : 'expedicao'
  io?.to(sala).emit('fila:imprimir', { tipo, dados })
  console.log(`[fila] Evento fila:imprimir tipo='${tipo}' → sala '${sala}'`)
}

const router = express.Router()

// ── POST /api/fila — cria nova ordem ─────────────────────────────────────────
router.post('/', async (req, res) => {
  const { itens, total, chaveNfce, origem } = req.body
  if (!itens) return res.status(400).json({ ok: false, error: 'itens obrigatório' })

  try {
    const ordem = await ordens.criarOrdem({ itens, total, chaveNfce, origem: origem || 'totem' })
    getIO()?.emit('fila:nova', { filaId: ordem.id, senha: ordem.senha, itens, total })
    return res.status(201).json({ ok: true, filaId: ordem.id, senha: ordem.senha, qr2Code: ordem.qr2Code })
  } catch (err) {
    console.error('[fila] Erro ao criar ordem:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila — ordens ativas ────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    return res.json(await ordens.listarAtivas())
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila/tv — SEPARANDO e CHAMADO (painel TV) ───────────────────────
router.get('/tv', async (_req, res) => {
  try {
    return res.json(await ordens.listarTV())
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila/todas — todas as ordens (admin) ────────────────────────────
router.get('/todas', async (_req, res) => {
  try {
    return res.json(await ordens.listarTodas())
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ATENÇÃO: rotas específicas ANTES das parametrizadas (/:id) — ordem importa no Express

// ── POST /api/fila/scan — processa leitura de QR code ───────────────────────
router.post('/scan', async (req, res) => {
  const { qrCode } = req.body
  if (!qrCode) return res.status(400).json({ ok: false, error: 'qrCode obrigatório' })

  try {
    const result = await ordens.scanQR(qrCode)

    const io = getIO()
    if (result.status === 'CHAMADO') {
      io?.emit('fila:atualizada', { filaId: result.id, senha: result.senha, status: 'CHAMADO' })
      const ordem = await ordens.buscarPorId(result.id)
      emitPrint('etiqueta', { senha: result.senha, qr2Code: ordem.qr2_code })
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
router.get('/status', async (_req, res) => {
  try {
    const ativas = (await ordens.listarAtivas()).length
    return res.json({ ok: true, ativos: ativas, porta: process.env.PORT || 4100 })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/reset-contador ────────────────────────────────────────────
router.post('/reset-contador', async (req, res) => {
  try {
    await ordens.resetarContador()
    return res.json({ ok: true, msg: 'Contador do dia resetado' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/limpar-tudo ───────────────────────────────────────────────
router.post('/limpar-tudo', async (req, res) => {
  try {
    await ordens.limparTudo()
    getIO()?.emit('fila:atualizada', { reset: true })
    return res.json({ ok: true, msg: 'Todas as ordens removidas e contador zerado' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── GET /api/fila/fila-count ─────────────────────────────────────────────────
router.get('/fila-count', async (_req, res) => {
  try {
    return res.json({ ok: true, total: await ordens.contarNaFila() })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/operador/:n/proximo ───────────────────────────────────────
router.post('/operador/:n/proximo', async (req, res) => {
  const n = parseInt(req.params.n)
  if (!n || n < 1) return res.status(400).json({ ok: false, error: 'Operador inválido' })

  try {
    let ordem = await ordens.ordemDoOperador(n)
    if (ordem) return res.json({ ok: true, ordem })

    const proxima = await ordens.proximaOrdemNova()
    if (!proxima) return res.json({ ok: true, ordem: null })

    await ordens.atribuirOperador(proxima.id, n)
    ordem = await ordens.buscarPorId(proxima.id)

    emitPrint('lista', { senha: ordem.senha, itens: ordem.itens, total: ordem.total, qr1Code: ordem.qr1_code })

    getIO()?.emit('fila:atualizada', { filaId: ordem.id, senha: ordem.senha, status: 'SEPARANDO', operador: n })
    return res.json({ ok: true, ordem })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/:id/imprimir-lista ────────────────────────────────────────
router.post('/:id/imprimir-lista', async (req, res) => {
  const id = parseInt(req.params.id)
  const ordem = await ordens.buscarPorId(id)
  if (!ordem) return res.status(404).json({ ok: false, error: 'Ordem não encontrada' })

  emitPrint('lista', { senha: ordem.senha, itens: ordem.itens, total: ordem.total, qr1Code: ordem.qr1_code })
  await ordens.atualizarStatus(id, 'SEPARANDO')
  getIO()?.emit('fila:atualizada', { filaId: id, senha: ordem.senha, status: 'SEPARANDO' })
  return res.json({ ok: true, status: 'SEPARANDO' })
})

// ── GET /api/fila/view/:token — status da ordem (somente leitura, para cliente) ─
router.get('/view/:token', async (req, res) => {
  const { token } = req.params
  try {
    const ordem = await ordens.buscarPorQr2(token)
    if (!ordem) return res.status(404).json({ ok: false, error: 'Senha não encontrada' })
    return res.json({ ok: true, senha: ordem.senha, status: ordem.status, criadoEm: ordem.criado_em })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/:id/cancelar ──────────────────────────────────────────────
router.post('/:id/cancelar', async (req, res) => {
  const id = parseInt(req.params.id)
  try {
    const ordem = await ordens.cancelarOrdem(id)
    getIO()?.emit('fila:atualizada', { filaId: id, senha: ordem.senha, status: 'NOVO' })
    return res.json({ ok: true, status: 'NOVO' })
  } catch (err) {
    if (err.message.includes('não encontrada')) return res.status(404).json({ ok: false, error: err.message })
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// ── POST /api/fila/:id/rechamar ──────────────────────────────────────────────
router.post('/:id/rechamar', async (req, res) => {
  const id = parseInt(req.params.id)
  const ordem = await ordens.buscarPorId(id)
  if (!ordem) return res.status(404).json({ ok: false, error: 'Ordem não encontrada' })
  getIO()?.emit('fila:rechamada', { filaId: id, senha: ordem.senha })
  console.log(`[fila] Rechamada: ${ordem.senha}`)
  return res.json({ ok: true, senha: ordem.senha })
})

module.exports = router
