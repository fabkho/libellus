import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createBookImport, findEdition, IMPORT_CHUNK, needsLook, pacedFetch, type ImportRow } from '@/data/bookImport'
import type { FetchLike } from '@/data/fetching'
import type { BookSnapshot } from '@/data/books'

/**
 * Writing a long file (the import's second wait): the Covers of a chunk are
 * resolved all at once, and those of the next chunk while this one is written,
 * so the minutes after "Import" are not spent one small wave of image probes at
 * a time. Synthetic rows only; the probe and the database are stubs.
 */

const snapshot = (n: number): BookSnapshot => ({
  title: `Book ${n}`,
  authors: ['Author'],
  isbn13: `97800000${String(n).padStart(5, '0')}`,
  isbn10: null,
  pageCount: null,
  year: null,
  language: null,
  publisher: null,
  description: null,
  coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/${n}/100x100bb.jpg`,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple',
  appleId: String(n),
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})

const rowOf = (n: number): ImportRow => ({
  key: `goodreads:${n}`,
  title: `Book ${n}`,
  authors: ['Author'],
  status: 'want_to_read',
  session: null,
  extraReads: 0,
  pageCount: null,
  otherKeys: [],
  addedOn: null,
  book: snapshot(n),
})

describe('writing rows', () => {
  it('resolves a chunk\'s covers in parallel and the next chunk\'s while the first is written', async () => {
    const events: string[] = []
    let live = 0
    let peak = 0
    const probe = async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise((resolve) => setTimeout(resolve, 5))
      live--
      return null
    }
    const client = {
      rpc: async (_name: string, args: { p_rows: { key: string }[] }) => {
        events.push(`write:${args.p_rows[0]!.key}`)
        await new Promise((resolve) => setTimeout(resolve, 30))
        return { data: args.p_rows.map((row) => ({ key: row.key, outcome: 'added', entry_id: 'e' })), error: null }
      },
    } as unknown as SupabaseClient
    const seen: string[] = []
    const importer = createBookImport(client, {
      lookups: { catalogue: { search: async () => [] }, search: { search: async () => ({ results: [], pending: false, failed: false }), lookupIsbn: async () => null } },
      probe: async (url) => {
        seen.push(url)
        return probe()
      },
    })
    const rows = Array.from({ length: IMPORT_CHUNK * 3 }, (_, n) => rowOf(n))
    const written: number[] = []
    const result = await importer.write(rows, { onWritten: (chunk) => written.push(chunk.length) })
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(rows.length)
    expect(written).toEqual([IMPORT_CHUNK, IMPORT_CHUNK, IMPORT_CHUNK])
    // Every row of a chunk is probed at once, not four at a time.
    expect(peak).toBeGreaterThan(4)
    // The second chunk's covers were being probed while the first was written.
    expect(events[0]).toBe('write:goodreads:0')
    expect(seen.length).toBeGreaterThanOrEqual(IMPORT_CHUNK * 2)
  })

  it('writes what was probed even when one cover lookup throws', async () => {
    const client = {
      rpc: async (_name: string, args: { p_rows: { key: string }[] }) => ({
        data: args.p_rows.map((row) => ({ key: row.key, outcome: 'added', entry_id: 'e' })),
        error: null,
      }),
    } as unknown as SupabaseClient
    const importer = createBookImport(client, {
      lookups: { catalogue: { search: async () => [] }, search: { search: async () => ({ results: [], pending: false, failed: false }), lookupIsbn: async () => null } },
      probe: async () => {
        throw new Error('decode failed')
      },
    })
    const result = await importer.write([rowOf(1), rowOf(2)], { onWritten: () => {} })
    expect(result.error).toBeNull()
    expect(result.data?.map((outcome) => outcome.outcome)).toEqual(['added', 'added'])
  })
})

describe('writing with covers found meanwhile', () => {
  const written: { p_rows: { key: string; book?: { cover_url: string | null; cover_thumbhash: string | null } }[] }[] = []
  const client = {
    rpc: async (_name: string, args: (typeof written)[number]) => {
      written.push(args)
      return { data: args.p_rows.map((row) => ({ key: row.key, outcome: 'added', entry_id: 'e' })), error: null }
    },
  } as unknown as SupabaseClient
  const importer = (probe: (url: string) => Promise<null>) =>
    createBookImport(client, {
      lookups: { catalogue: { search: async () => [] }, search: { search: async () => ({ results: [], pending: false, failed: false }), lookupIsbn: async () => null } },
      probe,
    })
  const bare = (n: number): ImportRow => ({ ...rowOf(n), book: { ...snapshot(n), coverUrl: null } })

  it('asks for each row just before its chunk: a row not written yet takes the cover that came in since', async () => {
    written.length = 0
    const rows = Array.from({ length: IMPORT_CHUNK + 1 }, (_, n) => bare(n))
    const refreshed: string[] = []
    const found = 'https://covers.openlibrary.org/b/id/42-L.jpg'
    const result = await importer(async () => null).write(rows, {
      onWritten: () => {},
      refresh: (row) => {
        refreshed.push(row.key)
        // The cover arrives while the first chunk is written: only the last row, in the second chunk, gets it.
        return row.key === `goodreads:${IMPORT_CHUNK}` ? { ...row, book: { ...row.book, coverUrl: found, coverThumbhash: 'hash' } as never } : row
      },
    })
    expect(result.error).toBeNull()
    expect(refreshed).toHaveLength(rows.length)
    expect(written[0]!.p_rows.every((row) => !row.book?.cover_url)).toBe(true)
    expect(written[1]!.p_rows[0]!.book).toMatchObject({ cover_url: found, cover_thumbhash: 'hash' })
  })

  it('does not resolve a cover again that the fill found with its thumbhash', async () => {
    written.length = 0
    const probed: string[] = []
    const row: ImportRow = { ...rowOf(1), book: { ...snapshot(1), coverUrl: 'https://covers.openlibrary.org/b/id/7-L.jpg', coverThumbhash: 'hash' } }
    await importer(async (url) => (probed.push(url), null)).write([row], { onWritten: () => {} })
    expect(probed).toEqual([])
    expect(written[0]!.p_rows[0]!.book).toMatchObject({ cover_url: 'https://covers.openlibrary.org/b/id/7-L.jpg', cover_thumbhash: 'hash' })
  })

  it('lends the cover the fill found for an edition only the file knows, without probing it again', async () => {
    written.length = 0
    const probed: string[] = []
    const row: ImportRow = {
      ...rowOf(1),
      book: { ...snapshot(1), coverUrl: null, source: 'import' },
      coverFrom: { ...snapshot(2), coverUrl: 'https://covers.openlibrary.org/b/id/9-L.jpg', coverThumbhash: 'lent' },
    }
    await importer(async (url) => (probed.push(url), null)).write([row], { onWritten: () => {} })
    expect(written[0]!.p_rows[0]!.book).toMatchObject({ cover_url: 'https://covers.openlibrary.org/b/id/9-L.jpg', cover_thumbhash: 'lent' })
    // Its own ISBN was tried for a cover (the Open Library by-ISBN step); the lent image was not read again.
    expect(probed.every((url) => !url.includes('/b/id/9-'))).toBe(true)
  })
})

describe('handing found covers to the Catalogue', () => {
  type Call = { name: string; args: { p_covers?: Record<string, unknown>[]; p_rows?: { key: string }[] } }
  const calls: Call[] = []
  const client = (failFill = false) =>
    ({
      rpc: async (name: string, args: Call['args']) => {
        calls.push({ name, args })
        if (name === 'fill_book_covers') {
          if (failFill) throw new Error('rpc down')
          return { data: 0, error: null }
        }
        return { data: args.p_rows!.map((row) => ({ key: row.key, outcome: row.key === 'goodreads:3' ? 'failed' : 'added', entry_id: 'e', error: row.key === 'goodreads:3' ? 'book_invalid' : undefined })), error: null }
      },
    }) as unknown as SupabaseClient
  const importer = (c: SupabaseClient) =>
    createBookImport(c, { lookups: { catalogue: { search: async () => [] }, search: { search: async () => ({ results: [], pending: false, failed: false }), lookupIsbn: async () => null } }, probe: async () => null })
  const withCoverUrl = (n: number, over: Partial<BookSnapshot> = {}): ImportRow => ({
    ...rowOf(n),
    book: { ...snapshot(n), coverUrl: `https://covers.openlibrary.org/b/id/${n}-L.jpg`, coverThumbhash: 'hash', coverColors: { dominant: '#112233', secondary: '#445566' }, ...over },
  })

  it('hands the covers of what was written to fill_book_covers once: snapshots by ISBN, a Catalogue Book only when the fill found its cover, never a failed row or a Manual book', async () => {
    calls.length = 0
    const catalogueBook = { ...snapshot(2), id: 'b2', createdAt: '', coverUrl: 'https://covers.openlibrary.org/b/id/2-L.jpg', coverThumbhash: 'h2', coverColors: null } as never
    const rows: ImportRow[] = [
      withCoverUrl(1),
      { ...rowOf(2), book: catalogueBook, coverFilled: true },
      withCoverUrl(3),
      withCoverUrl(4, { source: 'manual', isbn13: null }),
      { ...rowOf(5), book: { ...catalogueBook, id: 'b5' } },
    ]
    const result = await importer(client()).write(rows, { onWritten: () => {} })
    expect(result.error).toBeNull()
    const fills = calls.filter((call) => call.name === 'fill_book_covers')
    expect(fills).toHaveLength(1)
    expect(fills[0]!.args.p_covers).toEqual([
      { isbn13: snapshot(1).isbn13, cover_url: 'https://covers.openlibrary.org/b/id/1-L.jpg', cover_thumbhash: 'hash', cover_dominant: '#112233', cover_secondary: '#445566' },
      { book_id: 'b2', cover_url: 'https://covers.openlibrary.org/b/id/2-L.jpg', cover_thumbhash: 'h2', cover_dominant: null, cover_secondary: null },
    ])
  })

  it('hands a Goodreads cover the same way, so the next member never asks Goodreads for that Book (a Manual book keeps its own)', async () => {
    calls.length = 0
    const GR = (n: number) => `https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1682494830i/${n}.jpg`
    const catalogueBook = { ...snapshot(2), id: 'b2', createdAt: '', coverUrl: GR(2), coverThumbhash: 'h2', coverColors: null } as never
    const rows: ImportRow[] = [
      withCoverUrl(1, { coverUrl: GR(1) }),
      { ...rowOf(2), book: catalogueBook, coverFilled: true },
      withCoverUrl(4, { source: 'manual', isbn13: null, coverUrl: GR(4) }),
    ]
    await importer(client()).write(rows, { onWritten: () => {} })
    const fills = calls.filter((call) => call.name === 'fill_book_covers')
    expect(fills).toHaveLength(1)
    expect(fills[0]!.args.p_covers?.map((cover) => cover.cover_url)).toEqual([GR(1), GR(2)])
  })

  it('writes the import whatever that call says', async () => {
    calls.length = 0
    const result = await importer(client(true)).write([withCoverUrl(1)], { onWritten: () => {} })
    expect(result.error).toBeNull()
    expect(result.data?.[0]?.outcome).toBe('added')
  })

  it('asks for nothing when no written row has a cover', async () => {
    calls.length = 0
    await importer(client()).write([{ ...rowOf(1), book: { ...snapshot(1), coverUrl: null } }], { onWritten: () => {} })
    expect(calls.filter((call) => call.name === 'fill_book_covers')).toHaveLength(0)
  })
})

