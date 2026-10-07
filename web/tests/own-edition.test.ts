import { describe, expect, it } from 'vitest'
import { formatOf, isbnParts, parseIsbn, type Book, type BookSnapshot } from '@/data/books'
import type { CatalogueSearch } from '@/data/catalogueSearch'
import { resolveOwnCover } from '@/data/covers'
import { createEditions, isbnEdition, mergeEditions } from '@/data/editions'
import type { FetchLike } from '@/data/fetching'
import { createLibrary, type LibraryEntry } from '@/data/library'
import {
  createOpenLibrary,
  formatFromPhysical,
  snapshotFromEditionRecord,
  WORK_EDITIONS_LIMIT,
  type OpenLibraryEditionRecord,
} from '@/data/openLibrary'
import { newOwnEditionDraft, ownEditionSnapshot, validateOwnEdition, type OwnEditionDraft } from '@/data/ownEdition'
import { addDays, isoDay } from '@/utils/dates'
import { appleAnswer } from './support/apple'
import { signUpMember } from './support/member'
import { openLibraryAnswer } from './support/openLibrary'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * "My edition isn't listed" (Change edition). The owner's case: his *I Am
 * Legend* is ISBN 978-1-399-60773-5 (Gollancz, 2022), which OpenLibrary knows
 * and Change edition never offered — it is the 53rd of the 55 editions
 * OpenLibrary files under the work, and only the first 50 were asked for.
 * Recorded answers (tests/fixtures/openlibrary: the ISBN's search answer and
 * edition record, the work's 55 editions; Apple knows nothing of it). Then the
 * ISBN rules, the lookup in every source, her own edition's form, and the
 * repository's format and own-edition calls against the local stack.
 */

const LEGEND_ISBN = '9781399607735'
const LEGEND_WORK = 'OL11374287W'

type Recorded = FetchLike & { asked: URL[] }

function recorded({ failing = [] as string[] } = {}): Recorded {
  const asked: URL[] = []
  const fetch = (async (input: string) => {
    const url = new URL(input)
    asked.push(url)
    const apple = url.hostname === 'itunes.apple.com'
    if (!apple && url.hostname !== 'openlibrary.org') throw new Error(`Unexpected request to ${url.hostname}`)
    if (failing.includes(apple ? 'apple' : 'openlibrary')) return { ok: false, status: 503, json: async () => ({}) }
    const body = apple ? appleAnswer(url) : openLibraryAnswer(url)
    return { ok: true, status: 200, json: async () => body }
  }) as Recorded
  fetch.asked = asked
  return fetch
}

function snapshot(fields: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: 'I Am Legend',
    authors: ['Richard Matheson'],
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
    ...fields,
  }
}

function book(fields: Partial<Book> = {}): Book {
  return { ...snapshot(fields), id: fields.id ?? crypto.randomUUID(), createdAt: '2026-10-07T00:00:00Z', ...fields }
}

function catalogueOf(books: Book[]): CatalogueSearch {
  return {
    search: async () => books.map((found) => ({ book: found, source: 'catalogue' as const, popularity: 0 })),
    libraryEntries: async () => [],
  }
}

// ------------------------------------------------------------------- ISBNs

describe('isbnParts', () => {
  it('reads an ISBN-13 with hyphens and spaces as she types it', () => {
    expect(isbnParts('978-1-399-60773-5')).toEqual({ isbn13: LEGEND_ISBN, isbn10: null })
    expect(isbnParts(' 978 1399 607735 ')).toEqual({ isbn13: LEGEND_ISBN, isbn10: null })
  })

  it('keeps an ISBN-10 and its ISBN-13, an X check digit too', () => {
    expect(isbnParts('1-399-60773-1')).toEqual({ isbn13: LEGEND_ISBN, isbn10: '1399607731' })
    expect(isbnParts('0-8044-2957-x')).toEqual({ isbn13: '9780804429573', isbn10: '080442957X' })
  })

  it('refuses a check digit that does not add up, and anything that is no ISBN', () => {
    expect(isbnParts('978-1-399-60773-6')).toBeNull()
    expect(isbnParts('1399607732')).toBeNull()
    expect(isbnParts('97813996077')).toBeNull()
    expect(isbnParts('I Am Legend')).toBeNull()
    expect(parseIsbn('978-1-399-60773-5')).toBe(LEGEND_ISBN)
  })
})

