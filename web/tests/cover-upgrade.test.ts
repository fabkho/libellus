import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import {
  emptyCounters,
  isDone,
  runCoverUpgrade,
  UPGRADE_MIN_HEIGHT,
  UPGRADE_REFUSALS,
  upgradable,
  type CoverUpgradeDeps,
  type UpgradeList,
  type UpgradeRow,
  type UpgradeWrite,
} from '@/data/coverUpgrade'
import { createUpgradeCatalogue } from '@/data/coverUpgradeCatalogue'
import type { ProbeImage } from '@/data/covers'
import {
  importedEntryIds,
  makeUpgradeList,
  readUpgradeLists,
  UPGRADE_LIST_DAYS,
  UPGRADE_LISTS_KEY,
  writeUpgradeLists,
} from '@/utils/coverUpgradeList'

/**
 * The one-time Apple cover upgrade after an import (data/coverUpgrade.ts, issue #366): only the import's own books, only a larger
 * cover, idempotent, resumable, an Apple refusal pauses quietly. Stubs only: no test here reaches Apple, Open Library or the database.
 */

const OL = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`
const HC = (id: number) => `https://assets.hardcover.app/edition/${id}/abc.jpeg`
const GR = (id: number) => `https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1682494830i/${id}.jpg`
const APPLE = (id: number) => `https://is1-ssl.mzstatic.com/image/thumb/Publication/${id}/600x900bb.jpg`
const isbn = (n: number) => `97834530${String(n).padStart(5, '0')}`

const PIXELS = { width: 10, height: 10, data: Uint8ClampedArray.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) }

/** What each address measures: Apple's 600 × 900 ones are asked for by id (`sizes`), the rest by their own address. */
function prober(sizes: Record<string, number> = {}) {
  const asked: string[] = []
  const probe: ProbeImage = async (url) => {
    asked.push(url)
    const height = sizes[url]
    if (height === undefined) return url.includes('mzstatic') ? { width: 600, height: 900, pixels: PIXELS } : null
    return { width: Math.round(height * 0.66), height, pixels: PIXELS }
  }
  return { probe, asked }
}

const row = (n: number, over: Partial<UpgradeRow> = {}): UpgradeRow => ({
  bookId: `book-${n}`,
  isbn13: isbn(n),
  title: `Der Roman ${n}`,
  authors: ['Anna Autorin'],
  language: null,
  pageCount: null,
  year: null,
  cover: OL(n),
  ...over,
})

const listOf = (rows: UpgradeRow[], id = 'import-1'): UpgradeList => ({ id, at: 1_000, rows, counters: emptyCounters() })

const appleBook = (n: number, over: Partial<BookSnapshot> = {}): BookSnapshot =>
  ({
    title: `Der Roman ${n}`,
    authors: ['Anna Autorin'],
    isbn13: isbn(n),
    isbn10: null,
    pageCount: null,
    year: null,
    language: null,
    publisher: null,
    description: null,
    coverUrl: APPLE(n),
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: String(n),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...over,
  }) as BookSnapshot

/** Apple, as a stub: by ISBN (a batch is one call) and by title; every call counted; `refuse` says when it says no. */
function apple(isbns: Record<string, BookSnapshot | null> = {}, titles: Record<string, BookSnapshot[]> = {}, refuse: () => boolean = () => false) {
  const primed = new Map<string, BookSnapshot | null>()
  const calls = { batches: [] as string[][], searches: [] as { query: string; storefront: number | undefined; at: number }[] }
  let clock = () => 0
  return {
    calls,
    setClock: (now: () => number) => void (clock = now),
    search: {
      async primeIsbns(rows: readonly { isbn13: string }[]) {
        calls.batches.push(rows.map((one) => one.isbn13))
        if (refuse()) return { failed: true }
        for (const one of rows) if (!primed.has(one.isbn13)) primed.set(one.isbn13, isbns[one.isbn13] ?? null)
        return { failed: false }
      },
      primedApple: (value: string) => primed.get(value),
      async searchCovers(query: string, options?: { storefront?: 0 | 1 }) {
        calls.searches.push({ query, storefront: options?.storefront, at: clock() })
        if (refuse()) return { results: [], pending: false as const, failed: true }
        const key = Object.keys(titles).find((title) => query.includes(title))
        return { results: (key ? titles[key]! : []).map((book) => ({ book })), pending: false as const, failed: false }
      },
    } satisfies CoverUpgradeDeps['search'] as CoverUpgradeDeps['search'],
  }
}

