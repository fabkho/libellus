import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import type { Edition } from '@/data/bookImport'
import {
  COVER_FILL_SEARCH_GAP_MS,
  coverFromBooksAnswer,
  coverFromWorkAnswer,
  coverIsbns,
  createCoverFill,
  LANE_FAILURES,
  languageFits,
  mergeCover,
  OPENLIBRARY_BATCH,
  openLibraryBooksUrl,
  openLibraryWorkUrl,
  SEARCH_FAILURES,
  siblingCovers,
  type CoverFound,
  type CoverWanted,
} from '@/data/coverFill'
import type { FetchLike } from '@/data/fetching'
import type { ProbeImage } from '@/data/covers'

/**
 * The import's background cover resolver (data/coverFill.ts): siblings, Open Library
 * in batches, a paced search, its breaker and budget, and the merge into an edition.
 * Synthetic rows and stubs only: no test here reaches a live host.
 */

const OL = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`
const APPLE = (n: number) => `https://is1-ssl.mzstatic.com/image/thumb/Publication/${n}/200x300bb.jpg`

/** An image that will do as a cover: big enough, with some contrast. */
const GOOD: Awaited<ReturnType<ProbeImage>> = {
  width: 400,
  height: 600,
  pixels: { width: 10, height: 10, data: Uint8ClampedArray.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) },
}
const goodProbe: ProbeImage = async () => GOOD

const snapshot = (over: Partial<BookSnapshot> = {}): BookSnapshot => ({
  title: 'Brennen muss Salem',
  authors: ['Stephen King'],
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
  source: 'openlibrary',
  appleId: null,
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
  ...over,
})

const wanted = (n: number, over: Partial<CoverWanted['row']> = {}, alternatives: CoverWanted['alternatives'] = []): CoverWanted => ({
  key: `goodreads:${n}`,
  row: { title: `Der Roman ${n}`, authors: ['Anna Autorin'], isbn13: `97834530${String(n).padStart(5, '0')}`, isbn10: null, language: null, pageCount: null, year: null, binding: null, ...over },
  book: { isbn13: over.isbn13 ?? `97834530${String(n).padStart(5, '0')}`, isbn10: over.isbn10 ?? null },
  alternatives,
})

const noFetch: FetchLike = async () => {
  throw new Error('no network in this test')
}
const noSearch = { searchCovers: async () => ({ results: [], pending: false, failed: false }) }

/** The waits the lane asked for, answered at once. */
function clock() {
  let time = 1_000_000
  const waited: number[] = []
  return {
    waited,
    now: () => time,
    wait: async (ms: number) => {
      waited.push(ms)
      time += Math.max(0, ms)
    },
  }
}

/** Open Library's `api/books` answer: only the ISBNs given have a cover. */
function openLibrary(covers: Record<string, string | { large: string }>, requests: string[][] = []): FetchLike {
  return async (url) => {
    const keys = (new URL(url).searchParams.get('bibkeys') ?? '').split(',')
    requests.push(keys)
    const body: Record<string, unknown> = {}
    for (const key of keys) {
      const cover = covers[key.replace('ISBN:', '')]
      if (cover) body[key] = { cover: typeof cover === 'string' ? { large: cover } : cover }
      else if (key.endsWith('0')) body[key] = { title: 'No cover' }
    }
    return { ok: true, status: 200, json: async () => body }
  }
}

function collect() {
  const found: Record<string, CoverFound> = {}
  return { found, onFound: (key: string, cover: CoverFound) => void (found[key] = cover) }
}

