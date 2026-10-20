import { readFileSync } from 'node:fs'
import { rgbaToThumbHash } from 'thumbhash'
import { describe, expect, it } from 'vitest'
import {
  bookColour,
  calmColour,
  CLOTHS,
  MAX_LIGHTNESS,
  MAX_SATURATION,
  MIN_INK_CONTRAST,
  MIN_LIGHTNESS,
  SHELF_INK,
  SHELF_PAPER,
  thumbhashAverage,
} from '../app/utils/bookColour'
import { clothOf } from '#layers/ui/app/utils/cloth'

/**
 * The owner's rule for Your shelf (utils/bookColour.ts): one colour per Book,
 * its cover's most common one, inside guard rails so the pile looks like a
 * bookcase and the type on the Spine and the back always reads.
 */

const hsl = (hex: string): [number, number, number] => {
  const value = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6
  return [h, s, l]
}

/** Inside the guard rails: saturation, lightness (a hair for rounding to #rrggbb), a readable ink. */
function expectCalm(result: { colour: string; ink: string; contrast: number }) {
  const [, s, l] = hsl(result.colour)
  expect(s).toBeLessThanOrEqual(MAX_SATURATION + 0.01)
  expect(l).toBeGreaterThanOrEqual(MIN_LIGHTNESS - 0.01)
  expect(l).toBeLessThanOrEqual(MAX_LIGHTNESS + 0.01)
  expect([SHELF_INK, SHELF_PAPER]).toContain(result.ink)
  expect(result.contrast).toBeGreaterThanOrEqual(MIN_INK_CONTRAST)
}

describe('calmColour: the guard rails', () => {
  it('turns pure white into a pale cloth with dark ink', () => {
    const white = calmColour('#ffffff')
    expectCalm(white)
    expect(white.colour).toBe('#d6d6d6')
    expect(white.ink).toBe(SHELF_INK)
  })

  it('turns pure black into a near-black with paper ink', () => {
    const black = calmColour('#000000')
    expectCalm(black)
    expect(black.colour).toBe('#242424')
    expect(black.ink).toBe(SHELF_PAPER)
  })

  it('moves a mid grey, on which neither ink reads, out of the middle band', () => {
    const grey = calmColour('#808080')
    expectCalm(grey)
    // Still a grey, just far enough from the middle for dark ink.
    expect(hsl(grey.colour)[1]).toBe(0)
    expect(grey.colour).not.toBe('#808080')
  })

  it('tames a vivid neon cover without changing its hue', () => {
    const neon = calmColour('#39ff14')
    expectCalm(neon)
    expect(hsl(neon.colour)[0]).toBeCloseTo(hsl('#39ff14')[0], 2)
    expect(hsl(neon.colour)[1]).toBeLessThanOrEqual(MAX_SATURATION + 0.01)
    const pink = calmColour('#ff00ff')
    expectCalm(pink)
    expect(hsl(pink.colour)[0]).toBeCloseTo(hsl('#ff00ff')[0], 2)
  })

  it('keeps a calm colour as it is', () => {
    expect(calmColour('#1d3b5a').colour).toBe('#1d3b5a')
    expect(calmColour('#e8dcc0').colour).toBe('#e8dcc0')
    for (const hex of ['#ffffff', '#000000', '#808080', '#39ff14', '#c0392b']) {
      const once = calmColour(hex).colour
      expect(calmColour(once).colour).toBe(once)
    }
  })

  it('reads on every colour there is: a sweep of hues, saturations and lightnesses', () => {
    for (let r = 0; r <= 255; r += 51) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
          expectCalm(calmColour(hex))
        }
      }
    }
  })
})

/** Twelve real-looking covers' most common colours (the contact sheet's, docs/plans/shelf-for-everyone.md). */
const COVERS = [
  { title: 'Dune', dominant: '#e2a04a' },
  { title: 'The Left Hand of Darkness', dominant: '#f4f1ea' },
  { title: 'Piranesi', dominant: '#1f3f5b' },
  { title: 'Klara and the Sun', dominant: '#f6c90e' },
  { title: 'Project Hail Mary', dominant: '#0b0b0d' },
  { title: 'The Midnight Library', dominant: '#14254a' },
  { title: 'Normal People', dominant: '#7fb6a4' },
  { title: 'Circe', dominant: '#c56b2a' },
  { title: 'Never Let Me Go', dominant: '#8a8a88' },
  { title: 'Neon Gods', dominant: '#ff1fa8' },
  { title: 'Tomorrow, and Tomorrow, and Tomorrow', dominant: '#2ec4f1' },
  { title: 'The Overstory', dominant: '#3d6b35' },
]

describe('bookColour: where the colour comes from', () => {
  const book = (over: Partial<Parameters<typeof bookColour>[0]> = {}) => ({
    title: 'Piranesi',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/a.jpg/600x900bb.jpg',
    coverColors: { dominant: '#1F3F5B', secondary: '#d9c9a3' },
    coverThumbhash: null,
    ...over,
  })

  it('takes the cover\'s most common colour', () => {
    const colour = bookColour(book())
    expect(colour.source).toBe('cover')
    expect(colour.raw).toBe('#1f3f5b')
    expect(colour.colour).toBe('#1f3f5b')
    expect(colour.ink).toBe(SHELF_PAPER)
  })

  it('falls back to the thumbhash\'s average for a cover stored without colours', () => {
    // A thumbhash of a plain terracotta image: its average is that colour.
    const pixels = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.set([0xc0, 0x5a, 0x3c, 255], i)
    const hash = btoa(String.fromCharCode(...rgbaToThumbHash(16, 16, pixels)))
    const average = thumbhashAverage(hash)!
    const colour = bookColour(book({ coverColors: null, coverThumbhash: hash }))
    expect(colour.source).toBe('thumbhash')
    expect(colour.raw).toBe(average)
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(average.slice(i, i + 2), 16))
    expect(Math.abs(r! - 0xc0)).toBeLessThan(12)
    expect(Math.abs(g! - 0x5a)).toBeLessThan(12)
    expect(Math.abs(b! - 0x3c)).toBeLessThan(12)
  })

  it('takes the Placeholder cover\'s cloth for a Book without a cover, by title, stable', () => {
    const colour = bookColour(book({ coverUrl: null }))
    expect(colour.source).toBe('cloth')
    expect(colour.raw).toBe(CLOTHS[clothOf('Piranesi') - 1])
    expect(bookColour(book({ coverUrl: null })).colour).toBe(colour.colour)
    // A cover without colours or thumbhash: the cloth too (what shows until it loads).
    expect(bookColour(book({ coverColors: null })).source).toBe('cloth')
    // A broken thumbhash is no colour.
    expect(bookColour(book({ coverColors: null, coverThumbhash: '!!' })).source).toBe('cloth')
  })

  it('keeps every one of twelve real-looking covers inside the guard rails', () => {
    for (const cover of COVERS) {
      expectCalm(bookColour(book({ title: cover.title, coverColors: { dominant: cover.dominant, secondary: '#000000' } })))
    }
  })

  it('uses the cloths the tokens define', () => {
    const tokens = JSON.parse(readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8')) as Record<string, Record<string, { $value?: string }>>
    const cloths = Object.values(tokens).flatMap((group) => [1, 2, 3, 4, 5, 6].map((n) => group[`cloth${n}`]?.$value)).filter(Boolean)
    expect(cloths).toEqual([...CLOTHS])
  })
})