/** The Catalogue, as a stub: the covers the Books have, and what was handed to them. */
function catalogue(covers: Record<string, string | null>, options: { writeOk?: boolean } = {}) {
  const written: UpgradeWrite[][] = []
  let reads = 0
  return {
    written,
    reads: () => reads,
    currentCovers: async (ids: string[]) => {
      reads++
      return new Map(ids.filter((id) => id in covers).map((id) => [id, covers[id] ?? null] as const))
    },
    write: async (batch: UpgradeWrite[]) => {
      if (options.writeOk === false) return false
      written.push(batch)
      for (const item of batch) covers[item.book_id] = item.cover_url
      return true
    },
  }
}

/** A clock that moves only when waited for. */
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

function setup(rows: UpgradeRow[], options: { isbns?: Record<string, BookSnapshot | null>; titles?: Record<string, BookSnapshot[]>; sizes?: Record<string, number>; covers?: Record<string, string | null>; refuse?: () => boolean; writeOk?: boolean; signal?: AbortSignal } = {}) {
  const list = listOf(rows)
  const a = apple(options.isbns, options.titles, options.refuse)
  const covers = options.covers ?? Object.fromEntries(rows.map((one) => [one.bookId, one.cover]))
  const db = catalogue(covers, { writeOk: options.writeOk })
  const { probe, asked } = prober(options.sizes)
  const time = clock()
  a.setClock(time.now)
  const saves: string[] = []
  const deps: CoverUpgradeDeps = {
    search: a.search,
    probe,
    currentCovers: db.currentCovers,
    write: db.write,
    onSave: (saved) => void saves.push(JSON.stringify(saved)),
    signal: options.signal,
    ...time,
  }
  return { list, deps, apple: a, db, probed: asked, time, saves, run: () => runCoverUpgrade(list, deps) }
}

