import type { Book, BookSnapshot } from './books'
import { verifyCover, type ProbeImage, type ResolvedCover } from './covers'
import { abortError, type FetchLike } from './fetching'
import { isSameWork, languageCode, rankEditions, titleLanguage, titleQuery } from './import/editions'
import type { ImportBook } from './import/rows'
import type { Search } from './search'
import type { Edition } from './bookImport'

/**
 * Covers for the import's rows that have none (docs/plans/cover-sources.md): a row a
 * source identified (or whose ISBN the file names) but whose edition has no cover
 * is looked at again, in the background, while the import goes on. Nothing waits
 * for it: the preview and the write take what is found by then, and a row that
 * finds nothing stays as it is, a quiet "no cover".
 *
 * Per row, cheapest first, the first image that will do (`verifyCover`: big
 * enough, not one flat colour) wins:
 *
 * 1. **a sibling edition** the title search already found for the row (`alternatives`),
 *    of the same work and not in another language: no request at all;
 * 2. **Open Library by ISBN**, ISBN-13 and -10 of up to 25 rows in one `api/books`
 *    call, the cover by its id (`covers.openlibrary.org/b/id/…`: not counted per address
 *    the way the by-ISBN address is: 100 requests per address per 5 minutes);
 * 3. **a title and author search** at Apple Books (`Search.searchCovers`: its first
 *    storefront, one request; the other sources answered the lookup already), taking the
 *    best-fitting edition of the same work with a cover. Apple counts requests per address (about 20 a minute, 429 with a
 *    `Retry-After` of 5 to 11 seconds, measured), so this lane is one search at a time,
 *    one every `searchGapMs`, never into a host that is refused (`hostBlockedFor`),
 *    held back (`holdSearch`) until the lookup is over, while the import's own first pass needs Apple more, and
 *    stopped for good after a run of failures or when its `budgetMs` is spent.
 *
 * A cover is only linked: the address and its thumbhash are kept, never the image
 * (docs/THIRD-PARTY.md). Framework-free; `fetch`, the search and the image probe come
 * in from outside, so the tests answer from recordings and no test calls a live API.
 */

/** How long the search lane may run once it is released; what it has not reached stays without a cover. */
export const COVER_FILL_BUDGET_MS = 600_000
/** Rows checked at once against siblings and Open Library's answer. */
export const COVER_FILL_PARALLEL = 4
/** The least time between two searches: Apple's documented 20 calls a minute, one request a search. */
export const COVER_FILL_SEARCH_GAP_MS = 3000
/** ISBNs per Open Library call, and how long a half-full call waits for more. */
export const OPENLIBRARY_BATCH = 25
export const OPENLIBRARY_BATCH_WAIT_MS = 1500
/** Failed Open Library calls (or searches) in a row after which that lane is given up. */
export const LANE_FAILURES = 3
export const SEARCH_FAILURES = 5
/** One call may take this long. */
export const COVER_CALL_TIMEOUT_MS = 20_000

/** A row that wants a cover: what the file says, the edition it has now and the same work's other editions. */
export type CoverWanted = {
  key: string
  row: Pick<ImportBook, 'title' | 'authors' | 'isbn13' | 'isbn10' | 'language' | 'pageCount' | 'year' | 'binding'>
  book: Pick<BookSnapshot, 'isbn13' | 'isbn10'>
  alternatives?: readonly (Book | BookSnapshot)[]
}

export type CoverSource = 'sibling' | 'openlibrary' | 'work' | 'search'
export type CoverFound = ResolvedCover & { coverUrl: string; source: CoverSource }

export type CoverFillProgress = {
  /** Rows queued, rows answered (found or not), rows with a cover now. */
  total: number
  done: number
  found: number
}

export type CoverFillCalls = { openlibrary: number; work: number; search: number; probe: number }

