import { describe, expect, it } from 'vitest'
import type { Pixels } from '@/data/covers'
import { mapFableLibrary, type ImportEntry } from '@/data/import/fable'
import type { ReadingTrackerBook } from '@/data/import/readingTracker'
import { lookupEdition, titleScore, withLookup, type CoverLookupDeps, type ProbedImage } from '../scripts/fable/covers'

/**
 * Covers and Catalogue ids for imported Books (issue #17), through
 * `lookupEdition` with made-up answers in place of Apple, the German National
 * Library and Open Library: live external APIs are never called in tests.
 */

function record(fields: Partial<ReadingTrackerBook>): ReadingTrackerBook {
  return {
    id: 'rec-1',
    title: 'The Glass Orchard',
    author: 'Ada Example',
    additionalAuthors: null,
    shelf: 'want-to-read',
    isbn: null,
    isbn13: null,
    description: null,
    coverUrl: 'https://cdn.fable.co/covers/x.jpg',
    pageCount: null,
    yearPublished: '2019',
    createdAt: '2026-03-28 00:54:14',
    session: null,
    ...fields,
  }
}

const entry = (fields: Partial<ReadingTrackerBook>, lang?: 'de' | 'en'): ImportEntry =>
  mapFableLibrary([record(fields)], lang ? { books: { 'rec-1': { lang } } } : {}).entries[0]!

/** A cover-like image: two colours, so it is no blank stand-in. */
function picture(width: number, height: number): ProbedImage {
  const data = new Uint8Array(4 * 4 * 4)
  for (let i = 0; i < 16; i++) data.set(i < 8 ? [200, 40, 30, 255] : [20, 20, 60, 255], i * 4)
  return { width, height, pixels: { width: 4, height: 4, data } satisfies Pixels }
}

function blank(width: number, height: number): ProbedImage {
  return { width, height, pixels: { width: 4, height: 4, data: new Uint8Array(64).fill(240) } }
}

/** Answers by URL prefix; anything else is "not there". Records what was asked. */
function sources(json: Record<string, unknown>, images: Record<string, ProbedImage>) {
  const asked: string[] = []
  const deps: CoverLookupDeps = {
    async getJson(url) {
      asked.push(url)
      return Object.entries(json).find(([prefix]) => url.startsWith(prefix))?.[1] ?? null
    },
    async probe(url) {
      asked.push(url)
      return Object.entries(images).find(([prefix]) => url.startsWith(prefix))?.[1] ?? null
    },
  }
  return { deps, asked }
}

const ARTWORK = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/9780000000026.jpg/100x100bb.jpg'
const ARTWORK_LARGE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/9780000000026.jpg/600x900bb.jpg'

