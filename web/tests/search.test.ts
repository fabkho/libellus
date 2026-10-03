import { describe, expect, it } from 'vitest'
import { isbn10To13, parseBookKey, parseIsbn, type Book, type BookSnapshot } from '@/data/books'
import type { CatalogueSearch } from '@/data/catalogueSearch'
import type { LibraryEntry } from '@/data/library'
import { matchQuality, MATCH, mergeResults, normalise, workKey, type Found } from '@/data/merge'
import { cleanTitle, OPENLIBRARY_FIELDS, snapshotFromOpenLibrary } from '@/data/openLibrary'
import {
  appleArtwork,
  createSearch,
  isAbort,
  isbnFromArtwork,
  plainText,
  splitAuthors,
  storefrontsFor,
  type FetchLike,
  type SearchOutcome,
} from '@/data/search'
import { appleAnswer } from './support/apple'
import { openLibraryAnswer } from './support/openLibrary'

/**
 * The search repository on recorded responses: Apple Books
 * (tests/fixtures/apple, recorded 2 Oct 2026) and OpenLibrary
 * (tests/fixtures/openlibrary, recorded 3 Oct 2026). The live APIs are never
 * called: every request goes to `recorded`, which answers with the recording
 * and remembers what was asked. The Catalogue is a stand-in here; the real one
 * is driven against the local stack in catalogue.test.ts.
 */

type Recorded = FetchLike & { asked: URL[] }

/** `failing`: Apple storefronts (`us`, `gb`, `de`) or `openlibrary` that answer 503. */
function recorded(options: { failing?: string[]; hold?: Promise<void>; holdOnly?: 'apple' | 'openlibrary' } = {}): Recorded {
  const asked: URL[] = []
  const fetch = (async (input: string, init?: { signal?: AbortSignal }) => {
    const url = new URL(input)
    asked.push(url)
    const apple = url.hostname === 'itunes.apple.com'
    if (!apple && url.hostname !== 'openlibrary.org') throw new Error(`Unexpected request to ${url.hostname}`)
    if (options.hold && (!options.holdOnly || options.holdOnly === (apple ? 'apple' : 'openlibrary'))) {
      await Promise.race([
        options.hold,
        new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
        ),
      ])
    }
    const name = apple ? url.searchParams.get('country')! : 'openlibrary'
    if (options.failing?.includes(name)) return { ok: false, status: 503, json: async () => ({}) }
    const body = apple ? appleAnswer(url) : openLibraryAnswer(url)
    return { ok: true, status: 200, json: async () => body }
  }) as Recorded
  fetch.asked = asked
  return fetch
}

const appleAsks = (fetch: Recorded) => fetch.asked.filter((url) => url.hostname === 'itunes.apple.com')
const openLibraryAsks = (fetch: Recorded) => fetch.asked.filter((url) => url.hostname === 'openlibrary.org')

/** A Catalogue Book as the database returns it. */
function catalogueBook(overrides: Partial<Book> = {}): Book {
  return {
    id: '0f8e4a52-3c1b-4d2e-9a7f-5b6c7d8e9f00',
    createdAt: '2026-10-01T12:00:00Z',
    title: 'Piranesi',
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: 'Bloomsbury',
    description: null,
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Publication116/v4/2c/2e/b4/1031214040.jpg/600x900bb.jpg',
    coverThumbhash: '1QcSHQRnh493V4dIh4eXh1h4kJUI',
    coverColors: { dominant: '#2a4a6e', secondary: '#d8c8a0' },
    source: 'apple',
    appleId: '1504159680',
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

/** A stand-in Catalogue answering with `books` (or failing), and remembering what it was asked. */
function catalogue(books: Book[] | 'failing', hold?: Promise<void>): CatalogueSearch & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async search(query, signal) {
      asked.push(query)
      if (hold) await hold
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      if (books === 'failing') throw new Error('The database is down')
      return books.map((book) => ({ book, source: 'catalogue' as const, popularity: 0 }))
    },
    libraryEntries: async () => [],
  }
}

