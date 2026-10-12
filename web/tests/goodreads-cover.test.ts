import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createCoverFill, COVER_FILL_GOODREADS_GAP_MS, GOODREADS_FAILURES, mergeCover, type CoverFound, type CoverWanted } from '@/data/coverFill'
import { coverKindOf, kindRank, GOODREADS_COVERS } from '@/data/kindRank'
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
  const asked: { title: string; authors: string[]; goodreadsBookId: string | null }[] = []
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
    expect(asked).toEqual([{ title: 'Der Roman 42', authors: ['Anna Autorin'], goodreadsBookId: '42' }])
    expect(found['goodreads:42']).toMatchObject({ coverUrl: GR(42), source: 'goodreads', kind: 'goodreads' })
    expect(found['goodreads:42']?.coverThumbhash).toBeTruthy()
    expect(fill.calls().goodreads).toBe(1)
    expect(fill.progress()).toEqual({ total: 1, done: 1, found: 1 })
  })

  it('comes after the Apple search lane: it is held until the lane is released', async () => {
    const { fill, asked } = setup()
    fill.add(wanted(1))
    await fill.settled(30)
    expect(asked).toEqual([])
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(asked).toHaveLength(1)
  })

  it('is asked only when nothing else found a cover: Open Library, a sibling, the work and the ebook win', async () => {
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
    expect(found['goodreads:3']?.source).toBe('search')
    expect(asked).toEqual([])
    expect(fill.calls().goodreads).toBe(0)
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

  it('a book Goodreads has no cover for is no failure: the next row is asked', async () => {
    let calls = 0
    const { fill, found } = setup({ goodreads: async (query) => (calls++ < 4 ? null : GR(Number(query.goodreadsBookId))) })
    for (const n of [1, 2, 3, 4, 5]) fill.add(wanted(n))
    fill.holdSearch(false)
    await fill.settled(1000)
    expect(calls).toBe(5)
    expect(Object.keys(found)).toEqual(['goodreads:5'])
  })

  it('stops with the fill and honours the budget', async () => {
    const time = clock()
    let calls = 0
    const { fill } = setup({
      ...time,
      budgetMs: 2000,
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

  it('an address that is no cover (too small, one flat colour) is passed over', async () => {
    const { fill, found } = setup({ probe: async () => ({ ...GOOD, width: 40, height: 60 }) })
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

  it('takes only an address at i.gr-assets.com: any other is no cover', async () => {
    for (const coverUrl of ['https://evil.example/1.jpg', 'http://i.gr-assets.com/1.jpg', 'https://i.gr-assets.com.evil.com/1.jpg', 'javascript:alert(1)', 5, '']) {
      const { client } = invoker({ data: { status: 'found', coverUrl }, error: null })
      expect(await createGoodreadsCover(client).find({ title: 'T', authors: ['A'] })).toEqual({ coverUrl: null })
    }
  })
})