describe('needsLook', () => {
  const cover = { coverUrl: 'https://example.test/c.jpg' }
  it('is true when nothing identifies the row: no edition found and no ISBN in the file, whatever the cover', () => {
    expect(needsLook('fromFile', cover)).toBe(true)
    expect(needsLook('fromFile', null)).toBe(true)
    expect(needsLook('fromFile', null, { isbn13: null })).toBe(true)
  })
  it('is true when a source could not be asked: a better edition may exist', () => {
    expect(needsLook('fromFile', null, { isbn13: '9783453441088', unsure: true })).toBe(true)
  })
  it('is false for a row the file names by its ISBN that shows a cover, true without one (no cover is never "probably fine")', () => {
    expect(needsLook('fromFile', cover, { isbn13: '9783453441088' })).toBe(false)
    expect(needsLook('fromFile', null, { isbn13: '9783453441088' })).toBe(true)
  })
  it('is false for a match that shows a cover (its own, or one its work lent it), true for one without', () => {
    expect(needsLook('matched', cover)).toBe(false)
    expect(needsLook('matched', { coverUrl: null })).toBe(true)
    expect(needsLook('matched', null)).toBe(true)
  })
  it('is false for a row only Goodreads knows by the file\'s own book id, when it shows Goodreads\' cover', () => {
    expect(needsLook('fromFile', cover, { goodreadsOnly: true })).toBe(false)
    expect(needsLook('fromFile', null, { goodreadsOnly: true })).toBe(true)
  })
  it('is true for a match while a source could not be asked about it', () => {
    expect(needsLook('matched', cover, { unsure: true })).toBe(true)
  })
  it('is true for a row not looked up yet', () => {
    expect(needsLook(null, null)).toBe(true)
  })
})

