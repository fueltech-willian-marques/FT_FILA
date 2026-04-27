const { v4: uuidv4 } = require('uuid')
const { pool }       = require('./database')

const HOJE  = () => new Date().toISOString().slice(0, 10)
const AGORA = () => new Date().toISOString()

// QR codes sem hífen — evita problema de layout de teclado no scanner HID
const qrId = () => uuidv4().replace(/-/g, '')

/**
 * Gera próximo número de senha do dia de forma atômica (transação PG).
 */
async function proximaSenha() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO contador_dia (data, proximo) VALUES ($1, 1) ON CONFLICT (data) DO NOTHING`,
      [HOJE()]
    )
    const { rows: [row] } = await client.query(
      `SELECT proximo FROM contador_dia WHERE data = $1 FOR UPDATE`,
      [HOJE()]
    )
    await client.query(
      `UPDATE contador_dia SET proximo = proximo + 1 WHERE data = $1`,
      [HOJE()]
    )
    await client.query('COMMIT')
    return `A-${String(row.proximo).padStart(3, '0')}`
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function criarOrdem({ itens, total, chaveNfce, origem }) {
  const senha   = await proximaSenha()
  const qr1Code = qrId()
  const qr2Code = qrId()
  const agora   = AGORA()

  const { rows: [row] } = await pool.query(
    `INSERT INTO ordens (senha, status, qr1_code, qr2_code, itens, chave_nfce, total, origem, criado_em, atualizado_em)
     VALUES ($1, 'NOVO', $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING id`,
    [senha, qr1Code, qr2Code, JSON.stringify(itens), chaveNfce || null, total || 0, origem || 'totem', agora]
  )

  return { id: row.id, senha, qr1Code, qr2Code, status: 'NOVO' }
}

async function listarAtivas() {
  const { rows } = await pool.query(
    `SELECT * FROM ordens WHERE status != 'ENTREGUE' ORDER BY criado_em ASC`
  )
  return rows
}

async function listarTV() {
  const { rows } = await pool.query(
    `SELECT id, senha, status FROM ordens WHERE status IN ('SEPARANDO','CHAMADO') ORDER BY criado_em ASC`
  )
  return rows
}

async function buscarPorId(id) {
  const { rows: [row] } = await pool.query(`SELECT * FROM ordens WHERE id = $1`, [id])
  return row || null
}

async function atualizarStatus(id, novoStatus) {
  const { rowCount } = await pool.query(
    `UPDATE ordens SET status = $1, atualizado_em = $2 WHERE id = $3`,
    [novoStatus, AGORA(), id]
  )
  if (rowCount === 0) throw new Error(`Ordem ${id} não encontrada`)
  return buscarPorId(id)
}

async function scanQR(qrCode) {
  const { rows: [porQR1] } = await pool.query(
    `SELECT * FROM ordens WHERE qr1_code = $1`, [qrCode]
  )
  if (porQR1) {
    if (porQR1.status !== 'SEPARANDO')
      throw new Error(`QR1 inválido: ordem ${porQR1.id} está em status ${porQR1.status}`)
    await atualizarStatus(porQR1.id, 'CHAMADO')
    return { id: porQR1.id, senha: porQR1.senha, status: 'CHAMADO', acao: 'chamado_na_tv', qr2Code: porQR1.qr2_code, operador: porQR1.operador }
  }

  const { rows: [porQR2] } = await pool.query(
    `SELECT * FROM ordens WHERE qr2_code = $1`, [qrCode]
  )
  if (porQR2) {
    if (porQR2.status !== 'CHAMADO')
      throw new Error(`QR2 inválido: ordem ${porQR2.id} está em status ${porQR2.status}`)
    await atualizarStatus(porQR2.id, 'ENTREGUE')
    return { id: porQR2.id, senha: porQR2.senha, status: 'ENTREGUE', acao: 'entregue' }
  }

  throw new Error('QR code não encontrado')
}

async function listarTodas() {
  const { rows } = await pool.query(`SELECT * FROM ordens ORDER BY criado_em DESC`)
  return rows
}

async function cancelarOrdem(id) {
  const { rowCount } = await pool.query(
    `UPDATE ordens SET status = 'NOVO', operador = NULL, atualizado_em = $1 WHERE id = $2`,
    [AGORA(), id]
  )
  if (rowCount === 0) throw new Error(`Ordem ${id} não encontrada`)
  return buscarPorId(id)
}

async function atribuirOperador(id, operador) {
  await pool.query(
    `UPDATE ordens SET operador = $1, status = 'SEPARANDO', atualizado_em = $2 WHERE id = $3`,
    [operador, AGORA(), id]
  )
  return buscarPorId(id)
}

async function proximaOrdemNova() {
  const { rows: [row] } = await pool.query(
    `SELECT * FROM ordens WHERE status = 'NOVO' AND operador IS NULL ORDER BY criado_em ASC LIMIT 1`
  )
  return row || null
}

async function ordemDoOperador(operador) {
  const { rows: [row] } = await pool.query(
    `SELECT * FROM ordens WHERE status = 'SEPARANDO' AND operador = $1 LIMIT 1`,
    [operador]
  )
  return row || null
}

async function contarNaFila() {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ordens WHERE status = 'NOVO' AND operador IS NULL`
  )
  return row.total
}

async function resetarContador() {
  await pool.query(`DELETE FROM contador_dia WHERE data = $1`, [HOJE()])
}

async function limparTudo() {
  await pool.query(`DELETE FROM ordens`)
  await pool.query(`DELETE FROM contador_dia`)
}

async function buscarPorQr2(qr2Code) {
  const { rows: [row] } = await pool.query(
    `SELECT id, senha, status, criado_em FROM ordens WHERE qr2_code = $1`,
    [qr2Code]
  )
  return row || null
}

module.exports = {
  criarOrdem, listarAtivas, listarTV, buscarPorId, atualizarStatus,
  scanQR, listarTodas, cancelarOrdem, resetarContador, atribuirOperador,
  proximaOrdemNova, ordemDoOperador, contarNaFila, limparTudo, buscarPorQr2,
}
