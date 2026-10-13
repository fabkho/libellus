import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { findEdition, needsLook, rememberingAnswers, reviewOf, type Edition, type GoodreadsQuery, type Lookups } from '@/data/bookImport'
import type { ResolvedCover } from '@/data/covers'
import type { SourceName } from '@/data/merge'
import type { ImportBook } from '@/data/import/rows'
import type { SearchOutcome } from '@/data/search'

/**
 * The lookup one import row goes through (data/bookImport.ts: `findEdition`,
 * `reviewOf`, `needsLook`), on fakes: the sources answer as each case says,
 * nothing is asked of the network and no member's data is involved. The rows
 * are invented ("Bleak House"/"Charles Dickens", "Moby Dick"/"Herman
 * Melville"), their ISBNs invented 979s with a real check digit (as
 * tests/goodreads-import.test.ts's `uniqueIsbn`). A source's answer is a
 * SearchOutcome-shaped object with its `editions` (search.ts) and the sources
 * that did not answer (`unanswered`).
 */

/** An invented ISBN-13 of the 979 range, its check digit computed. */
function isbn(body: string): string {
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/** One row as an export maps it (tests/goodreads-import.test.ts's `row`). */
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

/** One edition a source named (tests/search.test.ts's `snapshot`). */
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

/** A title search's answer: these editions, and which sources did not answer (a refusal is no "nothing found"). */
const outcome = (editions: BookSnapshot[], unanswered: SourceName[] = []): SearchOutcome => ({
  results: [],
  pending: false,
  failed: false,
  editions,
  unanswered,
})

/** A `Lookups` whose sources answer as the case says; the Catalogue knows nothing. */
function lookups(answers: {
  lookupIsbn?: Lookups['search']['lookupIsbn']
  search?: Lookups['search']['search']
  goodreads?: NonNullable<Lookups['goodreads']>
}): Lookups {
  return {
    catalogue: { search: async () => [] },
    search: {
      lookupIsbn: answers.lookupIsbn ?? (async () => null),
      search: answers.search ?? (async () => outcome([])),
    },
    ...(answers.goodreads ? { goodreads: answers.goodreads } : {}),
  }
}

describe('findEdition', () => {
  it('carries the raw genre labels of the edition and its work\'s other editions, with their sources', async () => {
    const apple = snapshot({ title: 'Moby Dick', authors: ['Herman Melville'], coverUrl: 'https://example.test/e.jpg', genreLabels: ['Classics'] })
    const print = snapshot({ title: 'Moby Dick', authors: ['Herman Melville'], source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', genreLabels: ['Whaling', 'classics'] })
    const edition = await findEdition(row({ title: 'Moby Dick', authors: ['Herman Melville'], binding: 'Kindle Edition', isbn13: null }), lookups({ search: async () => outcome([print, apple]) }))
    expect(edition.genres).toEqual([
      { label: 'Classics', sources: ['apple', 'openlibrary'], from: [0, 1] },
      { label: 'Whaling', sources: ['openlibrary'], from: [1] },
    ])
  })

  it('met only a translation, it asks the Open Library work for an edition in the row\'s language', async () => {
    const german = snapshot({ title: 'The Old Man and the Sea', authors: ['Ernest Hemingway'], source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL5M', openLibraryWorkKey: 'OL9W', language: 'ger', coverUrl: 'https://example.test/de.jpg' })
    const english = { ...german, openLibraryEditionKey: 'OL6M', language: 'eng', coverUrl: 'https://example.test/en.jpg' }
    const asked: string[] = []
    const edition = await findEdition(row({ title: 'The Old Man and the Sea', authors: ['Ernest Hemingway'], isbn13: null }), {
      ...lookups({ search: async () => outcome([german]) }),
      search: { lookupIsbn: async () => null, search: async () => outcome([german]), workEditions: async (work) => (asked.push(work.key), [english]) },
    })
    expect(asked).toEqual(['OL9W'])
    expect(edition.book.coverUrl).toBe('https://example.test/en.jpg')
  })

  it('takes the Apple ebook of the work for an ebook row, not the print edition beside it', async () => {
    const print = snapshot({
      title: 'Moby Dick',
      authors: ['Herman Melville'],
      source: 'openlibrary',
      appleId: null,
      openLibraryEditionKey: 'OL1M',
      coverUrl: 'https://example.test/print.jpg',
    })
    const apple = snapshot({ title: 'Moby Dick', authors: ['Herman Melville'], source: 'apple', appleId: '9001', coverUrl: 'https://example.test/ebook.jpg' })
    const edition = await findEdition(
      row({ title: 'Moby Dick', authors: ['Herman Melville'], binding: 'Kindle Edition', isbn13: null }),
      lookups({ search: async () => outcome([print, apple]) }),
    )
    expect(edition.via).toBe('title')
    expect(edition.book.source).toBe('apple')
    expect(edition.unsure).toBe(false)
  })

  it("matches an ISBN no source knows to its work's edition a title search finds: a real Book, not the file's own row", async () => {
    const work = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL2M', coverUrl: 'https://example.test/bleak.jpg' })
    const edition = await findEdition(
      row({ isbn13: isbn('979000000101') }),
      lookups({ lookupIsbn: async () => null, search: async () => outcome([work]) }),
    )
    expect(edition.via).toBe('title')
    expect(edition.book).toBe(work)
    expect(edition.unsure).toBe(false)
  })

  it('a source that refuses is no miss: the row stays unsure, never a final "nothing found"', async () => {
    const edition = await findEdition(
      row({ isbn13: isbn('979000000102') }),
      lookups({
        lookupIsbn: async () => {
          throw new Error('Apple refused')
        },
        search: async () => outcome([], ['apple']),
      }),
    )
    expect(edition.via).toBeNull()
    expect(edition.unsure).toBe(true)
  })

  it('found while Apple was refused: a print edition with a cover will do for an ebook row (any format), asked again for the ebook', async () => {
    const print = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL3M', coverUrl: 'https://example.test/house.jpg' })
    const refused = lookups({ search: async () => outcome([print], ['apple']) })

    const kindle = await findEdition(row({ title: 'Bleak House', authors: ['Charles Dickens'], binding: 'Kindle Edition', isbn13: null }), refused)
    expect(kindle).toMatchObject({ via: 'title', unsure: false, retry: true })

    const hardcover = await findEdition(row({ title: 'Bleak House', authors: ['Charles Dickens'], binding: 'Hardcover', isbn13: null }), refused)
    expect(hardcover.via).toBe('title')
    expect(hardcover.unsure).toBe(false)
    expect(hardcover.retry).toBeUndefined()
  })

  it('found while Apple was refused, without a cover anywhere: unsure (a source may have one)', async () => {
    const bare = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL4M', coverUrl: null })
    const edition = await findEdition(row({ title: 'Bleak House', authors: ['Charles Dickens'], binding: 'Hardcover', isbn13: null }), lookups({ search: async () => outcome([bare], ['apple']) }))
    expect(edition).toMatchObject({ via: 'title', unsure: true })
  })

  it('an ISBN lookup that was refused: the title match stands and is asked again for the very edition', async () => {
    const print = snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL3M', coverUrl: 'https://example.test/house.jpg' })
    const edition = await findEdition(
      row({ title: 'Bleak House', authors: ['Charles Dickens'], binding: 'Hardcover', isbn13: isbn('979000000110') }),
      lookups({ lookupIsbn: async () => Promise.reject(new Error('429')), search: async () => outcome([print]) }),
    )
    expect(edition).toMatchObject({ via: 'title', unsure: false, retry: true })
  })

  it('a Goodreads row nothing anywhere found for takes its Goodreads cover as the last resort', async () => {
    const asked: GoodreadsQuery[] = []
    const edition = await findEdition(
      row({ title: 'The Quiet Harbour', authors: ['Lena Marsh'], sourceId: '42', isbn13: null }),
      lookups({
        search: async () => outcome([]),
        goodreads: async (query) => {
          asked.push(query)
          return { coverUrl: 'https://example.test/c.jpg', coverThumbhash: null, coverColors: null } satisfies ResolvedCover
        },
      }),
    )
    expect(edition.via).toBeNull()
    expect(edition.goodreadsOnly).toBe(true)
    expect(edition.coverFrom?.coverUrl ?? edition.book.coverUrl).toBe('https://example.test/c.jpg')
    expect(asked).toEqual([{ title: 'The Quiet Harbour', authors: ['Lena Marsh'], goodreadsBookId: '42' }])
  })

  it('does not ask Goodreads for a row a source refused (unsure): a better edition may come', async () => {
    let asked = 0
    const edition = await findEdition(
      row({ title: 'The Quiet Harbour', authors: ['Lena Marsh'], sourceId: '42', isbn13: isbn('979000000103') }),
      lookups({
        lookupIsbn: async () => {
          throw new Error('Apple refused')
        },
        search: async () => outcome([], ['apple']),
        goodreads: async () => {
          asked++
          return { coverUrl: 'https://example.test/c.jpg', coverThumbhash: null, coverColors: null }
        },
      }),
    )
    expect(edition.unsure).toBe(true)
    expect(edition.goodreadsOnly).toBeUndefined()
    expect(asked).toBe(0)
  })
})

describe('reviewOf', () => {
  type ReviewRow = Pick<ImportBook, 'title' | 'isbn13' | 'language' | 'problems'>
  const reviewRow = (overrides: Partial<ReviewRow> = {}): ReviewRow => ({
    title: 'Bleak House',
    isbn13: null,
    language: null,
    problems: [],
    ...overrides,
  })

  it('a matched edition without any cover is never "probably fine"', () => {
    const edition: Edition = {
      book: snapshot({ source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL4M', isbn13: isbn('979000000104') }),
      via: 'isbn',
      unsure: false,
    }
    const review = reviewOf(reviewRow(), edition, true)
    expect(review.tier).toBe('needsLook')
  })

  it('a match by title with its own cover is "probably fine", with a byTitle note', () => {
    const edition: Edition = { book: snapshot({ year: 1853, language: 'en', coverUrl: 'https://example.test/bleak.jpg' }), via: 'title', unsure: false }
    const review = reviewOf(reviewRow(), edition, true)
    expect(review.tier).toBe('probablyFine')
    expect(review.notes).toContainEqual({ code: 'byTitle', year: 1853, language: 'en' })
  })

  it('an ISBN match without a cover of its own, borrowing one from its work, does not need a look', () => {
    const lent = isbn('979000000105')
    const edition: Edition = {
      book: snapshot({ source: 'import', appleId: null, isbn13: lent }),
      via: 'isbn',
      unsure: false,
      coverFrom: snapshot({ coverUrl: 'https://example.test/lent.jpg' }),
    }
    const review = reviewOf(reviewRow({ isbn13: lent }), edition, true)
    expect(review.tier).not.toBe('needsLook')
    expect(review.shown).toMatchObject({ coverUrl: 'https://example.test/lent.jpg' })
  })

  it('an unmatched Goodreads row with a cover of its own is "probably fine"', () => {
    const edition: Edition = {
      book: snapshot({ source: 'manual', appleId: null, coverUrl: 'https://example.test/c.jpg' }),
      via: null,
      unsure: false,
      goodreadsOnly: true,
    }
    const review = reviewOf(reviewRow(), edition, false)
    expect(review.tier).toBe('probablyFine')
  })

  it('an unmatched row without an ISBN (and not goodreadsOnly) needs a look', () => {
    const edition: Edition = { book: snapshot({ source: 'manual', appleId: null }), via: null, unsure: false }
    const review = reviewOf(reviewRow(), edition, false)
    expect(review.tier).toBe('needsLook')
  })

  it('a match by title while a source could not be asked needs a look, with an unsureFound note', () => {
    const edition: Edition = { book: snapshot({ coverUrl: 'https://example.test/bleak.jpg' }), via: 'title', unsure: true }
    const review = reviewOf(reviewRow(), edition, true)
    expect(review.tier).toBe('needsLook')
    expect(review.notes).toContainEqual({ code: 'unsureFound' })
  })

  it('a match by title in another language than hers is a translation: it needs a look', () => {
    const edition: Edition = {
      book: snapshot({ title: 'The Old Man and the Sea', language: 'de', coverUrl: 'https://example.test/old-man-de.jpg' }),
      via: 'title',
      unsure: false,
    }
    const review = reviewOf(reviewRow({ title: 'The Old Man and the Sea' }), edition, true)
    expect(review.tier).toBe('needsLook')
    expect(review.notes).toContainEqual({ code: 'byTitle', year: null, language: 'de' })
  })
})

describe('needsLook', () => {
  it('does not throw when called with its defaults', () => {
    expect(() => needsLook(null, null)).not.toThrow()
    expect(needsLook(null, null)).toBe(true)
    expect(needsLook('fromFile', null)).toBe(true)
    expect(needsLook('matched', { coverUrl: 'https://example.test/c.jpg' })).toBe(false)
  })
})

describe('rememberingAnswers', () => {
  it('asks a question every source answered once per import, and one a source refused again', async () => {
    const asked: string[] = []
    let refuse = true
    const remembered = rememberingAnswers(
      lookups({
        search: async (query) => {
          asked.push(query)
          if (query.startsWith('Persuasion') && refuse) return outcome([], ['apple'])
          return outcome([snapshot({ title: query })])
        },
      }),
    )
    await remembered.search.search('Bleak House Dickens')
    await remembered.search.search('bleak  house dickens')
    await remembered.search.search('Bleak House Dickens', { sources: ['catalogue', 'openlibrary'] })
    expect(asked).toEqual(['Bleak House Dickens', 'Bleak House Dickens'])
    await remembered.search.search('Persuasion Austen')
    refuse = false
    await remembered.search.search('Persuasion Austen')
    await remembered.search.search('Persuasion Austen')
    expect(asked.filter((query) => query.startsWith('Persuasion'))).toHaveLength(2)
  })
})

describe('sparing Apple', () => {
  it('asks Apple only when the free sources leave the row unsettled: an ebook row, or nothing with a cover', async () => {
    const sourcesAsked: string[] = []
    const print = snapshot({ title: 'Persuasion', authors: ['Jane Austen'], source: 'openlibrary', appleId: null, openLibraryEditionKey: 'OL1M', coverUrl: 'https://example.test/print.jpg' })
    const answering = lookups({
      search: async (_query, options) => {
        sourcesAsked.push((options?.sources ?? ['all']).join(','))
        return outcome(options?.sources?.includes('apple') ? [] : [print])
      },
    })
    await findEdition(row({ title: 'Persuasion', authors: ['Jane Austen'], binding: 'Paperback', isbn13: null }), answering)
    expect(sourcesAsked).toEqual(['catalogue,openlibrary'])
    sourcesAsked.length = 0
    await findEdition(row({ title: 'Persuasion', authors: ['Jane Austen'], binding: 'Kindle Edition', isbn13: null }), answering)
    expect(sourcesAsked.slice(0, 2)).toEqual(['catalogue,openlibrary', 'apple'])
  })
})