describe('what is upgraded: only a larger Apple cover of the right book', () => {
  it('takes the edition\'s own Apple artwork when it is larger than the small cover, and hands it to the Catalogue with the cover it replaces', async () => {
    const t = setup([row(1), row(2)], { isbns: { [isbn(1)]: appleBook(1), [isbn(2)]: appleBook(2) }, sizes: { [OL(1)]: 180, [OL(2)]: 120 } })
    const run = await t.run()
    expect(run).toEqual({ done: true, paused: false })
    expect(t.list.rows.map((one) => one.result)).toEqual(['upgraded', 'upgraded'])
    expect(t.db.written).toHaveLength(1)
    expect(t.db.written[0]![0]).toMatchObject({ book_id: 'book-1', cover_url: APPLE(1), replaces: OL(1) })
    expect(t.db.written[0]![0]!.cover_thumbhash).toBeTruthy()
    expect(t.list.counters).toMatchObject({ upgraded: 2, noBetter: 0, skipped: 0, refused: 0, asked: 2, calls: 1 })
  })

  it('a Goodreads cover (linked, never owned) is replaced by the larger Apple one; a missing cover is filled', async () => {
    const t = setup([row(1, { cover: GR(1) }), row(2, { cover: null })], { isbns: { [isbn(1)]: appleBook(1), [isbn(2)]: appleBook(2) } })
    await t.run()
    expect(t.list.rows.map((one) => one.result)).toEqual(['upgraded', 'upgraded'])
    expect(t.db.written[0]!.map((one) => [one.book_id, one.replaces])).toEqual([['book-1', GR(1)], ['book-2', null]])
    // The Goodreads cover was not downloaded to be measured: it counts as the height it is asked at.
    expect(t.probed.some((url) => url.includes('gr-assets'))).toBe(false)
  })

  it('a Hardcover cover is measured as Goodreads\'s is (not downloaded) and replaced by the larger Apple one', async () => {
    const t = setup([row(1, { cover: HC(1) })], { isbns: { [isbn(1)]: appleBook(1) } })
    await t.run()
    expect(t.list.rows.map((one) => one.result)).toEqual(['upgraded'])
    expect(t.db.written[0]!.map((one) => [one.book_id, one.replaces])).toEqual([['book-1', HC(1)]])
    expect(t.probed.some((url) => url.includes('hardcover'))).toBe(false)
  })

  it('never takes a cover that is not larger: Apple\'s is smaller than the one there, or under 300 px', async () => {
    const t = setup([row(1, { cover: GR(1) }), row(2, { cover: null })], {
      isbns: { [isbn(1)]: appleBook(1), [isbn(2)]: appleBook(2) },
      // The Goodreads one counts as 500 high; Apple's 400 is smaller. Apple's other is under 300.
      sizes: { [APPLE(1)]: 400, [APPLE(2)]: UPGRADE_MIN_HEIGHT - 1 },
    })
    await t.run()
    expect(t.list.rows.map((one) => one.result)).toEqual(['none', 'none'])
    expect(t.db.written).toEqual([])
    expect(t.list.counters).toMatchObject({ upgraded: 0, noBetter: 2 })
  })

  it('a cover that is large enough already (300 px or more) is skipped without asking Apple; an Apple cover too (another member\'s upgrade)', async () => {
    const t = setup([row(1), row(2, { cover: APPLE(2) }), row(3)], {
      sizes: { [OL(1)]: 500, [OL(3)]: 299 },
      isbns: { [isbn(3)]: appleBook(3) },
    })
    await t.run()
    expect(t.list.rows.map((one) => one.result)).toEqual(['skipped', 'skipped', 'upgraded'])
    expect(t.apple.calls.batches).toEqual([[isbn(3)]])
    expect(t.list.counters).toMatchObject({ skipped: 2, upgraded: 1, asked: 1 })
  })

  it('reads the Catalogue again first: a cover another member put there since the list was made is skipped, a Book that is gone too', async () => {
    const t = setup([row(1), row(2), row(3)], { covers: { 'book-1': APPLE(1), 'book-3': OL(3) }, sizes: { [OL(3)]: 100 }, isbns: { [isbn(3)]: appleBook(3) } })
    await t.run()
    expect(t.list.rows.map((one) => one.result)).toEqual(['skipped', 'skipped', 'upgraded'])
    expect(t.apple.calls.batches).toEqual([[isbn(3)]])
  })

  it('an Apple edition of another work is no cover for the book (the ISBN\'s batch answers the book it belongs to)', async () => {
    // The stub's primeIsbns hands the row its Apple book as primed; a row whose ISBN Apple does not know goes to the title search.
    const t = setup([row(1, { isbn13: null })], { titles: { 'Der Roman 1': [appleBook(9, { title: 'Ein ganz anderes Buch', authors: ['Jemand Anderes'] })] } })
    await t.run()
    expect(t.list.rows[0]!.result).toBe('none')
    expect(t.db.written).toEqual([])
  })

  it('a title search takes the work\'s ebook (same work, in the book\'s language) when the ISBN is unknown to Apple', async () => {
    const t = setup([row(1, { isbn13: null, title: 'Der Zauberberg', authors: ['Thomas Mann'], language: 'de' })], {
      titles: {
        'Der Zauberberg': [
          appleBook(5, { title: 'The Magic Mountain', authors: ['Thomas Mann'] }),
          appleBook(6, { title: 'Der Zauberberg', authors: ['Thomas Mann'] }),
        ],
      },
    })
    await t.run()
    expect(t.list.rows[0]!.result).toBe('upgraded')
    expect(t.db.written[0]![0]!.cover_url).toBe(APPLE(6))
    expect(t.apple.calls.batches).toEqual([])
  })

  it('a refused write (the Catalogue could not be reached) leaves the rows for next time: nothing is marked', async () => {
    const t = setup([row(1)], { isbns: { [isbn(1)]: appleBook(1) }, writeOk: false })
    const run = await t.run()
    expect(run).toEqual({ done: false, paused: true })
    expect(t.list.rows[0]!.result).toBeUndefined()
    expect(t.list.counters.upgraded).toBe(0)
  })

  it('upgradable: a cover that is Apple\'s is the large one already', () => {
    expect(upgradable(APPLE(1))).toBe(false)
    expect([upgradable(null), upgradable(OL(1)), upgradable(GR(1))]).toEqual([true, true, true])
  })
})

