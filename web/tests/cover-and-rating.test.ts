import { describe, expect, it } from 'vitest'
import { rgbaToThumbHash } from 'thumbhash'
import { formatAuthors } from '@/utils/books'
import { CLOTH_COUNT, NEUTRAL_GLOW, clothOf, glowOf, thumbhashDataUrl } from '@/utils/cover'
import { ratingText, starFills } from '@/utils/rating'

describe('a rating', () => {
  it.each([
    [1, '0.25'],
    [15, '3.75'],
    [16, '4.00'],
    [20, '5.00'],
  ])('%i quarters reads %s', (quarters, text) => {
    expect(ratingText(quarters)).toBe(text)
  })

  it('reads nothing when unrated', () => {
    expect(ratingText(null)).toBe('')
  })

  it('fills whole stars, then the quarter of the next star’s shape', () => {
    const fills = starFills(15) // 3.75
    expect(fills.slice(0, 3)).toEqual([1, 1, 1])
    expect(fills[3]).toBeCloseTo((3.4 + 17.2 * 0.75) / 24)
    expect(fills[4]).toBe(0)
    expect(starFills(null)).toEqual([0, 0, 0, 0, 0])
    expect(starFills(20)).toEqual([1, 1, 1, 1, 1])
  })
})

describe('a cover', () => {
  it('gets the same cloth for the same title, one of six', () => {
    expect(clothOf('The Dispossessed')).toBe(clothOf('The Dispossessed'))
    const cloths = new Set(['A', 'B', 'C', 'Dune', 'Ruin', 'Kindred', 'Piranesi', 'Beloved'].map(clothOf))
    for (const cloth of cloths) expect(cloth).toBeGreaterThanOrEqual(1)
    for (const cloth of cloths) expect(cloth).toBeLessThanOrEqual(CLOTH_COUNT)
    expect(cloths.size).toBeGreaterThan(1)
  })

  it('glows in its most colourful tone, lifted to lamp brightness', () => {
    // A white cover with an indigo figure glows indigo, not grey.
    const glow = glowOf({ dominant: '#f4f4f2', secondary: '#2b2f8f' })
    const [r, g, b] = glow.a.split(' ').map(Number)
    expect(b).toBeGreaterThan(r!)
    expect(b).toBeGreaterThan(g!)
    expect(glowOf(null)).toEqual(NEUTRAL_GLOW)
  })

  it('turns a stored thumbhash into an image to show while loading', () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(200)
    const hash = btoa(String.fromCharCode(...rgbaToThumbHash(4, 4, rgba)))
    expect(thumbhashDataUrl(hash)).toMatch(/^data:image\/png;base64,/)
    expect(thumbhashDataUrl(null)).toBeNull()
    expect(thumbhashDataUrl('***')).toBeNull()
  })
})

describe('authors on one line', () => {
  it.each([
    [[], ''],
    [['Ursula K. Le Guin'], 'Ursula K. Le Guin'],
    [['Terry Pratchett', 'Neil Gaiman'], 'Terry Pratchett & Neil Gaiman'],
    [['Ann Leckie', 'A', 'B'], 'Ann Leckie et al.'],
  ])('%j → %s', (authors, line) => {
    expect(formatAuthors(authors, 'et al.')).toBe(line)
  })
})