// ----------------------------------------------------------------- formats

describe('formats', () => {
  it('reads OpenLibrary\'s physical format, in the words its editions use', () => {
    expect(formatFromPhysical('Paperback')).toBe('paperback')
    expect(formatFromPhysical('Mass Market Paperback')).toBe('paperback')
    expect(formatFromPhysical('Brossura')).toBe('paperback')
    expect(formatFromPhysical('Taschenbuch')).toBe('paperback')
    expect(formatFromPhysical('Hardcover')).toBe('hardcover')
    expect(formatFromPhysical('Library Binding')).toBe('hardcover')
    expect(formatFromPhysical('Gebundene Ausgabe')).toBe('hardcover')
    expect(formatFromPhysical('Audio CD')).toBe('audiobook')
    expect(formatFromPhysical('MP3 CD')).toBe('audiobook')
    expect(formatFromPhysical('Audio cassette')).toBe('audiobook')
    expect(formatFromPhysical('ebook')).toBe('ebook')
    expect(formatFromPhysical('Kindle Edition')).toBe('ebook')
    expect(formatFromPhysical('CD-ROM')).toBeNull()
    expect(formatFromPhysical('')).toBeNull()
    expect(formatFromPhysical(undefined)).toBeNull()
  })

  it('counts her own word first, then the source\'s; Apple\'s editions are ebooks', () => {
    expect(formatOf({ source: 'apple' })).toBe('ebook')
    expect(formatOf({ source: 'openlibrary', format: 'paperback' })).toBe('paperback')
    expect(formatOf({ source: 'openlibrary', format: null })).toBeNull()
    expect(formatOf({ source: 'apple', format: 'ebook' }, 'paperback')).toBe('paperback')
  })
})

// ------------------------------------------------------ the work's editions

describe('the owner\'s I Am Legend', () => {
  it('is among the work\'s editions now that every page of them is asked for', async () => {
    const fetch = recorded()
    const editions = await createOpenLibrary({ fetch, languages: ['en'] }).workEditions({ key: LEGEND_WORK, authors: ['Richard Matheson'] })

    expect(editions).toHaveLength(55)
    expect(editions.findIndex((edition) => edition.isbn13 === LEGEND_ISBN)).toBe(52)
    expect(editions.find((edition) => edition.isbn13 === LEGEND_ISBN)).toMatchObject({
      title: 'I Am Legend',
      authors: ['Richard Matheson'],
      year: 2022,
      publisher: 'Orion Publishing Group, Limited',
      language: 'eng',
      coverUrl: 'https://covers.openlibrary.org/b/id/14805160-L.jpg',
      openLibraryEditionKey: 'OL37999305M',
    })
    // OpenLibrary's free-text format, read.
    expect(editions.find((edition) => edition.isbn13 === '9781857988093')?.format).toBe('paperback')
    expect(editions.find((edition) => edition.isbn13 === '9781433203312')?.format).toBe('audiobook')
  })

  it('pages through a work with hundreds of editions, up to a limit', async () => {
    const asked: URL[] = []
    const fetch: FetchLike = async (input) => {
      const url = new URL(input)
      asked.push(url)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit'))
      const entries = Array.from({ length: Math.max(0, Math.min(limit, 1000 - offset)) }, (_, i) => ({
        key: `/books/OL${offset + i + 1}M`,
        title: 'Dune',
      }))
      return { ok: true, status: 200, json: async () => ({ size: 1000, entries }) }
    }
    const editions = await createOpenLibrary({ fetch, languages: ['en'] }).workEditions({ key: 'OL893415W', authors: ['Frank Herbert'] })

    expect(editions).toHaveLength(WORK_EDITIONS_LIMIT)
    expect(asked.map((url) => url.searchParams.get('offset') ?? '0')).toEqual(['0', '100', '200'])
  })

  it('is in Change edition\'s list for a Book of the work, an English one with its cover among the first', async () => {
    const current = book({ appleId: uniqueAppleId(), openLibraryWorkKey: LEGEND_WORK, coverUrl: 'https://example.com/a.jpg' })
    const outcome = await createEditions({ fetch: recorded(), languages: ['en'] }).find(current)
    const rows = outcome.candidates.map((candidate) => candidate.book.isbn13)

    expect(rows).toContain(LEGEND_ISBN)
    // An Apple Book has no language: the device's ranks first after the cover.
    const legend = rows.indexOf(LEGEND_ISBN)
    expect(legend).toBeGreaterThan(0)
    expect(legend).toBeLessThan(25)
  })

  it('ranks the editions in the device\'s language next when the current Book has none', () => {
    const current = book({ language: null })
    const italian = snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL1M', isbn13: '9788804723974', language: 'ita', coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' })
    const english = snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL2M', isbn13: LEGEND_ISBN, language: 'eng', coverUrl: 'https://covers.openlibrary.org/b/id/2-L.jpg' })

    expect(mergeEditions(current, { work: [italian, english] }, 'en').map((row) => row.book.isbn13)).toEqual([null, LEGEND_ISBN, '9788804723974'])
    expect(mergeEditions(current, { work: [italian, english] }).map((row) => row.book.isbn13)).toEqual([null, '9788804723974', LEGEND_ISBN])
  })
})

