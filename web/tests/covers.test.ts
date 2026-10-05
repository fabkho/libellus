import { thumbHashToRGBA } from 'thumbhash'
import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import {
  coverColors,
  coverVerdict,
  describeCover,
  isPlaceholderImage,
  MIN_COVER_SIDE,
  resolveBookCover,
  resolveCover,
  type Pixels,
  type ProbedImage,
} from '@/data/covers'

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

// ------------------------------------------------------------ the cover chain

/** A cover-like image: navy with a cream title band, at its own size. */
function image(width: number, height: number): ProbedImage {
  return {
    width,
    height,
    pixels: painted(20, 30, [
      [[24, 40, 82], 0.7],
      [[230, 214, 170], 0.3],
    ]),
  }
}

/** A blank stand-in: one flat grey. */
const blank = (width: number, height: number): ProbedImage => ({ width, height, pixels: painted(20, 30, [[[200, 200, 200], 1]]) })

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication116/v4/2c/2e/b4/1031214040.jpg/600x900bb.jpg'
const APPLE_BY_ISBN = 'https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/8d/3a/b4/9783641264864.jpg/100x100bb.jpg'

function book(overrides: Partial<BookSnapshot>): BookSnapshot {
  return {
    title: 'Piranesi',
    authors: ['Susanna Clarke'],
    isbn13: '9783641264864',
    isbn10: null,
    pageCount: null,
    year: 2020,
    language: null,
    publisher: null,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: '1',
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

/** A probe answering from a table of probe URLs; anything else is a 404. Remembers what it read. */
function probes(table: Record<string, ProbedImage | 'hang' | 'error'>) {
  const read: string[] = []
  const probe = async (url: string) => {
    read.push(url)
    const answer = table[url]
    if (answer === 'hang') return new Promise<never>(() => {})
    if (answer === 'error') throw new Error('offline')
    return answer ?? null
  }
  return Object.assign(probe, { read })
}

describe('which images will do as a Cover', () => {
  it('not one too small, nor one of a single flat colour', () => {
    expect(coverVerdict(image(200, 300))).toBe('ok')
    expect(coverVerdict(image(MIN_COVER_SIDE - 1, 300))).toBe('tooSmall')
    expect(coverVerdict(image(1, 1))).toBe('tooSmall')
    expect(coverVerdict(blank(400, 600))).toBe('placeholder')
    expect(isPlaceholderImage(painted(10, 15, [[[200, 100, 50], 1]]))).toBe(true)
  })
})

describe('resolving a Cover when a Book enters the Catalogue', () => {
  it('takes the Apple artwork, large, read from a smaller copy', async () => {
    const probe = probes({ [APPLE.replace('600x900bb', '300x450bb')]: image(300, 450) })
    const cover = await resolveBookCover(book({ coverUrl: APPLE }), { probe })
    expect(cover.coverUrl).toBe(APPLE)
    expect(cover.coverThumbhash).toBeTruthy()
    expect(cover.coverColors).toEqual({ dominant: '#182852', secondary: '#e6d6aa' })
    expect(probe.read).toHaveLength(1)
  })

  it('passes over artwork too small, and asks Apple for the edition by ISBN', async () => {
    const probe = probes({
      [APPLE.replace('600x900bb', '300x450bb')]: image(100, 150),
      [APPLE_BY_ISBN.replace('100x100bb', '300x450bb')]: image(300, 450),
    })
    const asked: string[] = []
    const cover = await resolveBookCover(book({ coverUrl: APPLE }), {
      probe,
      lookupAppleIsbn: async (isbn) => (asked.push(isbn), { coverUrl: APPLE_BY_ISBN }),
    })
    expect(asked).toEqual(['9783641264864'])
    expect(cover.coverUrl).toBe(APPLE_BY_ISBN.replace('100x100bb', '600x900bb'))
  })

  it('goes on to OpenLibrary by cover id, then by ISBN, passing over placeholders', async () => {
    const byId = 'https://covers.openlibrary.org/b/id/15155469-L.jpg'
    const byIsbn = 'https://covers.openlibrary.org/b/isbn/9783641264864-L.jpg?default=false'
    const probe = probes({
      'https://covers.openlibrary.org/b/id/15155469-M.jpg': blank(180, 270),
      'https://covers.openlibrary.org/b/isbn/9783641264864-M.jpg?default=false': image(180, 270),
    })
    const cover = await resolveBookCover(book({ source: 'openlibrary', appleId: null, coverUrl: byId }), {
      probe,
      lookupAppleIsbn: async () => null,
    })
    expect(probe.read).toEqual([
      'https://covers.openlibrary.org/b/id/15155469-M.jpg',
      'https://covers.openlibrary.org/b/isbn/9783641264864-M.jpg?default=false',
    ])
    expect(cover.coverUrl).toBe(byIsbn)
    expect(cover.coverThumbhash).toBeTruthy()
  })

  it('falls back to the Placeholder cover when no image will do', async () => {
    const cover = await resolveBookCover(book({ coverUrl: APPLE }), {
      probe: probes({ [APPLE.replace('600x900bb', '300x450bb')]: blank(300, 450) }),
      lookupAppleIsbn: async () => {
        throw new Error('offline')
      },
    })
    expect(cover).toEqual({ coverUrl: null, coverThumbhash: null, coverColors: null })
  })

  it('keeps its own image without the blur when it only could not be read in time', async () => {
    const cover = await resolveBookCover(book({ coverUrl: APPLE, isbn13: null }), {
      probe: probes({ [APPLE.replace('600x900bb', '300x450bb')]: 'hang' }),
      budgetMs: 30,
    })
    expect(cover).toEqual({ coverUrl: APPLE, coverThumbhash: null, coverColors: null })
  })
})