describe('Apple pace: batches of 40, a search every 3 seconds', () => {
  it('asks the ISBNs in batches of 40, one call each, spaced by the Apple gap', async () => {
    const rows = Array.from({ length: 85 }, (_, index) => row(index + 1, { cover: null }))
    const t = setup(rows)
    await t.run()
    expect(t.apple.calls.batches.map((batch) => batch.length)).toEqual([40, 40, 5])
    // No ISBN edition at Apple: every book goes on to its title search.
    expect(t.apple.calls.searches).toHaveLength(85 * 2)
    expect(t.list.counters.calls).toBe(3 + 85 * 2)
  })

  it('searches by title one every 3 s (the first storefront, then the second), never faster', async () => {
    const t = setup([row(1, { isbn13: null }), row(2, { isbn13: null })])
    await t.run()
    const times = t.apple.calls.searches.map((search) => search.at)
    expect(t.apple.calls.searches.map((search) => search.storefront)).toEqual([0, 1, 0, 1])
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(3000)
  })

  it('an ISBN the import\'s own lookup already asked Apple for costs no call', async () => {
    const t = setup([row(1)], { isbns: { [isbn(1)]: appleBook(1) } })
    await t.apple.search.primeIsbns([{ isbn13: isbn(1), title: 'x', authors: [] }], () => true)
    t.apple.calls.batches.length = 0
    await t.run()
    expect(t.apple.calls.batches).toEqual([])
    expect(t.list.rows[0]!.result).toBe('upgraded')
  })
})

