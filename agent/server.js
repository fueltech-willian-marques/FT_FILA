/**
 * ft-fila-agent — Agente local de impressão para painéis FT_FILA
 *
 * Recebe chamadas POST do browser (expedicao.html / entrega.html)
 * e envia ESC/POS para a impressora serial local.
 *
 * Porta: 4002 (localhost apenas)
 * config/printer.ini define a porta COM e baudrate.
 */

const express    = require('express')
const cors       = require('cors')
const printRouter = require('./src/routes/print')

const app  = express()
const PORT = process.env.PORT || 4002

app.use(cors({ origin: '*' }))
app.use(express.json({ limit: '64kb' }))

// Log de requisições
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  next()
})

app.use('/print', printRouter)

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) })
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n╔═══════════════════════════════════════╗`)
  console.log(`║  FT_FILA Agent — http://localhost:${PORT}  ║`)
  console.log(`╚═══════════════════════════════════════╝\n`)
})