describe('the second pass of a lookup', () => {
  const book = (n: number) => ({
    key: `goodreads:${n}`, source: 'goodreads', sourceId: String(n), row: n, title: `Book ${n}`, series: null, authors: ['Author'],
    isbn13: null, isbn10: null, pageCount: null, year: null, originalYear: null, binding: null, language: null, publisher: null,
    shelf: 'to-read', shelves: [], status: 'want_to_read', session: null, earlierReads: [], extraReads: 0, otherKeys: [], addedOn: null, problems: [],
  }) as never
  const client = {} as SupabaseClient

  function importerWith(search: (query: string, options: { signal?: AbortSignal }) => Promise<{ results: never[]; pending: boolean; failed: boolean }>) {
    return createBookImport(client, {
      lookups: { catalogue: { search: async () => [] }, search: { search, lookupIsbn: async () => null } },
      probe: async () => null,
    })
  }

  /** A source that refuses (every source failed) until `answering` says otherwise, then answers `then`. */
  function refusingFirst(then: (signal?: AbortSignal) => Promise<{ results: never[]; pending: boolean; failed: boolean }>) {
    const state = { answering: false }
    const search = async (_query: string, { signal }: { signal?: AbortSignal }) =>
      state.answering ? then(signal) : { results: [] as never[], pending: false, failed: true }
    return { state, search }
  }

  it('is counted, and its answers arrive per book', async () => {
    const { state, search } = refusingFirst(async () => ({ results: [], pending: false, failed: false }))
    const importer = importerWith(search)
    const counts: string[] = []
    let editions = 0
    await importer.match([book(1), book(2), book(3)], {
      onEdition: () => void editions++,
      onSecondPass: (done, total) => {
        state.answering = true
        counts.push(`${done}/${total}`)
      },
    })
    // No source could be asked the first time: all three are asked again, and every answer is reported again.
    expect(counts).toEqual(['0/3', '1/3', '2/3', '3/3'])
    expect(editions).toBe(6)
  })

  it('asks nothing again about a row every source answered: "nothing found" is final', async () => {
    const importer = importerWith(async () => ({ results: [], pending: false, failed: false }))
    const counts: string[] = []
    await importer.match([book(1), book(2)], { onEdition: () => {}, onSecondPass: (done, total) => counts.push(`${done}/${total}`) })
    expect(counts).toEqual([])
  })

  it('ends when its own signal aborts, keeping the first answers, and the match resolves', async () => {
    const { state, search } = refusingFirst((signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped')))))
    const importer = importerWith(search)
    const stop = new AbortController()
    const seen: number[] = []
    const started = importer.match([book(1), book(2)], {
      onEdition: (index) => void seen.push(index),
      onSecondPass: (done) => {
        state.answering = true
        if (done === 0) setTimeout(() => stop.abort(), 20)
      },
      secondPassSignal: stop.signal,
    })
    await expect(started).resolves.toBeUndefined()
    expect(seen).toEqual([0, 1])
  })

  it('ends by itself after its budget, so a stalled source cannot hold the preview back', async () => {
    const { state, search } = refusingFirst((signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped')))))
    const importer = importerWith(search)
    const started = performance.now()
    await importer.match([book(1)], { onEdition: () => {}, onSecondPass: () => void (state.answering = true), secondPassBudgetMs: 30 })
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('waits until a paced host lets us back before asking again', async () => {
    const { state, search } = refusingFirst(async () => ({ results: [], pending: false, failed: false }))
    let busy = 120
    const importer = createBookImport(client, {
      lookups: { catalogue: { search: async () => [] }, search: { search, lookupIsbn: async () => null }, busyFor: () => busy },
      probe: async () => null,
    })
    const started = performance.now()
    await importer.match([book(1)], {
      onEdition: () => {},
      onSecondPass: (done) => {
        state.answering = true
        if (done === 1) busy = 0
      },
    })
    expect(performance.now() - started).toBeGreaterThanOrEqual(100)
  })

  it('still rejects when the whole lookup is aborted', async () => {
    const { search } = refusingFirst(async () => ({ results: [], pending: false, failed: false }))
    const importer = importerWith(search)
    const all = new AbortController()
    const run = importer.match([book(1)], { signal: all.signal, onEdition: () => {}, onSecondPass: () => all.abort() })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('a host that keeps refusing', () => {
  it('is left alone for a while: its requests answer at once instead of costing the waits each time', async () => {
    let clock = 0
    let calls = 0
    const fetch: FetchLike = async () => {
      calls++
      return { ok: false, status: 403, json: async () => ({}) }
    }
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1, cooldownMs: 1000, now: () => clock })
    const first = await paced('https://itunes.apple.com/search?term=a')
    expect(first.status).toBe(403)
    // The first request tried three times, then the host is blocked.
    expect(calls).toBe(3)
    const second = await paced('https://itunes.apple.com/search?term=b')
    expect(second.ok).toBe(false)
    expect(calls).toBe(3)
    // After the cool-down: one attempt only; refused again, blocked again.
    clock = 2000
    await paced('https://itunes.apple.com/search?term=c')
    expect(calls).toBe(4)
    await paced('https://itunes.apple.com/search?term=d')
    expect(calls).toBe(4)
  })

  it('asks again after the cool-down and goes on as before once it answers', async () => {
    let clock = 0
    let refusing = true
    const fetch: FetchLike = async () => (refusing ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({}) })
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1, cooldownMs: 1000, now: () => clock })
    await paced('https://itunes.apple.com/search?term=a')
    refusing = false
    clock = 1500
    expect((await paced('https://itunes.apple.com/search?term=b')).status).toBe(200)
    expect((await paced('https://itunes.apple.com/search?term=c')).status).toBe(200)
  })

  it('waits what the host names in Retry-After before it tries again', async () => {
    let calls = 0
    const fetch: FetchLike = async () =>
      ++calls === 1
        ? { ok: false, status: 429, json: async () => ({}), headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '0.08' : null) } }
        : { ok: true, status: 200, json: async () => ({}) }
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1 })
    const started = Date.now()
    expect((await paced('https://itunes.apple.com/search?term=a')).status).toBe(200)
    expect(Date.now() - started).toBeGreaterThanOrEqual(75)
    expect(calls).toBe(2)
  })

  it('leaves a host that named a time alone for a short while, not the flat cool-down, and says how long', async () => {
    let clock = 0
    let calls = 0
    const fetch: FetchLike = async () => (
      calls++,
      { ok: false, status: 429, json: async () => ({}), headers: { get: () => '0.001' } }
    )
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1, cooldownMs: 60_000, now: () => clock })
    await paced('https://itunes.apple.com/search?term=a')
    expect(calls).toBe(3)
    expect(paced.blockedFor('itunes.apple.com')).toBe(15_000)
    expect(paced.blockedFor('openlibrary.org')).toBe(0)
    clock = 14_000
    expect((await paced('https://itunes.apple.com/search?term=b')).status).toBe(429)
    expect(calls).toBe(3)
    clock = 15_500
    expect(paced.blockedFor('itunes.apple.com')).toBe(0)
    await paced('https://itunes.apple.com/search?term=c')
    expect(calls).toBe(4)
  })

  it('keeps the flat cool-down when the host names no time', async () => {
    let clock = 0
    const fetch: FetchLike = async () => ({ ok: false, status: 403, json: async () => ({}) })
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1, cooldownMs: 60_000, now: () => clock })
    await paced('https://itunes.apple.com/search?term=a')
    expect(paced.blockedFor('itunes.apple.com')).toBe(60_000)
  })

  it('does not hold back a host that is not paced', async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}) })
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1, now: () => 0 })
    await paced('https://itunes.apple.com/search?term=a')
    expect((await paced('https://openlibrary.org/search.json?q=a')).status).toBe(429)
  })
})