describe('siblings', () => {
  it('takes the same work\'s other editions that have a cover, in the row\'s language', () => {
    const w = wanted(1, { title: 'Der Zauberberg', language: 'de' }, [
      snapshot({ title: 'The Magic Mountain', language: 'eng', coverUrl: OL(1) }),
      snapshot({ title: 'Der Zauberberg', language: 'ger', coverUrl: OL(2) }),
      snapshot({ title: 'Der Zauberberg', language: null, coverUrl: null }),
      snapshot({ title: 'Der Zauberberg', language: null, coverUrl: OL(3) }),
    ])
    expect(siblingCovers(w)).toEqual([OL(2), OL(3)])
  })

  it('tells a language by the title when neither the file nor the edition says', () => {
    expect(languageFits({ title: 'Der Vorleser', language: null }, { title: 'The Reader', language: null })).toBe(false)
    expect(languageFits({ title: 'Circe', language: null }, { title: 'Circe', language: 'en' })).toBe(true)
  })

  it('fills a row from a sibling without a single request', async () => {
    const { found, onFound } = collect()
    const fill = createCoverFill({ fetch: noFetch, search: noSearch, probe: goodProbe, onFound, batchWaitMs: 0 })
    fill.add(wanted(1, {}, [snapshot({ coverUrl: APPLE(1) })]))
    await fill.settled(1000)
    expect(found['goodreads:1']?.source).toBe('sibling')
    expect(found['goodreads:1']?.coverUrl).toContain('600x900bb')
    expect(found['goodreads:1']?.coverThumbhash).toBeTruthy()
    expect(fill.calls().search).toBe(0)
  })
})

describe('Open Library in batches', () => {
  it('asks for up to 25 rows per call, with ISBN-13 and ISBN-10, and takes the cover by id', async () => {
    const requests: string[][] = []
    const covers: Record<string, string> = {}
    const rows = Array.from({ length: OPENLIBRARY_BATCH + 5 }, (_, i) => wanted(i + 1, { isbn10: `34530${String(i + 1).padStart(4, '0')}` }))
    for (const row of rows) covers[row.row.isbn13!] = OL(Number(row.row.isbn13!.slice(-4)) + 100)
    const { found, onFound } = collect()
    const fill = createCoverFill({ fetch: openLibrary(covers, requests), search: noSearch, probe: goodProbe, onFound, batchWaitMs: 5 })
    for (const row of rows) fill.add(row)
    await fill.settled(2000)
    expect(requests.map((keys) => keys.length)).toEqual([OPENLIBRARY_BATCH * 2, 5 * 2])
    expect(requests[0]).toContain(`ISBN:${rows[0]!.row.isbn13}`)
    expect(requests[0]).toContain(`ISBN:${rows[0]!.row.isbn10}`)
    expect(Object.keys(found)).toHaveLength(rows.length)
    expect(found['goodreads:1']).toMatchObject({ source: 'openlibrary', coverUrl: OL(101) })
    expect(fill.calls().openlibrary).toBe(2)
    expect(fill.progress()).toEqual({ total: 30, done: 30, found: 30 })
  })

  it('ignores a cover that is not on covers.openlibrary.org', async () => {
    const { found, onFound } = collect()
    const w = wanted(1)
    const fill = createCoverFill({
      fetch: openLibrary({ [w.row.isbn13!]: 'https://example.test/c.jpg' }),
      search: noSearch,
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
    })
    fill.add(w)
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(found).toEqual({})
  })

  it('goes on to the search with a row Open Library has no cover for', async () => {
    const w = wanted(2, { title: 'Der Roman 2' })
    const { found, onFound } = collect()
    const asked: string[] = []
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: {
        searchCovers: async (query: string) => (asked.push(query), { results: [{ book: snapshot({ title: 'Der Roman 2', authors: ['Anna Autorin'], coverUrl: APPLE(2), source: 'apple' }) }], pending: false, failed: false }) as never,
      },
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
      ...clock(),
    })
    fill.add(w)
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked).toEqual(['Der Roman 2 Anna Autorin'])
    expect(found[w.key]?.source).toBe('search')
  })

  it('gives the lane up after a run of failed calls and asks no more', async () => {
    let calls = 0
    const failing: FetchLike = async (url) => (url.includes('/api/books') && calls++, { ok: false, status: 503, json: async () => ({}) })
    const fill = createCoverFill({ fetch: failing, search: noSearch, probe: goodProbe, onFound: () => {}, batchWaitMs: 0, batch: 1, wait: clock().wait })
    for (let n = 1; n <= LANE_FAILURES + 4; n++) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(calls).toBe(LANE_FAILURES)
  })

  it('stays away from Open Library for the time it names in Retry-After', async () => {
    let calls = 0
    let time = 0
    const refusing: FetchLike = async (url) => (
      url.includes('/api/books') && calls++,
      { ok: false, status: 429, json: async () => ({}), headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '30' : null) } }
    )
    const fill = createCoverFill({ fetch: refusing, search: noSearch, probe: goodProbe, onFound: () => {}, batchWaitMs: 0, batch: 1, now: () => time, wait: clock().wait })
    fill.add(wanted(1))
    fill.add(wanted(2))
    fill.add(wanted(3))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(calls).toBe(1)
  })
})

