import { randomInt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createCatalogueSearch } from '@/data/catalogueSearch'
import {
  createGoodreadsImport,
  eachLimited,
  entryFor,
  findEdition,
  importedKeys,
  libraryTitleIndex,
  pacedFetch,
  type Edition,
  type ImportRow,
  type Lookups,
} from '@/data/goodreadsImport'
import { parseGoodreads, type GoodreadsBook } from '@/data/import/goodreads'
import { createLibrary } from '@/data/library'
import { createSearch, type FetchLike } from '@/data/search'
import { isoDay } from '@/utils/dates'
import { appleAnswer } from './support/apple'
import { signUpMember } from './support/member'
import { openLibraryAnswer } from './support/openLibrary'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The Goodreads import (#40) through its repository, against the local stack,
 * as real signed-in members: each book's edition found the way search finds
 * it, the rows written through `import_books`, and the same file twice adding
 * nothing. Apple and OpenLibrary answer from the recordings; the Catalogue is
 * the real one. Books the import puts into the Catalogue carry the run's tag
 * and the test publisher, so the sweep removes them.
 */

const today = isoDay()

/** A valid ISBN-13 no real book has (979-0, the music range), unique enough per run. */
function uniqueIsbn(): string {
  const body = `9790${String(randomInt(0, 1e8)).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

const wrap = (value: string) => `"=""${value}"""`

/** A small export in Goodreads' own shape, with this run's titles and ISBNs. */
function exportFile(isbns: { read: string; reading: string; owned: string; wish: string }) {
  const header =
    'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,Year Published,' +
    'Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,' +
    'Private Notes,Read Count,Owned Copies'
  const row = (cells: (string | number)[]) => cells.join(',')
  return [
    header,
    row([11, `"${runTitle('Harbour Lights')} (Harbour, #1)"`, 'Mira Okafor', '"Okafor, Mira"', '', wrap(''), wrap(isbns.read), 4,
      TEST_PUBLISHER, 'Paperback', 300, 2019, 2018, '2024/03/09', '2023/11/20', '', '', 'read', '"Lovely.<br/>Truly."', '', '', 1, 0]),
    row([12, runTitle('Field Notes'), 'Hanne Soberg', '"Soberg, Hanne"', '', wrap(''), wrap(isbns.reading), 0,
      TEST_PUBLISHER, 'Paperback', 210, 2020, '', '', '2025/08/01', '', '', 'currently-reading', '', '', '', 0, 0]),
    row([13, runTitle('Quiet Rooms'), 'Lea Marchetti', '"Marchetti, Lea"', '', wrap(''), wrap(''), 0,
      '', 'Paperback', 190, '', 2016, '', '2025/06/12', '', '', 'to-read', '', '', '', 0, 0]),
    row([14, runTitle('Already Mine'), 'Ola Strand', '"Strand, Ola"', '', wrap(''), wrap(isbns.owned), 5,
      TEST_PUBLISHER, 'Hardcover', 400, 2015, '', '2021/01/01', '2020/12/01', '', '', 'read', '', '', '', 1, 0]),
    row([15, runTitle('Glass Orchard'), 'Ilse Brandt', '"Brandt, Ilse"', '', wrap(''), wrap(isbns.wish), 0,
      TEST_PUBLISHER, '', '', '', '', '', '2025/06/10', '', '', 'wishlist', '', '', '', 0, 0]),
  ].join('\n')
}

/** Sources that know nothing: every book is the Catalogue's or the file's. */
const nowhere: Lookups['search'] = {
  lookupIsbn: async () => null,
  search: async () => ({ results: [], pending: false, failed: false }),
}

const noProbe = async () => null

function recorded(): FetchLike {
  return async (input) => {
    const url = new URL(input)
    const body = url.hostname === 'itunes.apple.com' ? appleAnswer(url) : openLibraryAnswer(url)
    return { ok: true, status: 200, json: async () => body }
  }
}

function snapshot(overrides: Partial<BookSnapshot>): BookSnapshot {
  return {
    title: runTitle('Snapshot'),
    authors: ['A. Writer'],
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    language: null,
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

/** Every edition the importer finds for the rows, in their order. */
async function matchAll(importer: ReturnType<typeof createGoodreadsImport>, books: readonly GoodreadsBook[]) {
  const editions: Edition[] = []
  await importer.match(books, { onEdition: (index, edition) => void (editions[index] = edition) })
  return editions
}

const rowsOf = (books: readonly GoodreadsBook[], editions: readonly Edition[]): ImportRow[] =>
  books.map((book, index) => ({
    key: book.key,
    title: book.title,
    authors: book.authors,
    status: book.status,
    session: book.session,
    addedOn: book.addedOn,
    book: editions[index]!.book,
  }))

describe('importing a Goodreads export', () => {
  it('adds every book with its Status and read, keeps what she has, and adds nothing the second time', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const isbns = { read: uniqueIsbn(), reading: uniqueIsbn(), owned: uniqueIsbn(), wish: uniqueIsbn() }

    // One of the books is in her Library already, being read, from search.
    const owned = await library.addToLibrary(snapshot({ title: runTitle('Already Mine'), isbn13: isbns.owned }), {
      status: 'reading',
      startedOn: today,
    })
    expect(owned.error).toBeNull()

    const { books } = parseGoodreads(exportFile(isbns), today)
    const catalogue = createCatalogueSearch(member.client)
    const importer = createGoodreadsImport(member.client, { lookups: { catalogue, search: nowhere }, probe: noProbe })

    const editions = await matchAll(importer, books)
    expect(editions.map((edition) => [edition.via, 'id' in edition.book, edition.book.source])).toEqual([
      [null, false, 'import'],
      [null, false, 'import'],
      [null, false, 'manual'],
      // Found in the Catalogue by its ISBN: the Book she has.
      ['isbn', true, 'apple'],
      [null, false, 'import'],
    ])
    const entries = await catalogue.libraryEntries()
    expect(editions.map((edition) => entryFor(edition.book, entries)?.id ?? null)).toEqual([null, null, null, owned.data!.id, null])

    const seen: string[] = []
    const first = await importer.write(rowsOf(books, editions), { onWritten: (chunk) => seen.push(...chunk.map((o) => o.outcome)) })
    expect(first.error).toBeNull()
    expect(first.data!.map((outcome) => outcome.outcome)).toEqual(['added', 'added', 'added', 'in_library', 'added'])
    expect(seen).toEqual(first.data!.map((outcome) => outcome.outcome))

    const stored = await sql<{ title: string; status: string; source: string; owner_id: string | null; sessions: unknown }>(
      `select b.title, e.status, b.source, b.owner_id,
              (select json_agg(json_build_object('started', s.started_on, 'ended', s.ended_on, 'outcome', s.outcome,
                                                 'rating', s.rating, 'review', s.review, 'key', s.import_key))
                 from public.reading_sessions s where s.entry_id = e.id) as sessions
         from public.library_entries e join public.books b on b.id = e.book_id
        where e.member_id = $1 order by b.title`,
      [member.id],
    )
    expect(stored).toEqual([
      {
        title: runTitle('Already Mine'),
        status: 'reading',
        source: 'apple',
        owner_id: null,
        sessions: [{ started: today, ended: null, outcome: null, rating: null, review: null, key: null }],
      },
      {
        title: runTitle('Field Notes'),
        status: 'reading',
        source: 'import',
        owner_id: null,
        sessions: [{ started: '2025-08-01', ended: null, outcome: null, rating: null, review: null, key: 'goodreads:12' }],
      },
      { title: runTitle('Glass Orchard'), status: 'want_to_read', source: 'import', owner_id: null, sessions: null },
      {
        title: runTitle('Harbour Lights'),
        status: 'finished',
        source: 'import',
        owner_id: null,
        sessions: [{ started: null, ended: '2024-03-09', outcome: 'finished', rating: 16, review: 'Lovely.\nTruly.', key: 'goodreads:11' }],
      },
      { title: runTitle('Quiet Rooms'), status: 'want_to_read', source: 'manual', owner_id: member.id, sessions: null },
    ])

    // The same file again: nothing new, whatever the lookups find this time.
    const keys = await importedKeys(member.client)
    expect([...keys.data!].sort()).toEqual(['goodreads:11', 'goodreads:12', 'goodreads:13', 'goodreads:15'])
    const again = await importer.write(rowsOf(books, await matchAll(importer, books)), { onWritten: () => {} })
    expect(again.data!.map((outcome) => outcome.outcome)).toEqual(['imported', 'imported', 'imported', 'in_library', 'imported'])
    const [counts] = await sql<{ entries: number; sessions: number; manual: number }>(
      `select (select count(*)::int from public.library_entries where member_id = $1) as entries,
              (select count(*)::int from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
                where e.member_id = $1) as sessions,
              (select count(*)::int from public.books where owner_id = $1) as manual`,
      [member.id],
    )
    expect(counts).toEqual({ entries: 5, sessions: 3, manual: 1 })
  })

  it('lets another member import the same file into her own Library, sharing the import Books', async () => {
    const [ida, max] = await Promise.all([signUpMember(), signUpMember()])
    const isbns = { read: uniqueIsbn(), reading: uniqueIsbn(), owned: uniqueIsbn(), wish: uniqueIsbn() }
    const { books } = parseGoodreads(exportFile(isbns), today)

    for (const member of [ida, max]) {
      const catalogue = createCatalogueSearch(member.client)
      const importer = createGoodreadsImport(member.client, { lookups: { catalogue, search: nowhere }, probe: noProbe })
      const written = await importer.write(rowsOf(books, await matchAll(importer, books)), { onWritten: () => {} })
      expect(written.data!.every((outcome) => outcome.outcome === 'added')).toBe(true)
    }
    const [shared] = await sql<{ books: number }>('select count(*)::int as books from public.books where isbn13 = $1', [isbns.read])
    expect(shared!.books).toBe(1)
    // Max, importing second, found Ida's import Books in the Catalogue by their ISBN.
  })

  it('counts a book she has under another edition as in her Library (title and first author), not as a second entry', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const isbns = { read: uniqueIsbn(), reading: uniqueIsbn(), owned: uniqueIsbn(), wish: uniqueIsbn() }
    const { books } = parseGoodreads(exportFile(isbns), today)
    const [harbour, fieldNotes] = books as [GoodreadsBook, GoodreadsBook]

    // Added in the app, read on the same day as the file says, then its edition changed: the file's ISBN finds neither.
    const mine = await library.addToLibrary(
      snapshot({ title: runTitle('Harbour Lights'), authors: ['Mira Okafor'], isbn13: uniqueIsbn(), appleId: uniqueAppleId() }),
      { status: 'finished', endedOn: '2024-03-09' },
    )
    expect(mine.error).toBeNull()
    const other = await library.changeEdition(
      mine.data!.id,
      snapshot({ title: `${runTitle('Harbour Lights')}: A Novel`, authors: ['M. Okafor'], isbn13: uniqueIsbn(), appleId: uniqueAppleId() }),
    )
    expect(other.error).toBeNull()
    // A different read of Field Notes: the same title, but another author's.
    const namesake = await library.addToLibrary(
      snapshot({ title: runTitle('Field Notes'), authors: ['Someone Else'], isbn13: uniqueIsbn(), appleId: uniqueAppleId() }),
      { status: 'want_to_read' },
    )
    expect(namesake.error).toBeNull()

    const catalogue = createCatalogueSearch(member.client)
    const entries = await catalogue.libraryEntries()
    const owned = libraryTitleIndex(entries)
    expect(owned(harbour)?.id).toBe(mine.data!.id)
    expect(owned(fieldNotes)).toBeNull()
    // A finished row whose read ended on another day is another read of it (or another book).
    const otherDay = { ...harbour, session: { ...harbour.session!, endedOn: '2020-01-01' } }
    expect(owned(otherDay)).toBeNull()
    // No end day known, or not a finished row: the title and author are enough.
    expect(owned({ ...harbour, session: { ...harbour.session!, endedOn: null } })?.id).toBe(mine.data!.id)
    expect(owned({ ...harbour, status: 'want_to_read', session: null })?.id).toBe(mine.data!.id)

    const importer = createGoodreadsImport(member.client, { lookups: { catalogue, search: nowhere }, probe: noProbe })
    const written = await importer.write(rowsOf(books, await matchAll(importer, books)), { onWritten: () => {} })
    expect(written.error).toBeNull()
    expect(written.data![0]).toMatchObject({ key: harbour.key, outcome: 'in_library', entryId: mine.data!.id })
    expect(written.data!.slice(1).map((outcome) => outcome.outcome)).toEqual(['added', 'added', 'added', 'added'])
    const [counts] = await sql<{ entries: number }>('select count(*)::int as entries from public.library_entries where member_id = $1', [member.id])
    // Hers (2) and four new ones, not five.
    expect(counts!.entries).toBe(6)
  })

  it('refuses to write while the device is offline', async () => {
    const member = await signUpMember()
    const importer = createGoodreadsImport(member.client, {
      lookups: { catalogue: createCatalogueSearch(member.client), search: nowhere },
      probe: noProbe,
      online: () => false,
    })
    const { books } = parseGoodreads(exportFile({ read: uniqueIsbn(), reading: uniqueIsbn(), owned: uniqueIsbn(), wish: uniqueIsbn() }), today)
    const written = await importer.write(rowsOf(books, await matchAll(importer, books)), { onWritten: () => {} })
    expect(written).toEqual({ data: null, error: 'offline' })
  })
})

describe('findEdition', () => {
  const row = (overrides: Partial<GoodreadsBook>): GoodreadsBook => ({
    key: 'goodreads:1',
    row: 1,
    title: 'Piranesi',
    series: null,
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    publisher: null,
    shelf: 'read',
    status: 'finished',
    session: null,
    addedOn: null,
    problems: [],
    ...overrides,
  })

  it('looks an ISBN up at Apple Books and OpenLibrary when the Catalogue does not have it', async () => {
    const member = await signUpMember()
    const lookups: Lookups = {
      catalogue: { search: async () => [] },
      search: createSearch({ fetch: recorded(), languages: ['en-US'], catalogue: createCatalogueSearch(member.client) }),
    }
    // OpenLibrary's recorded edition of Piranesi (Bloomsbury, 9781526622419).
    const edition = await findEdition(row({ isbn13: '9781526622419' }), lookups)
    expect(edition).toMatchObject({ via: 'isbn', unsure: false, book: { title: 'Piranesi', isbn13: '9781526622419' } })
  })

  it('takes a title search hit only when it is the same book', async () => {
    const found = (title: string, authors: string[]) => ({ book: snapshot({ title, authors }), entry: null, otherEdition: false })
    const search: Lookups['search'] = {
      lookupIsbn: async () => null,
      search: async () => ({
        results: [found('Piranesi: Drawings', ['Maria Peitcheva']), found('Piranesi', ['Susanna Clarke'])],
        pending: false,
        failed: false,
      }),
    }
    const edition = await findEdition(row({}), { catalogue: { search: async () => [] }, search })
    expect(edition).toMatchObject({ via: 'title', book: { title: 'Piranesi', authors: ['Susanna Clarke'] } })

    const none = await findEdition(row({ title: 'Jonathan Strange', isbn13: '9790000001022' }), { catalogue: { search: async () => [] }, search })
    expect(none).toMatchObject({ via: null, unsure: false, book: { title: 'Jonathan Strange', source: 'import', isbn13: '9790000001022' } })
  })

  it('moves on without a source that does not answer in time, and says the edition is unsure', async () => {
    const never = (_: unknown, options?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const lookups: Lookups = {
      catalogue: { search: (_query, signal) => never(null, { signal }) },
      search: { lookupIsbn: (_isbn, options) => never(null, options), search: (_query, options) => never(null, options) },
      timeoutMs: 20,
    }
    const started = Date.now()
    const edition = await findEdition(row({ isbn13: '9790000001022' }), lookups)
    expect(edition).toMatchObject({ via: null, unsure: true, book: { source: 'import' } })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('tries the rows nothing was found for once more at the end', async () => {
    let calls = 0
    const flaky: Lookups['search'] = {
      lookupIsbn: async () => {
        calls++
        if (calls === 1) throw new Error('offline for a moment')
        return snapshot({ title: 'Piranesi', authors: ['Susanna Clarke'], isbn13: '9790000001022' })
      },
      search: async () => {
        throw new Error('offline for a moment')
      },
    }
    const member = await signUpMember()
    const importer = createGoodreadsImport(member.client, { lookups: { catalogue: { search: async () => [] }, search: flaky }, probe: noProbe })
    const reports: Edition[] = []
    await importer.match([row({ isbn13: '9790000001022' })], { onEdition: (_index, edition) => void reports.push(edition) })
    expect(reports.map((edition) => [edition.via, edition.unsure])).toEqual([
      [null, true],
      ['isbn', false],
    ])
  })
})

describe('pacing', () => {
  it('runs at most `limit` tasks at once', async () => {
    let running = 0
    let most = 0
    await eachLimited(Array.from({ length: 10 }, (_, i) => i), 4, async () => {
      running++
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
    })
    expect(most).toBe(4)
  })

  it('spaces requests to a host that counts them, and tries a refused one once more', async () => {
    const at: number[] = []
    let refused = false
    const fetch: FetchLike = async () => {
      at.push(Date.now())
      if (!refused) {
        refused = true
        return { ok: false, status: 403, json: async () => ({}) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 30 }, retryMs: 10 })
    const answers = await Promise.all([1, 2, 3].map(() => paced('https://itunes.apple.com/lookup?isbn=1')))
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200])
    expect(at).toHaveLength(4)
    const gaps = at.slice(1).map((time, index) => time - at[index]!)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(25)
  })
})