describe('idempotent, one-time, resumable', () => {
  it('a second run over a worked-off list asks Apple, the Catalogue and the images nothing', async () => {
    const t = setup([row(1), row(2), row(3, { isbn13: null })], { isbns: { [isbn(1)]: appleBook(1) } })
    await t.run()
    expect(isDone(t.list)).toBe(true)
    const before = { batches: t.apple.calls.batches.length, searches: t.apple.calls.searches.length, probes: t.probed.length, reads: t.db.reads(), writes: t.db.written.length }
    const again = await t.run()
    expect(again).toEqual({ done: true, paused: false })
    expect({ batches: t.apple.calls.batches.length, searches: t.apple.calls.searches.length, probes: t.probed.length, reads: t.db.reads(), writes: t.db.written.length }).toEqual(before)
  })

  it('a book checked without a better result is never asked again', async () => {
    const t = setup([row(1, { cover: null })], { isbns: { [isbn(1)]: appleBook(1) }, sizes: { [APPLE(1)]: 100 } })
    await t.run()
    expect(t.list.rows[0]!.result).toBe('none')
    const calls = t.apple.calls.batches.length + t.apple.calls.searches.length
    await t.run()
    expect(t.apple.calls.batches.length + t.apple.calls.searches.length).toBe(calls)
  })

  it('a worked-off list is dropped from the device: it cannot run again on a later start', () => {
    const storage = memory()
    const list = makeUpgradeList('import-a', [row(1), row(2)], 5_000)!
    writeUpgradeLists(storage, 'her', [list])
    expect(readUpgradeLists(storage, 'her', 6_000)).toHaveLength(1)
    for (const one of list.rows) one.result = 'upgraded'
    writeUpgradeLists(storage, 'her', [list])
    expect(readUpgradeLists(storage, 'her', 6_000)).toEqual([])
    expect(storage.getItem(UPGRADE_LISTS_KEY)).toBeNull()
    // Nothing makes a list from nothing: books added later never make one.
    expect(makeUpgradeList('import-b', [])).toBeNull()
  })

  it('resumes after a pause: what was worked off is kept, the rest is asked on the next start, and the counters add up', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => row(index + 1, { isbn13: null }))
    const titles = Object.fromEntries(rows.map((one, index) => [one.title, [appleBook(index + 1)]]))
    const controller = new AbortController()
    const t = setup(rows, { titles, signal: controller.signal })
    // The app is closed after the third search of the first storefront has been answered.
    let searches = 0
    const inner = t.apple.search.searchCovers
    t.deps.search = { ...t.apple.search, searchCovers: async (...args) => ((++searches === 4 ? controller.abort() : undefined), inner(...args)) }
    const first = await runCoverUpgrade(t.list, t.deps)
    expect(first).toEqual({ done: false, paused: true })
    const worked = t.list.rows.filter((one) => one.result).length
    expect(worked).toBeGreaterThan(0)
    expect(worked).toBeLessThan(6)
    // What was saved is what a next start reads back.
    const kept = JSON.parse(t.saves.at(-1)!) as UpgradeList
    expect(kept.rows.filter((one) => one.result)).toHaveLength(worked)

    const callsBefore = t.apple.calls.searches.length
    const next = await runCoverUpgrade(kept, { ...t.deps, search: t.apple.search, signal: undefined })
    expect(next).toEqual({ done: true, paused: false })
    expect(kept.rows.every((one) => one.result === 'upgraded')).toBe(true)
    // Only the rest was asked: no row was asked twice.
    expect(t.apple.calls.searches.length - callsBefore).toBe(6 - worked)
    expect(kept.counters.upgraded).toBe(6)
  })

  it('an Apple refusal pauses quietly: nothing thrown, the list stays whole, the run tries again later', async () => {
    let refusing = true
    const t = setup([row(1), row(2, { isbn13: null })], { isbns: { [isbn(1)]: appleBook(1) }, titles: { 'Der Roman 2': [appleBook(2)] }, refuse: () => refusing })
    const run = await t.run()
    expect(run).toEqual({ done: false, paused: true })
    expect(t.list.rows.map((one) => one.result)).toEqual([undefined, undefined])
    expect(t.list.counters.refused).toBe(UPGRADE_REFUSALS)
    // Waited between the refusals (never a burst), then gave up.
    expect(t.time.waited.filter((ms) => ms >= 3000).length).toBeGreaterThanOrEqual(UPGRADE_REFUSALS - 1)
    // Apple answers again: the same list goes on from where it was.
    refusing = false
    expect(await runCoverUpgrade(t.list, t.deps)).toEqual({ done: true, paused: false })
    expect(t.list.rows.map((one) => one.result)).toEqual(['upgraded', 'upgraded'])
  })

  it('a refusal that clears after one try goes on (the refusals are counted in a row)', async () => {
    let calls = 0
    const t = setup([row(1, { isbn13: null })], { titles: { 'Der Roman 1': [appleBook(1)] }, refuse: () => ++calls === 1 })
    expect(await t.run()).toEqual({ done: true, paused: false })
    expect(t.list.counters.refused).toBe(1)
    expect(t.list.rows[0]!.result).toBe('upgraded')
  })

  it('waits the host\'s own refusal out (hostBlockedFor) before the next request', async () => {
    const t = setup([row(1, { isbn13: null })], { titles: { 'Der Roman 1': [appleBook(1)] } })
    let blocked = 20_000
    t.deps.hostBlockedFor = () => {
      const now = blocked
      blocked = 0
      return now
    }
    await t.run()
    expect(t.time.waited.some((ms) => ms >= 20_000)).toBe(true)
  })

  it('an unreadable Catalogue (offline) pauses before anything is asked', async () => {
    const t = setup([row(1)])
    t.deps.currentCovers = async () => null
    expect(await t.run()).toEqual({ done: false, paused: true })
    expect(t.apple.calls.batches).toEqual([])
  })
})

