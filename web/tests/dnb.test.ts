import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from '@/data/books'
import { createDnb, DNB_FUNCTION, snapshotFromDnbEdition, type FunctionsClient } from '@/data/dnb'
import type { DnbEdition } from '@/data/dnbRecord'
import { createEditions, isbnEdition, mergeEditions, wantsGerman } from '@/data/editions'
import type { FetchLike } from '@/data/fetching'
import { createLibrary } from '@/data/library'
import { createSearch } from '@/data/search'

/**
 * German editions from the National Library (docs/ENRICHMENT.md) where a member meets them: the
 * barcode scan and the ISBN lookups, the edition picker, and adding or picking one. The
 * `dnb-lookup` function is a stand-in; nothing here reaches the library or the network.
 */

const SCHWARM: DnbEdition = { title: 'Der Schwarm: Roman', authors: ['Frank Schätzing'], isbn13: '9783462041002', publisher: 'Kiepenheuer & Witsch', year: 2004, language: 'ger', pages: 992 }
const BERGMAN: DnbEdition = { title: 'Die Toten, die niemand vermisst', authors: ['Michael Hjorth', 'Hans Rosenfeldt'], isbn13: '9783499267017', publisher: 'Rowohlt Polaris', year: 2013, language: 'ger', pages: 622, coverUrl: 'https://covers.openlibrary.org/b/isbn/9783499267017-L.jpg' }

