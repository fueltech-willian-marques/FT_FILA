// Usa banco em memória para não poluir data/fila.db
const Database = require('better-sqlite3')

let db
let ordens

beforeEach(() => {
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
  ordens = require('../src/db/ordens')
})

afterEach(() => { db.close() })

test('criarOrdem retorna senha no formato A-NNN', () => {
  const o = ordens.criarOrdem({ itens: [], total: 10, chaveNfce: null, origem: 'totem' })
  expect(o.senha).toMatch(/^A-\d{3}$/)
  expect(o.status).toBe('NOVO')
  expect(o.qr1Code).toBeTruthy()
  expect(o.qr2Code).toBeTruthy()
})

test('contador incrementa corretamente no mesmo dia', () => {
  const o1 = ordens.criarOrdem({ itens: [], total: 1, chaveNfce: null, origem: 'totem' })
  const o2 = ordens.criarOrdem({ itens: [], total: 2, chaveNfce: null, origem: 'totem' })
  expect(o1.senha).toBe('A-001')
  expect(o2.senha).toBe('A-002')
})

test('listarAtivas retorna apenas NOVO e SEPARANDO', () => {
  const o = ordens.criarOrdem({ itens: [], total: 5, chaveNfce: null, origem: 'totem' })
  ordens.atualizarStatus(o.id, 'ENTREGUE')
  const ativas = ordens.listarAtivas()
  expect(ativas.find(x => x.id === o.id)).toBeUndefined()
})

test('scanQR com qr1_code avança para CHAMADO', () => {
  const o = ordens.criarOrdem({ itens: [], total: 5, chaveNfce: null, origem: 'totem' })
  ordens.atualizarStatus(o.id, 'SEPARANDO')
  const result = ordens.scanQR(o.qr1Code)
  expect(result.status).toBe('CHAMADO')
  expect(result.acao).toBe('chamado_na_tv')
})

test('scanQR com qr2_code avança para ENTREGUE', () => {
  const o = ordens.criarOrdem({ itens: [], total: 5, chaveNfce: null, origem: 'totem' })
  ordens.atualizarStatus(o.id, 'CHAMADO')
  const result = ordens.scanQR(o.qr2Code)
  expect(result.status).toBe('ENTREGUE')
  expect(result.acao).toBe('entregue')
})

test('scanQR com QR desconhecido lança erro', () => {
  expect(() => ordens.scanQR('uuid-invalido')).toThrow('QR code não encontrado')
})

test('atualizarStatus lança erro para ID inexistente', () => {
  expect(() => ordens.atualizarStatus(9999, 'CHAMADO')).toThrow('Ordem 9999 não encontrada')
})

test('scanQR com qr1_code em status errado lança erro', () => {
  const o = ordens.criarOrdem({ itens: [], total: 5, chaveNfce: null, origem: 'totem' })
  // Status NOVO — ainda não está SEPARANDO
  expect(() => ordens.scanQR(o.qr1Code)).toThrow(/QR1 inválido/)
})

test('scanQR com qr2_code em status errado lança erro', () => {
  const o = ordens.criarOrdem({ itens: [], total: 5, chaveNfce: null, origem: 'totem' })
  ordens.atualizarStatus(o.id, 'SEPARANDO')
  // Status SEPARANDO — ainda não está CHAMADO
  expect(() => ordens.scanQR(o.qr2Code)).toThrow(/QR2 inválido/)
})
