/**
 * services/printer.js (ft-fila-agent)
 * Lê config/printer.ini para obter porta/baudrate locais.
 * ESC/POS idêntico ao FT_FILA — adaptado para ler printer.ini.
 */

const { SerialPort }  = require('serialport')
const fs              = require('fs')
const path            = require('path')
const { bufQRRaster } = require('./qrcode')

// ── Lê config/printer.ini ─────────────────────────────────────────────────────
function readPrinterIni() {
  const iniPath = path.join(__dirname, '../../config/printer.ini')
  const defaults = { porta: 'COM3', baudRate: 115200, colunas: 48, modelo: 'Bematech_MP4200TH' }
  try {
    const content = fs.readFileSync(iniPath, 'utf8')
    const result  = { ...defaults }
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*(\w+)\s*=\s*(.+)/)
      if (!m) continue
      const [, key, val] = m
      const k = key.toLowerCase()
      if (k === 'porta')    result.porta    = val.trim()
      if (k === 'baudrate') result.baudRate = parseInt(val.trim(), 10)
      if (k === 'colunas')  result.colunas  = parseInt(val.trim(), 10)
      if (k === 'modelo')   result.modelo   = val.trim()
    }
    return result
  } catch {
    console.warn('[printer:agent] printer.ini nao encontrado — usando defaults')
    return defaults
  }
}

const cfg  = readPrinterIni()
const COLS = cfg.colunas

// ── ESC/POS constantes ────────────────────────────────────────────────────────
const ESC      = 0x1B
const GS       = 0x1D
const CENTER   = Buffer.from([ESC, 0x61, 0x01])
const LEFT     = Buffer.from([ESC, 0x61, 0x00])
const BOLD_ON  = Buffer.from([ESC, 0x45, 0x01])
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00])
const BIG_ON   = Buffer.from([ESC, 0x21, 0x30])
const BIG_OFF  = Buffer.from([ESC, 0x21, 0x00])

// Corte por modelo:
//   Bematech_MP4200TH — ESC m (0x1B 0x6D) proprietário, 10 linhas de avanço
//   ElginI9           — GS V 0 (0x1D 0x56 0x00) padrão ESC/POS, 5 linhas de avanço
const FEED_CUT = cfg.modelo === 'ElginI9'
  ? Buffer.from([ESC, 0x64, 0x05, GS, 0x56, 0x00])
  : Buffer.from([ESC, 0x64, 0x0A, ESC, 0x6D])

function txt(s)         { return Buffer.from(s + '\n', 'latin1') }
function line(ch = '-') { return txt(ch.repeat(COLS)) }

// Porta Windows (USB001, LPT1): escreve direto no device file sem serialport
function isWindowsPort(porta) {
  return /^USB\d+$/i.test(porta) || /^LPT\d+$/i.test(porta)
}

function writeToPort(data) {
  if (isWindowsPort(cfg.porta)) {
    return new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(`\\\\.\\${cfg.porta}`)
      stream.on('error', reject)
      stream.on('finish', resolve)
      stream.write(data)
      stream.end()
    })
  }
  return new Promise((resolve, reject) => {
    const sp = new SerialPort({ path: cfg.porta, baudRate: cfg.baudRate, autoOpen: false })
    let done = false
    const finish = (err) => {
      if (done) return
      done = true
      try { sp.close() } catch (_) {}
      if (err) { reject(err) } else { resolve() }
    }
    const timer = setTimeout(() => finish(new Error('Timeout: porta serial nao respondeu em 8s')), 8000)
    sp.on('error', (err) => { console.warn('[printer:agent]', err.message); finish(err) })
    sp.open((err) => {
      if (err) { clearTimeout(timer); return finish(new Error(`Nao foi possivel abrir ${cfg.porta}: ${err.message}`)) }
      sp.write(data, (err) => {
        if (err) { clearTimeout(timer); return finish(err) }
        sp.drain(() => { clearTimeout(timer); finish(null) })
      })
    })
  })
}

async function printBuf(buffers) {
  await writeToPort(Buffer.concat(buffers.filter(Boolean)))
}

/**
 * Imprime lista de separação com QR1.
 * @param {{ senha, itens, total, qr1Code }} dados
 */
async function printListaSeparacao({ senha, itens, total, qr1Code }) {
  const itensArr = typeof itens === 'string' ? JSON.parse(itens) : itens
  const hora     = new Date().toTimeString().slice(0, 5)
  const qrBuf    = await bufQRRaster(qr1Code, 6)
  const totalStr = Number(total).toFixed(2)

  const itensBufs = itensArr.flatMap(it => {
    const cod   = String(it.B1_COD  || it.codigo    || '').trim()
    const desc  = String(it.B1_DESC || it.descricao || '').substring(0, COLS - 2)
    const end_  = String(it.B1_ENDEREC || '').trim()
    const qty   = it.quantidade || it.qty || 1
    const valor = ((it.vrUnit || it.PRECO || 0) * qty).toFixed(2)
    const lines = [BOLD_ON, txt(`  ${qty}x ${desc}`), BOLD_OFF]
    if (cod)  lines.push(txt(`     Cod: ${cod}   R$ ${valor}`))
    if (end_) lines.push(txt(`     End: ${end_}`))
    lines.push(txt(''))
    return lines
  })

  await printBuf([
    CENTER, BOLD_ON, txt('FUELTECH - SEPARACAO'), BOLD_OFF,
    LEFT, line(),
    CENTER, BIG_ON, BOLD_ON, txt(senha), BOLD_OFF, BIG_OFF,
    LEFT, txt(`Hora: ${hora}`),
    line(),
    txt('ITENS:'), txt(''),
    ...itensBufs,
    line('-'),
    txt(`TOTAL:${''.padEnd(COLS - 6 - 3 - totalStr.length)}R$ ${totalStr}`),
    line(),
    CENTER, txt('Escaneie o QR apos separar:'), txt(''),
    qrBuf,
    LEFT, line(),
    FEED_CUT,
  ])
}

/**
 * Imprime etiqueta de entrega com QR2.
 * @param {{ senha, qr2Code }} dados
 */
async function printEtiquetaEntrega({ senha, qr2Code }) {
  const qrBuf = await bufQRRaster(qr2Code, 7)
  await printBuf([
    CENTER, line('='),
    BOLD_ON, txt('FUELTECH - RETIRADA'), BOLD_OFF,
    line('='), txt(''),
    txt('SENHA:'),
    BIG_ON, BOLD_ON, txt(senha), BOLD_OFF, BIG_OFF,
    txt(''), line('='),
    txt('Escaneie na entrega:'), txt(''),
    qrBuf,
    line('='),
    FEED_CUT,
  ])
}

module.exports = { printListaSeparacao, printEtiquetaEntrega }