describe('the paced search', () => {
  const found = (n: number, over: Partial<BookSnapshot> = {}) => ({
    book: snapshot({ title: `Der Roman ${n}`, authors: ['Anna Autorin'], coverUrl: APPLE(n), source: 'apple', ...over }),
  })

  it('does not search while it is held, and answers with `settled` after the grace', async () => {
    let searched = 0
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: { searchCovers: async () => (searched++, { results: [], pending: false, failed: false }) as never },
      probe: goodProbe,
      onFound: () => {},
      batchWaitMs: 0,
    })
    fill.add(wanted(1))
    const settled = await Promise.race([fill.settled(30).then(() => 'grace'), new Promise((resolve) => setTimeout(() => resolve('never'), 500))])
    expect(settled).toBe('grace')
    expect(searched).toBe(0)
    expect(fill.progress()).toEqual({ total: 1, done: 0, found: 0 })
    fill.stop()
    expect(fill.progress().done).toBe(1)
  })

  it('keeps the gap between two searches and waits out a host that is refused', async () => {
    const time = clock()
    let blocked = 0
    const { onFound } = collect()
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: { searchCovers: async (query: string) => ({ results: [found(Number(query.match(/\d+/)![0]))], pending: false, failed: false }) as never },
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
      hostBlockedFor: (host) => (host === 'itunes.apple.com' ? blocked : 0),
      ...time,
    })
    fill.add(wanted(1))
    fill.add(wanted(2))
    fill.add(wanted(3))
    fill.holdSearch(false)
    await fill.settled(1000)
    // 3 searches, one gap apart: the first waits for nothing, the next two for the gap.
    expect(time.waited.filter((ms) => ms > 0)).toEqual([COVER_FILL_SEARCH_GAP_MS, COVER_FILL_SEARCH_GAP_MS])

    const again = clock()
    blocked = 11_000
    const second = createCoverFill({
      fetch: openLibrary({}),
      search: { searchCovers: async () => ({ results: [found(4)], pending: false, failed: false }) as never },
      probe: goodProbe,
      onFound: () => {},
      batchWaitMs: 0,
      hostBlockedFor: () => blocked,
      ...again,
    })
    second.add(wanted(4))
    second.holdSearch(false)
    await second.settled(1000)
    expect(again.waited).toContain(11_000)
  })

  it('takes the best-fitting edition of the same work with a cover, not another language, not another work', async () => {
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: {
        searchCovers: async () =>
          ({
            results: [
              found(1, { title: 'Ein ganz anderes Buch', coverUrl: APPLE(9) }),
              found(1, { title: 'The Novel 1', language: 'en', coverUrl: APPLE(8) }),
              found(1, { coverUrl: null }),
              found(1, { coverUrl: APPLE(7) }),
            ],
            pending: false,
            failed: false,
          }) as never,
      },
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
      ...clock(),
    })
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(filled['goodreads:1']?.coverUrl).toContain('/7/')
  })

  it('answers a row nothing was found for as none, and never reports a cover for it', async () => {
    const reported: string[] = []
    const fill = createCoverFill({ fetch: openLibrary({}), search: noSearch, probe: goodProbe, onFound: (key) => reported.push(key), batchWaitMs: 0, ...clock() })
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(reported).toEqual([])
    expect(fill.progress()).toEqual({ total: 1, done: 1, found: 0 })
  })

  it('skips a stray pixel, takes a low-resolution cover: it is better than none', async () => {
    const run = async (size: { width: number; height: number }) => {
      const probe: ProbeImage = async () => ({ ...GOOD, ...size })
      const { found: filled, onFound } = collect()
      const fill = createCoverFill({
        fetch: openLibrary({}),
        search: { searchCovers: async () => ({ results: [found(1)], pending: false, failed: false }) as never },
        probe,
        onFound,
        batchWaitMs: 0,
        ...clock(),
      })
      fill.add(wanted(1))
      fill.holdSearch(false)
      await fill.settled(1000)
      return filled
    }
    expect(await run({ width: 20, height: 30 })).toEqual({})
    expect(await run({ width: 80, height: 120 })).toHaveProperty(['goodreads:1', 'kind'], 'ebook')
  })

  it('pauses with a growing pause after a failed search, asks a row once more, then gives the lane up', async () => {
    const time = clock()
    let searched = 0
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: { searchCovers: async () => (searched++, { results: [], pending: false, failed: true }) as never },
      probe: goodProbe,
      onFound: () => {},
      batchWaitMs: 0,
      ...time,
    })
    for (let n = 1; n <= 10; n++) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(searched).toBe(SEARCH_FAILURES)
    expect(fill.progress()).toEqual({ total: 10, done: 10, found: 0 })
    // The waits between the searches grew: 5 s × 2^n after each failure, never below the gap.
    const waits = time.waited.filter((ms) => ms > 0)
    expect(waits.length).toBeGreaterThan(1)
    expect(waits[waits.length - 1]!).toBeGreaterThan(waits[0]!)
    // And it stops: nothing more is asked afterwards.
    fill.add(wanted(11))
    await fill.settled(1000)
    expect(searched).toBe(SEARCH_FAILURES)
  })

  it('waits out a refusal instead of counting it: the row stays first and is searched when Apple lets the address in', async () => {
    const time = clock()
    let blockedUntil = 0
    let searched = 0
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: {
        searchCovers: async () => {
          searched++
          // Refused the first eight times, which would be more than the lane's failures if they counted.
          if (searched <= 8) {
            blockedUntil = time.now() + 11_000
            return { results: [], pending: false, failed: true } as never
          }
          return { results: [found(1)], pending: false, failed: false } as never
        },
      },
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
      hostBlockedFor: (host) => (host === 'itunes.apple.com' ? Math.max(0, blockedUntil - time.now()) : 0),
      ...time,
    } as never)
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(searched).toBe(9)
    expect(filled['goodreads:1']?.source).toBe('search')
    // Every refusal was waited out in full.
    expect(time.waited.filter((ms) => ms >= 11_000)).toHaveLength(8)
  })

  it('stops searching when its budget is spent: the rest stay without a cover, quietly', async () => {
    const time = clock()
    let searched = 0
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: { searchCovers: async (query: string) => (searched++, { results: [found(Number(query.match(/\d+/)![0]))], pending: false, failed: false }) as never },
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
      budgetMs: 10_000,
      ...time,
    })
    for (let n = 1; n <= 6; n++) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    // Gap 3 s, budget 10 s: four searches start inside it (t = 0, 3, 6, 9 s), the rest do not.
    expect(searched).toBe(4)
    expect(Object.keys(filled)).toHaveLength(4)
    expect(fill.progress()).toEqual({ total: 6, done: 6, found: 4 })
  })

  it('takes a row back: a row dropped is not searched for', async () => {
    let searched = 0
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: { searchCovers: async () => (searched++, { results: [], pending: false, failed: false }) as never },
      probe: goodProbe,
      onFound: () => {},
      batchWaitMs: 0,
      ...clock(),
    })
    fill.add(wanted(1))
    fill.add(wanted(2))
    fill.drop('goodreads:1')
    fill.holdSearch(false)
    await fill.settled(1000)
    // The row that stayed: the first storefront, then the second.
    expect(searched).toBe(2)
    expect(fill.progress().total).toBe(1)
  })
})