// --------------------------------------------------------------- by ISBN

describe('an edition by its ISBN', () => {
  it('reads OpenLibrary\'s edition record: pages from its pagination, its work, its language', () => {
    const record = openLibraryAnswer(new URL(`https://openlibrary.org/isbn/${LEGEND_ISBN}.json`)) as OpenLibraryEditionRecord
    expect(snapshotFromEditionRecord(record, ['Richard Matheson'])).toMatchObject({
      title: 'I Am Legend',
      authors: ['Richard Matheson'],
      isbn13: LEGEND_ISBN,
      pageCount: 176,
      year: 2022,
      language: 'eng',
      publisher: 'Orion Publishing Group, Limited',
      openLibraryEditionKey: 'OL37999305M',
      openLibraryWorkKey: LEGEND_WORK,
      format: null,
    })
    expect(snapshotFromEditionRecord({})).toBeNull()
  })

  it('finds the owner\'s edition in every source: OpenLibrary knows it, Apple does not', async () => {
    const fetch = recorded()
    const current = book({ appleId: uniqueAppleId() })
    const outcome = await createEditions({ fetch, languages: ['en'], catalogue: catalogueOf([]) }).lookupIsbn(current, LEGEND_ISBN)

    expect(outcome.failed).toBe(false)
    expect(outcome.edition).toMatchObject({
      title: 'I Am Legend',
      authors: ['Richard Matheson'],
      isbn13: LEGEND_ISBN,
      pageCount: 176,
      year: 2022,
      publisher: 'Orion Publishing Group, Limited',
      coverUrl: 'https://covers.openlibrary.org/b/id/14805160-L.jpg',
      source: 'openlibrary',
      openLibraryEditionKey: 'OL37999305M',
      openLibraryWorkKey: LEGEND_WORK,
    })
    expect(outcome.edition && formatOf(outcome.edition)).toBeNull()
    // Apple's lookup and OpenLibrary's record and search were all asked.
    expect(fetch.asked.some((url) => url.hostname === 'itunes.apple.com' && url.searchParams.get('isbn') === LEGEND_ISBN)).toBe(true)
    expect(fetch.asked.some((url) => url.pathname === `/isbn/${LEGEND_ISBN}.json`)).toBe(true)
    expect(fetch.asked.some((url) => url.pathname === '/search.json' && url.searchParams.get('isbn') === LEGEND_ISBN)).toBe(true)
  })

  it('says nobody knows an ISBN no source has, and that it could not tell when none answered', async () => {
    const current = book()
    const nowhere = await createEditions({ fetch: recorded(), languages: ['en'] }).lookupIsbn(current, '9790000042018')
    expect(nowhere).toEqual({ edition: null, failed: false })

    const away = await createEditions({ fetch: recorded({ failing: ['apple', 'openlibrary'] }), languages: ['en'] }).lookupIsbn(current, LEGEND_ISBN)
    expect(away).toEqual({ edition: null, failed: true })
  })

  it('takes the Catalogue\'s Book first, never a Manual one', async () => {
    const catalogued = book({ isbn13: LEGEND_ISBN, source: 'openlibrary', openLibraryEditionKey: 'OL37999305M' })
    const hers = book({ isbn13: LEGEND_ISBN, source: 'manual' })
    const outcome = await createEditions({ fetch: recorded(), languages: ['en'], catalogue: catalogueOf([hers, catalogued]) }).lookupIsbn(book(), LEGEND_ISBN)
    expect(outcome.edition).toBe(catalogued)
  })

  it('lets OpenLibrary\'s edition lead, Apple\'s fill in, but never with Apple\'s ebook format', () => {
    const fromOpenLibrary = snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL37999305M', isbn13: LEGEND_ISBN, pageCount: 176, authors: [] })
    const fromApple = snapshot({ source: 'apple', appleId: '123', isbn13: LEGEND_ISBN, coverUrl: 'https://is1-ssl.mzstatic.com/a.jpg', description: 'Neville.', format: 'ebook' })

    const merged = isbnEdition({ authors: ['Richard Matheson'] }, LEGEND_ISBN, { openlibrary: [fromOpenLibrary], apple: [fromApple] })
    expect(merged).toMatchObject({ source: 'openlibrary', appleId: null, pageCount: 176, coverUrl: fromApple.coverUrl, description: 'Neville.', authors: ['Richard Matheson'] })
    expect(merged && formatOf(merged)).toBeNull()

    // Apple's edition alone is what it is: an ebook.
    const apple = isbnEdition({ authors: ['Richard Matheson'] }, LEGEND_ISBN, { apple: [fromApple], openlibrary: [] })
    expect(apple && formatOf(apple)).toBe('ebook')
    expect(isbnEdition({ authors: [] }, LEGEND_ISBN, { apple: [], openlibrary: [] })).toBeNull()
  })
})

