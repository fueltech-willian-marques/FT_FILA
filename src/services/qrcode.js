const QRCode = require('qrcode')

/**
 * Gera buffer ESC/POS GS v 0 (raster) a partir de um texto/UUID.
 * Compatível com Bematech MP-4200 TH.
 * @param {string} text  - UUID ou URL a codificar
 * @param {number} scale - pixels por módulo do QR (padrão 4)
 */
async function bufQRRaster(text, scale = 4) {
  const qr   = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const size  = qr.modules.size
  const data  = qr.modules.data   // Uint8Array: 1 = módulo escuro

  const scaledSize   = size * scale
  const bytesPerRow  = Math.ceil(scaledSize / 8)
  const raster       = Buffer.alloc(bytesPerRow * scaledSize, 0)

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (data[row * size + col]) {
        for (let sr = 0; sr < scale; sr++) {
          for (let sc = 0; sc < scale; sc++) {
            const pr      = row * scale + sr
            const pc      = col * scale + sc
            const byteIdx = pr * bytesPerRow + Math.floor(pc / 8)
            raster[byteIdx] |= (1 << (7 - (pc % 8)))
          }
        }
      }
    }
  }

  // Comando GS v 0: modo normal (0x00), xL xH yL yH + raster
  const xL = bytesPerRow & 0xFF
  const xH = (bytesPerRow >> 8) & 0xFF
  const yL = scaledSize & 0xFF
  const yH = (scaledSize >> 8) & 0xFF

  return Buffer.concat([
    Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]),
    raster,
  ])
}

module.exports = { bufQRRaster }