describe('the work\'s other editions at Open Library', () => {
  const searchJson = (docs: unknown[], seen: string[] = []): FetchLike => async (url) => {
    seen.push(url)
    return { ok: true, status: 200, json: async () => (url.includes('/search.json') ? { docs } : {}) }
  }
  const w = wanted(1, { title: 'Der Roman 1', language: 'de' })

  it('takes the cover of the same work with a cover id, in the row\'s language, from the structured search', async () => {
    const seen: string[] = []
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({
      fetch: searchJson(
        [
          { title: 'Ein anderes Buch', author_name: ['Anna Autorin'], cover_i: 9, language: ['ger'] },
          { title: 'The Novel 1', author_name: ['Anna Autorin'], cover_i: 8, language: ['eng'] },
          { title: 'Der Roman 1', author_name: ['Anna Autorin'], cover_i: 0, language: ['ger'] },
          { title: 'Der Roman 1', author_name: ['Anna Autorin'], cover_i: 77, language: ['eng', 'ger'] },
        ],
        seen,
      ),
      search: noSearch,
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
      ...clock(),
    })
    fill.add(w)
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(filled[w.key]).toMatchObject({ source: 'work', kind: 'sameWork', coverUrl: OL(77) })
    const asked = new URL(seen.find((url) => url.includes('/search.json'))!)
    expect(asked.searchParams.get('title')).toBe('Der Roman 1')
    expect(asked.searchParams.get('author')).toBe('Anna Autorin')
    expect(fill.calls().work).toBe(1)
  })

  it('does not take a cover whose work has only editions in another language', async () => {
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({
      fetch: searchJson([{ title: 'Der Roman 1', author_name: ['Anna Autorin'], cover_i: 5, language: ['eng'] }]),
      search: noSearch,
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
      ...clock(),
    })
    fill.add(w)
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(filled).toEqual({})
  })

  it('asks the second Apple storefront for a row the first did not know, and only then gives it up', async () => {
    const storefronts: (number | undefined)[] = []
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({
      fetch: openLibrary({}),
      search: {
        searchCovers: async (_query: string, options?: { storefront?: 0 | 1 }) => {
          storefronts.push(options?.storefront)
          return { results: options?.storefront === 1 ? [{ book: snapshot({ title: 'Der Roman 1', authors: ['Anna Autorin'], coverUrl: APPLE(1), source: 'apple' }) }] : [], pending: false, failed: false } as never
        },
      },
      probe: goodProbe,
      onFound,
      batchWaitMs: 0,
      ...clock(),
    })
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(storefronts).toEqual([0, 1])
    expect(filled['goodreads:1']?.source).toBe('search')
  })
})