function functionsAnswering(answers: (body: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = []
  const client: FunctionsClient = {
    functions: {
      invoke: async (name, { body }) => {
        expect(name).toBe(DNB_FUNCTION)
        calls.push(body as Record<string, unknown>)
        const data = answers(body as Record<string, unknown>)
        return data instanceof Error ? { data: null, error: data } : { data, error: null }
      },
    },
  }
  return { client, calls }
}

const book = (fields: Partial<BookSnapshot> = {}): BookSnapshot => ({
  title: 'Der Schwarm', authors: ['Frank Schätzing'], isbn13: null, isbn10: null, pageCount: null, year: null, language: null, publisher: null,
  description: null, coverUrl: null, coverThumbhash: null, coverColors: null, source: 'openlibrary', appleId: null, openLibraryEditionKey: null, openLibraryWorkKey: null, ...fields,
})
const catalogueBook = (fields: Partial<Book> = {}): Book => ({ ...book({ source: 'apple', appleId: '1' }), id: '11111111-1111-4111-8111-111111111111', createdAt: '2026-01-01T00:00:00Z', ...fields }) as Book

/** Apple and Open Library that know nothing. */
const nobody: FetchLike = async (url) => ({
  ok: true,
  status: 200,
  json: async () => (url.includes('itunes.apple.com') ? { resultCount: 0, results: [] } : { numFound: 0, docs: [] }),
})

describe('the client of the function', () => {
  it('maps an edition to the snapshot the app shows: source import, no id, the function\'s cover', () => {
    expect(snapshotFromDnbEdition(BERGMAN)).toMatchObject({ title: 'Die Toten, die niemand vermisst', isbn13: '9783499267017', pageCount: 622, year: 2013, language: 'ger', publisher: 'Rowohlt Polaris', source: 'import', coverUrl: 'https://covers.openlibrary.org/b/isbn/9783499267017-L.jpg', description: null })
    expect(snapshotFromDnbEdition(SCHWARM).coverUrl).toBeNull()
    expect(snapshotFromDnbEdition(SCHWARM)).not.toHaveProperty('id')
  })

  it('looks an ISBN up, lists a work\'s editions, and says null / empty for nothing', async () => {
    const { client, calls } = functionsAnswering((body) =>
      body.action === 'isbn' ? (body.isbn13 === BERGMAN.isbn13 ? { status: 'found', edition: BERGMAN } : { status: 'not_found' }) : { status: 'ok', editions: [SCHWARM, BERGMAN] },
    )
    const dnb = createDnb(client)
    expect((await dnb.lookupIsbn('9783499267017'))?.title).toBe('Die Toten, die niemand vermisst')
    expect(await dnb.lookupIsbn('9780000000002')).toBeNull()
    expect((await dnb.editions(book())).map((e) => e.isbn13)).toEqual(['9783462041002', '9783499267017'])
    expect(calls[2]).toEqual({ action: 'editions', title: 'Der Schwarm', authors: ['Frank Schätzing'] })
  })

  it('rejects when the function cannot answer: an error, a refusal, nothing, offline', async () => {
    await expect(createDnb(functionsAnswering(() => new Error('502')).client).lookupIsbn('9783499267017')).rejects.toThrow()
    await expect(createDnb(functionsAnswering(() => ({ error: 'rate_limited' })).client).editions(book())).rejects.toThrow()
    const { client, calls } = functionsAnswering(() => ({ status: 'not_found' }))
    await expect(createDnb(client, { online: () => false }).lookupIsbn('9783499267017')).rejects.toThrow('offline')
    expect(calls).toEqual([])
  })
})

describe('the barcode scan and the ISBN search', () => {
  const isbn = '9783499267017'
  const withDnb = (dnb: { lookupIsbn: (isbn13: string) => Promise<BookSnapshot | null> }) => createSearch({ fetch: nobody, languages: ['de-DE'], dnb })

  it('shows the German edition the other sources do not know, like any other result', async () => {
    const outcome = await withDnb({ lookupIsbn: async () => snapshotFromDnbEdition(BERGMAN) }).search(isbn)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0]!.book).toMatchObject({ title: 'Die Toten, die niemand vermisst', isbn13: isbn, publisher: 'Rowohlt Polaris', language: 'ger', pageCount: 622, year: 2013 })
    expect(outcome).toMatchObject({ pending: false, failed: false })
  })

  it('is asked last and only when the others found nothing', async () => {
    let asked = 0
    const catalogue = { search: async () => [{ book: catalogueBook({ isbn13: isbn }), source: 'catalogue' as const, popularity: 0 }] }
    const search = createSearch({ fetch: nobody, languages: ['de-DE'], catalogue: catalogue as never, dnb: { lookupIsbn: async () => (asked++, null) } })
    expect((await search.search(isbn)).results.length).toBeGreaterThan(0)
    expect(asked).toBe(0)
  })

  it('is not asked for a title, only for an ISBN', async () => {
    let asked = 0
    const outcome = await withDnb({ lookupIsbn: async () => (asked++, null) }).search('Der Schwarm Schätzing')
    expect(asked).toBe(0)
    expect(outcome.results).toEqual([])
  })

  it('finds nothing when the library does not know it either, and fails only when nothing answered', async () => {
    expect((await withDnb({ lookupIsbn: async () => null }).search(isbn)).results).toEqual([])
    const down = createSearch({ fetch: async () => { throw new Error('offline') }, languages: ['de-DE'], dnb: { lookupIsbn: async () => { throw new Error('down') } } })
    expect(await down.search(isbn)).toMatchObject({ failed: true })
  })

  it('opens a book page cold: the ISBN lookup falls back to the library too', async () => {
    const search = withDnb({ lookupIsbn: async () => snapshotFromDnbEdition(BERGMAN) })
    expect((await search.lookupIsbn(isbn))?.title).toBe('Die Toten, die niemand vermisst')
    expect(await createSearch({ fetch: nobody, languages: ['en-US'] }).lookupIsbn(isbn)).toBeNull()
  })
})

