const { SerialPort } = require('serialport')
const http           = require('http')
const settings       = require('../config/settings')
const { bufQRRaster } = require('./qrcode')

const COLS = settings.impressora.colunas

// ── ESC/POS constantes ────────────────────────────────────────────────────────
const ESC      = 0x1B
const CENTER   = Buffer.from([ESC, 0x61, 0x01])
const LEFT     = Buffer.from([ESC, 0x61, 0x00])
const BOLD_ON  = Buffer.from([ESC, 0x45, 0x01])
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00])
const BIG_ON   = Buffer.from([ESC, 0x21, 0x30])   // duplo W+H (bits 4+5)
const BIG_OFF  = Buffer.from([ESC, 0x21, 0x00])
// ESC d 10 (feed) + ESC m (corte Bematech) — NÃO usar GS V B que imprime "VB" como texto
const FEED_CUT = Buffer.from([ESC, 0x64, 0x0A, ESC, 0x6D])

function txt(s)           { return Buffer.from(s + '\n', 'latin1') }
function line(ch = '-')   { return txt(ch.repeat(COLS)) }
function center(s, width) { const w = width || COLS; const pad = Math.max(0, Math.floor((w - s.length) / 2)); return txt(' '.repeat(pad) + s) }

// ── Porta serial — abre/escreve/fecha por job (compatível com compartilhamento) ──
function writeToPort(data, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const sp = new SerialPort({
      path:     settings.impressora.porta,
      baudRate: settings.impressora.baudRate,
      autoOpen: false,
    })
    let done = false
    const finish = (err) => {
      if (done) return
      done = true
      try { sp.close() } catch (_) {}
      if (err) reject(err)
      else     resolve()
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    sp.on('error', (err) => { console.warn('[printer:fila] Erro assíncrono:', err.message); finish(err) })
    sp.open((err) => {
      if (err) { clearTimeout(timer); return finish(new Error(`Impressora: não foi possível abrir ${settings.impressora.porta} — ${err.message}`)) }
      sp.write(data, (err) => {
        if (err) { clearTimeout(timer); return finish(new Error(`Impressora: erro ao escrever — ${err.message}`)) }
        sp.drain(() => { clearTimeout(timer); finish(null) })
      })
    })
  })
}

/**
 * Envia buffer via proxy HTTP ao FT_PDV (compartilhamento de porta serial).
 * Usado quando PrintProxyUrl está configurado no fila.ini.
 */
function sendViaProxy(buf, proxyUrl) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ buf: buf.toString('base64') })
    const url  = new URL('/api/printer/raw', proxyUrl)
    const opts = {
      hostname: url.hostname,
      port:     parseInt(url.port) || 80,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }
    const req = http.request(opts, (res) => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end',  () => {
        if (res.statusCode === 200) resolve()
        else reject(new Error(`Proxy impressão falhou (${res.statusCode}): ${data}`))
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(new Error('Proxy impressão: timeout')) })
    req.write(body)
    req.end()
  })
}

async function printBuf(buffers) {
  const buf      = Buffer.concat(buffers.filter(Boolean))
  const proxyUrl = settings.impressora.printProxyUrl
  if (proxyUrl) {
    await sendViaProxy(buf, proxyUrl)
  } else {
    await writeToPort(buf)
  }
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
  const qrBuf = await bufQRRaster(qr1Code, 6)   // QR maior: scale 4→6

  const totalStr = Number(total).toFixed(2)

  const itensBufs = itensArr.flatMap(it => {
    const cod    = String(it.B1_COD  || it.codigo      || '').trim()
    const desc   = String(it.B1_DESC || it.descricao   || '').substring(0, COLS - 2)
    const end_   = String(it.B1_ENDEREC || '').trim()
    const qty    = it.quantidade || it.qty || 1
    const valor  = ((it.vrUnit || it.PRECO || 0) * qty).toFixed(2)
    const lines  = [BOLD_ON, txt(`  ${qty}x ${desc}`), BOLD_OFF]
    if (cod)  lines.push(txt(`     Cod: ${cod}   R$ ${valor}`))
    if (end_) lines.push(txt(`     End: ${end_}`))
    lines.push(txt(''))
    return lines
  })

  await printBuf([
    CENTER, BOLD_ON, txt('FUELTECH - SEPARACAO'), BOLD_OFF,
    LEFT, line(),
    // Senha em destaque
    CENTER, BIG_ON, BOLD_ON, txt(senha), BOLD_OFF, BIG_OFF,
    LEFT, txt(`Hora: ${hora}`),
    line(),
    txt('ITENS:'),
    txt(''),
    ...itensBufs,
    line('-'),
    txt(`TOTAL:${''.padEnd(COLS - 6 - 3 - totalStr.length)}R$ ${totalStr}`),
    line(),
    CENTER, txt('Escaneie o QR apos separar:'),
    txt(''),
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
  const qrBuf = await bufQRRaster(qr2Code, 7)   // QR maior: scale 5→7

  await printBuf([
    CENTER,
    line('='),
    BOLD_ON, txt('FUELTECH - RETIRADA'), BOLD_OFF,
    line('='),
    txt(''),
    txt('SENHA:'),
    BIG_ON, BOLD_ON, txt(senha), BOLD_OFF, BIG_OFF,   // senha em fonte dupla
    txt(''),
    line('='),
    txt('Escaneie na entrega:'),
    txt(''),
    qrBuf,
    line('='),
    FEED_CUT,
  ])
}

module.exports = { printListaSeparacao, printEtiquetaEntrega }