describe('the ranking: edition-exact, then the work\'s ebook, then another edition', () => {
  const searchJson = (): FetchLike => async (url) => ({
    ok: true,
    status: 200,
    json: async () => (url.includes('/search.json') ? { docs: [{ title: 'Der Roman 1', author_name: ['Anna Autorin'], cover_i: 77, language: ['ger'] }] } : {}),
  })
  const appleHit = { searchCovers: async () => ({ results: [{ book: snapshot({ title: 'Der Roman 1', authors: ['Anna Autorin'], coverUrl: APPLE(1), source: 'apple' }) }], pending: false, failed: false }) as never }

  it('takes the ebook at Apple over another print edition at Open Library', async () => {
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({ fetch: searchJson(), search: appleHit, probe: goodProbe, onFound, batchWaitMs: 0, ...clock() })
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(filled['goodreads:1']).toMatchObject({ source: 'search', kind: 'ebook' })
  })

  it('takes the edition itself over both', async () => {
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({ fetch: openLibrary({ '97834530000010': OL(5) }), search: appleHit, probe: goodProbe, onFound, batchWaitMs: 0, ...clock() })
    fill.add(wanted(1, { isbn13: '97834530000010' }))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(filled['goodreads:1']).toMatchObject({ source: 'openlibrary', kind: 'exact', coverUrl: OL(5) })
  })

  it('reports another edition\'s cover at once, and the ebook replaces it when it is found', async () => {
    const reported: string[] = []
    const fill = createCoverFill({ fetch: searchJson(), search: appleHit, probe: goodProbe, onFound: (_key, cover) => void reported.push(`${cover.kind}`), batchWaitMs: 0, ...clock() })
    fill.add(wanted(1))
    await fill.settled(30)
    expect(reported).toEqual(['sameWork'])
    expect(fill.progress()).toEqual({ total: 1, done: 0, found: 1 })
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(reported).toEqual(['sameWork', 'ebook'])
    expect(fill.progress()).toEqual({ total: 1, done: 1, found: 1 })
  })

  it('keeps another edition\'s cover when Apple has no ebook of the work', async () => {
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({ fetch: searchJson(), search: noSearch, probe: goodProbe, onFound, batchWaitMs: 0, ...clock() })
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(filled['goodreads:1']).toMatchObject({ source: 'work', kind: 'sameWork', coverUrl: OL(77) })
  })

  it('takes a sibling edition\'s Apple cover as the ebook, an Open Library one only as the fallback', async () => {
    const { found: filled, onFound } = collect()
    const fill = createCoverFill({ fetch: openLibrary({}), search: noSearch, probe: goodProbe, onFound, batchWaitMs: 0, ...clock() })
    fill.add(wanted(1, {}, [snapshot({ title: 'Der Roman 1', authors: ['Anna Autorin'], coverUrl: APPLE(1), source: 'apple' })]))
    fill.add(wanted(2, {}, [snapshot({ title: 'Der Roman 2', authors: ['Anna Autorin'], coverUrl: OL(2) })]))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(filled['goodreads:1']).toMatchObject({ source: 'sibling', kind: 'ebook' })
    expect(filled['goodreads:2']).toMatchObject({ source: 'sibling', kind: 'sameWork' })
  })
})

