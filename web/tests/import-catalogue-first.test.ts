import { describe, expect, it } from 'vitest'
import type { Book, BookSnapshot } from '@/data/books'
import { catalogueFirst, createBookImport, findEdition, type Edition, type Lookups } from '@/data/bookImport'
import type { ImportBook } from '@/data/import/rows'
import type { SearchOutcome } from '@/data/search'

/**
 * The Catalogue is the import's first source (data/bookImport.ts: `catalogueFirst`): a row whose work the
 * Catalogue holds with a cover, in the row's language and a fitting edition, costs no Apple, Open Library or
 * National Library call; anything less goes down the ladder as before. On fakes, as tests/import-find-edition.test.ts:
 * every external source is a spy, nothing is asked of the network, no member's data is involved. The rows are
 * invented ("Bleak House"/"Charles Dickens"), their ISBNs invented 979s with a real check digit.
 */

function isbn(body: string): string {
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

const row = (overrides: Partial<ImportBook>): ImportBook => ({
  source: 'goodreads',
  key: 'goodreads:1',
  sourceId: '1',
  row: 1,
  title: 'Bleak House',
  series: null,
  authors: ['Charles Dickens'],
  isbn13: null,
  isbn10: null,
  pageCount: null,
  year: null,
  originalYear: null,
  binding: null,
  language: null,
  publisher: null,
  shelf: 'read',
  shelves: [],
  status: 'finished',
  session: null,
  earlierReads: [],
  extraReads: 0,
  otherKeys: [],
  addedOn: null,
  problems: [],
  ...overrides,
})

function snapshot(overrides: Partial<BookSnapshot>): BookSnapshot {
  return {
    title: 'Bleak House',
    authors: ['Charles Dickens'],
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
    appleId: '9001',
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

let next = 0
/** A Catalogue Book: a snapshot with an id. */
const stored = (overrides: Partial<BookSnapshot>): Book => ({ ...snapshot(overrides), id: `book-${++next}`, createdAt: '2026-01-01T00:00:00Z' })

const outcome = (editions: BookSnapshot[]): SearchOutcome => ({ results: [], pending: false, failed: false, editions, unanswered: [] })

/** Lookups whose Catalogue holds `held` and whose external sources are spies, answering `external`. */
function world(held: Book[], external: BookSnapshot[] = []) {
  const asked = { catalogue: [] as string[], search: [] as string[], isbn: [] as string[], dnb: 0, workEditions: 0, goodreads: 0, prime: 0 }
  const lookups: Lookups = {
    catalogue: {
      search: async (query) => {
        asked.catalogue.push(query)
        // The Catalogue's own matching, as far as these rows need: every word of the query begins a word of the title or authors.
        const words = query.toLowerCase().split(/\s+/).filter(Boolean)
        return held
          .filter((book) => {
            const text = `${book.title} ${book.authors.join(' ')} ${book.isbn13 ?? ''}`.toLowerCase()
            return words.every((word) => text.split(/[^\p{L}\p{N}]+/u).some((part) => part.startsWith(word)))
          })
          .map((book) => ({ book, source: 'catalogue' as const, popularity: 0 }))
      },
    },
    search: {
      lookupIsbn: async (code) => (asked.isbn.push(code), null),
      search: async (query) => (asked.search.push(query), outcome(external)),
      workEditions: async () => (asked.workEditions++, []),
      primeIsbns: async () => void asked.prime++,
    },
    dnb: { editions: async () => (asked.dnb++, []) },
    goodreads: async () => (asked.goodreads++, null),
  }
  const external_ = () => asked.search.length + asked.isbn.length + asked.dnb + asked.workEditions + asked.goodreads + asked.prime
  return { lookups, asked, external: external_ }
}

const covered = 'https://example.test/bleak.jpg'

describe('the Catalogue first, by title', () => {
  it('settles a row the Catalogue holds with a cover: nothing external is asked', async () => {
    const mine = stored({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', openLibraryWorkKey: 'OL9W', language: 'eng', coverUrl: covered })
    const { lookups, external } = world([mine])
    const edition = await findEdition(row({ language: 'English' }), lookups)
    expect(edition.book).toBe(mine)
    expect(edition.via).toBe('title')
    expect(edition.unsure).toBe(false)
    expect(edition.catalogueOnly).toBe(true)
    expect(external()).toBe(0)
  })

  it('takes the best fitting edition of the Catalogue, its other editions kept for Choose edition', async () => {
    const small = stored({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', coverUrl: covered, pageCount: 200 })
    const fitting = stored({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', coverUrl: covered, pageCount: 880 })
    const { lookups, external } = world([small, fitting])
    const edition = await findEdition(row({ pageCount: 876 }), lookups)
    expect(edition.book).toBe(fitting)
    expect(edition.alternatives).toEqual([fitting, small])
    expect(external()).toBe(0)
  })

  it('asks no work editions for it at import time: Choose edition asks for them when it is opened', async () => {
    const mine = stored({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', openLibraryWorkKey: 'OL9W', coverUrl: covered })
    const { lookups, asked } = world([mine])
    const importer = createBookImport({} as never, { lookups, probe: async () => null })
    const book = row({})
    const found: Edition[] = []
    await importer.match([book], { onEdition: (_, edition) => found.push(edition) })
    expect(asked.workEditions).toBe(0)
    expect(asked.prime).toBe(0)
    await importer.candidates(book, found[0]!)
    expect(asked.workEditions).toBe(1)
  })

  it('falls through unchanged when the Catalogue holds nothing: the whole ladder is asked', async () => {
    const elsewhere = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', coverUrl: covered })
    const { lookups, asked } = world([], [elsewhere])
    const edition = await findEdition(row({}), lookups)
    expect(edition.book).toBe(elsewhere)
    expect(edition.via).toBe('title')
    expect(edition.catalogueOnly).toBeUndefined()
    expect(asked.search.length).toBeGreaterThan(0)
  })

  it('does not settle on a Catalogue Book without a cover', async () => {
    const bare = stored({ source: 'import', appleId: null, coverUrl: null })
    const elsewhere = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', coverUrl: covered })
    const { lookups, asked } = world([bare], [elsewhere])
    const edition = await findEdition(row({}), lookups)
    expect(asked.search.length).toBeGreaterThan(0)
    expect(edition.book).toBe(elsewhere)
    expect(edition.catalogueOnly).toBeUndefined()
  })

  it('does not settle on a Catalogue Book in another language than the row\'s', async () => {
    const german = stored({ title: 'Bleak House', source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL3M', language: 'ger', coverUrl: covered })
    const english = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL4M', language: 'eng', coverUrl: 'https://example.test/en.jpg' })
    const { lookups, asked } = world([german], [english])
    const edition = await findEdition(row({ language: 'English' }), lookups)
    expect(asked.search.length).toBeGreaterThan(0)
    expect(edition.book).toBe(english)
    expect(edition.catalogueOnly).toBeUndefined()
  })

  it('does not settle on another work, or on a member\'s Manual book', async () => {
    const other = stored({ title: 'Hard Times', coverUrl: covered })
    const manual = stored({ source: 'manual', appleId: null, coverUrl: covered })
    const { lookups, asked } = world([other, manual])
    const edition = await findEdition(row({}), lookups)
    expect(asked.search.length).toBeGreaterThan(0)
    expect(edition.catalogueOnly).toBeUndefined()
  })

  it('does not settle an ebook row on a print edition: Apple\'s ebook is still asked for', async () => {
    const print = stored({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', coverUrl: covered })
    const ebook = snapshot({ source: 'apple', appleId: '9002', coverUrl: 'https://example.test/ebook.jpg' })
    const { lookups, asked } = world([print], [ebook])
    const edition = await findEdition(row({ binding: 'Kindle Edition' }), lookups)
    expect(asked.search.length).toBeGreaterThan(0)
    expect(edition.book.source).toBe('apple')
  })

  it('settles an ebook row on the Catalogue\'s Apple ebook', async () => {
    const ebook = stored({ source: 'apple', appleId: '9002', coverUrl: covered })
    const { lookups, external } = world([ebook])
    const edition = await findEdition(row({ binding: 'Kindle Edition' }), lookups)
    expect(edition.book).toBe(ebook)
    expect(external()).toBe(0)
  })

  it('does not take the Catalogue being unreachable for "unsure": the ladder asks on', async () => {
    const elsewhere = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', coverUrl: covered })
    const { lookups } = world([], [elsewhere])
    const down: Lookups = { ...lookups, catalogue: { search: async () => Promise.reject(new Error('down')) } }
    const edition = await findEdition(row({}), down)
    expect(edition.book).toBe(elsewhere)
    expect(edition.unsure).toBe(false)
  })

  it('asks the Catalogue only the ladder\'s first questions', async () => {
    const { lookups, asked } = world([])
    await catalogueFirst(row({ title: 'Bleak House: A Novel', authors: ['Charles Dickens'] }), lookups)
    expect(asked.catalogue).toEqual(['Bleak House: A Novel Charles Dickens', 'Bleak House Dickens'])
  })
})

describe('the Catalogue first, by ISBN', () => {
  it('settles a row whose ISBN the Catalogue holds with a cover, as before', async () => {
    const code = isbn('979000000201')
    const mine = stored({ isbn13: code, source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', coverUrl: covered })
    const { lookups, external } = world([mine])
    const edition = await findEdition(row({ isbn13: code }), lookups)
    expect(edition.book).toBe(mine)
    expect(edition.via).toBe('isbn')
    expect(edition.catalogueOnly).toBe(true)
    expect(external()).toBe(0)
  })

  it('a Catalogue ISBN without a cover borrows the cover of the Catalogue\'s other edition: nothing external', async () => {
    const code = isbn('979000000202')
    const bare = stored({ isbn13: code, source: 'import', appleId: null, coverUrl: null })
    const sibling = stored({ isbn13: isbn('979000000203'), source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', coverUrl: covered })
    const { lookups, external } = world([bare, sibling])
    const edition = await findEdition(row({ isbn13: code }), lookups)
    expect((edition.book as Book).id).toBe(bare.id)
    expect(edition.via).toBe('isbn')
    expect((edition.coverFrom ?? edition.book).coverUrl).toBe(covered)
    expect(edition.catalogueOnly).toBe(true)
    expect(external()).toBe(0)
  })

  it('a Catalogue ISBN without a cover and no covered edition beside it asks the ladder for one', async () => {
    const code = isbn('979000000204')
    const bare = stored({ isbn13: code, source: 'import', appleId: null, coverUrl: null })
    const lender = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', coverUrl: covered })
    const { lookups, asked } = world([bare], [lender])
    const edition = await findEdition(row({ isbn13: code }), lookups)
    expect(asked.search.length).toBeGreaterThan(0)
    expect(asked.isbn).toEqual([])
    expect((edition.coverFrom ?? edition.book).coverUrl).toBe(covered)
    expect(edition.catalogueOnly).toBeUndefined()
  })

  it('an ISBN the Catalogue lacks is asked of the sources, then the Catalogue\'s edition of the work settles the row, flagged not Catalogue-only', async () => {
    const code = isbn('979000000205')
    const mine = stored({ isbn13: isbn('979000000206'), source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', coverUrl: covered })
    const { lookups, asked } = world([mine])
    const edition = await findEdition(row({ isbn13: code }), lookups)
    expect(asked.isbn).toEqual([code])
    expect(edition.book).toBe(mine)
    expect(edition.catalogueOnly).toBeUndefined()
  })

  it('primes Apple only with the ISBNs the Catalogue does not hold with a cover', async () => {
    const known = isbn('979000000207')
    const unknown = isbn('979000000208')
    const mine = stored({ isbn13: known, source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', coverUrl: covered })
    const { lookups } = world([mine])
    const primed: string[][] = []
    lookups.search = { ...lookups.search, primeIsbns: async (rows) => void primed.push(rows.map((r) => r.isbn13)) }
    const importer = createBookImport({} as never, { lookups, probe: async () => null })
    await importer.match([row({ isbn13: known, title: 'Bleak House' }), row({ key: 'goodreads:2', isbn13: unknown, title: 'Hard Times' })], { onEdition: () => {} })
    expect(primed).toEqual([[unknown]])
  })

  it('a file whose ISBNs the Catalogue all holds primes nothing', async () => {
    const known = isbn('979000000209')
    const mine = stored({ isbn13: known, source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', coverUrl: covered })
    const { lookups, asked, external } = world([mine])
    const importer = createBookImport({} as never, { lookups, probe: async () => null })
    const editions: Edition[] = []
    await importer.match([row({ isbn13: known })], { onEdition: (_, edition) => editions.push(edition) })
    expect(asked.prime).toBe(0)
    expect(external()).toBe(0)
    expect(editions[0]!.catalogueOnly).toBe(true)
  })
})
