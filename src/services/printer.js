const { SerialPort } = require('serialport')
const settings       = require('../config/settings')
const { bufQRRaster } = require('./qrcode')

const COLS = settings.impressora.colunas

// ── ESC/POS constantes ────────────────────────────────────────────────────────
const ESC      = 0x1B
const GS       = 0x1D
const CENTER   = Buffer.from([ESC, 0x61, 0x01])
const LEFT     = Buffer.from([ESC, 0x61, 0x00])
const BOLD_ON  = Buffer.from([ESC, 0x45, 0x01])
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00])
const FEED_CUT = Buffer.from([ESC, 0x64, 0x0A, GS, 0x56, 0x42, 0x00])

function txt(s)           { return Buffer.from(s + '\n', 'latin1') }
function line(ch = '-')   { return txt(ch.repeat(COLS)) }
function center(s, width) { const w = width || COLS; const pad = Math.max(0, Math.floor((w - s.length) / 2)); return txt(' '.repeat(pad) + s) }

// ── Porta serial ──────────────────────────────────────────────────────────────
let _portPromise = null

function getPort() {
  if (_portPromise) return _portPromise
  _portPromise = new Promise((resolve, reject) => {
    const port = new SerialPort({
      path:     settings.impressora.porta,
      baudRate: settings.impressora.baudRate,
      autoOpen: false,
    })
    port.open((err) => {
      if (err) { _portPromise = null; console.error('[printer] Erro ao abrir porta:', err.message); return reject(err) }
      resolve(port)
    })
  })
  return _portPromise
}

async function printBuf(buffers) {
  const port = await getPort()
  const data = Buffer.concat(buffers.filter(Boolean))
  return new Promise((resolve, reject) => {
    port.write(data, (err) => {
      if (err) return reject(err)
      port.drain(resolve)
    })
  })
}

// ── Documentos ────────────────────────────────────────────────────────────────

/**
 * Imprime lista de separação com QR1 para o operador de estoque.
 * @param {Object} ordem  - { senha, itens (JSON string), total, qr1Code }
 */
async function printListaSeparacao(ordem) {
  const { senha, itens, total, qr1Code } = ordem
  const itensArr = typeof itens === 'string' ? JSON.parse(itens) : itens
  const hora = new Date().toTimeString().slice(0, 5)
  const qrBuf = await bufQRRaster(qr1Code, 4)

  const totalStr = Number(total).toFixed(2)

  await printBuf([
    CENTER, BOLD_ON, txt('FUELTECH - SEPARACAO'), BOLD_OFF,
    LEFT, line(),
    txt(`Senha:  ${senha}`),
    txt(`Hora:   ${hora}`),
    line(),
    txt('ITENS:'),
    ...itensArr.map(it => {
      const desc  = String(it.descricao || it.B1_DESC || '').substring(0, 26).padEnd(26)
      const valor = ((it.vrUnit || it.PRECO || 0) * (it.quantidade || it.qty || 1)).toFixed(2)
      return txt(`  ${String(it.quantidade || it.qty || 1)}x ${desc} ${valor}`)
    }),
    line('-'),
    txt(`TOTAL:${''.padEnd(COLS - 6 - 3 - totalStr.length)}R$ ${totalStr}`),
    line(),
    CENTER, txt('Escaneie o QR apos separar:'),
    qrBuf,
    LEFT, line(),
    FEED_CUT,
  ])
}

/**
 * Imprime etiqueta de entrega com QR2 para colocar na sacola.
 * @param {string} senha   - ex: "A-042"
 * @param {string} qr2Code - UUID único para scan de entrega
 */
async function printEtiquetaEntrega(senha, qr2Code) {
  const qrBuf = await bufQRRaster(qr2Code, 5)

  await printBuf([
    CENTER,
    line('='),
    BOLD_ON, txt('FUELTECH - RETIRADA'), BOLD_OFF,
    line('='),
    txt(''),
    txt(`        SENHA:  ${senha}`),
    txt(''),
    line('='),
    txt('Escaneie na entrega:'),
    qrBuf,
    line('='),
    FEED_CUT,
  ])
}

module.exports = { printListaSeparacao, printEtiquetaEntrega, getPort }
