const fs   = require('fs')
const path = require('path')

const iniPath = path.resolve(__dirname, '../../config/fila.ini')
const raw     = fs.readFileSync(iniPath, 'utf8')

function parseIni(content) {
  const result = {}
  let section  = '_'
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';')) continue
    const secMatch = trimmed.match(/^\[(.+)\]$/)
    if (secMatch) { section = secMatch[1].toLowerCase(); result[section] = result[section] || {}; continue }
    const kvMatch  = trimmed.match(/^([^=]+)=(.*)$/)
    if (kvMatch) result[section][kvMatch[1].trim().toLowerCase()] = kvMatch[2].trim()
  }
  return result
}

const cfg = parseIni(raw)

module.exports = {
  servidor: {
    porta: parseInt(cfg.servidor?.porta || '4100'),
  },
  impressora: {
    porta:         cfg.impressora?.porta         || 'COM3',
    baudRate:      parseInt(cfg.impressora?.baudrate || '115200'),
    colunas:       parseInt(cfg.impressora?.colunas  || '48'),
    printProxyUrl: cfg.impressora?.printproxyurl || '',
  },
}
