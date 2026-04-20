const request  = require('supertest')
const Database = require('better-sqlite3')

let app, db

beforeEach(() => {
  // Banco em memória
  db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE ordens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      senha TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'NOVO',
      qr1_code TEXT UNIQUE NOT NULL, qr2_code TEXT UNIQUE NOT NULL,
      itens TEXT NOT NULL, chave_nfce TEXT, total REAL,
      origem TEXT DEFAULT 'totem', criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
    );
    CREATE TABLE contador_dia (data TEXT PRIMARY KEY, proximo INTEGER DEFAULT 1);
  `)
  jest.resetModules()
  jest.doMock('../src/db/database', () => db)
  jest.doMock('../src/services/printer', () => ({
    printListaSeparacao: jest.fn().mockResolvedValue(),
    printEtiquetaEntrega: jest.fn().mockResolvedValue(),
  }))

  const express = require('express')
  const server = express()
  server.use(express.json())
  server.use('/api/fila', require('../src/routes/fila'))
  app = server
})

afterEach(() => { db.close() })

test('POST /api/fila cria ordem e retorna senha', async () => {
  const res = await request(app)
    .post('/api/fila')
    .send({ itens: [{ descricao: 'PRODUTO A', quantidade: 1, vrUnit: 10 }], total: 10, origem: 'totem' })
  expect(res.status).toBe(201)
  expect(res.body.ok).toBe(true)
  expect(res.body.senha).toBe('A-001')
  expect(res.body.filaId).toBeGreaterThan(0)
  expect(res.body.qr2Code).toBeTruthy()
})

test('GET /api/fila retorna ordens ativas', async () => {
  await request(app).post('/api/fila').send({ itens: [], total: 5, origem: 'totem' })
  const res = await request(app).get('/api/fila')
  expect(res.status).toBe(200)
  expect(res.body.length).toBe(1)
})

test('POST /api/fila/scan com QR1 avança para CHAMADO', async () => {
  const criar = await request(app).post('/api/fila').send({ itens: [], total: 5, origem: 'totem' })
  // Buscar qr1_code do banco diretamente
  const ordem = db.prepare('SELECT * FROM ordens WHERE id = ?').get(criar.body.filaId)
  // Setar status SEPARANDO manualmente
  db.prepare("UPDATE ordens SET status = 'SEPARANDO' WHERE id = ?").run(ordem.id)

  const res = await request(app).post('/api/fila/scan').send({ qrCode: ordem.qr1_code })
  expect(res.status).toBe(200)
  expect(res.body.status).toBe('CHAMADO')
  expect(res.body.acao).toBe('chamado_na_tv')
})

test('POST /api/fila/scan com QR2 avança para ENTREGUE', async () => {
  const criar = await request(app).post('/api/fila').send({ itens: [], total: 5, origem: 'totem' })
  const ordem = db.prepare('SELECT * FROM ordens WHERE id = ?').get(criar.body.filaId)
  db.prepare("UPDATE ordens SET status = 'CHAMADO' WHERE id = ?").run(ordem.id)

  const res = await request(app).post('/api/fila/scan').send({ qrCode: ordem.qr2_code })
  expect(res.status).toBe(200)
  expect(res.body.status).toBe('ENTREGUE')
})

test('POST /api/fila/scan com QR desconhecido retorna 404', async () => {
  const res = await request(app).post('/api/fila/scan').send({ qrCode: 'uuid-invalido' })
  expect(res.status).toBe(404)
})

test('GET /api/fila/status retorna ok', async () => {
  const res = await request(app).get('/api/fila/status')
  expect(res.status).toBe(200)
  expect(res.body.ok).toBe(true)
})