export type CoverFill = {
  /** Queues a row; one already queued (same key) is kept as it is. */
  add: (wanted: CoverWanted) => void
  /** Takes a row back (it got a cover another way, or the member chose its edition). */
  drop: (key: string) => void
  /** Holds the search lane (`true`) or lets it run (`false`). Held from the start. */
  holdSearch: (hold: boolean) => void
  /** Resolves when every queued row is answered, or after `graceMs`, whichever is first. Never rejects. */
  settled: (graceMs: number) => Promise<void>
  /** Ends it: what is not answered stays without a cover. */
  stop: () => void
  progress: () => CoverFillProgress
  calls: () => CoverFillCalls
}

export type CoverFillOptions = {
  fetch: FetchLike
  search: Pick<Search, 'searchCovers'>
  probe: ProbeImage
  /** A cover was found for the row. */
  onFound: (key: string, found: CoverFound) => void
  onProgress?: (progress: CoverFillProgress) => void
  /** How long a host stays refused, in ms (`pacedFetch(…).blockedFor`); the search lane waits it out. */
  hostBlockedFor?: (host: string) => number
  budgetMs?: number
  searchGapMs?: number
  parallel?: number
  batch?: number
  batchWaitMs?: number
  now?: () => number
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

type Item = { wanted: CoverWanted; attempts: number; done: boolean; ol: Promise<string | null>; second: boolean }

const APPLE_HOST = 'itunes.apple.com'
const OPENLIBRARY_API = 'https://openlibrary.org/api/books'
const OPENLIBRARY_SEARCH = 'https://openlibrary.org/search.json'
const OPENLIBRARY_COVERS = /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-[SML]\.jpg$/

const defaultWait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(abortError())
    }, { once: true })
  })

/** Whether an edition is not in another language than the row's (both known: told from the file, else the titles). */
export function languageFits(row: Pick<ImportBook, 'title' | 'language'>, found: Pick<BookSnapshot, 'title' | 'language'>): boolean {
  const wanted = languageCode(row.language) ?? titleLanguage(row.title)
  const theirs = languageCode(found.language) ?? titleLanguage(found.title)
  return !wanted || !theirs || wanted === theirs
}

/** The editions of the same work that have a cover, best first, in the row's language. */
export function siblingCovers(wanted: CoverWanted): string[] {
  return (wanted.alternatives ?? [])
    .filter((book) => book.coverUrl && languageFits(wanted.row, book))
    .map((book) => book.coverUrl as string)
}

/**
 * The edition with the found cover on it: on its Book when a source found the edition itself, as the
 * cover its Book borrows (`coverFrom`) when only the file knows it (the ISBN is hers, the image another
 * edition's). Null when it has a cover already (the member's own pick, or another way found one first).
 */
export function mergeCover(edition: Edition, found: ResolvedCover): Edition | null {
  if (edition.book.coverUrl || edition.coverFrom?.coverUrl) return null
  const cover = { coverUrl: found.coverUrl, coverThumbhash: found.coverThumbhash, coverColors: found.coverColors }
  return edition.via
    ? { ...edition, filled: true, book: { ...edition.book, ...cover } as Edition['book'] }
    : { ...edition, filled: true, coverFrom: { ...(edition.coverFrom ?? edition.book), ...cover } as Edition['book'] }
}

