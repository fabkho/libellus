import { describe, expect, it } from 'vitest'
import { createBookCovers, type AppleIsbnLookup } from '@/data/bookCovers'
import type { Book, BookSnapshot } from '@/data/books'
import { MIN_COVER_SIDE, PREFERRED_COVER_SIDE, type Pixels, type ProbedImage } from '@/data/covers'

/**
 * The Cover chain behind one door (data/bookCovers.ts): the order of the
 * sources, the low-resolution image kept as the fallback, the stray pixel and
 * the flat stand-in passed over, an own cover kept when it cannot be read, and
 * Apple asked once, only for an ISBN. Pure and network-free: the probe is a
 * table of URLs, Apple's lookup is a fake that remembers its arguments.
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

/** A cover-like image: navy with a cream title band. */
const image = (width: number, height: number): ProbedImage => ({
  width,
  height,
  pixels: painted(20, 30, [
    [[24, 40, 82], 0.7],
    [[230, 214, 170], 0.3],
  ]),
})

/** A blank stand-in: one flat grey. */
const blank = (width: number, height: number): ProbedImage => ({ width, height, pixels: painted(20, 30, [[[200, 200, 200], 1]]) })

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication116/v4/2c/2e/b4/1031214040.jpg/600x900bb.jpg'
const APPLE_PROBED = APPLE.replace('600x900bb', '300x450bb')
const APPLE_BY_ISBN = 'https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/8d/3a/b4/9783641264864.jpg/100x100bb.jpg'
const APPLE_BY_ISBN_PROBED = APPLE_BY_ISBN.replace('100x100bb', '300x450bb')
const APPLE_BY_ISBN_LARGE = APPLE_BY_ISBN.replace('100x100bb', '600x900bb')
const OL_BY_ID = 'https://covers.openlibrary.org/b/id/15155469-L.jpg'
const OL_BY_ISBN = 'https://covers.openlibrary.org/b/isbn/9783641264864-L.jpg?default=false'
const OWN_HTTPS = 'https://my.shelf.example/own-copy.jpg'

