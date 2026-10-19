import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import {
  createCoverFill,
  COVER_FILL_GOODREADS_GAP_MS,
  GOODREADS_FAILURES,
  GOODREADS_LATER_PAUSE_MS,
  GOODREADS_LATER_RUN,
  GOODREADS_LATER_TRIES,
  GOODREADS_RETRY_AFTER_MS,
  mergeCover,
  type CoverFound,
  type CoverWanted,
} from '@/data/coverFill'
import { coverKindOf, kindRank, GOODREADS_COVERS } from '@/data/coverRank'
import { verifyCover, type ProbeImage } from '@/data/covers'
import type { FetchLike } from '@/data/fetching'
import { createGoodreadsCover } from '@/data/goodreadsCover'

/**
 * The Goodreads cover, the last-resort source (docs/covers.md): the fill's last stage and the client that
 * asks the function for it. Stubs only: no test here reaches Goodreads or the function.
 */

const GR = (n: number) => `https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1682494830i/${n}.jpg`
const OL = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`
const APPLE = (n: number) => `https://is1-ssl.mzstatic.com/image/thumb/Publication/${n}/200x300bb.jpg`

const GOOD: Awaited<ReturnType<ProbeImage>> = {
  width: 332,
  height: 500,
  pixels: { width: 10, height: 10, data: Uint8ClampedArray.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) },
}
const goodProbe: ProbeImage = async () => GOOD

