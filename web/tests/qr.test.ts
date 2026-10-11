import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { QR_QUIET_ZONE, qrCode } from '@/utils/qr'
import { followLink } from '@/data/social'

/**
 * The follow link as a QR code (social v2b, utils/qr.ts). The code is read back the way a phone reads it: its
 * path is drawn into pixels (the same path the SVG carries, with the quiet zone, dark on light and, for the
 * dark theme's inverted tile, the same pixels), and zxing-wasm, already the app's barcode reader, decodes them.
 */

const SCALE = 6

/** The path's dark modules as the pixels of a picture, `dark` modules black on white. */
function pixelsOf(path: string, size: number, invert = false): ImageData {
  const side = (size + QR_QUIET_ZONE * 2) * SCALE
  const data = new Uint8ClampedArray(side * side * 4).fill(invert ? 0 : 255)
  const paint = (x: number, y: number) => {
    for (let dy = 0; dy < SCALE; dy++)
      for (let dx = 0; dx < SCALE; dx++) {
        const i = (((y + QR_QUIET_ZONE) * SCALE + dy) * side + (x + QR_QUIET_ZONE) * SCALE + dx) * 4
        data[i] = data[i + 1] = data[i + 2] = invert ? 255 : 0
        data[i + 3] = 255
      }
  }
  for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) for (let k = 0; k < Number(run); k++) paint(Number(x) + k, Number(y))
  // The alpha of the background too.
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  return { data, width: side, height: side, colorSpace: 'srgb' } as ImageData
}

async function decode(image: ImageData) {
  const found = await readBarcodes(image, { formats: ['QRCode'], tryInvert: false, maxNumberOfSymbols: 1 })
  return found.map((f) => f.text)
}

beforeAll(async () => {
  await prepareZXingModule({
    overrides: { wasmBinary: readFileSync(new URL('../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url)) },
    fireImmediately: true,
  })
})

const LINK = followLink('https://libellus.fabkho.dev', 'aB3dE5gH7jK9mN2pQ4rS6t')

describe('the follow link as a QR code', () => {
  it('reads back as the link', async () => {
    const code = qrCode(LINK)
    expect(await decode(pixelsOf(code.path, code.size))).toEqual([LINK])
  })

  it('stays small: a version 3 to 5 code for a link of this length, a grid of modules the size says', () => {
    const code = qrCode(LINK)
    expect(LINK.length).toBeGreaterThan(40)
    expect(code.version).toBeGreaterThanOrEqual(3)
    expect(code.version).toBeLessThanOrEqual(5)
    expect(code.size).toBe(17 + 4 * code.version)
  })

  it('reads with the colours swapped, as the dark theme draws the tile (light paper, dark modules is the same picture)', async () => {
    const code = qrCode(LINK)
    // A code drawn light on dark: some readers need `tryInvert`, which is why the dark tile is not drawn that way.
    const inverted = await readBarcodes(pixelsOf(code.path, code.size, true), { formats: ['QRCode'], tryInvert: true, maxNumberOfSymbols: 1 })
    expect(inverted.map((f) => f.text)).toEqual([LINK])
  })

  it('is another code for another link (a renewed link changes it), and the same one for the same link', () => {
    const renewed = followLink('https://libellus.fabkho.dev', 'zZ9yY8xX7wW6vV5uU4tT3s')
    expect(qrCode(renewed).path).not.toBe(qrCode(LINK).path)
    expect(qrCode(LINK).path).toBe(qrCode(LINK).path)
  })

  it('keeps a long link whole', async () => {
    const long = `https://libellus.example/f/${'x'.repeat(120)}`
    const code = qrCode(long)
    expect(await decode(pixelsOf(code.path, code.size))).toEqual([long])
  })
})