describe('finding an edition by title', () => {
  const row = {
    title: 'Haunting Adeline', authors: ['H.D. Carlton'], isbn13: null, isbn10: null, pageCount: null, year: null, binding: null, language: null,
  } as never
  const found = { book: { title: 'Haunting Adeline', authors: ['H. D. Carlton'], language: null, pageCount: null, year: null, source: 'openlibrary', coverUrl: 'https://x/c.jpg' } }

  it('asks again with the title and the surname when the first query finds nobody (initials in the author)', async () => {
    const asked: string[] = []
    const lookups = {
      catalogue: { search: async () => [] },
      search: {
        lookupIsbn: async () => null,
        search: async (query: string) => {
          asked.push(query)
          return { results: query === 'Haunting Adeline Carlton' ? [found] : [], pending: false, failed: false } as never
        },
      },
    }
    const edition = await findEdition(row, lookups as never)
    // Each question goes to the free sources first, then to Apple while they found nothing that settles the row.
    expect([...new Set(asked)]).toEqual(['Haunting Adeline H.D. Carlton', 'Haunting Adeline Carlton'])
    expect(edition.via).toBe('title')
  })

  it('does not ask twice when the first query found the book', async () => {
    const asked: string[] = []
    const lookups = {
      catalogue: { search: async () => [] },
      search: { lookupIsbn: async () => null, search: async (query: string) => (asked.push(query), { results: [found], pending: false, failed: false } as never) },
    }
    expect((await findEdition(row, lookups as never)).via).toBe('title')
    expect(asked).toHaveLength(1)
  })
})