const snapshot = (over: Partial<BookSnapshot> = {}): BookSnapshot => ({
  title: 'Der Roman',
  authors: ['Anna Autorin'],
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

/** A Goodreads file's row (`goodreadsId`, the file's own book id) unless `fromGoodreads` is false (another file's). */
const wanted = (n: number, over: Partial<CoverWanted> = {}): CoverWanted => ({
  key: `goodreads:${n}`,
  row: { title: `Der Roman ${n}`, authors: ['Anna Autorin'], isbn13: null, isbn10: null, language: null, pageCount: null, year: null, binding: null },
  book: { isbn13: null, isbn10: null },
  goodreadsId: String(n),
  ...over,
})

const noFetch: FetchLike = async () => {
  throw new Error('no network in this test')
}
const noSearch = { searchCovers: async () => ({ results: [], pending: false, failed: false }) }

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

function setup(options: Partial<Parameters<typeof createCoverFill>[0]> = {}) {
  const found: Record<string, CoverFound> = {}
  const asked: { title: string; authors: string[]; isbn13: string | null; goodreadsBookId: string | null }[] = []
  const time = clock()
  const fill = createCoverFill({
    fetch: noFetch,
    search: noSearch,
    probe: goodProbe,
    onFound: (key, cover) => void (found[key] = cover),
    batchWaitMs: 0,
    goodreadsCovers: true,
    goodreads: async (query) => (asked.push(query), GR(Number(query.goodreadsBookId))),
    ...time,
    ...options,
  })
  return { fill, found, asked, time }
}

describe('the Goodreads stage of the cover fill', () => {
  it('is the flag: on by default (the owner decides before merge), and a Goodreads cover ranks below the work\'s other editions', () => {
    expect(GOODREADS_COVERS).toBe(true)
    expect(coverKindOf('goodreads', GR(1))).toBe('goodreads')
    expect(kindRank('goodreads')).toBeGreaterThan(kindRank('sameWork'))
    expect(kindRank('goodreads')).toBeLessThan(kindRank('placeholder'))
  })

  it('asks for a Goodreads file\'s row that nothing else found a cover for, with its title, authors and book id', async () => {
    const { fill, found, asked } = setup()
    fill.add(wanted(42))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked).toEqual([{ title: 'Der Roman 42', authors: ['Anna Autorin'], isbn13: null, goodreadsBookId: '42' }])
    expect(found['goodreads:42']).toMatchObject({ coverUrl: GR(42), source: 'goodreads', kind: 'goodreads' })
    expect(found['goodreads:42']?.coverThumbhash).toBeTruthy()
    expect(fill.calls().goodreads).toBe(1)
    expect(fill.progress()).toEqual({ total: 1, done: 1, found: 1 })
  })

  it('has its own lane: it does not wait for the Apple search lane (held until the lookups end) nor for its pace', async () => {
    const { fill, found, asked } = setup()
    fill.add(wanted(1))
    // The Apple lane is still held; Goodreads asks anyway and the row has its cover already.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(asked).toHaveLength(1)
    expect(found['goodreads:1']).toMatchObject({ source: 'goodreads' })
    // The row is answered once Apple's lane is through with it as well.
    expect(fill.progress()).toEqual({ total: 1, done: 0, found: 1 })
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(fill.progress()).toEqual({ total: 1, done: 1, found: 1 })
  })

  it('is asked only for a row with no cover after the lookups (Open Library, a sibling, the work); the ebook found later still wins', async () => {
    const olFetch: FetchLike = async (url) =>
      url.includes('/api/books')
        ? ({ ok: true, status: 200, json: async () => ({ 'ISBN:9783453000019': { cover: { large: OL(7) } } }) } as never)
        : ({ ok: true, status: 200, json: async () => ({ docs: [] }) } as never)
    const { fill, found, asked } = setup({
      fetch: olFetch,
      search: {
        searchCovers: async () =>
          ({ results: [{ book: snapshot({ title: 'Der Roman 3', coverUrl: APPLE(3), source: 'apple' }) }], pending: false, failed: false }) as never,
      },
    })
    fill.add(wanted(1, { row: { ...wanted(1).row, isbn13: '9783453000019' }, book: { isbn13: '9783453000019', isbn10: null } }))
    fill.add(wanted(2, { alternatives: [snapshot({ title: 'Der Roman 2', coverUrl: OL(2) })] }))
    fill.add(wanted(3))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(found['goodreads:1']?.source).toBe('openlibrary')
    // A sibling edition's cover is the fallback: the row has a cover, Goodreads is not asked.
    expect(found['goodreads:2']?.kind).toBe('sameWork')
    // The row nothing else covered asked Goodreads in its own lane, at once; Apple's ebook, found after, replaced it.
    expect(found['goodreads:3']).toMatchObject({ source: 'search', kind: 'ebook' })
    expect(asked.map((query) => query.goodreadsBookId)).toEqual(['3'])
    expect(fill.calls().goodreads).toBe(1)
    expect(fill.progress()).toEqual({ total: 3, done: 3, found: 3 })
  })

  it('asks for a Goodreads row whatever its Book is, a Manual book (no ISBN, nothing found) included', async () => {
    const { fill, found, asked } = setup()
    fill.add(wanted(7, { book: { isbn13: null, isbn10: null }, row: { ...wanted(7).row, isbn13: null } }))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked.map((q) => q.goodreadsBookId)).toEqual(['7'])
    expect(found['goodreads:7']?.kind).toBe('goodreads')
  })

  it('never asks about a row of another file (no Goodreads book id)', async () => {
    const { fill, found, asked } = setup()
    fill.add(wanted(1, { key: 'storygraph:1', goodreadsId: undefined }))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked).toEqual([])
    expect(found).toEqual({})
    expect(fill.progress()).toEqual({ total: 1, done: 1, found: 0 })
  })

  it('flag off: the stage is skipped, not one call', async () => {
    const { fill, found, asked } = setup({ goodreadsCovers: false })
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked).toEqual([])
    expect(found).toEqual({})
    expect(fill.calls().goodreads).toBe(0)
    expect(fill.progress().done).toBe(1)
  })

  it('without a function wired there is no stage either', async () => {
    const { fill, found } = setup({ goodreads: undefined })
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(found).toEqual({})
    expect(fill.progress().done).toBe(1)
  })

  it('is paced: serial, at least 1.2 s apart (1.6 s by default)', async () => {
    expect(COVER_FILL_GOODREADS_GAP_MS).toBeGreaterThanOrEqual(1200)
    const time = clock()
    const at: number[] = []
    const { fill } = setup({
      ...time,
      goodreads: async (query) => (at.push(time.now()), GR(Number(query.goodreadsBookId))),
    })
    for (const n of [1, 2, 3]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(at).toHaveLength(3)
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(COVER_FILL_GOODREADS_GAP_MS)
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(COVER_FILL_GOODREADS_GAP_MS)
  })

  it('gives its lane up AT ONCE on blocked (not after three failures), tells onBlocked once, and the rows go on without a cover', async () => {
    let blocked = 0
    const { fill, found, asked } = setup({
      goodreads: async (query) => (asked.push(query), 'blocked'),
      onBlocked: () => void blocked++,
    })
    for (const n of [1, 2, 3, 4]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked).toHaveLength(1)
    expect(blocked).toBe(1)
    expect(found).toEqual({})
    expect(fill.calls().goodreads).toBe(1)
    expect(fill.progress()).toEqual({ total: 4, done: 4, found: 0 })
    // A row added later is not asked either.
    fill.add(wanted(5))
    await fill.settled(1000)
    expect(asked).toHaveLength(1)
    expect(blocked).toBe(1)
  })

  it('a failing onBlocked does not stop the fill', async () => {
    const { fill, asked } = setup({
      goodreads: async (query) => (asked.push(query), 'blocked'),
      onBlocked: () => {
        throw new Error('log down')
      },
    })
    fill.add(wanted(1))
    fill.add(wanted(2))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(fill.progress().done).toBe(2)
  })

  it('gives up after three failures in a row; a success in between resets the count', async () => {
    let calls = 0
    const { fill, found } = setup({
      goodreads: async (query) => {
        calls++
        if (calls === 3) return GR(Number(query.goodreadsBookId))
        throw new Error('unavailable')
      },
    })
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    // Rows 1, 2 fail, row 3 succeeds (the count starts over), rows 4, 5, 6 fail: the rest is not asked.
    expect(calls).toBe(6)
    expect(Object.keys(found)).toEqual(['goodreads:3'])
    expect(fill.progress()).toEqual({ total: 9, done: 9, found: 1 })
    expect(GOODREADS_FAILURES).toBe(3)
  })

  it('sends the row\'s ISBN-13 with the ask (the search\'s first query), the row\'s own, else the Book\'s', async () => {
    const { fill, asked } = setup()
    fill.add(wanted(1, { row: { ...wanted(1).row, isbn13: '9783865527127' } }))
    fill.add(wanted(2, { book: { isbn13: '9783453321540', isbn10: null } }))
    fill.add(wanted(3))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked.map((q) => [q.goodreadsBookId, q.isbn13]).sort()).toEqual([
      ['1', '9783865527127'],
      ['2', '9783453321540'],
      ['3', null],
    ])
  })

  it('"later" (the function\'s empty lists) is no failure and no "none": the row is asked once more, after the others', async () => {
    const calls: string[] = []
    const answers: Record<string, ('later' | string | null)[]> = { '1': ['later', 'cover'], '2': ['cover'], '3': ['later', 'later'] }
    const { fill, found, time } = setup({
      goodreads: async (query) => {
        calls.push(query.goodreadsBookId!)
        const answer = answers[query.goodreadsBookId!]!.shift()!
        return answer === 'cover' ? GR(Number(query.goodreadsBookId)) : answer
      },
    })
    for (const n of [1, 2, 3]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    // 1 later then found, 2 found, 3 later twice: given up, no more tries (the rows reach the lane in no fixed order).
    expect([...calls].sort()).toEqual(['1', '1', '2', '3', '3'])
    expect(GOODREADS_LATER_TRIES).toBe(1)
    expect(Object.keys(found).sort()).toEqual(['goodreads:1', 'goodreads:2'])
    expect(fill.calls().goodreads).toBe(5)
    expect(fill.progress()).toEqual({ total: 3, done: 3, found: 2 })
    // The second ask of a row waits at least the retry delay.
    expect(time.waited.some((ms) => ms >= GOODREADS_RETRY_AFTER_MS - COVER_FILL_GOODREADS_GAP_MS * 3)).toBe(true)
  })

  it('"later" never counts toward the three failures: a long run of them does not close the stage', async () => {
    let calls = 0
    const { fill, found } = setup({
      goodreads: async (query) => (calls++ < 8 ? 'later' : GR(Number(query.goodreadsBookId))),
    })
    for (const n of [1, 2, 3, 4, 5, 6]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    // Eight asks answer later, then every ask is a cover: no row is lost to a stage that closed.
    expect(calls).toBeGreaterThanOrEqual(10)
    expect(Object.keys(found).length).toBeGreaterThanOrEqual(3)
    expect(GOODREADS_FAILURES).toBe(3)
  })

  it('a run of "later" answers holds the whole stage for a while (it is throttling, not three unknown books)', async () => {
    const at: number[] = []
    const { fill, time } = setup({
      goodreads: async () => (at.push(time.now()), 'later'),
    })
    for (const n of [1, 2, 3, 4]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(GOODREADS_LATER_RUN).toBe(3)
    // After the third in a row, the fourth waits out the pause.
    expect(at[3]! - at[2]!).toBeGreaterThanOrEqual(GOODREADS_LATER_PAUSE_MS)
    expect(at[1]! - at[0]!).toBeLessThan(GOODREADS_LATER_PAUSE_MS)
  })

  it('a book Goodreads has no cover for is no failure: the next row is asked', async () => {
    let calls = 0
    const { fill, found } = setup({ goodreads: async (query) => (calls++ < 4 ? null : GR(Number(query.goodreadsBookId))) })
    for (const n of [1, 2, 3, 4, 5]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(calls).toBe(5)
    expect(Object.keys(found)).toEqual(['goodreads:5'])
  })

  it('stops with the fill and honours its own budget (the time the lane has worked, not Apple\'s)', async () => {
    const time = clock()
    let calls = 0
    const { fill } = setup({
      ...time,
      budgetMs: 1_000_000,
      goodreadsBudgetMs: 2000,
      searchGapMs: 0,
      goodreads: async (query) => {
        calls++
        time.wait(5000)
        return GR(Number(query.goodreadsBookId))
      },
    })
    for (const n of [1, 2, 3]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    // The first ask spends the budget; the others are answered without one.
    expect(calls).toBe(1)
    expect(fill.progress().done).toBe(3)

    const stopped = setup()
    stopped.fill.add(wanted(1))
    stopped.fill.stop()
    stopped.fill.holdSearch(false)
    await stopped.fill.settled(50)
    expect(stopped.asked).toEqual([])
  })

  it('is not behind Apple\'s budget: an Apple lane that spent its 600 s leaves Goodreads its own', async () => {
    const time = clock()
    const { fill, asked } = setup({
      ...time,
      budgetMs: 1,
      // Each Apple search takes longer than its whole budget: the lane is given up after the first.
      search: { searchCovers: async () => (time.wait(10_000), { results: [], pending: false, failed: false }) },
    })
    for (const n of [1, 2, 3, 4, 5]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked.map((query) => query.goodreadsBookId).sort()).toEqual(['1', '2', '3', '4', '5'])
    expect(fill.progress()).toEqual({ total: 5, done: 5, found: 5 })
  })

  it('idle time with nothing to ask is not spent: rows that arrive late are still asked', async () => {
    const time = clock()
    const { fill, asked } = setup({ ...time, goodreadsBudgetMs: 10_000 })
    fill.add(wanted(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    time.wait(3_600_000)
    fill.add(wanted(2))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked.map((query) => query.goodreadsBookId)).toEqual(['1', '2'])
  })

  it('takes the row out of the Goodreads queue unasked when Apple found its cover first', async () => {
    const hit = { results: [{ book: snapshot({ title: 'Der Roman 2', coverUrl: APPLE(2), source: 'apple' }) }], pending: false, failed: false }
    let appleAnswered!: () => void
    const answered = new Promise<void>((resolve) => (appleAnswered = resolve))
    const { fill, found, asked } = setup({
      searchGapMs: 0,
      // The first Goodreads ask is slow (row 1); Apple has found row 2 by the time it is over.
      goodreads: async (query) => (asked.push(query), await answered, GR(Number(query.goodreadsBookId))),
      search: {
        searchCovers: async (query: string) => {
          if (!query.includes('Roman 2')) return { results: [], pending: false, failed: false }
          setTimeout(appleAnswered, 0)
          return hit
        },
      } as never,
    })
    fill.holdSearch(false)
    fill.add(wanted(1))
    fill.add(wanted(2))
    await fill.settled(1000)
    expect(asked.map((query) => query.goodreadsBookId)).toEqual(['1'])
    expect(found['goodreads:2']).toMatchObject({ source: 'search', kind: 'ebook' })
    expect(found['goodreads:1']).toMatchObject({ source: 'goodreads' })
    expect(fill.progress()).toEqual({ total: 2, done: 2, found: 2 })
  })

  it('an address that is no cover (a stray pixel, one flat colour) is passed over', async () => {
    const { fill, found } = setup({ probe: async () => ({ ...GOOD, width: 20, height: 30 }) })
    fill.add(wanted(1))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(found).toEqual({})
  })

  it('its cover is lent and never replaces a better kind, but a better kind replaces it', () => {
    const edition = { book: snapshot(), via: null } as never
    const first = mergeCover(edition, { coverUrl: GR(1), coverThumbhash: null, coverColors: null, kind: 'goodreads' })
    expect(first).toMatchObject({ filled: true, coverKind: 'goodreads' })
    expect(mergeCover(first!, { coverUrl: GR(2), coverThumbhash: null, coverColors: null, kind: 'goodreads' })).toBeNull()
    expect(mergeCover(first!, { coverUrl: OL(1), coverThumbhash: null, coverColors: null, kind: 'sameWork' })?.coverKind).toBe('sameWork')
  })
})

describe('a Goodreads cover address as a cover', () => {
  it('passes through verifyCover as it is, probed where it is kept', async () => {
    const probed: string[] = []
    const verified = await verifyCover(GR(131743446), { probe: async (url) => (probed.push(url), GOOD) })
    expect(verified?.coverUrl).toBe(GR(131743446))
    expect(probed).toEqual([GR(131743446)])
    expect(verified?.coverThumbhash).toBeTruthy()
  })
})

describe('createGoodreadsCover (the function\'s client)', () => {
  const invoker = (answer: { data: unknown; error: unknown } | Error) => {
    const calls: { name: string; body: unknown }[] = []
    return {
      calls,
      client: {
        functions: {
          invoke: async (name: string, options: { body: unknown }) => {
            calls.push({ name, body: options.body })
            if (answer instanceof Error) throw answer
            return answer
          },
        },
      },
    }
  }

  it('asks goodreads-rating with cover: true, the title, authors and the book id; answers the address', async () => {
    const { client, calls } = invoker({ data: { status: 'found', goodreadsId: '5', coverUrl: GR(5) }, error: null })
    const answer = await createGoodreadsCover(client).find({ title: 'Der Roman', authors: ['Anna Autorin'], goodreadsBookId: '5' })
    expect(answer).toEqual({ coverUrl: GR(5) })
    expect(calls).toEqual([{ name: 'goodreads-rating', body: { title: 'Der Roman', authors: ['Anna Autorin'], cover: true, goodreadsBookId: '5' } }])
  })

  it('sends the ISBN-13 when the row has one (the function\'s first search), and leaves it out otherwise', async () => {
    const { client, calls } = invoker({ data: { status: 'found', goodreadsId: '5', coverUrl: GR(5) }, error: null })
    await createGoodreadsCover(client).find({ title: 'Der Roman', authors: ['Anna Autorin'], isbn13: '9783865527127', goodreadsBookId: '5' })
    await createGoodreadsCover(client).find({ title: 'Der Roman', authors: ['Anna Autorin'], isbn13: null })
    expect(calls.map((c) => c.body)).toEqual([
      { title: 'Der Roman', authors: ['Anna Autorin'], cover: true, isbn13: '9783865527127', goodreadsBookId: '5' },
      { title: 'Der Roman', authors: ['Anna Autorin'], cover: true },
    ])
  })

  it('answers "later" when the function is unsure (every search answered an empty list): neither a cover nor "none"', async () => {
    const book = { title: 'Der Roman', authors: ['Anna Autorin'] }
    expect(await createGoodreadsCover(invoker({ data: { status: 'unsure', retryAfterSeconds: 30 }, error: null }).client).find(book)).toBe('later')
    // An error response is still "could not ask".
    expect(await createGoodreadsCover(invoker({ data: { status: 'unsure' }, error: new Error('x') }).client).find(book)).toBeNull()
  })

  it('leaves the book id out when there is none', async () => {
    const { client, calls } = invoker({ data: { status: 'not_found', coverUrl: null }, error: null })
    expect(await createGoodreadsCover(client).find({ title: 'Der Roman', authors: ['Anna Autorin'] })).toEqual({ coverUrl: null })
    expect(calls[0]?.body).toEqual({ title: 'Der Roman', authors: ['Anna Autorin'], cover: true })
  })

  it('answers null (could not ask) for an error, a throw, nonsense, offline, or nothing to ask with; never throws', async () => {
    const book = { title: 'Der Roman', authors: ['Anna Autorin'] }
    expect(await createGoodreadsCover(invoker({ data: null, error: new Error('429') }).client).find(book)).toBeNull()
    expect(await createGoodreadsCover(invoker(new Error('network')).client).find(book)).toBeNull()
    expect(await createGoodreadsCover(invoker({ data: { nope: 1 }, error: null }).client).find(book)).toBeNull()
    const offline = invoker({ data: { status: 'found', coverUrl: GR(1) }, error: null })
    expect(await createGoodreadsCover(offline.client, { online: () => false }).find(book)).toBeNull()
    expect(await createGoodreadsCover(offline.client).find({ title: ' ', authors: ['A'] })).toBeNull()
    expect(await createGoodreadsCover(offline.client).find({ title: 'T', authors: [] })).toBeNull()
    expect(offline.calls).toEqual([])
  })

  it('answers "blocked" when the function says Goodreads is turning it away; a miss is not that', async () => {
    const book = { title: 'Der Roman', authors: ['Anna Autorin'] }
    expect(await createGoodreadsCover(invoker({ data: { status: 'blocked', retryAfterSeconds: 600 }, error: null }).client).find(book)).toBe('blocked')
    expect(await createGoodreadsCover(invoker({ data: { status: 'not_found', coverUrl: null }, error: null }).client).find(book)).toEqual({ coverUrl: null })
    // An error response is still "could not ask", whatever it carries.
    expect(await createGoodreadsCover(invoker({ data: { status: 'blocked' }, error: new Error('x') }).client).find(book)).toBeNull()
  })

  it('takes only an address at i.gr-assets.com: any other is no cover', async () => {
    for (const coverUrl of ['https://evil.example/1.jpg', 'http://i.gr-assets.com/1.jpg', 'https://i.gr-assets.com.evil.com/1.jpg', 'javascript:alert(1)', 5, '']) {
      const { client } = invoker({ data: { status: 'found', coverUrl }, error: null })
      expect(await createGoodreadsCover(client).find({ title: 'T', authors: ['A'] })).toEqual({ coverUrl: null })
    }
  })
})