describe('the edition picker', () => {
  const stored = catalogueBook({ title: 'Der Schwarm', isbn13: '9783596156238', language: 'ger' })
  const withCover = (fields: Partial<BookSnapshot>) => book({ coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg', ...fields })

  it('is asked for German editions only where German is in play', () => {
    expect(wantsGerman(['de-DE', 'en-US'], { language: null })).toBe(true)
    expect(wantsGerman(['en-US'], { language: 'ger' })).toBe(true)
    expect(wantsGerman(['en-US'], { language: 'eng' })).toBe(false)
    expect(wantsGerman(['en-US'], { language: null })).toBe(false)
  })

  it('adds the library\'s editions, only those of the work, and not for an English member', async () => {
    const asked: unknown[] = []
    const dnb = { lookupIsbn: async () => null, editions: async () => (asked.push(1), [snapshotFromDnbEdition(SCHWARM), snapshotFromDnbEdition({ ...SCHWARM, title: 'Ein ganz anderes Buch', isbn13: '9783000000009' })]) }
    const german = await createEditions({ fetch: nobody, languages: ['de-DE'], dnb }).find(stored)
    expect(german.candidates.map((c) => c.book.isbn13)).toEqual([stored.isbn13, '9783462041002'])
    const english = await createEditions({ fetch: nobody, languages: ['en-US'], dnb }).find(catalogueBook({ title: 'Dune', language: 'eng', isbn13: '9780441013593' }))
    expect(english.candidates).toHaveLength(1)
    expect(asked).toHaveLength(1)
  })

  it('is one row per ISBN: an edition another source has is that source\'s, with the library\'s facts filled in', () => {
    const apple = withCover({ isbn13: SCHWARM.isbn13, source: 'apple', appleId: '5', year: null, pageCount: null, publisher: null, language: null })
    const rows = mergeEditions(stored, { apple: [apple], dnb: [snapshotFromDnbEdition(SCHWARM)] }, 'de-DE')
    const others = rows.filter((row) => !row.current)
    expect(others).toHaveLength(1)
    expect(others[0]!.book).toMatchObject({ source: 'apple', coverUrl: apple.coverUrl, year: 2004, pageCount: 992, publisher: 'Kiepenheuer & Witsch', language: 'ger' })
  })

  it('sorts a cover-less library edition after those with a cover', () => {
    const covered = withCover({ isbn13: '9783000000016', source: 'openlibrary', openLibraryEditionKey: 'OL9M', language: 'eng', title: 'The Swarm' })
    const rows = mergeEditions(catalogueBook({ title: 'Der Schwarm', language: 'eng', isbn13: '9780000000002' }), { openlibrary: [covered], dnb: [snapshotFromDnbEdition(SCHWARM)] }, 'en-US')
    expect(rows.map((row) => row.book.isbn13)).toEqual(['9780000000002', '9783000000016', SCHWARM.isbn13])
  })

  it('sorts a German edition without a cover as if it had one when German is the member\'s language', () => {
    const english = withCover({ isbn13: '9783000000016', source: 'openlibrary', openLibraryEditionKey: 'OL9M', language: 'eng', title: 'Der Schwarm' })
    const rows = mergeEditions(catalogueBook({ title: 'Der Schwarm', language: 'ger', isbn13: '9780000000002' }), { openlibrary: [english], dnb: [snapshotFromDnbEdition(SCHWARM)] }, 'de-DE')
    expect(rows.map((row) => row.book.isbn13)).toEqual(['9780000000002', SCHWARM.isbn13, '9783000000016'])
    // A cover-less English edition of the library gets no such lift.
    const englishDnb = snapshotFromDnbEdition({ ...SCHWARM, language: 'eng', isbn13: '9783000000023' })
    const again = mergeEditions(catalogueBook({ title: 'Der Schwarm', language: 'ger', isbn13: '9780000000002' }), { openlibrary: [english], dnb: [englishDnb] }, 'de-DE')
    expect(again.map((row) => row.book.isbn13)).toEqual(['9780000000002', '9783000000016', '9783000000023'])
  })

  it('finds an ISBN the others do not know in the library, with the stored book\'s authors when it names none', async () => {
    const german = snapshotFromDnbEdition({ ...SCHWARM, authors: [] })
    const editions = createEditions({ fetch: nobody, languages: ['de-DE'], dnb: { editions: async () => [], lookupIsbn: async () => german } })
    const outcome = await editions.lookupIsbn({ authors: ['Frank Schätzing'] }, SCHWARM.isbn13)
    expect(outcome.edition).toMatchObject({ isbn13: SCHWARM.isbn13, publisher: 'Kiepenheuer & Witsch', authors: ['Frank Schätzing'] })
    expect(outcome.failed).toBe(false)
    expect(isbnEdition({ authors: [] }, SCHWARM.isbn13, { dnb: [german] })?.title).toBe('Der Schwarm: Roman')
  })
})

describe('adding or picking a German edition', () => {
  /** A client whose database answers the RPCs and whose function makes the Catalogue Book. */
  function clientWith(functionAnswer: unknown) {
    const rpcs: { name: string; args: Record<string, unknown> }[] = []
    const client = {
      functions: { invoke: async () => ({ data: functionAnswer, error: null }) },
      rpc: async (name: string, args: Record<string, unknown>) => (rpcs.push({ name, args }), { data: { id: 'entry-1' }, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    } as unknown as SupabaseClient
    return { client, rpcs }
  }
  const row = { id: '22222222-2222-4222-8222-222222222222', title: 'Der Schwarm', authors: ['Frank Schätzing'], isbn13: '9783462041002', isbn10: null, page_count: 992, published_year: 2004, language: 'ger', publisher: 'Kiepenheuer & Witsch', description: null, cover_url: null, cover_thumbhash: null, cover_dominant: null, cover_secondary: null, source: 'import', apple_id: null, openlibrary_edition_key: null, openlibrary_work_key: null, created_at: '2026-10-11T10:00:00Z' }

  it('has the Catalogue Book made first (a member may only add one), and sends that', async () => {
    const { client, rpcs } = clientWith({ status: 'found', book: row })
    await createLibrary(client).addToLibrary(snapshotFromDnbEdition(SCHWARM), { status: 'want_to_read' } as never)
    expect(rpcs[0]!.name).toBe('add_to_library')
    expect(rpcs[0]!.args.p_book).toMatchObject({ isbn13: '9783462041002', source: 'import', title: 'Der Schwarm' })
    await createLibrary(client).changeEdition('entry-1', snapshotFromDnbEdition(SCHWARM))
    expect(rpcs.at(-1)!.name).toBe('change_edition')
  })

  it('refuses when the function cannot make it, and sends nothing; other books never ask the function', async () => {
    const { client, rpcs } = clientWith({ status: 'not_found' })
    expect(await createLibrary(client).addToLibrary(snapshotFromDnbEdition(SCHWARM), {} as never)).toEqual({ data: null, error: 'unknown' })
    expect(await createLibrary(client).changeEdition('entry-1', snapshotFromDnbEdition(SCHWARM))).toEqual({ data: null, error: 'unknown' })
    expect(rpcs).toEqual([])
    const asked: string[] = []
    const plain = { functions: { invoke: async () => (asked.push('x'), { data: null, error: null }) }, rpc: async () => ({ data: { id: 'e' }, error: null }), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as unknown as SupabaseClient
    await createLibrary(plain).addToLibrary(book({ isbn13: '9780441013593', source: 'openlibrary', openLibraryEditionKey: 'OL1M' }), {} as never)
    await createLibrary(plain).addToLibrary(catalogueBook({ source: 'import' }), {} as never)
    expect(asked).toEqual([])
  })
})

describe('the cover of a DNB edition that is added', () => {
  it('goes with the request that makes the Catalogue Book, as the app resolved it', async () => {
    const sent: unknown[] = []
    const client = {
      functions: { invoke: async (_name: string, { body }: { body: unknown }) => (sent.push(body), { data: { status: 'found', book: { id: '22222222-2222-4222-8222-222222222222', title: 'T', authors: [], isbn13: '9783462041002', isbn10: null, page_count: null, published_year: null, language: null, publisher: null, description: null, cover_url: null, cover_thumbhash: null, cover_dominant: null, cover_secondary: null, source: 'import', apple_id: null, openlibrary_edition_key: null, openlibrary_work_key: null, created_at: '2026-10-11T10:00:00Z' } }, error: null }) },
      rpc: async () => ({ data: { id: 'entry-1' }, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    } as unknown as SupabaseClient
    const resolved = { ...snapshotFromDnbEdition(SCHWARM), coverUrl: 'https://covers.openlibrary.org/b/isbn/9783462041002-L.jpg', coverThumbhash: 'abc', coverColors: { dominant: '#111111', secondary: '#222222' } }
    await createLibrary(client).addToLibrary(resolved, {} as never)
    await createLibrary(client).addToLibrary(snapshotFromDnbEdition(SCHWARM), {} as never)
    expect(sent[0]).toEqual({ action: 'book', isbn13: '9783462041002', cover: { coverUrl: resolved.coverUrl, coverThumbhash: 'abc', coverColors: { dominant: '#111111', secondary: '#222222' } } })
    expect(sent[1]).toEqual({ action: 'book', isbn13: '9783462041002' })
  })
})
