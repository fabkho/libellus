import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { findEdition, reviewOf, settled, titleCandidates, type Lookups } from '@/data/bookImport'
import { createDnb, snapshotFromDnbEdition, type FunctionsClient } from '@/data/dnb'
import type { DnbEdition } from '@/data/dnbRecord'
import type { FetchLike } from '@/data/fetching'
import type { ImportBook } from '@/data/import/rows'
import type { SourceName } from '@/data/merge'
import { createSearch, type SearchOutcome } from '@/data/search'

/**
 * The National Library in the import's match (docs/parity.md, "Import books: the DNB step"): the
 * ISBN step falls back to it, the title ladder asks it its one question EARLY for a row that is
 * probably German and LAST for any other row nothing was found for, never for a row the ladder
 * settled, and its editions have no cover of their own (they borrow one, or the row stays one to
 * look at). The `dnb-lookup` function and every source are stand-ins; nothing here reaches the
 * network and no member's data is involved. The rows are invented ("Der Schwarm"/"Frank
 * Schätzing" is the public fixture of tests/dnb.test.ts, "Bleak House"/"Charles Dickens" an
 * invented row of tests/import-find-edition.test.ts).
 */

/** An invented ISBN-13 of the 979 range, its check digit computed (tests/import-find-edition.test.ts). */
function isbn(body: string): string {
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/** One row as an export maps it (tests/import-find-edition.test.ts's `row`). */
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

/** One edition a source named (tests/import-find-edition.test.ts's `snapshot`). */
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

/** A title search's answer: these editions, and which sources did not answer. */
const outcome = (editions: BookSnapshot[], unanswered: SourceName[] = []): SearchOutcome => ({
  results: [],
  pending: false,
  failed: false,
  editions,
  unanswered,
})

const SCHWARM: DnbEdition = { title: 'Der Schwarm: Roman', authors: ['Frank Schätzing'], isbn13: '9783462041002', publisher: 'Kiepenheuer & Witsch', year: 2004, language: 'ger', pages: 992 }

/** A `dnb-lookup` function that answers as the case says; every call recorded. */
function functionAnswering(answer: (body: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = []
  const client: FunctionsClient = {
    functions: {
      invoke: async (_name, { body }) => {
        calls.push(body as Record<string, unknown>)
        const data = answer(body as Record<string, unknown>)
        return data instanceof Error ? { data: null, error: data } : { data, error: null }
      },
    },
  }
  return { client, calls }
}

/** Apple and Open Library that know nothing (tests/dnb.test.ts's `nobody`). */
const nobody: FetchLike = async (url) => ({
  ok: true,
  status: 200,
  json: async () => (new URL(url).hostname === 'itunes.apple.com' ? { resultCount: 0, results: [] } : { numFound: 0, docs: [] }),
})

describe('the ISBN step asks the National Library too', () => {
  it('an ISBN only it knows is matched to its edition (via isbn, source dnb)', async () => {
    const { client } = functionAnswering((body) => (body.action === 'isbn' ? { status: 'found', edition: SCHWARM } : { status: 'ok', editions: [] }))
    const searcher = createSearch({ fetch: nobody, languages: ['de-DE', 'en-US'], dnb: createDnb(client) })
    const lookups: Lookups = {
      catalogue: { search: async () => [] },
      search: searcher,
      dnb: createDnb(client),
    }
    const edition = await findEdition(row({ title: 'Der Schwarm', authors: ['Frank Schätzing'], isbn13: SCHWARM.isbn13 }), lookups)
    expect(edition.via).toBe('isbn')
    expect(edition.book).toMatchObject({ isbn13: '9783462041002', source: 'dnb', publisher: 'Kiepenheuer & Witsch' })
    expect(edition.unsure).toBe(false)
  })

  it('its refusal is "not asked", never "not found": the row is unsure and a look', async () => {
    const { client } = functionAnswering(() => new Error('dnb_unavailable'))
    const searcher = createSearch({ fetch: nobody, languages: ['de-DE', 'en-US'], dnb: createDnb(client) })
    const lookups: Lookups = { catalogue: { search: async () => [] }, search: searcher, dnb: createDnb(client) }
    const book = row({ title: 'Der Schwarm', authors: ['Frank Schätzing'], isbn13: SCHWARM.isbn13 })
    const edition = await findEdition(book, lookups)
    expect(edition.via).toBeNull()
    expect(edition.unsure).toBe(true)
    expect(reviewOf(book, edition, false).tier).toBe('needsLook')
  })

  it('when it answers "none" and the others have nothing, nothing found is told', async () => {
    const { client } = functionAnswering((body) => (body.action === 'isbn' ? { status: 'not_found' } : { status: 'ok', editions: [] }))
    const searcher = createSearch({ fetch: nobody, languages: ['de-DE', 'en-US'], dnb: createDnb(client) })
    const lookups: Lookups = { catalogue: { search: async () => [] }, search: searcher, dnb: createDnb(client) }
    const edition = await findEdition(row({ title: 'Bleak House', authors: ['Charles Dickens'], isbn13: isbn('979000000103') }), lookups)
    expect(edition.via).toBeNull()
    expect(edition.unsure).toBe(false)
  })
})

describe('the title ladder’s one National Library question', () => {
  /** `Lookups` whose answers as the case says, with the order the sources were asked in. */
  function ladder(options: { dnb?: BookSnapshot[]; search?: BookSnapshot[]; refuseDnb?: boolean }): { lookups: Lookups; order: string[]; asked: { title: string; authors: string[] }[] } {
    const order: string[] = []
    const asked: { title: string; authors: string[] }[] = []
    const lookups: Lookups = {
      catalogue: { search: async () => [] },
      search: {
        lookupIsbn: async () => null,
        search: async (query) => (order.push(`search:${query}`), outcome(options.search ?? [])),
      },
      dnb: {
        editions: async (book) => {
          order.push('dnb')
          asked.push({ title: book.title, authors: [...book.authors] })
          if (options.refuseDnb) throw new Error('dnb_unavailable')
          return options.dnb ?? []
        },
      },
    }
    return { lookups, order, asked }
  }

  it('is asked EARLY for a row that is probably German: before the ladder\'s first question', async () => {
    const { lookups, order, asked } = ladder({ dnb: [snapshotFromDnbEdition(SCHWARM)] })
    await titleCandidates(row({ title: 'Der Schwarm', authors: ['Frank Schätzing'] }), lookups)
    expect(order[0]).toBe('dnb')
    expect(asked).toEqual([{ title: 'Der Schwarm', authors: ['Frank Schätzing'] }])
  })

  it('is asked LAST for a row nothing points to Germany at, when nothing was found', async () => {
    const { lookups, order, asked } = ladder({})
    const found = await titleCandidates(row({ title: 'Cold Water: A Novel', authors: ['Greta Müller'], isbn13: isbn('979000000104') }), lookups)
    expect(order.at(-1)).toBe('dnb')
    expect(order.slice(0, -1).every((step) => step.startsWith('search:'))).toBe(true)
    // The main title, without its subtitle, and the first author.
    expect(asked).toEqual([{ title: 'Cold Water', authors: ['Greta Müller'] }])
    expect(found.incomplete).toBe(false)
  })

  it('is never asked for a row the ladder settled: its work, with a cover', async () => {
    const work = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', coverUrl: 'https://example.test/bleak.jpg' })
    const { lookups, order } = ladder({ search: [work] })
    await titleCandidates(row({ title: 'Bleak House', authors: ['Charles Dickens'] }), lookups)
    expect(order.some((step) => step === 'dnb')).toBe(false)
  })

  it('a refusal is "not asked": the result is incomplete, never "nothing there"', async () => {
    const { lookups } = ladder({ refuseDnb: true })
    const german = await titleCandidates(row({ title: 'Der Schwarm', authors: ['Frank Schätzing'] }), lookups)
    expect(german.incomplete).toBe(true)
    expect(german.same).toEqual([])
  })
})

describe('a National Library edition has no cover of its own', () => {
  const german = row({ title: 'Der Schwarm', authors: ['Frank Schätzing'], pageCount: 992, year: 2004, language: 'ger' })
  const bare = snapshotFromDnbEdition(SCHWARM)

  function lookupsWith(editions: BookSnapshot[]): Lookups {
    return {
      catalogue: { search: async () => [] },
      search: { lookupIsbn: async () => null, search: async () => outcome(editions.filter((book) => book !== bare)) },
      dnb: { editions: async () => [bare] },
    }
  }

  it('borrows the work\'s best cover (the ranking\'s, not its own)', async () => {
    const sibling = snapshot({ title: 'Der Schwarm', authors: ['Frank Schätzing'], source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', language: 'ger', coverUrl: 'https://example.test/schwarm.jpg' })
    const edition = await findEdition(german, lookupsWith([sibling]))
    expect(edition.via).toBe('title')
    // The DNB edition itself has none: the work's cover is lent onto it (as the cover fill gives one).
    expect(edition.book).toMatchObject({ title: 'Der Schwarm: Roman', source: 'dnb', coverUrl: 'https://example.test/schwarm.jpg' })
    expect(edition.filled).toBe(true)
    const review = reviewOf(german, edition, true)
    expect(review.shown?.coverUrl).toBe('https://example.test/schwarm.jpg')
    expect(review.tier).not.toBe('needsLook')
  })

  it('the same edition named twice keeps its cover (its twin at Apple is the same ISBN)', async () => {
    // What the measurement showed: the coverless National Library edition entered the pool first and its
    // covered twin (the very ISBN at Apple) was dropped as the same edition, so the row showed no cover.
    const twin = snapshot({ title: 'Der Schwarm', authors: ['Frank Schätzing'], isbn13: SCHWARM.isbn13, source: 'apple', appleId: '9001', language: 'ger', coverUrl: 'https://example.test/schwarm.jpg' })
    const book = row({ ...german, isbn13: SCHWARM.isbn13 })
    const edition = await findEdition(book, {
      catalogue: { search: async () => [] },
      search: { lookupIsbn: async () => snapshotFromDnbEdition(SCHWARM), search: async () => outcome([twin]) },
      dnb: { editions: async () => [snapshotFromDnbEdition(SCHWARM)] },
    })
    expect(edition.via).toBe('isbn')
    expect(edition.book.source).toBe('dnb')
    expect(edition.alternatives?.[0]).toMatchObject({ source: 'dnb', coverUrl: 'https://example.test/schwarm.jpg' })
    expect(reviewOf(book, edition, true).shown?.coverUrl).toBe('https://example.test/schwarm.jpg')
  })

  it('without one to borrow it is a row to look at (the existing rule)', async () => {
    const edition = await findEdition(german, lookupsWith([]))
    expect(edition.book).toBe(bare)
    const review = reviewOf(german, edition, true)
    expect(review.shown?.coverUrl).toBeNull()
    expect(review.tier).toBe('needsLook')
  })

  it('never settles a row for a cover, so the ladder goes on asking', () => {
    expect(settled(german, bare)).toBe(false)
    expect(settled(german, snapshotFromDnbEdition({ ...SCHWARM, coverUrl: 'https://covers.openlibrary.org/b/isbn/9783462041002-L.jpg' }))).toBe(false)
    expect(settled(german, snapshot({ source: 'apple', coverUrl: 'https://example.test/e.jpg', language: 'ger' }))).toBe(true)
  })
})