describe('the device list and its books', () => {
  it('a new import makes a list only for its own books, next to the earlier one, never merged into it', () => {
    const storage = memory()
    const first = makeUpgradeList('import-a', [row(1), row(2)], 1_000)!
    writeUpgradeLists(storage, 'her', [first])
    const second = makeUpgradeList('import-b', [row(3)], 2_000)!
    writeUpgradeLists(storage, 'her', [...readUpgradeLists(storage, 'her', 3_000), second])
    const lists = readUpgradeLists(storage, 'her', 3_000)
    expect(lists.map((list) => [list.id, list.rows.map((one) => one.bookId)])).toEqual([
      ['import-a', ['book-1', 'book-2']],
      ['import-b', ['book-3']],
    ])
    // Another member on the same device has none of it.
    expect(readUpgradeLists(storage, 'someone else', 3_000)).toEqual([])
  })

  it('keeps each row\'s result across reads, and lets an old list go', () => {
    const storage = memory()
    const list = makeUpgradeList('import-a', [row(1), row(2)], 1_000)!
    list.rows[0]!.result = 'none'
    writeUpgradeLists(storage, 'her', [list])
    expect(readUpgradeLists(storage, 'her', 2_000)[0]!.rows.map((one) => one.result)).toEqual(['none', undefined])
    expect(readUpgradeLists(storage, 'her', 1_000 + (UPGRADE_LIST_DAYS + 1) * 86_400_000)).toEqual([])
  })

  it('storage that fails keeps nothing and says nothing; garbage on the device is no list', () => {
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('no') } }
    expect(readUpgradeLists(broken, 'her')).toEqual([])
    expect(() => writeUpgradeLists(broken, 'her', [makeUpgradeList('x', [row(1)])!])).not.toThrow()
  })

  it('only the entries an import ADDED make its list: not a book she had, an earlier import\'s, a failed row, nor her own pick of an edition', () => {
    const outcomes = [
      { key: 'a', outcome: 'added', entryId: 'e1' },
      { key: 'b', outcome: 'in_library', entryId: 'e2' },
      { key: 'c', outcome: 'imported', entryId: 'e3' },
      { key: 'd', outcome: 'failed', entryId: null },
      { key: 'e', outcome: 'added', entryId: 'e5' },
      { key: 'f', outcome: 'added', entryId: 'e6' },
    ]
    expect(importedEntryIds(outcomes, new Set(['e']))).toEqual(['e1', 'e6'])
  })

  it('reads only the entries asked for, and leaves out a Manual book, a book that is hers alone and one that has an Apple cover already', async () => {
    const asked: string[][] = []
    const books: Record<string, { owner_id: string | null; source: string; cover_url: string | null }> = {
      e1: { owner_id: null, source: 'openlibrary', cover_url: OL(1) },
      e2: { owner_id: 'her', source: 'manual', cover_url: null },
      e3: { owner_id: null, source: 'manual', cover_url: null },
      e4: { owner_id: null, source: 'apple', cover_url: APPLE(4) },
      e5: { owner_id: null, source: 'import', cover_url: null },
    }
    const client = {
      from: () => ({
        select: () => ({
          in: (_column: string, ids: string[]) => {
            asked.push(ids)
            return { returns: async () => ({ data: ids.map((id) => ({ id, book: { id: `book-${id}`, isbn13: null, title: 'T', authors: ['A'], language: null, page_count: null, published_year: null, ...books[id]! } })), error: null }) }
          },
        }),
      }),
    }
    const rows = await createUpgradeCatalogue(client as never).rowsForEntries(['e1', 'e2', 'e3', 'e4', 'e5'])
    expect(asked).toEqual([['e1', 'e2', 'e3', 'e4', 'e5']])
    expect(rows!.map((one) => one.bookId)).toEqual(['book-e1', 'book-e5'])
  })

  it('writes through fill_book_covers, 200 a call; false when it could not', async () => {
    const calls: { name: string; args: { p_covers: unknown[] } }[] = []
    let fail = false
    const client = { rpc: async (name: string, args: { p_covers: unknown[] }) => (calls.push({ name, args }), { data: 1, error: fail ? { message: 'no' } : null }) }
    const write = createUpgradeCatalogue(client as never).write
    const item = (n: number): UpgradeWrite => ({ book_id: `b${n}`, cover_url: APPLE(n), cover_thumbhash: 'h', cover_dominant: null, cover_secondary: null, replaces: null })
    expect(await write(Array.from({ length: 450 }, (_, n) => item(n)))).toBe(true)
    expect(calls.map((call) => [call.name, call.args.p_covers.length])).toEqual([['fill_book_covers', 200], ['fill_book_covers', 200], ['fill_book_covers', 50]])
    fail = true
    expect(await write([item(1)])).toBe(false)
  })
})

function memory() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}
