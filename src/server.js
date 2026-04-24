const express    = require('express')
const http       = require('http')
const path       = require('path')
const { Server } = require('socket.io')
const settings   = require('./config/settings')
const { setIO }  = require('./socket')

// Inicializa banco (cria tabelas se não existir)
require('./db/database')

const app    = express()
const server = http.createServer(app)
const io     = new Server(server, { cors: { origin: '*' } })

setIO(io)

// Middlewares
app.use(express.json())
// Desativa cache nos HTML para garantir atualização imediata nos painéis
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    }
  }
}))

// Rotas
app.use('/api/fila', require('./routes/fila'))

// Redireciona raiz para expedição
app.get('/', (_req, res) => res.redirect('/expedicao.html'))

// Socket.IO — log de conexões
io.on('connection', (socket) => {
  console.log(`[ws] Cliente conectado: ${socket.id}`)

  // Painéis emitem 'join-room' com 'expedicao' ou 'entrega' ao carregar
  socket.on('join-room', (room) => {
    if (['expedicao', 'entrega'].includes(room)) {
      socket.join(room)
      console.log(`[ws] ${socket.id} entrou na sala '${room}'`)
    }
  })

  socket.on('disconnect', () => console.log(`[ws] Cliente desconectado: ${socket.id}`))
})

const PORT = settings.servidor.porta
server.listen(PORT, () => {
  console.log(`[FT_FILA] Rodando em http://localhost:${PORT}`)
  console.log(`[FT_FILA] Painéis:`)
  console.log(`  Expedição : http://localhost:${PORT}/expedicao.html`)
  console.log(`  TV Senhas : http://localhost:${PORT}/tv.html`)
  console.log(`  Entrega   : http://localhost:${PORT}/entrega.html`)
  console.log(`  Admin     : http://localhost:${PORT}/admin.html`)
})