function book(overrides: Partial<BookSnapshot> = {}): BookSnapshot {
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

/** A Book already in the Catalogue: same snapshot plus its id. */
function catalogued(snapshot: BookSnapshot): Book {
  return { ...snapshot, id: 'b-1', createdAt: '2026-01-01T00:00:00.000Z' }
}

/** A probe answering from a table of probe URLs, in order; anything else is a 404. Remembers what it read. */
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

/** Apple's lookup: remembers every ISBN it was asked for, answers from the table. */
function appleIsbn(table: Record<string, string | null> = {}) {
  const asked: string[] = []
  const lookup: AppleIsbnLookup = async (isbn13) => {
    asked.push(isbn13)
    const coverUrl = table[isbn13]
    return coverUrl ? { ...book({ isbn13 }), coverUrl } : null
  }
  return Object.assign(lookup, { asked })
}

describe('the order of the cover chain', () => {
  it('takes the Apple artwork first, read from a smaller copy, and asks nothing else', async () => {
    const probe = probes({ [APPLE_PROBED]: image(300, 450) })
    const lookup = appleIsbn({ '9783641264864': APPLE_BY_ISBN })
    const cover = await createBookCovers({ probe, lookupAppleIsbn: lookup }).resolveCatalogue(book({ coverUrl: APPLE }))

    expect(cover.coverUrl).toBe(APPLE)
    expect(cover.coverThumbhash).toBeTruthy()
    expect(cover.coverColors).toEqual({ dominant: '#182852', secondary: '#e6d6aa' })
    expect(probe.read).toEqual([APPLE_PROBED])
    expect(lookup.asked).toEqual([])
  })

  it('goes Apple artwork → Apple by ISBN → OpenLibrary by ISBN, passing over what will not do', async () => {
    const probe = probes({
      [APPLE_PROBED]: image(20, 30),
      [APPLE_BY_ISBN_PROBED]: blank(300, 450),
      [OL_BY_ID]: blank(330, 500),
      [OL_BY_ISBN]: image(330, 500),
    })
    const lookup = appleIsbn({ '9783641264864': APPLE_BY_ISBN })
    const cover = await createBookCovers({ probe, lookupAppleIsbn: lookup }).resolveCatalogue(
      book({ coverUrl: APPLE, openLibraryEditionKey: null }),
    )

    // The Book's own address is Apple's, so the third step (OpenLibrary by the cover id it came with) has
    // nothing to try; the other three are walked in their order, one reading at a time.
    expect(probe.read).toEqual([APPLE_PROBED, APPLE_BY_ISBN_PROBED, OL_BY_ISBN])
    expect(lookup.asked).toEqual(['9783641264864'])
    expect(cover.coverUrl).toBe(OL_BY_ISBN)
    expect(cover.coverThumbhash).toBeTruthy()
    expect(cover.coverColors).toEqual({ dominant: '#182852', secondary: '#e6d6aa' })
  })

  it('takes an OpenLibrary cover by the id the Book came with, at the size it keeps', async () => {
    const probe = probes({ [OL_BY_ID]: image(330, 500) })
    const lookup = appleIsbn({})
    const cover = await createBookCovers({ probe, lookupAppleIsbn: lookup }).resolveCatalogue(
      book({ source: 'openlibrary', appleId: null, coverUrl: OL_BY_ID }),
    )

    // No Apple artwork of its own, so Apple is asked for the edition by ISBN first, and finds nothing.
    expect(lookup.asked).toEqual(['9783641264864'])
    expect(probe.read).toEqual([OL_BY_ID])
    expect(cover.coverUrl).toBe(OL_BY_ID)
    expect(cover.coverThumbhash).toBeTruthy()
  })
})

describe('what the chain passes over', () => {
  it('skips a stray pixel and a flat stand-in, and goes on looking', async () => {
    const probe = probes({
      [APPLE_PROBED]: image(MIN_COVER_SIDE - 1, 450),
      [APPLE_BY_ISBN_PROBED]: blank(300, 450),
      [OL_BY_ISBN]: image(330, 500),
    })
    const cover = await createBookCovers({ probe, lookupAppleIsbn: appleIsbn({ '9783641264864': APPLE_BY_ISBN }) }).resolveCatalogue(
      book({ coverUrl: APPLE }),
    )

    expect(probe.read).toEqual([APPLE_PROBED, APPLE_BY_ISBN_PROBED, OL_BY_ISBN])
    expect(cover.coverUrl).toBe(OL_BY_ISBN)
  })

  it('keeps a low-resolution cover as the fallback while the chain goes on, and takes the better one', async () => {
    const probe = probes({
      [APPLE_PROBED]: image(PREFERRED_COVER_SIDE - 1, 450),
      [APPLE_BY_ISBN_PROBED]: image(300, 450),
    })
    const cover = await createBookCovers({ probe, lookupAppleIsbn: appleIsbn({ '9783641264864': APPLE_BY_ISBN }) }).resolveCatalogue(
      book({ coverUrl: APPLE }),
    )

    // Both were read: the low one did not stop the chain.
    expect(probe.read).toEqual([APPLE_PROBED, APPLE_BY_ISBN_PROBED])
    expect(cover.coverUrl).toBe(APPLE_BY_ISBN_LARGE)
    expect(cover.coverThumbhash).toBeTruthy()
  })

  it('comes back to the low-resolution cover when nothing better turns up', async () => {
    const probe = probes({ [APPLE_PROBED]: image(100, 150) })
    const cover = await createBookCovers({ probe }).resolveCatalogue(book({ coverUrl: APPLE, isbn13: null }))

    expect(cover.coverUrl).toBe(APPLE)
    expect(cover.coverThumbhash).toBeTruthy()
    expect(cover.coverColors).toEqual({ dominant: '#182852', secondary: '#e6d6aa' })
  })

  it('gives the Placeholder cover when no image will do', async () => {
    const cover = await createBookCovers({
      probe: probes({ [APPLE_PROBED]: blank(300, 450) }),
      lookupAppleIsbn: async () => {
        throw new Error('offline')
      },
    }).resolveCatalogue(book({ coverUrl: APPLE }))

    expect(cover).toEqual({ coverUrl: null, coverThumbhash: null, coverColors: null })
  })
})

describe('the Book it is given', () => {
  it('asks for Apple\'s edition once, only when the Book has an ISBN', async () => {
    const withIsbn = appleIsbn({})
    await createBookCovers({ probe: probes({}), lookupAppleIsbn: withIsbn }).resolveCatalogue(book({ isbn13: null }))
    expect(withIsbn.asked).toEqual([])

    const withoutIsbn = appleIsbn({})
    await createBookCovers({ probe: probes({}), lookupAppleIsbn: withoutIsbn }).resolveCatalogue(book())
    expect(withoutIsbn.asked).toEqual(['9783641264864'])
  })

  it('resolves a Book already in the Catalogue to the Cover it has, without reading anything', async () => {
    const probe = probes({ [APPLE_PROBED]: image(300, 450) })
    const lookup = appleIsbn({})
    const kept = catalogued(book({ coverUrl: APPLE, coverThumbhash: 'hash', coverColors: { dominant: '#000000', secondary: '#111111' } }))
    const cover = await createBookCovers({ probe, lookupAppleIsbn: lookup }).resolveCatalogue(kept)

    expect(cover).toEqual({ coverUrl: APPLE, coverThumbhash: 'hash', coverColors: { dominant: '#000000', secondary: '#111111' } })
    expect(probe.read).toEqual([])
    expect(lookup.asked).toEqual([])
  })

  it('keeps its own image without the blur when it only could not be read in time', async () => {
    const cover = await createBookCovers({ probe: probes({ [APPLE_PROBED]: 'hang' }), budgetMs: 30 }).resolveCatalogue(
      book({ coverUrl: APPLE, isbn13: null }),
    )

    expect(cover).toEqual({ coverUrl: APPLE, coverThumbhash: null, coverColors: null })
  })
})

describe('the Cover of her own edition', () => {
  it('keeps an arbitrary https image she gave, read for its thumbhash and colours', async () => {
    const probe = probes({ [OWN_HTTPS]: image(200, 300) })
    const cover = await createBookCovers({ probe, lookupAppleIsbn: appleIsbn({}) }).resolveOwn(book({ coverUrl: OWN_HTTPS }))

    expect(probe.read).toEqual([OWN_HTTPS])
    expect(cover.coverUrl).toBe(OWN_HTTPS)
    expect(cover.coverThumbhash).toBeTruthy()
    expect(cover.coverColors).toEqual({ dominant: '#182852', secondary: '#e6d6aa' })
  })

  it('keeps that image without thumbhash or colours when it cannot be read or times out', async () => {
    const unreadable = await createBookCovers({ probe: probes({ [OWN_HTTPS]: 'error' }) }).resolveOwn(book({ coverUrl: OWN_HTTPS }))
    expect(unreadable).toEqual({ coverUrl: OWN_HTTPS, coverThumbhash: null, coverColors: null })

    const slow = await createBookCovers({ probe: probes({ [OWN_HTTPS]: 'hang' }), budgetMs: 30 }).resolveOwn(book({ coverUrl: OWN_HTTPS }))
    expect(slow).toEqual({ coverUrl: OWN_HTTPS, coverThumbhash: null, coverColors: null })
  })

  it('falls back to the chain, and so to the Placeholder cover, without an image of hers', async () => {
    const probe = probes({ [OL_BY_ISBN]: image(330, 500) })
    const lookup = appleIsbn({})
    const cover = await createBookCovers({ probe, lookupAppleIsbn: lookup }).resolveOwn(book({ coverUrl: null }))

    expect(probe.read).toEqual([OL_BY_ISBN])
    expect(lookup.asked).toEqual(['9783641264864'])
    expect(cover.coverUrl).toBe(OL_BY_ISBN)

    const none = await createBookCovers({ probe: probes({}), lookupAppleIsbn: appleIsbn({}) }).resolveOwn(book({ coverUrl: null }))
    expect(none).toEqual({ coverUrl: null, coverThumbhash: null, coverColors: null })
  })
})

describe('one address, verified', () => {
  it('will do at ok and at low resolution, with its thumbhash and colours', async () => {
    const ok = await createBookCovers({ probe: probes({ [APPLE_PROBED]: image(300, 450) }) }).verifyAddress(APPLE)
    expect(ok?.coverUrl).toBe(APPLE)
    expect(ok?.coverThumbhash).toBeTruthy()

    const low = await createBookCovers({ probe: probes({ [OWN_HTTPS]: image(100, 150) }) }).verifyAddress(OWN_HTTPS)
    expect(low?.coverUrl).toBe(OWN_HTTPS)
    expect(low?.coverThumbhash).toBeTruthy()
  })

  it('is no cover at all when the image is one flat colour or a stray pixel', async () => {
    expect(await createBookCovers({ probe: probes({ [OWN_HTTPS]: blank(300, 450) }) }).verifyAddress(OWN_HTTPS)).toBeNull()
    expect(await createBookCovers({ probe: probes({ [OWN_HTTPS]: image(MIN_COVER_SIDE - 1, 450) }) }).verifyAddress(OWN_HTTPS)).toBeNull()
  })

  it('is kept without thumbhash or colours when it could not be read, and null when there is nothing there', async () => {
    expect(await createBookCovers({ probe: probes({ [OWN_HTTPS]: 'hang' }), budgetMs: 30 }).verifyAddress(OWN_HTTPS)).toEqual({
      coverUrl: OWN_HTTPS,
      coverThumbhash: null,
      coverColors: null,
    })
    // A budget of its own, per address, as `resolveCatalogue` has one for the whole chain.
    expect(await createBookCovers({ probe: probes({ [OWN_HTTPS]: 'hang' }) }).verifyAddress(OWN_HTTPS, 30)).toEqual({
      coverUrl: OWN_HTTPS,
      coverThumbhash: null,
      coverColors: null,
    })
    expect(await createBookCovers({ probe: probes({}) }).verifyAddress(OWN_HTTPS)).toBeNull()
  })
})