describe('merging a found cover', () => {
  it('replaces a cover the fill gave with one of a better kind, never the reverse and never a cover of her own', () => {
    const lent = { coverUrl: OL(1), coverThumbhash: 'a', coverColors: null }
    const ebook = { coverUrl: APPLE(1), coverThumbhash: 'b', coverColors: null }
    const edition: Edition = { book: snapshot({ isbn13: '9783453441088' }), via: null, unsure: false }
    const first = mergeCover(edition, { ...lent, kind: 'sameWork' })!
    expect(first).toMatchObject({ filled: true, coverKind: 'sameWork' })
    const better = mergeCover(first, { ...ebook, kind: 'ebook' })!
    expect(better.coverFrom?.coverUrl).toBe(APPLE(1))
    expect(better.coverKind).toBe('ebook')
    expect(mergeCover(better, { ...lent, kind: 'sameWork' })).toBeNull()
    expect(mergeCover(better, { ...ebook, kind: 'ebook' })).toBeNull()
    // Hers: no kind recorded, nothing replaces it.
    expect(mergeCover({ ...edition, book: snapshot({ coverUrl: OL(9) }) }, { ...ebook, kind: 'exact' })).toBeNull()
  })

  const found = { coverUrl: OL(5), coverThumbhash: 'abc', coverColors: { dominant: '#112233', secondary: '#445566' } }
  const edition = (over: Partial<Edition>): Edition => ({ book: snapshot(), via: 'isbn', unsure: false, ...over })

  it('puts the cover on the Book of an edition a source found', () => {
    const merged = mergeCover(edition({}), found)!
    expect(merged.filled).toBe(true)
    expect(merged.book.coverUrl).toBe(OL(5))
    expect(merged.book.coverThumbhash).toBe('abc')
    expect(merged.coverFrom).toBeUndefined()
  })

  it('lends it as coverFrom when only the file knows the edition, which keeps its own ISBN and no cover', () => {
    const own = snapshot({ source: 'import', isbn13: '9783453441088' })
    const merged = mergeCover(edition({ book: own, via: null }), found)!
    expect(merged.book.coverUrl).toBeNull()
    expect(merged.book.isbn13).toBe('9783453441088')
    expect(merged.coverFrom?.coverUrl).toBe(OL(5))
  })

  it('puts the cover on a Manual book itself: nothing else is hers to lend it', () => {
    const edition: Edition = { book: snapshot({ source: 'manual', isbn13: null }), via: null, unsure: false }
    const next = mergeCover(edition, { coverUrl: APPLE(1), coverThumbhash: 'b', coverColors: null })!
    expect(next.book.coverUrl).toBe(APPLE(1))
    expect(next.coverFrom).toBeUndefined()
  })

  it('leaves an edition that has a cover alone', () => {
    expect(mergeCover(edition({ book: snapshot({ coverUrl: OL(1) }) }), found)).toBeNull()
    expect(mergeCover(edition({ via: null, coverFrom: snapshot({ coverUrl: OL(1) }) }), found)).toBeNull()
  })
})

