const { Pool }  = require('pg')
const settings  = require('../config/settings')

const pool = new Pool({ connectionString: settings.postgres.url })

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ordens (
      id            SERIAL PRIMARY KEY,
      senha         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'NOVO',
      qr1_code      TEXT UNIQUE NOT NULL,
      qr2_code      TEXT UNIQUE NOT NULL,
      itens         TEXT NOT NULL,
      chave_nfce    TEXT,
      total         NUMERIC(10,2) DEFAULT 0,
      origem        TEXT DEFAULT 'totem',
      operador      INTEGER,
      criado_em     TIMESTAMPTZ NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contador_dia (
      data    TEXT PRIMARY KEY,
      proximo INTEGER NOT NULL DEFAULT 1
    )
  `)
  console.log('[db] PostgreSQL conectado — tabelas ordens e contador_dia verificadas')
}

module.exports = { pool, init }