function entry(book: Book, status: LibraryEntry['status'] = 'want_to_read'): LibraryEntry {
  return { id: `entry-${book.id}`, status, addedAt: '2026-10-02T08:00:00Z', book }
}

function snapshot(overrides: Partial<BookSnapshot>): BookSnapshot {
  return {
    title: 'Piranesi',
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    language: null,
    publisher: null,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

const found = (book: BookSnapshot | Book, source: Found['source'] = 'apple', popularity = 0): Found => ({
  book,
  source,
  popularity,
})

const describeHit = (book: BookSnapshot | Book) => `${book.title} — ${book.authors[0] ?? ''}`

// ---------------------------------------------------------------------- Apple

describe('the storefront', () => {
  it('is German first for a German device, then the US', () => {
    expect(storefrontsFor(['de-DE', 'en-US'])).toEqual(['de', 'us'])
    expect(storefrontsFor(['de'])).toEqual(['de', 'us'])
  })

  it('is the US first for everyone else, then Britain', () => {
    expect(storefrontsFor(['en-GB'])).toEqual(['us', 'gb'])
    expect(storefrontsFor(['fr-FR', 'de-DE'])).toEqual(['us', 'gb'])
    expect(storefrontsFor([])).toEqual(['us', 'gb'])
  })

  it('decides which Apple storefronts are asked, both at once', async () => {
    const fetch = recorded()
    await createSearch({ fetch, languages: ['de-DE'] }).search('Klara und die Sonne')
    expect(appleAsks(fetch).map((url) => url.searchParams.get('country'))).toEqual(['de', 'us'])
    expect(appleAsks(fetch).every((url) => url.searchParams.get('media') === 'ebook')).toBe(true)
  })

  it('decides which edition of a book is shown: the first storefront\'s', async () => {
    const german = await createSearch({ fetch: recorded(), languages: ['de-DE'] }).search('Klara und die Sonne')
    expect(german.results[0]!.book).toMatchObject({ title: 'Klara und die Sonne', isbn13: '9783641274436' })
    // Two editions of one book from two storefronts: the device language's one is shown.
    const results = mergeResults('Piranesi', {
      apple: [found(snapshot({ appleId: 'de', isbn13: '9783641264864' })), found(snapshot({ appleId: 'us' }), 'apple', 1697)],
    })
    expect(results.map((hit) => hit.book.appleId)).toEqual(['de'])
  })
})

describe('searching Apple Books', () => {
  it('turns Apple ebooks into Books with title, authors, year and a large cover', async () => {
    const { results, failed } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('Piranesi')

    expect(failed).toBe(false)
    expect(results[0]!.book).toMatchObject({
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      year: 2020,
      source: 'apple',
      appleId: '1504159680',
      coverUrl: expect.stringMatching(/\/1031214040\.jpg\/600x900bb\.jpg$/),
    })
    expect(results[0]!.book.description).toMatch(/^The award-winning, New York Times bestselling fantasy sensation that Madeline Miller called, "a miraculous/)
    expect(results[0]!.book.description).not.toMatch(/<br|&#/)
  })

  it('reads the ISBN-13 out of artwork named after it, and only a valid one', () => {
    expect(isbnFromArtwork('https://x.test/a/9783641274436.jpg/100x100bb.jpg')).toBe('9783641274436')
    expect(isbnFromArtwork('https://x.test/a/9788284321257_L2_Piranesi_Cover.jpg/100x100bb.jpg')).toBe('9788284321257')
    expect(isbnFromArtwork('https://x.test/a/1031214040.jpg/100x100bb.jpg')).toBeNull()
    expect(isbnFromArtwork('https://x.test/a/9783641274437.jpg/100x100bb.jpg')).toBeNull()
  })

  it('splits Apple\'s author line in order', () => {
    expect(splitAuthors('Edward Gibbon, Gian Battista Piranesi & Daniel J. Boorstin')).toEqual([
      'Edward Gibbon',
      'Gian Battista Piranesi',
      'Daniel J. Boorstin',
    ])
    expect(splitAuthors('Martin Luther King, Jr.')).toEqual(['Martin Luther King, Jr.'])
  })

  it('keeps paragraphs and decodes entities in descriptions', () => {
    expect(plainText('<b>Bold</b> &amp; &#34;quoted&#34;<br/>\n<br/>\nNext&nbsp;one')).toBe('Bold & "quoted"\n\nNext one')
  })

  it('asks for any cover size from the artwork URL', () => {
    expect(appleArtwork('https://x.test/a/1.jpg/100x100bb.jpg', 200, 300)).toBe('https://x.test/a/1.jpg/200x300bb.jpg')
  })
})

// --------------------------------------------------------------- OpenLibrary

describe('searching OpenLibrary', () => {
  it('asks for a reduced field list, in the device language', async () => {
    const fetch = recorded()
    await createSearch({ fetch, languages: ['de-DE'] }).search('Klara und die Sonne')
    const [ask] = openLibraryAsks(fetch)
    expect(ask!.pathname).toBe('/search.json')
    expect(ask!.searchParams.get('q')).toBe('Klara und die Sonne')
    expect(ask!.searchParams.get('fields')).toBe(OPENLIBRARY_FIELDS)
    expect(ask!.searchParams.get('lang')).toBe('de')
    expect(OPENLIBRARY_FIELDS.split(',').length).toBeLessThan(20)
  })

  it('turns a work into the Book of its best edition', async () => {
    const answer = openLibraryAnswer(new URL('https://openlibrary.org/search.json?q=piranesi')) as { docs: object[] }
    expect(snapshotFromOpenLibrary(answer.docs[0]!)).toEqual({
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      isbn13: '9781526622419',
      isbn10: '1526622416',
      pageCount: null,
      year: 2020,
      language: 'eng',
      publisher: 'Bloomsbury Publishing',
      description: null,
      coverUrl: 'https://covers.openlibrary.org/b/id/15155469-L.jpg',
      coverThumbhash: null,
      coverColors: null,
      source: 'openlibrary',
      appleId: null,
      openLibraryEditionKey: 'OL61022665M',
      openLibraryWorkKey: 'OL20893680W',
    })
  })

  it('drops catalogue punctuation from titles and converts a lone ISBN-10', () => {
    expect(cleanTitle('Piranesi.')).toBe('Piranesi')
    expect(cleanTitle('Emma /')).toBe('Emma')
    const book = snapshotFromOpenLibrary({
      key: '/works/OL1W',
      title: 'Klara und die Sonne',
      author_name: ['Kazuo Ishiguro'],
      editions: { docs: [{ key: '/books/OL2M', isbn: ['3-641-26486-3'] }] },
    })
    expect(book).toMatchObject({ isbn13: '9783641264864', isbn10: '3641264863', openLibraryEditionKey: 'OL2M' })
    expect(snapshotFromOpenLibrary({ title: 'No edition to add' })).toBeNull()
  })
})

// ------------------------------------------------------------------ merging

describe('merging the sources', () => {
  it('puts Catalogue hits first, and keeps one of each edition', async () => {
    const stored = catalogueBook()
    const { results } = await createSearch({ fetch: recorded(), languages: ['en-US'], catalogue: catalogue([stored]) }).search(
      'Piranesi',
    )
    // Apple's 1504159680 is the Catalogue Book: the stored one stays (with its id and thumbhash), once.
    expect(results[0]!.book).toEqual(stored)
    expect(results.filter((hit) => hit.book.appleId === '1504159680')).toHaveLength(1)
  })

  it('ranks Catalogue hits first among equally good matches', () => {
    const samuel = catalogueBook({ id: 'a1', authors: ['Arthur Samuel'], appleId: null, openLibraryEditionKey: 'OL1M' })
    const results = mergeResults('Piranesi', {
      catalogue: [found(samuel, 'catalogue')],
      apple: [found(snapshot({ appleId: '1' }), 'apple', 1697)],
    })
    expect(results.map((hit) => describeHit(hit.book))).toEqual(['Piranesi — Arthur Samuel', 'Piranesi — Susanna Clarke'])
  })

  it('streams: each source\'s answer is merged in as it arrives', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => (release = resolve))
    const updates: SearchOutcome[] = []
    const search = createSearch({
      fetch: recorded({ hold, holdOnly: 'apple' }),
      languages: ['en-US'],
      catalogue: catalogue([catalogueBook()]),
    })

    const done = search.search('Piranesi', { onUpdate: (update) => updates.push(update) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The Catalogue and OpenLibrary have answered; Apple is still on its way.
    expect(updates.map((update) => update.pending)).toEqual([true, true])
    expect(updates[1]!.results.some((hit) => hit.book.source === 'apple' && !('id' in hit.book))).toBe(false)
    expect(updates[0]!.results[0]!.book).toEqual(catalogueBook())

    release()
    const final = await done
    expect(updates).toHaveLength(3)
    expect(updates[2]).toEqual(final)
    expect(final.pending).toBe(false)
    expect(final.results.some((hit) => hit.book.appleId === '1080796080')).toBe(true)
  })

  it('keeps one of the same edition: by ISBN-13, with ISBN-10s converted', () => {
    const results = mergeResults('Klara und die Sonne', {
      apple: [found(snapshot({ title: 'Klara und die Sonne', authors: ['Kazuo Ishiguro'], appleId: '1', isbn13: '9783641264864' }))],
      openlibrary: [
        found(
          snapshot({
            title: 'Klara und die Sonne',
            authors: ['Kazuo Ishiguro'],
            source: 'openlibrary',
            isbn10: '3641264863',
            publisher: 'Blessing',
            openLibraryEditionKey: 'OL2M',
          }),
          'openlibrary',
        ),
      ],
    })
    expect(results).toHaveLength(1)
    // The first keeps its place; the later one fills in what it lacked.
    expect(results[0]!.book).toMatchObject({ source: 'apple', appleId: '1', publisher: 'Blessing', openLibraryEditionKey: 'OL2M' })
  })

  it('keeps one of the same book: by normalised title and first author', async () => {
    const { results } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('Piranesi')
    const clarke = results.filter((hit) => workKey(hit.book) === 'piranesi|susanna clarke')
    // Apple sells eleven editions of it and OpenLibrary has one more: one row.
    expect(clarke).toHaveLength(1)
    // A misspelt author is another book as far as search can tell.
    expect(results.filter((hit) => workKey(hit.book) === 'piranesi|susanne clarke')).toHaveLength(1)
    expect(new Set(results.map((hit) => workKey(hit.book))).size).toBe(results.length)
  })

  it('compares titles and authors without accents, case or punctuation', () => {
    expect(normalise('Klára & the Sun!')).toBe('klara and the sun')
    expect(normalise('Straße')).toBe('strasse')
    expect(workKey({ title: 'Piranesi.', authors: ['SUSANNA CLARKE'] })).toBe(workKey({ title: 'Piranesi', authors: ['Susanna Clarke'] }))
  })
})

// ------------------------------------------------------------------ ranking

describe('ranking', () => {
  it('puts Susanna Clarke\'s Piranesi first, not the Gibbon editions Apple lists above it', async () => {
    const { results } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('Piranesi')
    const titles = results.map((hit) => describeHit(hit.book))

    expect(titles[0]).toBe('Piranesi — Susanna Clarke')
    // Every Book whose title is (or begins with) the query outranks every Book
    // that merely credits a Piranesi among its authors.
    const lastTitleMatch = Math.max(...results.map((hit, i) => (normalise(hit.book.title).startsWith('piranesi') ? i : -1)))
    const firstGibbon = titles.findIndex((title) => title.endsWith('Edward Gibbon'))
    expect(firstGibbon).toBeGreaterThan(lastTitleMatch)
    // Apple's own order had them before the novel's other storefront editions.
    expect(titles.indexOf('Piranesi: Drawings Colour Plates — Maria Peitcheva')).toBeLessThan(firstGibbon)
  })

  it('weighs exact title over title without subtitle over prefix over words', () => {
    const quality = (title: string, authors = ['Someone']) => matchQuality('Piranesi', { title, authors })
    expect(quality('Piranesi')).toBe(MATCH.title)
    expect(quality('Piranesi: Drawings Colour Plates')).toBe(MATCH.mainTitle)
    expect(quality('Piranesi as designer')).toBe(MATCH.titleStart)
    expect(quality('Piranesis Traum')).toBe(MATCH.titleWordStart)
    expect(quality('Selected Etchings by Piranesi')).toBe(MATCH.titleWords)
    expect(quality('The Prisons', ['Giovanni Battista Piranesi'])).toBe(MATCH.firstAuthorWords)
    expect(quality('Decline and Fall', ['Edward Gibbon', 'Gian Battista Piranesi'])).toBe(MATCH.otherAuthorWords)
    expect(quality('Something else')).toBe(0)
    expect(MATCH.title).toBeGreaterThan(MATCH.mainTitle)
    expect(MATCH.mainTitle).toBeGreaterThan(MATCH.titleStart)
    expect(MATCH.titleStart).toBeGreaterThan(MATCH.titleWords)
  })

  it('understands a query of author, or of title and author', () => {
    const piranesi = { title: 'Piranesi', authors: ['Susanna Clarke'] }
    expect(matchQuality('Susanna Clarke', piranesi)).toBe(MATCH.author)
    expect(matchQuality('piranesi clarke', piranesi)).toBe(MATCH.titleAndAuthor)
    expect(matchQuality('clarke piranesi', piranesi)).toBe(MATCH.titleAndAuthor)
    expect(matchQuality('pira', piranesi)).toBe(MATCH.titleWordStart)
    expect(matchQuality('klara sonne', { title: 'Klara und die Sonne', authors: ['Kazuo Ishiguro'] })).toBe(MATCH.titleWords)
  })

  it('breaks ties by popularity, then by the order the sources gave', () => {
    const results = mergeResults('Piranesi', {
      apple: [
        found(snapshot({ authors: ['Arthur Samuel'], appleId: '1' }), 'apple', 0),
        found(snapshot({ appleId: '2' }), 'apple', 1697),
        found(snapshot({ authors: ['Ian Scott'], appleId: '3' }), 'apple', 0),
      ],
    })
    expect(results.map((hit) => hit.book.appleId)).toEqual(['2', '1', '3'])
  })

  it('ranks a German query in German', async () => {
    const { results } = await createSearch({ fetch: recorded(), languages: ['de-DE'] }).search('Klara und die Sonne')
    expect(results[0]!.book).toMatchObject({ title: 'Klara und die Sonne', authors: ['Kazuo Ishiguro'], isbn13: '9783641274436' })
  })
})

// --------------------------------------------------------- what she has

describe('what the member already has', () => {
  const german = catalogueBook({ id: 'b-german', appleId: '1506831259', isbn13: '9783641264864', coverUrl: null })

  it('shows the edition she has, with its status', async () => {
    const { results } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('Piranesi', {
      library: [entry(german, 'reading')],
    })
    // Of all the editions, hers is the one shown — matched by its Apple id.
    expect(results[0]!.book.appleId).toBe('1506831259')
    expect(results[0]!.entry).toMatchObject({ id: 'entry-b-german', status: 'reading' })
    expect(results[0]!.otherEdition).toBe(false)
    expect(results.slice(1).every((hit) => hit.entry === null)).toBe(true)
  })

  it('finds her edition by ISBN-13 too, an ISBN-10 converted', () => {
    const hers = catalogueBook({ id: 'b-ten', appleId: null, isbn13: null, isbn10: '3641264863', source: 'openlibrary', openLibraryEditionKey: 'OL9M' })
    const results = mergeResults(
      'Piranesi',
      { apple: [found(snapshot({ appleId: '1506831259', isbn13: '9783641264864' }))] },
      [entry(hers)],
    )
    expect(results[0]!.entry?.id).toBe('entry-b-ten')
  })

  it('says "other edition in your Library" for the same title and author without the same ISBN', async () => {
    const hardback = catalogueBook({ id: 'b-hard', appleId: null, isbn13: '9781526622426', source: 'openlibrary', openLibraryEditionKey: 'OL7M' })
    const { results } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('Piranesi', {
      library: Promise.resolve([entry(hardback)]),
    })
    const clarke = results.find((hit) => workKey(hit.book) === 'piranesi|susanna clarke')!
    expect(clarke.entry).toBeNull()
    expect(clarke.otherEdition).toBe(true)
    expect(results.filter((hit) => hit.otherEdition)).toHaveLength(1)
  })

  it('marks nothing when the Library cannot be read', async () => {
    const { results } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('Piranesi', {
      library: Promise.reject(new Error('offline')),
    })
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((hit) => !hit.entry && !hit.otherEdition)).toBe(true)
  })
})

// --------------------------------------------------------------- the query

describe('a query', () => {
  it('answers an empty list when nothing matches', async () => {
    const outcome = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('qxzvwlmbrt')
    expect(outcome).toEqual({ results: [], pending: false, failed: false })
  })

  it('does not ask anything when it is too short', async () => {
    const fetch = recorded()
    const lib = catalogue([])
    const outcome = await createSearch({ fetch, languages: ['en-US'], catalogue: lib }).search(' p ')
    expect(outcome).toEqual({ results: [], pending: false, failed: false })
    expect(fetch.asked).toEqual([])
    expect(lib.asked).toEqual([])
  })
})

describe('an ISBN query', () => {
  it('is looked up by ISBN in every source instead of searched as text, hyphens and all', async () => {
    const fetch = recorded()
    const lib = catalogue([])
    const { results } = await createSearch({ fetch, languages: ['de-DE'], catalogue: lib }).search('978-3-641-26486-4')
    expect(appleAsks(fetch).every((url) => url.pathname === '/lookup' && url.searchParams.get('isbn') === '9783641264864')).toBe(true)
    expect(openLibraryAsks(fetch).map((url) => url.searchParams.get('isbn'))).toEqual(['9783641264864'])
    expect(openLibraryAsks(fetch)[0]!.searchParams.has('q')).toBe(false)
    expect(lib.asked).toEqual(['9783641264864'])
    expect(results).toHaveLength(1)
    expect(results[0]!.book).toMatchObject({ title: 'Piranesi', isbn13: '9783641264864', appleId: '1506831259' })
  })

  it('merges what every source knows about that one edition', async () => {
    const { results } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('1526622416')
    expect(results).toHaveLength(1)
    expect(results[0]!.book).toMatchObject({ isbn13: '9781526622419', openLibraryEditionKey: 'OL61022665M' })
  })

  it('reads ISBN-10s as their ISBN-13', () => {
    expect(isbn10To13('3641264863')).toBe('9783641264864')
    expect(parseIsbn('3-641-26486-3')).toBe('9783641264864')
    expect(parseIsbn('Piranesi')).toBeNull()
    expect(parseIsbn('9783641264865')).toBeNull()
  })
})

// ----------------------------------------------------------- failing sources

describe('when a source fails', () => {
  it('is silent about Apple: the other sources\' results stay', async () => {
    const { results, failed } = await createSearch({
      fetch: recorded({ failing: ['us', 'gb'] }),
      languages: ['en-US'],
      catalogue: catalogue([catalogueBook()]),
    }).search('Piranesi')
    expect(failed).toBe(false)
    expect(results[0]!.book).toEqual(catalogueBook())
    expect(results.some((hit) => hit.book.source === 'openlibrary')).toBe(true)
  })

  it('is silent about one storefront: the other\'s results stay', async () => {
    const { results, failed } = await createSearch({ fetch: recorded({ failing: ['us'] }), languages: ['en-US'] }).search(
      'Piranesi',
    )
    expect(failed).toBe(false)
    expect(results.some((hit) => hit.book.appleId === '1496423620')).toBe(true)
  })

  it('is silent about OpenLibrary and the Catalogue', async () => {
    const { results, failed } = await createSearch({
      fetch: recorded({ failing: ['openlibrary'] }),
      languages: ['en-US'],
      catalogue: catalogue('failing'),
    }).search('Piranesi')
    expect(failed).toBe(false)
    expect(results[0]!.book.appleId).toBe('1504159680')
    expect(results.every((hit) => hit.book.source === 'apple')).toBe(true)
  })

  it('says so only when every source failed', async () => {
    const outcome = await createSearch({
      fetch: recorded({ failing: ['us', 'gb', 'openlibrary'] }),
      languages: ['en-US'],
      catalogue: catalogue('failing'),
    }).search('Piranesi')
    expect(outcome).toEqual({ results: [], pending: false, failed: true })
  })
})

// --------------------------------------------------------------- stale queries

describe('a query replaced by a newer one', () => {
  it('is aborted in flight, never resolves with its results and reports nothing more', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => (release = resolve))
    const fetch = recorded({ hold })
    const search = createSearch({ fetch, languages: ['en-US'] })
    const updates: SearchOutcome[] = []

    const older = new AbortController()
    const stale = search.search('Piranesi', { signal: older.signal, onUpdate: (update) => updates.push(update) })
    older.abort()
    release()

    const error = await stale.catch((reason: unknown) => reason)
    expect(isAbort(error)).toBe(true)
    expect(updates).toEqual([])
    // Every source was asked with the signal that aborted.
    expect(fetch.asked).toHaveLength(3)
  })

  it('is dropped even when its answers already arrived', async () => {
    const controller = new AbortController()
    let answers = 0
    const fetch = (async (url: string, init?: { signal?: AbortSignal }) => {
      const answer = await recorded()(url, init)
      if (++answers === 3) controller.abort() // a newer query came in while the last one was read
      return answer
    }) as FetchLike
    const error = await createSearch({ fetch, languages: ['en-US'] })
      .search('Piranesi', { signal: controller.signal })
      .catch((reason: unknown) => reason)
    expect(isAbort(error)).toBe(true)
  })
})

// ------------------------------------------------------------------ lookups

describe('one Book by its id', () => {
  it('is looked up in every storefront and found where it is sold', async () => {
    const book = await createSearch({ fetch: recorded(), languages: ['en-GB'] }).lookupApple('1504159680')
    expect(book).toMatchObject({ title: 'Piranesi', appleId: '1504159680' })
  })

  it('is null when no storefront sells it, and an error when none answered', async () => {
    expect(await createSearch({ fetch: recorded(), languages: ['en-US'] }).lookupApple('1')).toBeNull()
    const error = await createSearch({ fetch: recorded({ failing: ['us', 'gb'] }), languages: ['en-US'] })
      .lookupApple('1504159680')
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
  })

  it('is found on OpenLibrary by its edition key', async () => {
    const book = await createSearch({ fetch: recorded(), languages: ['en-US'] }).lookupOpenLibrary('OL61022665M')
    expect(book).toMatchObject({ title: 'Piranesi', authors: ['Susanna Clarke'], openLibraryEditionKey: 'OL61022665M' })
    expect(await createSearch({ fetch: recorded(), languages: ['en-US'] }).lookupOpenLibrary('OL1M')).toBeNull()
  })

  it('is found by ISBN on Apple Books first, then on OpenLibrary', async () => {
    const search = createSearch({ fetch: recorded(), languages: ['de-DE'] })
    expect(await search.lookupIsbn('9783641264864')).toMatchObject({ appleId: '1506831259' })
    expect(await search.lookupIsbn('9781526622419')).toMatchObject({ openLibraryEditionKey: 'OL61022665M' })
    expect(await search.lookupAppleIsbn('9781526622419')).toBeNull()
  })

  it('has a page address that reads back', () => {
    expect(parseBookKey('apple-1504159680')).toEqual({ kind: 'apple', appleId: '1504159680' })
    expect(parseBookKey('ol-OL61022665M')).toEqual({ kind: 'openlibrary', editionKey: 'OL61022665M' })
    expect(parseBookKey('isbn-9783641264864')).toEqual({ kind: 'isbn', isbn13: '9783641264864' })
    expect(parseBookKey('0f8e4a52-3c1b-4d2e-9a7f-5b6c7d8e9f00')).toEqual({
      kind: 'catalogue',
      id: '0f8e4a52-3c1b-4d2e-9a7f-5b6c7d8e9f00',
    })
    expect(parseBookKey('ol-OL20893680W')).toBeNull()
    expect(parseBookKey('nonsense')).toBeNull()
  })
})
