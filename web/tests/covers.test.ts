import { thumbHashToRGBA } from 'thumbhash'
import { describe, expect, it } from 'vitest'
import { coverColors, describeCover, resolveCover, type Pixels } from '@/data/covers'

/**
 * Resolving a Cover when its Book enters the Catalogue: the thumbhash shown
 * while it loads and the two colours of its light, from the image's pixels.
 */

/** A cover painted in bands: `[colour, share]`, top to bottom. */
function painted(width: number, height: number, bands: [[number, number, number], number][]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  const rows = bands.flatMap(([rgb, share]) => Array.from({ length: Math.round(height * share) }, () => rgb))
  for (let y = 0; y < height; y++) {
    const rgb = rows[Math.min(y, rows.length - 1)]!
    for (let x = 0; x < width; x++) data.set([...rgb, 255], (y * width + x) * 4)
  }
  return { width, height, data }
}

describe('a cover\'s colours', () => {
  it('are the most common colour and the most common clearly different one', () => {
    const navyWithCream = painted(40, 60, [
      [[24, 40, 82], 0.7],
      [[230, 214, 170], 0.3],
    ])
    expect(coverColors(navyWithCream)).toEqual({ dominant: '#182852', secondary: '#e6d6aa' })
  })

  it('fall back to a darker shade on a cover of one colour', () => {
    expect(coverColors(painted(10, 15, [[[200, 100, 50], 1]]))).toEqual({ dominant: '#c86432', secondary: '#783c1e' })
  })
})

describe('describing a cover', () => {
  it('gives a thumbhash that decodes back to the cover\'s proportions and colour', () => {
    const { thumbhash, colors } = describeCover(painted(66, 100, [[[24, 40, 82], 1]]))
    const decoded = thumbHashToRGBA(Uint8Array.from(atob(thumbhash), (c) => c.charCodeAt(0)))

    expect(decoded.w).toBeLessThan(decoded.h) // portrait, like the cover
    expect(Math.abs(decoded.rgba[0]! - 24)).toBeLessThan(16)
    expect(colors.dominant).toBe('#182852')
  })

  it('adds the Book without one when the image cannot be read', async () => {
    expect(await resolveCover('https://example.test/cover.jpg', async () => Promise.reject(new Error('CORS')))).toBeNull()
    expect(await resolveCover('https://example.test/cover.jpg', () => new Promise(() => {}), 20)).toBeNull()
    expect(await resolveCover(null, async () => painted(1, 1, [[[0, 0, 0], 1]]))).toBeNull()
  })
})
