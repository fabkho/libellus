import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from '@/data/books'
import { findEdition, reviewOf, titleCandidates, type Lookups } from '@/data/bookImport'
import { createEditions } from '@/data/editions'
import { GENRES, GOOGLE_CATEGORY_GENRES, googleGenres, isGenreId, mapGenres } from '@/data/enrich/genres'
import type { FetchLike } from '@/data/fetching'
import { createGoogleBooks, GOOGLE_BOOKS_FUNCTION, snapshotFromGoogleVolume, type FunctionsClient } from '@/data/googleBooks'
import { coverUrlOf, parseVolumes, volumesUrl, type GoogleVolume } from '@/data/googleBooksRecord'
import { isGoogleCover } from '@/data/googleCover'
import type { ImportBook } from '@/data/import/rows'
import { createLibrary, bookToRow } from '@/data/library'
import { GOOGLE_BELOW, createSearch, type SearchOutcome } from '@/data/search'

/**
 * Google Books as a source (issue #305, docs/parity.md "Google Books"): the mapping of a volumes answer, the genre table,
 * the client of the `google-books` function, and where a member meets it: Search (an ISBN nobody has, a query the others
 * leave nearly empty), the edition picker, the import's unfound rows and adding one. The recordings are the Deno tests'
 * (supabase/functions/google-books/fixtures: hand-built from the documented response shape, every name and ISBN invented,
 * plus one real 429); the function and every other source are stand-ins. Nothing here reaches Google or the network.
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../supabase/functions/google-books/fixtures/${name}.json`, import.meta.url), 'utf8'))

const ISBN_HIT = '9791034567898'
const ISBN_DE = '9791034567904'
const ISBN_EN = '9791034567911'

const hit = parseVolumes(fixture('isbn-hit'))
const german = parseVolumes(fixture('title-german'))

function functionAnswering(answers: (body: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = []
  const client: FunctionsClient = {
    functions: {
      invoke: async (name, { body }) => {
        expect(name).toBe(GOOGLE_BOOKS_FUNCTION)
        calls.push(body as Record<string, unknown>)
        const data = answers(body as Record<string, unknown>)
        return data instanceof Error ? { data: null, error: data } : { data, error: null }
      },
    },
  }
  return { client, calls }
}

/** The function as it answers while it has no key. */
const unavailable = () => functionAnswering(() => ({ status: 'unavailable', reason: 'not_configured' }))