// -------------------------------------------------------- her own edition

describe('her own edition\'s form', () => {
  const draft = (fields: Partial<OwnEditionDraft> = {}): OwnEditionDraft => ({ ...newOwnEditionDraft({ language: 'eng' }), ...fields })

  it('starts with the Book\'s language and the ISBN she looked up', () => {
    expect(newOwnEditionDraft({ language: 'eng' }, '978-1-399-60773-5')).toMatchObject({ language: 'en', isbn: '978-1-399-60773-5', format: null })
    expect(newOwnEditionDraft({ language: 'xx' }).language).toBe('')
  })

  it('needs a format, and marks what cannot be stored', () => {
    expect(validateOwnEdition(draft(), 2026)).toEqual({ format: true })
    expect(validateOwnEdition(draft({ format: 'paperback' }), 2026)).toEqual({})
    expect(
      validateOwnEdition(
        draft({ format: 'paperback', isbn: '978-1-399-60773-6', year: '2030', pageCount: '0', coverUrl: 'http://example.com/a.jpg', publisher: 'x'.repeat(501) }),
        2026,
      ),
    ).toEqual({ isbn: true, year: true, pageCount: true, coverUrl: true, publisher: true })
    expect(validateOwnEdition(draft({ format: 'ebook', year: '2027', pageCount: '176', coverUrl: 'https://example.com/a.jpg' }), 2026)).toEqual({})
  })

  it('becomes a Manual book with the Book\'s title and authors and what she typed', () => {
    const own = ownEditionSnapshot(
      { title: 'I Am Legend', authors: ['Richard Matheson'] },
      draft({ format: 'paperback', isbn: '1-399-60773-1', year: '2022', publisher: ' Gollancz ', pageCount: '176', coverUrl: ' https://example.com/legend.jpg ' }),
    )
    expect(own).toMatchObject({
      title: 'I Am Legend',
      authors: ['Richard Matheson'],
      isbn13: LEGEND_ISBN,
      isbn10: '1399607731',
      year: 2022,
      publisher: 'Gollancz',
      pageCount: 176,
      language: 'en',
      coverUrl: 'https://example.com/legend.jpg',
      source: 'manual',
      format: 'paperback',
    })
  })

  it('keeps the cover she gave, read when it can be, else as it is; without one her ISBN may have one', async () => {
    const pixels = { width: 2, height: 3, data: new Uint8ClampedArray(2 * 3 * 4).fill(200) }
    const readable = await resolveOwnCover(snapshot({ source: 'manual', coverUrl: 'https://example.com/a.jpg' }), {
      probe: async () => ({ width: 400, height: 600, pixels }),
    })
    expect(readable).toMatchObject({ coverUrl: 'https://example.com/a.jpg' })
    expect(readable.coverThumbhash).not.toBeNull()
    const unreadable = await resolveOwnCover(snapshot({ source: 'manual', coverUrl: 'https://example.com/b.jpg' }), {
      probe: async () => {
        throw new Error('CORS')
      },
    })
    expect(unreadable).toEqual({ coverUrl: 'https://example.com/b.jpg', coverThumbhash: null, coverColors: null })
    const byIsbn = await resolveOwnCover(snapshot({ source: 'manual', isbn13: LEGEND_ISBN }), {
      probe: async (url) => (url.includes(`/isbn/${LEGEND_ISBN}`) ? { width: 400, height: 600, pixels: { ...pixels, data: pixels.data.map((v, i) => (i % 8 ? v : 10)) } } : null),
    })
    expect(byIsbn.coverUrl).toContain(`/b/isbn/${LEGEND_ISBN}-L.jpg`)
  })
})