// What the import job's cover stage (supabase/functions/import-job/covers.ts) shares with the fill: Open Library's requests and its answers' readers.
describe('Open Library requests and answers, shared with the import job', () => {
  it('names the ISBNs of a row once each, the file\'s and the edition\'s', () => {
    expect(coverIsbns({ row: { isbn13: '9781635575637', isbn10: null }, book: { isbn13: '9781635575637', isbn10: '1635575630' } })).toEqual(['9781635575637', '1635575630'])
    expect(coverIsbns({ row: { isbn13: null, isbn10: null }, book: { isbn13: null, isbn10: null } })).toEqual([])
  })

  it('asks api/books for every ISBN in one call, and the work\'s search by title and first author', () => {
    expect(openLibraryBooksUrl(['1', '2'])).toBe('https://openlibrary.org/api/books?bibkeys=ISBN%3A1%2CISBN%3A2&jscmd=data&format=json')
    const url = new URL(openLibraryWorkUrl({ title: 'Piranesi', authors: ['Susanna Clarke', 'Other'] }))
    expect(url.pathname).toBe('/search.json')
    expect(url.searchParams.get('title')).toBe('Piranesi')
    expect(url.searchParams.get('author')).toBe('Susanna Clarke')
  })

  it('reads the large cover of the first ISBN that has one, and only an Open Library cover address', () => {
    const answer = { 'ISBN:1': {}, 'ISBN:2': { cover: { large: OL(22), medium: OL(23) } } }
    expect(coverFromBooksAnswer(answer, ['1', '2'])).toBe(OL(22))
    expect(coverFromBooksAnswer({ 'ISBN:1': { cover: { large: 'https://evil.example/c.jpg' } } }, ['1'])).toBeNull()
    expect(coverFromBooksAnswer(null, ['1'])).toBeNull()
  })

  it('reads the work\'s cover: the first document of the same work with a cover, in the row\'s language', () => {
    const row = { title: 'Piranesi', authors: ['Susanna Clarke'], language: 'en' }
    expect(coverFromWorkAnswer(row, { docs: [{ title: 'Piranesi', author_name: ['Susanna Clarke'], cover_i: 10226290, language: ['ita', 'eng'] }] })).toBe(
      'https://covers.openlibrary.org/b/id/10226290-L.jpg',
    )
    expect(coverFromWorkAnswer(row, { docs: [{ title: 'Piranesi', author_name: ['Susanna Clarke'], cover_i: 1, language: ['ger'] }] })).toBeNull()
    expect(coverFromWorkAnswer(row, { docs: [{ title: 'Piranesi', author_name: ['Susanna Clarke'] }] })).toBeNull()
    expect(coverFromWorkAnswer(row, null)).toBeNull()
  })
})