describe('lookupEdition', () => {
  it('takes the exact edition from Apple by its ISBN: an Apple Book, with its large artwork', async () => {
    const { deps, asked } = sources(
      { 'https://itunes.apple.com/lookup?isbn=9780000000026&country=us': { results: [{ trackId: 1504159680, artworkUrl100: ARTWORK, description: '<p>A blurb.</p>' }] } },
      { [ARTWORK_LARGE]: picture(600, 900) },
    )
    const book = entry({ isbn13: '9780000000026' })
    const found = await lookupEdition(book, deps)

    expect(found.apple).toEqual({ id: '1504159680', via: 'isbn', isbn13: '9780000000026', description: 'A blurb.' })
    expect(found.cover).toMatchObject({ url: ARTWORK_LARGE, source: 'apple', width: 600, height: 900 })
    expect(found.cover!.thumbhash).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(found.cover!.colors).toEqual({ dominant: expect.stringMatching(/^#[0-9a-f]{6}$/), secondary: expect.stringMatching(/^#[0-9a-f]{6}$/) })
    // Apple knows the edition: nobody else is asked, and Fable's cover never is.
    expect(asked.some((url) => url.includes('openlibrary') || url.includes('fable'))).toBe(false)

    expect(withLookup(book, found).book).toMatchObject({
      source: 'apple',
      appleId: '1504159680',
      isbn13: '9780000000026',
      coverUrl: ARTWORK_LARGE,
      coverThumbhash: found.cover!.thumbhash,
      coverColors: found.cover!.colors,
      description: 'A blurb.',
    })
  })

  it('asks the German store for a German edition, and records the German National Library cover without storing it', async () => {
    const GERMAN = 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/cc/dd/9783000000099.jpg/100x100bb.jpg'
    const { deps, asked } = sources(
      {
        'https://openlibrary.org/isbn/9783000000010.json': { key: '/books/OL123M', works: [{ key: '/works/OL9W' }] },
        'https://itunes.apple.com/search': { results: [{ trackId: 77, trackName: 'Der Fuchs im Schnee', artistName: 'Ada Example', artworkUrl100: GERMAN }] },
      },
      {
        'https://portal.dnb.de/opac/mvb/cover?isbn=9783000000010': picture(396, 599),
        'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/cc/dd/9783000000099.jpg/600x900bb.jpg': picture(600, 900),
      },
    )
    const book = entry({ title: 'Der Fuchs im Schnee', isbn13: '9783000000010' })
    expect(book.readLanguage).toBe('de')
    const found = await lookupEdition(book, deps)

    expect(asked).toContain('https://itunes.apple.com/lookup?isbn=9783000000010&country=de')
    expect(asked.some((url) => url.includes('country=us'))).toBe(false)
    // Browsers get a bot page from the DNB instead of the image: found, kept aside, never the cover.
    expect(found.dnb).toEqual({ url: 'https://portal.dnb.de/opac/mvb/cover?isbn=9783000000010', width: 396, height: 599 })
    expect(found.cover).toMatchObject({ source: 'apple', height: 900 })
    expect(found.openLibrary).toEqual({ editionKey: 'OL123M', workKey: 'OL9W' })
    // Apple's edition found by title is another edition: the Book stays the one read, known to Open Library.
    expect(withLookup(book, found).book).toMatchObject({ source: 'openlibrary', isbn13: '9783000000010', openLibraryEditionKey: 'OL123M', openLibraryWorkKey: 'OL9W', appleId: null })
  })

  it("tries the owner's pinned cover first and takes it at any size", async () => {
    const { deps } = sources({}, { 'https://example.com/pinned.jpg': picture(300, 450) })
    const book = mapFableLibrary([record({ isbn13: '9780000000026' })], { books: { 'rec-1': { coverUrl: 'https://example.com/pinned.jpg' } } }).entries[0]!
    expect((await lookupEdition(book, deps)).cover).toMatchObject({ source: 'pinned', url: 'https://example.com/pinned.jpg' })
  })

  it('finds a Book Fable knew without an ISBN by title and author, and takes that edition', async () => {
    const { deps } = sources(
      {
        'https://itunes.apple.com/search': {
          results: [
            // A study guide by someone else, and another book by the author: neither is it.
            { trackId: 1, trackName: 'Summary of The Glass Orchard', artistName: 'Quick Reads', artworkUrl100: ARTWORK },
            { trackId: 2, trackName: 'The Copper Field', artistName: 'Ada Example', artworkUrl100: ARTWORK },
            { trackId: 3, trackName: 'The Glass Orchard: A Novel', artistName: 'Ada Example', artworkUrl100: ARTWORK },
          ],
        },
      },
      { [ARTWORK_LARGE]: picture(600, 900) },
    )
    const book = entry({ isbn13: 'XqT9ab12Cd' })
    const found = await lookupEdition(book, deps)
    expect(found.apple).toMatchObject({ id: '3', via: 'search' })
    expect(withLookup(book, found).book).toMatchObject({ source: 'apple', appleId: '3', isbn13: '9780000000026' })
  })

  it('passes over blanks and thumbnails, and keeps the tallest real image when none is tall enough', async () => {
    const { deps } = sources(
      { 'https://openlibrary.org/isbn/9780000000026.json': { key: '/books/OL5M', covers: [77] } },
      {
        'https://covers.openlibrary.org/b/id/77-L.jpg': blank(500, 750),
        'https://covers.openlibrary.org/b/isbn/9780000000026-L.jpg': picture(333, 500),
      },
    )
    const found = await lookupEdition(entry({ isbn13: '9780000000026' }), deps)
    expect(found.cover).toMatchObject({ source: 'openlibrary', url: 'https://covers.openlibrary.org/b/isbn/9780000000026-L.jpg', height: 500 })
  })

  it('leaves a Book nobody knows as it was: no cover (the Placeholder cover), still an import', async () => {
    const { deps } = sources({}, {})
    const book = entry({ isbn13: '9780000000026' })
    const found = await lookupEdition(book, deps)
    expect(found).toEqual({ apple: null, openLibrary: null, cover: null, dnb: null })
    expect(withLookup(book, found).book).toMatchObject({ source: 'import', coverUrl: null, appleId: null })
  })

  it('fails instead of answering "not found" when a source cannot be asked, so nothing wrong is cached', async () => {
    const deps: CoverLookupDeps = {
      getJson: async () => {
        throw new Error('itunes.apple.com unavailable (HTTP 403)')
      },
      probe: async () => null,
    }
    await expect(lookupEdition(entry({ isbn13: '9780000000026' }), deps)).rejects.toThrow(/unavailable/)
  })
})

describe('titleScore', () => {
  it('matches the same title, a title with more after it, and a title behind a series name', () => {
    expect(titleScore('The Glass Orchard (Orchard Cycle, #1)', 'The Glass Orchard')).toBe(2)
    expect(titleScore('Glass Orchard', 'The Glass Orchard')).toBe(2)
    expect(titleScore('The Sandman Vol. 1: Preludes & Nocturnes (New Edition)', 'Preludes & Nocturnes')).toBe(2)
    expect(titleScore('The Glass Orchard Trilogy Box Set', 'The Glass Orchard')).toBe(1)
    expect(titleScore('The Copper Field', 'The Glass Orchard')).toBe(0)
  })
})
