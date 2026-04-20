const { v4: uuidv4 } = require('uuid')
const db = require('./database')

const HOJE = () => new Date().toISOString().slice(0, 10)
const AGORA = () => new Date().toISOString()

/**
 * Gera próximo número de senha do dia de forma atômica.
 * Retorna string no formato "A-042".
 */
function proximaSenha() {
  const hoje = HOJE()
  const tx = db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO contador_dia (data, proximo) VALUES (?, 1)`).run(hoje)
    const row = db.prepare(`SELECT proximo FROM contador_dia WHERE data = ?`).get(hoje)
    db.prepare(`UPDATE contador_dia SET proximo = proximo + 1 WHERE data = ?`).run(hoje)
    return row.proximo
  })
  const num = tx()
  return `A-${String(num).padStart(3, '0')}`
}

/**
 * Cria uma nova ordem e retorna { id, senha, qr1Code, qr2Code, status }.
 */
function criarOrdem({ itens, total, chaveNfce, origem }) {
  const senha   = proximaSenha()
  const qr1Code = uuidv4()
  const qr2Code = uuidv4()
  const agora   = AGORA()

  const result = db.prepare(`
    INSERT INTO ordens (senha, status, qr1_code, qr2_code, itens, chave_nfce, total, origem, criado_em, atualizado_em)
    VALUES (?, 'NOVO', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(senha, qr1Code, qr2Code, JSON.stringify(itens), chaveNfce || null, total || 0, origem || 'totem', agora, agora)

  return { id: result.lastInsertRowid, senha, qr1Code, qr2Code, status: 'NOVO' }
}

/**
 * Lista ordens ativas (status != ENTREGUE), ordenadas por criação.
 */
function listarAtivas() {
  return db.prepare(`SELECT * FROM ordens WHERE status != 'ENTREGUE' ORDER BY criado_em ASC`).all()
}

/**
 * Lista ordens para painel TV (SEPARANDO e CHAMADO).
 */
function listarTV() {
  return db.prepare(`SELECT id, senha, status FROM ordens WHERE status IN ('SEPARANDO','CHAMADO') ORDER BY criado_em ASC`).all()
}

/**
 * Busca ordem por ID.
 */
function buscarPorId(id) {
  return db.prepare(`SELECT * FROM ordens WHERE id = ?`).get(id)
}

/**
 * Atualiza status de uma ordem.
 */
function atualizarStatus(id, novoStatus) {
  const result = db.prepare(`UPDATE ordens SET status = ?, atualizado_em = ? WHERE id = ?`).run(novoStatus, AGORA(), id)
  if (result.changes === 0) throw new Error(`Ordem ${id} não encontrada`)
  return buscarPorId(id)
}

/**
 * Processa scan de QR code (QR1 ou QR2).
 * Retorna { id, senha, status, acao }.
 */
function scanQR(qrCode) {
  // Tenta QR1 (separação) — válido apenas no status SEPARANDO
  const porQR1 = db.prepare(`SELECT * FROM ordens WHERE qr1_code = ?`).get(qrCode)
  if (porQR1) {
    if (porQR1.status !== 'SEPARANDO') {
      throw new Error(`QR1 inválido: ordem ${porQR1.id} está em status ${porQR1.status}`)
    }
    atualizarStatus(porQR1.id, 'CHAMADO')
    return { id: porQR1.id, senha: porQR1.senha, status: 'CHAMADO', acao: 'chamado_na_tv', qr2Code: porQR1.qr2_code }
  }

  // Tenta QR2 (entrega) — válido apenas no status CHAMADO
  const porQR2 = db.prepare(`SELECT * FROM ordens WHERE qr2_code = ?`).get(qrCode)
  if (porQR2) {
    if (porQR2.status !== 'CHAMADO') {
      throw new Error(`QR2 inválido: ordem ${porQR2.id} está em status ${porQR2.status}`)
    }
    atualizarStatus(porQR2.id, 'ENTREGUE')
    return { id: porQR2.id, senha: porQR2.senha, status: 'ENTREGUE', acao: 'entregue' }
  }

  throw new Error('QR code não encontrado')
}

/**
 * Lista todas as ordens (admin).
 */
function listarTodas() {
  return db.prepare(`SELECT * FROM ordens ORDER BY criado_em DESC`).all()
}

/**
 * Cancela uma ordem (volta para NOVO).
 */
function cancelarOrdem(id) {
  return atualizarStatus(id, 'NOVO')
}

/**
 * Reseta o contador do dia (admin).
 */
function resetarContador() {
  db.prepare(`DELETE FROM contador_dia WHERE data = ?`).run(HOJE())
}

module.exports = { criarOrdem, listarAtivas, listarTV, buscarPorId, atualizarStatus, scanQR, listarTodas, cancelarOrdem, resetarContador }
