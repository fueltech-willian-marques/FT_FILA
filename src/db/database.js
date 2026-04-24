const Database = require('better-sqlite3')
const path     = require('path')
const fs       = require('fs')

const dataDir = path.resolve(__dirname, '../../data')
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const db = new Database(path.join(dataDir, 'fila.db'))

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS ordens (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    senha         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'NOVO',
    qr1_code      TEXT UNIQUE NOT NULL,
    qr2_code      TEXT UNIQUE NOT NULL,
    itens         TEXT NOT NULL,
    chave_nfce    TEXT,
    total         REAL,
    origem        TEXT DEFAULT 'totem',
    criado_em     TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contador_dia (
    data     TEXT PRIMARY KEY,
    proximo  INTEGER DEFAULT 1
  );
`)

// Migration: adiciona coluna operador se ainda não existir
const colunas = db.prepare(`PRAGMA table_info(ordens)`).all()
if (!colunas.find(c => c.name === 'operador')) {
  db.exec(`ALTER TABLE ordens ADD COLUMN operador INTEGER DEFAULT NULL`)
  console.log('[db] Migration: coluna operador adicionada')
}

module.exports = db
