/**
 * routes/print.js (ft-fila-agent)
 *
 * POST /print/lista    — imprime lista de separação + QR1 na impressora local
 * POST /print/etiqueta — imprime etiqueta de entrega + QR2 na impressora local
 */

const express = require('express')
const { printListaSeparacao, printEtiquetaEntrega } = require('../services/printer')

const router = express.Router()

// POST /print/lista
// Body: { senha, itens, total, qr1Code }
router.post('/lista', async (req, res) => {
  const { senha, itens, total, qr1Code } = req.body
  if (!senha || !itens || total === undefined || !qr1Code) {
    return res.status(400).json({ ok: false, error: 'senha, itens, total e qr1Code obrigatórios' })
  }
  try {
    await printListaSeparacao({ senha, itens, total, qr1Code })
    return res.json({ ok: true })
  } catch (err) {
    console.error('[print] Erro lista:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

// POST /print/etiqueta
// Body: { senha, qr2Code }
router.post('/etiqueta', async (req, res) => {
  const { senha, qr2Code } = req.body
  if (!senha || !qr2Code) {
    return res.status(400).json({ ok: false, error: 'senha e qr2Code obrigatórios' })
  }
  try {
    await printEtiquetaEntrega({ senha, qr2Code })
    return res.json({ ok: true })
  } catch (err) {
    console.error('[print] Erro etiqueta:', err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