// ----------------------------------------------------------- the database

describe('formats and her own edition in the Library', () => {
  const today = isoDay()
  const edition = (title: string, fields: Partial<BookSnapshot> = {}) =>
    snapshot({ title: runTitle(title), publisher: TEST_PUBLISHER, appleId: uniqueAppleId(), ...fields })

  it('keeps her word on the format on her entry, never on the shared Book', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const added = (await library.addToLibrary(edition('I Am Legend'))).data as LibraryEntry
    expect(added.book.format).toBe('ebook')
    expect(added.formatOverride).toBeNull()

    const paperback = await library.setFormat(added.id, 'paperback')
    expect(paperback.error).toBeNull()
    expect(paperback.data!.formatOverride).toBe('paperback')
    expect(formatOf(paperback.data!.book, paperback.data!.formatOverride)).toBe('paperback')
    expect((await library.book(added.book.id)).data!.format).toBe('ebook')
    // Her word equal to the Book's is none.
    expect((await library.setFormat(added.id, 'ebook')).data!.formatOverride).toBeNull()
  })

  it('changes to an edition with the format she says it is', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const added = (await library.addToLibrary(edition('I Am Legend'))).data as LibraryEntry

    const printed = edition('I Am Legend (Gollancz)', { source: 'openlibrary', appleId: null, openLibraryEditionKey: `OL${uniqueAppleId().slice(2, 10)}M` })
    const { data, error } = await library.changeEdition(added.id, printed, 'hardcover')

    expect(error).toBeNull()
    expect(data).toMatchObject({ id: added.id, formatOverride: 'hardcover', book: { title: printed.title, format: null } })
  })

  it('makes her own edition, keeps the reads, and shows it to nobody else', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const library = createLibrary(ida.client)
    const added = (await library.addToLibrary(edition('I Am Legend', { pageCount: 312 }), {
      status: 'finished', startedOn: addDays(today, -30), endedOn: addDays(today, -20), rating: 16,
    })).data as LibraryEntry
    const readsBefore = (await library.sessions(added.id)).data!

    const own = ownEditionSnapshot(added.book, {
      format: 'paperback', isbn: '978-1-399-60773-5', year: '2022', publisher: 'Gollancz', pageCount: '176', language: 'en', coverUrl: '',
    })
    const { data, error } = await library.useOwnEdition(added.id, own)

    expect(error).toBeNull()
    expect(data).toMatchObject({
      id: added.id,
      status: 'finished',
      formatOverride: null,
      book: { title: added.book.title, authors: ['Richard Matheson'], source: 'manual', format: 'paperback', isbn13: LEGEND_ISBN, pageCount: 176, year: 2022, publisher: 'Gollancz', language: 'en' },
    })
    expect((await library.sessions(added.id)).data!.map((read) => read.id)).toEqual(readsBefore.map((read) => read.id))
    expect((await createLibrary(max.client).book(data!.book.id)).data).toBeNull()

    // Without a format it is refused, and an ISBN that does not add up too.
    expect((await library.useOwnEdition(added.id, { ...own, format: null })).error).toBe('book_invalid')
    expect((await library.useOwnEdition(added.id, { ...own, isbn13: '9781399607736' })).error).toBe('isbn_invalid')
  })

  it('is refused offline without sending anything', async () => {
    const member = await signUpMember()
    const added = (await createLibrary(member.client).addToLibrary(edition('I Am Legend'))).data as LibraryEntry
    const offline = createLibrary(member.client, { online: () => false })
    expect((await offline.setFormat(added.id, 'paperback')).error).toBe('offline')
    expect((await offline.useOwnEdition(added.id, ownEditionSnapshot(added.book, { ...newOwnEditionDraft(added.book), format: 'ebook' }))).error).toBe('offline')
  })
})