const book = (fields: Partial<BookSnapshot> = {}): BookSnapshot => ({
  title: 'Der stille Hafen', authors: ['Ida Beispiel'], isbn13: null, isbn10: null, pageCount: null, year: null, language: null, publisher: null,
  description: null, coverUrl: null, coverThumbhash: null, coverColors: null, source: 'openlibrary', appleId: null, openLibraryEditionKey: null, openLibraryWorkKey: null, ...fields,
})
const catalogueBook = (fields: Partial<Book> = {}): Book => ({ ...book({ source: 'apple', appleId: '1' }), id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-01-01T00:00:00Z', ...fields }) as Book

/** Apple and Open Library that know nothing. */
const nobody: FetchLike = async (url) => ({
  ok: true,
  status: 200,
  json: async () => (new URL(url).hostname === 'itunes.apple.com' ? { resultCount: 0, results: [] } : { numFound: 0, docs: [] }),
})

describe('the mapping of a volumes answer', () => {
  it('keeps the facts of the edition, the app\'s genres and a linked cover, and nothing else', () => {
    expect(hit).toEqual([
      {
        id: 'ZZhit0001AAA', title: 'Das Leuchten der Nordsee', authors: ['Ida Beispiel'], isbn13: ISBN_HIT, isbn10: null, pageCount: 412, year: 2019, language: 'de',
        publisher: 'Musterverlag', genres: ['thriller'], coverUrl: 'https://books.google.com/books/content?id=ZZhit0001AAA&printsec=frontcover&img=1&zoom=1&source=gbs_api',
      },
    ])
    // The description is in the recording and in nothing that comes out.
    expect(JSON.stringify(fixture('isbn-hit'))).toContain('blurb')
    expect(JSON.stringify(hit)).not.toContain('blurb')
    expect(Object.keys(hit[0]!)).not.toContain('description')
  })

  it('lists one volume per ISBN-13 in Google\'s order, one without an ISBN or author kept as it is', () => {
    expect(german.map((volume) => [volume.title, volume.language, volume.isbn13])).toEqual([
      ['Der stille Hafen', 'de', ISBN_DE],
      ['The Quiet Harbour', 'en', ISBN_EN],
      ['Der stille Hafen (Leseprobe)', 'de', null],
      ['Hafenlichter', 'de', '9791034567928'],
      ['Le Port silencieux', 'fr', '9791034567935'],
    ])
    expect(german[3]!.authors).toEqual([])
  })

  it('reads a miss, an error body and nonsense as no volumes', () => {
    expect(parseVolumes(fixture('isbn-miss'))).toEqual([])
    expect(parseVolumes(fixture('quota-429'))).toEqual([])
    for (const nonsense of [null, undefined, 3, 'x', [], { items: {} }, { items: [{}] }]) expect(parseVolumes(nonsense)).toEqual([])
  })

  it('links the cover over https at the small size and refuses any other host', () => {
    expect(coverUrlOf('http://books.google.com/books/content?id=abcd1234&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'))
      .toBe('https://books.google.com/books/content?id=abcd1234&printsec=frontcover&img=1&zoom=1&source=gbs_api')
    for (const other of ['https://evil.example/books/content?id=abcd1234', 'https://books.google.com.evil.example/books/content?id=abcd1234', 'https://books.google.com/books?id=abcd1234', 'https://books.google.com/books/content', 'not a url', null, 3]) {
      expect(coverUrlOf(other)).toBeNull()
    }
    expect(isGoogleCover(hit[0]!.coverUrl)).toBe(true)
    expect(isGoogleCover('https://covers.openlibrary.org/b/id/1-L.jpg')).toBe(false)
    expect(isGoogleCover('https://books.google.com/books?id=a')).toBe(false)
  })

  it('asks for no description, one language only when told one', () => {
    const url = new URL(volumesUrl('intitle:"x"', 'de'))
    expect(url.searchParams.get('fields')).not.toMatch(/description/)
    expect(url.searchParams.get('langRestrict')).toBe('de')
    expect(new URL(volumesUrl('x')).searchParams.has('langRestrict')).toBe(false)
  })

  it('is a snapshot of source google, with no id and no description; one without an ISBN or an author is none', () => {
    const snapshot = snapshotFromGoogleVolume(hit[0]!)!
    expect(snapshot).toMatchObject({ source: 'google', isbn13: ISBN_HIT, language: 'de', pageCount: 412, year: 2019, description: null, appleId: null })
    expect(snapshot).not.toHaveProperty('id')
    expect(snapshotFromGoogleVolume(german[2]!)).toBeNull()
    expect(snapshotFromGoogleVolume(german[3]!)).toBeNull()
  })
})

describe('Google\'s categories become the app\'s genres by a small explicit table', () => {
  it('splits a BISAC path and maps each part; General, Fiction and everything unlisted drop', () => {
    expect(googleGenres(['Fiction / Science Fiction / General'])).toEqual(['sci-fi'])
    expect(googleGenres(['Fiction / Romance / Contemporary'])).toEqual(['romance'])
    expect(googleGenres(['Fiction / Mystery & Detective / Cozy'])).toEqual(['crime'])
    expect(googleGenres(['Fiction / Thrillers / Suspense'])).toEqual(['thriller'])
    expect(googleGenres(['Juvenile Fiction / Historical / General'])).toEqual(['ya', 'historical'])
    expect(googleGenres(['Biography & Autobiography / Women'])).toEqual(['biography'])
    expect(googleGenres(['Comics & Graphic Novels / Manga / General'])).toEqual(['graphic'])
    expect(googleGenres(['Fiction / Short Stories (single author)'])).toEqual(['short-stories'])
    expect(googleGenres(['Fiction / General', 'Business & Economics / Marketing', 'Cooking / Baking', ''])).toEqual([])
    expect(googleGenres([])).toEqual([])
  })

  it('keeps each genre once and at most three, in the order named', () => {
    expect(googleGenres(['Fiction / Romance / General', 'Fiction / Romance / Historical', 'Fiction / Fantasy / Epic', 'Fiction / Horror', 'Fiction / Classics'])).toEqual(['romance', 'historical', 'fantasy'])
  })

  it('has only the app\'s genres on the right, and nothing of the table is guessed from keywords', () => {
    for (const ids of Object.values(GOOGLE_CATEGORY_GENRES)) for (const id of ids) expect(isGenreId(id)).toBe(true)
    expect(new Set(Object.values(GOOGLE_CATEGORY_GENRES).flat()).size).toBeGreaterThan(10)
    expect(GENRES.length).toBeGreaterThan(0)
    // "Fantasy" inside an unlisted part is no match: only the whole part counts.
    expect(googleGenres(['Fiction / Fantasy Football Guides'])).toEqual([])
  })

  it('is a signal the enrichment weighs: one passes alone, and the value is an id', () => {
    expect(mapGenres([{ source: 'google', value: 'crime' }])).toEqual([{ genre: 'crime', source: 'google', confidence: 0.6 }])
    expect(mapGenres([{ source: 'google', value: 'Fiction / Romance' }])).toEqual([])
    expect(mapGenres([{ source: 'google', value: 'crime' }, { source: 'google', value: 'thriller' }, { source: 'google', value: 'romance' }, { source: 'google', value: 'horror' }]).map((g) => g.genre)).toHaveLength(3)
  })
})

describe('the client of the function', () => {
  it('looks an ISBN up and lists words and editions, with the member\'s languages on the words', async () => {
    const { client, calls } = functionAnswering((body) =>
      body.action === 'isbn' ? { status: 'found', volume: hit[0] } : { status: 'ok', volumes: german },
    )
    const google = createGoogleBooks(client, { languages: () => ['de-DE', 'en-US'] })
    expect((await google.lookupIsbn(ISBN_HIT))?.title).toBe('Das Leuchten der Nordsee')
    // Two volumes of five have no ISBN or no author: they are no Books.
    expect((await google.search('stille hafen')).map((b) => b.isbn13)).toEqual([ISBN_DE, ISBN_EN, '9791034567935'])
    expect((await google.editions(book())).length).toBe(3)
    expect(calls).toEqual([
      { action: 'isbn', isbn13: ISBN_HIT },
      { action: 'search', query: 'stille hafen', languages: ['de-DE', 'en-US'] },
      { action: 'search', title: 'Der stille Hafen', authors: ['Ida Beispiel'] },
    ])
  })

  it('is silent when the function has nothing: unavailable, an error, a refusal, garbage, a throw, offline', async () => {
    const answers: unknown[] = [{ status: 'unavailable', reason: 'budget' }, new Error('502'), { error: 'rate_limited' }, 'nonsense', null]
    for (const answer of answers) {
      const google = createGoogleBooks(functionAnswering(() => answer).client)
      expect(await google.lookupIsbn(ISBN_HIT)).toBeNull()
      expect(await google.search('x y')).toEqual([])
      expect(await google.editions(book())).toEqual([])
    }
    const throwing: FunctionsClient = { functions: { invoke: async () => { throw new Error('network') } } }
    expect(await createGoogleBooks(throwing).lookupIsbn(ISBN_HIT)).toBeNull()
    const { client, calls } = functionAnswering(() => ({ status: 'found', volume: hit[0] }))
    expect(await createGoogleBooks(client, { online: () => false }).lookupIsbn(ISBN_HIT)).toBeNull()
    expect(calls).toEqual([])
  })

  it('rejects only on abort', async () => {
    const controller = new AbortController()
    const { client } = functionAnswering(() => ({ status: 'found', volume: hit[0] }))
    controller.abort()
    await expect(createGoogleBooks(client).lookupIsbn(ISBN_HIT, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('an import says so (purpose) and paces its calls (gapMs)', async () => {
    const { client, calls } = functionAnswering(() => ({ status: 'ok', volumes: [] }))
    const google = createGoogleBooks(client, { purpose: 'import', gapMs: 30 })
    const started = performance.now()
    await Promise.all([google.search('a b'), google.editions(book()), google.lookupIsbn(ISBN_HIT)])
    expect(calls.map((body) => body.purpose)).toEqual(['import', 'import', 'import'])
    expect(performance.now() - started).toBeGreaterThanOrEqual(55)
  })
})

describe('Search', () => {
  const withGoogle = (google: Parameters<typeof createSearch>[0]['google'], extra: Partial<Parameters<typeof createSearch>[0]> = {}) =>
    createSearch({ fetch: nobody, languages: ['de-DE'], google, ...extra })
  const volumeBooks = german.map(snapshotFromGoogleVolume).filter((b): b is BookSnapshot => b !== null)

  it('shows a Google-only result like any other, with nothing to say where it came from beside the internal source', async () => {
    const outcome = await withGoogle({ lookupIsbn: async () => null, search: async () => volumeBooks }).search('stille hafen beispiel')
    expect(outcome.results.map((r) => r.book.title)).toEqual(['Der stille Hafen', 'The Quiet Harbour', 'Le Port silencieux'])
    expect(outcome.results[0]!.book).toMatchObject({ isbn13: ISBN_DE, language: 'de', pageCount: 320, publisher: 'Musterverlag', source: 'google' })
    expect(outcome).toMatchObject({ pending: false, failed: false, unanswered: [] })
    // The list carries the Books, the entry and the other-edition flag, never a source's name.
    for (const result of outcome.results) expect(Object.keys(result).sort()).toEqual(['book', 'entry', 'otherEdition'])
  })

  it('is asked after the others, and only when they found fewer than a handful of editions', async () => {
    let asked = 0
    const google = { lookupIsbn: async () => null, search: async () => (asked++, volumeBooks) }
    const many = Array.from({ length: GOOGLE_BELOW }, (_, i) => ({ book: catalogueBook({ id: `11111111-1111-4111-8111-11111111111${i}`, title: `Stille ${i}`, isbn13: `97910345679${i}0`, appleId: null }), source: 'catalogue' as const, popularity: 0 }))
    const catalogue = (found: typeof many) => ({ search: async () => found }) as never
    await withGoogle(google, { catalogue: catalogue(many) }).search('stille')
    expect(asked).toBe(0)
    await withGoogle(google, { catalogue: catalogue(many.slice(0, GOOGLE_BELOW - 1)) }).search('stille')
    expect(asked).toBe(1)
  })

  it('is not asked for a query of a few letters', async () => {
    let asked = 0
    await withGoogle({ lookupIsbn: async () => null, search: async () => (asked++, volumeBooks) }).search('abc')
    expect(asked).toBe(0)
  })

  it('an ISBN: Google is asked last, when none of the others had it', async () => {
    const calls: string[] = []
    const google = { lookupIsbn: async (isbn13: string) => (calls.push(`google:${isbn13}`), snapshotFromGoogleVolume(hit[0]!)), search: async () => [] }
    const dnb = { lookupIsbn: async (isbn13: string) => (calls.push(`dnb:${isbn13}`), null) }
    const outcome = await withGoogle(google, { dnb }).search(ISBN_HIT)
    expect(calls).toEqual([`dnb:${ISBN_HIT}`, `google:${ISBN_HIT}`])
    expect(outcome.results[0]!.book).toMatchObject({ isbn13: ISBN_HIT, title: 'Das Leuchten der Nordsee' })

    const found: string[] = []
    const dnbKnows = { lookupIsbn: async () => book({ isbn13: ISBN_HIT, source: 'dnb', title: 'Das Leuchten der Nordsee' }) }
    await withGoogle({ lookupIsbn: async () => (found.push('asked'), null), search: async () => [] }, { dnb: dnbKnows }).search(ISBN_HIT)
    expect(found).toEqual([])
  })

  it('failing, unavailable or slow Google changes nothing the member sees: no failure, nothing unanswered, the others\' list', async () => {
    const { client } = unavailable()
    const catalogue = { search: async () => [{ book: catalogueBook({ title: 'Der stille Hafen' }), source: 'catalogue' as const, popularity: 0 }] } as never
    const silent = await createSearch({ fetch: nobody, languages: ['de-DE'], catalogue, google: createGoogleBooks(client) }).search('stille hafen')
    expect(silent).toMatchObject({ failed: false, pending: false, unanswered: [] })
    expect(silent.results).toHaveLength(1)
    const throwing = await createSearch({ fetch: nobody, languages: ['de-DE'], catalogue, google: { lookupIsbn: async () => { throw new Error('x') }, search: async () => { throw new Error('x') } } }).search('stille hafen')
    expect(throwing).toMatchObject({ failed: false, unanswered: [] })
  })

  it('"could not reach" is still told when every other source failed, and Google answering nothing does not hide it', async () => {
    const down: FetchLike = async () => { throw new Error('offline') }
    const outcome = await createSearch({ fetch: down, languages: ['de-DE'], google: createGoogleBooks(unavailable().client) }).search('stille hafen')
    expect(outcome.failed).toBe(true)
  })

  it('opens a book page cold: the ISBN lookup falls back to Google, never calling the row unsure', async () => {
    const search = withGoogle({ lookupIsbn: async () => snapshotFromGoogleVolume(hit[0]!), search: async () => [] })
    expect((await search.lookupIsbn(ISBN_HIT, { strict: true }))?.title).toBe('Das Leuchten der Nordsee')
    expect(await withGoogle({ lookupIsbn: async () => null, search: async () => [] }).lookupIsbn(ISBN_HIT, { strict: true })).toBeNull()
  })
})

describe('the edition picker', () => {
  const stored = catalogueBook({ title: 'Der stille Hafen', isbn13: '9791034567805', language: 'de' })

  it('adds Google\'s editions of the work, only those of it', async () => {
    const google = { lookupIsbn: async () => null, editions: async () => [...german.map(snapshotFromGoogleVolume), snapshotFromGoogleVolume({ ...german[0]!, title: 'Ein ganz anderes Buch', isbn13: '9791034568000' })].filter((b): b is BookSnapshot => b !== null) }
    const found = await createEditions({ fetch: nobody, languages: ['de-DE'], google }).find(stored)
    // The English edition has another title (`isEditionOf`): not an edition of this Book as the picker reads it.
    expect(found.candidates.map((c) => c.book.isbn13)).toEqual([stored.isbn13, ISBN_DE])
    expect(found.failed).toBe(false)
  })

  it('answers nothing without failing while Google has none, and "failed" is still told when the others all fail', async () => {
    const google = createGoogleBooks(unavailable().client)
    const ok = await createEditions({ fetch: nobody, languages: ['de-DE'], google }).find(stored)
    expect(ok.candidates).toHaveLength(1)
    const down: FetchLike = async () => { throw new Error('offline') }
    expect((await createEditions({ fetch: down, languages: ['de-DE'], google }).find(stored)).failed).toBe(true)
  })

  it('finds an ISBN the others do not know, with the stored book\'s authors when it names none', async () => {
    const edition = snapshotFromGoogleVolume({ ...hit[0]! })!
    const editions = createEditions({ fetch: nobody, languages: ['de-DE'], google: { editions: async () => [], lookupIsbn: async () => edition } })
    const outcome = await editions.lookupIsbn({ authors: ['Ida Beispiel'] }, ISBN_HIT)
    expect(outcome.edition).toMatchObject({ isbn13: ISBN_HIT, publisher: 'Musterverlag', source: 'google' })
    expect(outcome.failed).toBe(false)
  })
})

describe('the import', () => {
  const row = (overrides: Partial<ImportBook>): ImportBook => ({
    source: 'goodreads', key: 'goodreads:1', sourceId: '1', row: 1, title: 'Der stille Hafen', series: null, authors: ['Ida Beispiel'], isbn13: null, isbn10: null,
    pageCount: null, year: null, originalYear: null, binding: null, language: null, publisher: null, shelf: 'read', shelves: [], status: 'finished', session: null,
    earlierReads: [], extraReads: 0, otherKeys: [], addedOn: null, problems: [], ...overrides,
  })
  const outcome = (editions: BookSnapshot[]): SearchOutcome => ({ results: [], pending: false, failed: false, editions, unanswered: [] })
  const googleEditions = german.map(snapshotFromGoogleVolume).filter((b): b is BookSnapshot => b !== null)

  function ladder(options: { found?: BookSnapshot[]; google?: BookSnapshot[] | Error; hang?: boolean }) {
    const calls: string[] = []
    const googleCalls: { title: string; authors: string[] }[] = []
    const lookups: Lookups = {
      catalogue: { search: async () => [] },
      search: { lookupIsbn: async () => null, search: async (query) => (calls.push(`search:${query}`), outcome(options.found ?? [])) },
      google: {
        editions: async (b) => {
          calls.push('google')
          googleCalls.push({ title: b.title, authors: [...b.authors] })
          if (options.google instanceof Error) throw options.google
          return options.google ?? []
        },
      },
    }
    return { lookups, calls, googleCalls }
  }

  it('asks Google once, last, for a row nothing else found a Book of its work for', async () => {
    const { lookups, calls, googleCalls } = ladder({ google: googleEditions })
    const edition = await findEdition(row({}), lookups)
    expect(calls.at(-1)).toBe('google')
    expect(calls.filter((call) => call === 'google')).toHaveLength(1)
    expect(googleCalls).toEqual([{ title: 'Der stille Hafen', authors: ['Ida Beispiel'] }])
    expect(edition.via).toBe('title')
    expect(edition.book).toMatchObject({ title: 'Der stille Hafen', isbn13: ISBN_DE, source: 'google' })
    expect(edition.unsure).toBe(false)
  })

  it('never asks it for a row the other sources found', async () => {
    const found = [book({ title: 'Der stille Hafen', authors: ['Ida Beispiel'], isbn13: ISBN_DE, coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg', language: 'de' })]
    const { lookups, calls } = ladder({ found, google: googleEditions })
    const edition = await findEdition(row({}), lookups)
    expect(calls).not.toContain('google')
    expect(edition.via).toBe('title')
  })

  it('its silence or failure is no "unsure": the row is the file\'s own, to look at, but never asked again for it', async () => {
    for (const google of [[], new Error('unavailable')]) {
      const { lookups } = ladder({ google })
      const source = row({})
      const edition = await findEdition(source, lookups)
      expect(edition.via).toBeNull()
      expect(edition.unsure).toBe(false)
      expect(reviewOf(source, edition, false).tier).toBe('needsLook')
    }
  })

  it('an ISBN only Google knows is matched to its edition, with its own cover (via isbn, source google)', async () => {
    const google = createGoogleBooks(functionAnswering((body) => (body.action === 'isbn' ? { status: 'found', volume: hit[0] } : { status: 'ok', volumes: [] })).client)
    const searcher = createSearch({ fetch: nobody, languages: ['de-DE', 'en-US'], google })
    const lookups: Lookups = { catalogue: { search: async () => [] }, search: searcher, google }
    const edition = await findEdition(row({ title: 'Das Leuchten der Nordsee', isbn13: ISBN_HIT }), lookups)
    expect(edition.via).toBe('isbn')
    expect(edition.book).toMatchObject({ isbn13: ISBN_HIT, source: 'google', coverUrl: hit[0]!.coverUrl, language: 'de', pageCount: 412 })
    expect(edition.unsure).toBe(false)
  })

  it('while the function has no key a whole file costs no call it would have to wait for and no row is unsure', async () => {
    const { client, calls } = unavailable()
    const google = createGoogleBooks(client)
    const searcher = createSearch({ fetch: nobody, languages: ['de-DE'], google })
    const lookups: Lookups = { catalogue: { search: async () => [] }, search: searcher, google }
    for (const isbn13 of ['9791034567898', '9791034567904']) {
      const edition = await findEdition(row({ isbn13 }), lookups)
      expect(edition.unsure).toBe(false)
      expect(edition.via).toBeNull()
    }
    expect(calls.length).toBeGreaterThan(0)
    expect(await titleCandidates(row({}), lookups)).toMatchObject({ incomplete: false })
  })

  it('is not asked a title question twice by the same row', async () => {
    const { lookups, calls } = ladder({ google: [] })
    await findEdition(row({}), lookups)
    expect(calls.filter((call) => call === 'google')).toHaveLength(1)
  })
})

describe('adding a Google edition', () => {
  const row = { id: '22222222-2222-4222-8222-222222222222', title: 'Der stille Hafen', authors: ['Ida Beispiel'], isbn13: ISBN_DE, isbn10: null, page_count: 320, published_year: 2021, language: 'de', publisher: 'Musterverlag', description: null, cover_url: german[0]!.coverUrl, cover_thumbhash: null, cover_dominant: null, cover_secondary: null, source: 'import', apple_id: null, openlibrary_edition_key: null, openlibrary_work_key: null, created_at: '2026-11-05T10:00:00Z' }

  function clientWith(answerOf: (name: string, body: Record<string, unknown>) => unknown) {
    const invoked: { name: string; body: Record<string, unknown> }[] = []
    const rpcs: { name: string; args: Record<string, unknown> }[] = []
    const client = {
      functions: { invoke: async (name: string, { body }: { body: Record<string, unknown> }) => (invoked.push({ name, body }), { data: answerOf(name, body), error: null }) },
      rpc: async (name: string, args: Record<string, unknown>) => (rpcs.push({ name, args }), { data: { id: 'entry-1' }, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    } as unknown as SupabaseClient
    return { client, invoked, rpcs }
  }

  it('is written as an import Book, and made by the google-books function from what Google says: nothing of the snapshot goes', async () => {
    const snapshot = snapshotFromGoogleVolume(german[0]!)!
    expect(bookToRow(snapshot).source).toBe('import')
    const { client, invoked, rpcs } = clientWith(() => ({ status: 'found', book: row }))
    await createLibrary(client).addToLibrary(snapshot, { status: 'want_to_read' } as never)
    expect(invoked).toEqual([{ name: 'google-books', body: { action: 'book', isbn13: ISBN_DE } }])
    expect(rpcs[0]!.name).toBe('add_to_library')
    expect(rpcs[0]!.args.p_book).toMatchObject({ isbn13: ISBN_DE, source: 'import', cover_url: german[0]!.coverUrl })
  })

  it('says unknown when the function cannot make it (no key, no longer found), and adds nothing', async () => {
    const snapshot = snapshotFromGoogleVolume(german[0]!)!
    for (const answer of [{ status: 'unavailable', reason: 'not_configured' }, { status: 'not_found' }]) {
      const { client, rpcs } = clientWith(() => answer)
      const added = await createLibrary(client).addToLibrary(snapshot, { status: 'want_to_read' } as never)
      expect(added).toEqual({ data: null, error: 'unknown' })
      expect(rpcs).toEqual([])
    }
  })

  it('a National Library edition still goes to its own function', async () => {
    const { client, invoked } = clientWith(() => ({ status: 'found', book: row }))
    await createLibrary(client).addToLibrary(book({ source: 'dnb', isbn13: ISBN_DE }), { status: 'want_to_read' } as never)
    expect(invoked.map((call) => call.name)).toEqual(['dnb-lookup'])
  })
})

describe('what a Google result never carries', () => {
  it('no description, even when the volume had one (the merge withholds it too)', () => {
    const snapshot = snapshotFromGoogleVolume({ ...(hit[0] as GoogleVolume), description: 'A long publisher blurb that must never be kept anywhere.' } as GoogleVolume)!
    expect(snapshot.description).toBeNull()
    expect(snapshot).not.toHaveProperty('categories')
  })
})