const withIn = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer in time')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export function createCoverFill(options: CoverFillOptions): CoverFill {
  const {
    fetch,
    search,
    onFound,
    onProgress,
    hostBlockedFor,
    budgetMs = COVER_FILL_BUDGET_MS,
    searchGapMs = COVER_FILL_SEARCH_GAP_MS,
    parallel = COVER_FILL_PARALLEL,
    batch = OPENLIBRARY_BATCH,
    batchWaitMs = OPENLIBRARY_BATCH_WAIT_MS,
    now = Date.now,
    wait = defaultWait,
  } = options
  const calls: CoverFillCalls = { openlibrary: 0, work: 0, search: 0, probe: 0 }
  const probe: ProbeImage = (url) => {
    calls.probe++
    return options.probe(url)
  }
  const controller = new AbortController()
  const items = new Map<string, Item>()
  const waiters = new Set<() => void>()
  let answered = 0
  let found = 0
  let stopped = false

  const progress = (): CoverFillProgress => ({ total: items.size, done: answered, found })
  const report = () => {
    onProgress?.(progress())
    if (answered >= items.size || stopped) for (const waiter of [...waiters]) waiter()
  }

  function finish(item: Item, cover: CoverFound | null) {
    if (item.done) return
    item.done = true
    answered++
    if (cover && !stopped) {
      found++
      onFound(item.wanted.key, cover)
    }
    report()
  }

  const verified = async (url: string): Promise<ResolvedCover | null> => {
    try {
      const cover = await verifyCover(url, { probe })
      return cover?.coverUrl ? cover : null
    } catch {
      return null
    }
  }
  const asFound = (cover: ResolvedCover | null, source: CoverSource): CoverFound | null =>
    cover?.coverUrl ? { ...cover, coverUrl: cover.coverUrl, source } : null

  // ---------------------------------------------------- Open Library, batched

  let batchWaiting: { item: Item; resolve: (url: string | null) => void }[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  let openLibraryFailures = 0
  let openLibraryPausedUntil = 0

  const isbnsOf = (wanted: CoverWanted) =>
    [...new Set([wanted.row.isbn13, wanted.book.isbn13, wanted.row.isbn10, wanted.book.isbn10].filter((isbn): isbn is string => Boolean(isbn)))]

  function requestOpenLibrary(item: Item): Promise<string | null> {
    if (openLibraryFailures >= LANE_FAILURES || !isbnsOf(item.wanted).length) return Promise.resolve(null)
    return new Promise((resolve) => {
      batchWaiting.push({ item, resolve })
      if (batchWaiting.length >= batch) flushBatch()
      else batchTimer ??= setTimeout(() => void flushBatch(), batchWaitMs)
    })
  }

  /** One call at a time: the next waits for the last, so a run of failures is seen before more is asked. */
  let openLibraryChain: Promise<void> = Promise.resolve()

  function flushBatch() {
    if (batchTimer) clearTimeout(batchTimer)
    batchTimer = null
    const taken = batchWaiting.splice(0, batch)
    if (!taken.length) return
    if (batchWaiting.length) batchTimer = setTimeout(() => void flushBatch(), 0)
    openLibraryChain = openLibraryChain.then(() => askOpenLibrary(taken))
  }

  async function askOpenLibrary(taken: { item: Item; resolve: (url: string | null) => void }[]) {
    const none = () => taken.forEach(({ resolve }) => resolve(null))
    if (stopped || openLibraryFailures >= LANE_FAILURES || now() < openLibraryPausedUntil) return none()
    const keys = [...new Set(taken.flatMap(({ item }) => isbnsOf(item.wanted)))]
    calls.openlibrary++
    let answer: Record<string, { cover?: { large?: string; medium?: string } } | undefined>
    try {
      const response = await withIn(
        fetch(`${OPENLIBRARY_API}?${new URLSearchParams({ bibkeys: keys.map((isbn) => `ISBN:${isbn}`).join(','), jscmd: 'data', format: 'json' })}`, {
          signal: controller.signal,
        }),
        COVER_CALL_TIMEOUT_MS,
      )
      if (!response.ok) {
        const seconds = Number(response.headers?.get('retry-after'))
        if (Number.isFinite(seconds) && seconds > 0) openLibraryPausedUntil = now() + Math.min(seconds, 60) * 1000
        throw new Error(`openlibrary.org answered ${response.status}`)
      }
      answer = (await response.json()) as typeof answer
      openLibraryFailures = 0
    } catch {
      openLibraryFailures++
      return none()
    }
    for (const { item, resolve } of taken) {
      let url: string | null = null
      for (const isbn of isbnsOf(item.wanted)) {
        const cover = answer?.[`ISBN:${isbn}`]?.cover
        const candidate = cover?.large ?? cover?.medium
        if (candidate && OPENLIBRARY_COVERS.test(candidate)) {
          url = candidate
          break
        }
      }
      resolve(url)
    }
  }

  // ----------------------------------------------- Open Library, the work's covers

  let workFailures = 0
  let workPausedUntil = 0

  /**
   * The cover of another edition of the row's work: Open Library's search by title and author (the
   * structured one, which does not trip over initials in an author's name), the first document that is
   * the same work, in the row's language where it says, and has a cover. Its address is by cover id.
   */
  async function openLibraryWork(item: Item): Promise<string | null> {
    const { row } = item.wanted
    if (stopped || workFailures >= LANE_FAILURES || now() < workPausedUntil || !row.title) return null
    calls.work++
    try {
      const response = await withIn(
        fetch(
          `${OPENLIBRARY_SEARCH}?${new URLSearchParams({ title: row.title, author: row.authors[0] ?? '', fields: 'key,title,author_name,cover_i,language', limit: '12' })}`,
          { signal: controller.signal },
        ),
        COVER_CALL_TIMEOUT_MS,
      )
      if (!response.ok) {
        const seconds = Number(response.headers?.get('retry-after'))
        if (Number.isFinite(seconds) && seconds > 0) workPausedUntil = now() + Math.min(seconds, 60) * 1000
        throw new Error(`openlibrary.org answered ${response.status}`)
      }
      const body = (await response.json()) as { docs?: { title?: string; author_name?: string[]; cover_i?: number; language?: string[] }[] }
      workFailures = 0
      const wanted = languageCode(row.language) ?? titleLanguage(row.title)
      const doc = (body.docs ?? []).find(
        (found) =>
          found.cover_i &&
          found.cover_i > 0 &&
          isSameWork(row, { title: found.title ?? '', authors: found.author_name ?? [] }) &&
          // The work's languages: a German row is not given a cover whose editions are all English.
          (!wanted || !found.language?.length || found.language.some((code) => languageCode(code) === wanted)),
      )
      return doc ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null
    } catch {
      workFailures++
      return null
    }
  }

  // ------------------------------------------------- the lane over the items

  const lane: Item[] = []
  let active = 0

  async function check(item: Item) {
    // 1. A sibling edition the title search already found.
    for (const url of siblingCovers(item.wanted).slice(0, 3)) {
      const cover = asFound(await verified(url), 'sibling')
      if (cover) return finish(item, cover)
    }
    // 2. Open Library, asked for with the rows that came with it.
    const url = await item.ol
    if (url) {
      const cover = asFound(await verified(url), 'openlibrary')
      if (cover) return finish(item, cover)
    }
    // 3. The work's other editions at Open Library (a search by title and author, the cover of the best fit).
    const work = await openLibraryWork(item)
    if (work) {
      const cover = asFound(await verified(work), 'work')
      if (cover) return finish(item, cover)
    }
    // 4. Everything else: the paced search.
    if (stopped) return finish(item, null)
    searchQueue.push(item)
    void runSearch()
  }

  function pump() {
    while (!stopped && active < parallel && lane.length) {
      const item = lane.shift()!
      active++
      void check(item)
        .catch(() => finish(item, null))
        .finally(() => {
          active--
          pump()
        })
    }
  }

  // ------------------------------------------------------ the search lane

  const searchQueue: Item[] = []
  let held = true
  let running = false
  let nextAt = 0
  let pausedUntil = 0
  let failures = 0
  let deadline: number | null = null

  const searchOver = () => failures >= SEARCH_FAILURES || (deadline !== null && now() >= deadline)

  async function runSearch() {
    if (running || held || stopped) return
    running = true
    try {
      while (!held && !stopped) {
        const item = searchQueue.shift()
        if (!item) break
        if (item.done) continue
        deadline ??= now() + budgetMs
        if (searchOver()) {
          finish(item, null)
          continue
        }
        // Paced: one search every `searchGapMs`, never into a host that is refused, never during a pause.
        const blocked = hostBlockedFor?.(APPLE_HOST) ?? 0
        const at = Math.max(now() + blocked, nextAt, pausedUntil)
        nextAt = at + searchGapMs
        await wait(at - now(), controller.signal)
        if (item.done) continue
        if (held) {
          searchQueue.unshift(item)
          break
        }
        if (searchOver()) {
          finish(item, null)
          continue
        }
        await searchFor(item)
      }
    } catch {
      /* stopped */
    } finally {
      running = false
    }
    if (searchQueue.length && !held && !stopped) void runSearch()
    // A lane that ended with rows it will not reach answers them now.
    if (searchOver() || stopped) for (const item of searchQueue.splice(0)) finish(item, null)
  }

  async function searchFor(item: Item) {
    const { row } = item.wanted
    calls.search++
    let outcome: Awaited<ReturnType<Search['searchCovers']>> | null = null
    try {
      outcome = await withIn(search.searchCovers(titleQuery(row), { signal: controller.signal, storefront: item.second ? 1 : 0 }), COVER_CALL_TIMEOUT_MS)
    } catch {
      if (stopped) return finish(item, null)
    }
    if (!outcome || outcome.failed) {
      // Refused: Apple is left alone for the time it asked for; that is waiting, not a failure of the lane, and the row stays first.
      const blocked = hostBlockedFor?.(APPLE_HOST) ?? 0
      if (blocked > 0) {
        pausedUntil = now() + blocked
        searchQueue.unshift(item)
        return
      }
      // Unreachable or broken: a pause that grows, and the row asked once more at the end.
      failures++
      pausedUntil = now() + Math.min(60_000, 5000 * 2 ** failures)
      if (item.attempts++ < 1 && !searchOver()) searchQueue.push(item)
      else finish(item, null)
      return
    }
    failures = 0
    const ranked = rankEditions(row, outcome.results)
      .map((result) => result.book)
      .filter((book) => book.coverUrl && languageFits(row, book))
    for (const book of ranked.slice(0, 3)) {
      const cover = asFound(await verified(book.coverUrl as string), 'search')
      if (cover) return finish(item, cover)
    }
    // Not in the first storefront: the second one is asked once the first has been through every row.
    if (!item.second) {
      item.second = true
      searchQueue.push(item)
      return
    }
    finish(item, null)
  }

  return {
    add(wanted) {
      if (stopped || items.has(wanted.key)) return
      const item: Item = { wanted, attempts: 0, done: false, ol: Promise.resolve(null), second: false }
      items.set(wanted.key, item)
      item.ol = requestOpenLibrary(item)
      lane.push(item)
      report()
      pump()
    },
    drop(key) {
      const item = items.get(key)
      if (!item) return
      if (item.done) answered--
      items.delete(key)
      const at = searchQueue.indexOf(item)
      if (at >= 0) searchQueue.splice(at, 1)
      item.done = true
      report()
    },
    holdSearch(hold) {
      held = hold
      if (!hold) void runSearch()
    },
    settled(graceMs) {
      if (answered >= items.size || stopped) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const timer = setTimeout(release, Math.max(0, graceMs))
        function release() {
          clearTimeout(timer)
          waiters.delete(release)
          resolve()
        }
        waiters.add(release)
      })
    },
    stop() {
      if (stopped) return
      stopped = true
      controller.abort()
      if (batchTimer) clearTimeout(batchTimer)
      batchTimer = null
      for (const { resolve } of batchWaiting.splice(0)) resolve(null)
      for (const item of items.values()) finish(item, null)
      report()
    },
    progress,
    calls: () => ({ ...calls }),
  }
}
