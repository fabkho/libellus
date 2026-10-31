import { appleArtwork, COVER_LARGE } from './apple'
import type { BookSnapshot } from './books'
import { COVER_HEIGHT } from './coverRank'
import { COVER_FILL_SEARCH_GAP_MS, languageFits } from './coverFill'
import { coverVerdict, describeCover, type ProbeImage } from './covers'
import { abortError } from './fetching'
import { isSameWork, rankEditions, titleQuery } from './import/editions'
import { APPLE_ISBN_BATCH, type Search } from './search'

/**
 * The one-time Apple cover upgrade after an import (issue #366, docs/covers.md, "The Apple upgrade"). An import ends with covers that
 * are small (Open Library's, under 300 px high), only linked (Goodreads'), or missing; Apple has the large ones and its limit is
 * per address, so the member's own device is the place to ask. When the import is written, its list is made (`UpgradeList`: the
 * Catalogue Books THAT import added, never one she added herself or picked an edition for, never a Manual book; the store keeps
 * it on the device, utils/coverUpgradeList.ts) and this works it off, once, in the background:
 *
 * 1. **Refresh** the Catalogue's cover of each Book (another member's import may have upgraded it: an Apple cover is skipped).
 * 2. **Measure** a cover that is neither Apple's nor Goodreads': under `UPGRADE_MIN_HEIGHT` px high it is a candidate, else skipped
 *    (no Apple request). A Goodreads cover counts as `COVER_HEIGHT.goodreads` high (linked, never owned), a Hardcover one as `COVER_HEIGHT.hardcover` (no CORS read of its image), a missing one as 0.
 * 3. **Apple by ISBN**, `APPLE_ISBN_BATCH` (40) ISBNs a request, one batch every `gapMs`: the edition's own artwork.
 * 4. **Apple by title**, for the rest, one search every `gapMs` (3 s, the app's Apple pace): the best-fitting ebook edition of the
 *    same work (`rankEditions`, `languageFits`), the row's storefront first, then the other.
 * 5. A cover is taken only if the **larger** one: the 600 × 900 artwork read at its size is higher than the current cover and at
 *    least `UPGRADE_MIN_HEIGHT`. It is handed to the Catalogue Book through `fill_book_covers` (`write`, with `replaces`: the cover
 *    that was seen, so a cover someone else changed is never overwritten).
 *
 * **Idempotent.** A row has one result for good (`upgraded`, `none`: Apple has nothing better, `skipped`) and is never asked
 * again; a list with every row resolved is done and is dropped by the caller: it never runs again. A second run over a list asks Apple nothing.
 * **Resumable.** The list (rows and results) is saved through `onSave` after every batch; a closed app, or a run stopped by
 * `signal`, leaves the rest for the next start. **An Apple refusal pauses quietly:** the run stops after `UPGRADE_REFUSALS` in a
 * row (it waits out the `Retry-After` between them), the list stays, nothing is shown. Framework-free: the search, the probe and the
 * Catalogue come in from outside.
 */

/** A cover under this many pixels high is small: the bar the upgrade works to (the owner's measure, docs/covers.md). */
export const UPGRADE_MIN_HEIGHT = 300
/** Apple refusals in a row after which a run pauses (the list stays for the next start). */
export const UPGRADE_REFUSALS = 3
/** The longest a refusal's `Retry-After` is waited out in one go. */
export const UPGRADE_REFUSAL_WAIT_MAX_MS = 60_000
/** Rows between two saves of the list while the title searches run. */
export const UPGRADE_SAVE_EVERY = 5
/** Covers measured at once. */
export const UPGRADE_MEASURE_PARALLEL = 4

/** What a row ended as: a larger Apple cover, Apple has nothing better, or nothing to do (large enough, already Apple's, gone). */
export type UpgradeResult = 'upgraded' | 'none' | 'skipped'

/** A Catalogue Book the import added, with what asking Apple for it needs. */
export type UpgradeRow = {
  bookId: string
  isbn13: string | null
  title: string
  authors: string[]
  language: string | null
  pageCount: number | null
  year: number | null
  /** The cover the Catalogue Book has (as last seen); null: none. */
  cover: string | null
  result?: UpgradeResult
}

/** How a run went, summed over its resumes. `asked`: rows sent to Apple; `calls`: Apple requests (a batch of 40 is one). */
export type UpgradeCounters = { asked: number; upgraded: number; noBetter: number; skipped: number; refused: number; calls: number }

/** One import's work list. */
export type UpgradeList = { id: string; at: number; rows: UpgradeRow[]; counters: UpgradeCounters }

export const emptyCounters = (): UpgradeCounters => ({ asked: 0, upgraded: 0, noBetter: 0, skipped: 0, refused: 0, calls: 0 })

/** One cover for the Catalogue: `fill_book_covers`' item. */
export type UpgradeWrite = {
  book_id: string
  cover_url: string
  cover_thumbhash: string
  cover_dominant: string | null
  cover_secondary: string | null
  /** The cover the Book had when the list last looked: only a Book that still has exactly this one takes the new. */
  replaces: string | null
}

export type CoverUpgradeDeps = {
  search: Pick<Search, 'primeIsbns' | 'primedApple' | 'searchCovers'>
  probe: ProbeImage
  /** The Books' covers now: id → address or null; an id that is missing is a Book that is gone. Null: could not be read (offline). */
  currentCovers: (ids: string[]) => Promise<Map<string, string | null> | null>
  /** Hands covers to the Catalogue Books; false when it could not (offline, refused): the rows stay for next time. */
  write: (covers: UpgradeWrite[]) => Promise<boolean>
  /** The list changed (a result, a cover seen, counters): keep it. */
  onSave?: (list: UpgradeList) => void
  /** How long Apple's host is refused, in ms (`pacedFetch(…).blockedFor`). */
  hostBlockedFor?: (host: string) => number
  signal?: AbortSignal
  /** The least time between two Apple requests; the app's Apple pace. */
  gapMs?: number
  now?: () => number
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export type UpgradeRun = {
  /** Every row has its result: the list is worked off for good. */
  done: boolean
  /** Paused by Apple (refusals) or by something that could not be reached; the rest waits for the next start. */
  paused: boolean
}

const APPLE_HOST = 'itunes.apple.com'
const APPLE_ARTWORK = /mzstatic\.com\//
const GOODREADS_COVER = /^https:\/\/i\.gr-assets\.com\//
const HARDCOVER_COVER = /^https:\/\/assets\.hardcover\.app\//

const defaultWait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(abortError())
    }, { once: true })
  })

/** Whether a Catalogue Book's cover is worth an upgrade ask when the list is made: not Apple's (it is the large one). */
export const upgradable = (cover: string | null): boolean => !cover || !APPLE_ARTWORK.test(cover)

export const isDone = (list: UpgradeList): boolean => list.rows.every((row) => row.result)

/** Works the list off; resolves when it is done, paused or stopped. Never rejects. */
export async function runCoverUpgrade(list: UpgradeList, deps: CoverUpgradeDeps): Promise<UpgradeRun> {
  const { search, probe, signal, hostBlockedFor, onSave } = deps
  const gap = deps.gapMs ?? COVER_FILL_SEARCH_GAP_MS
  const now = deps.now ?? Date.now
  const wait = deps.wait ?? defaultWait
  const counters = list.counters
  const stopped = () => Boolean(signal?.aborted)
  const save = () => {
    try {
      onSave?.(list)
    } catch {
      /* a list that cannot be kept is asked again, nothing more */
    }
  }
  const todo = () => list.rows.filter((row) => !row.result)
  const finishRow = (row: UpgradeRow, result: UpgradeResult) => {
    row.result = result
    if (result === 'skipped') counters.skipped++
    else if (result === 'none') counters.noBetter++
    else counters.upgraded++
  }

  /** What the current cover is, in pixels high. */
  const heights = new Map<string, number>()
  const heightOf = (row: UpgradeRow) => heights.get(row.bookId) ?? 0

  /** The least time between two Apple requests; the host's own refusal waited out. */
  let nextAt = 0
  async function pace() {
    const blocked = hostBlockedFor?.(APPLE_HOST) ?? 0
    const at = Math.max(now() + blocked, nextAt)
    nextAt = at + gap
    await wait(at - now(), signal)
  }

  let refusalsInRow = 0
  /** An Apple request was refused or failed: waits out its `Retry-After`; true when the run should pause now. */
  async function refused(): Promise<boolean> {
    counters.refused++
    refusalsInRow++
    if (refusalsInRow >= UPGRADE_REFUSALS) return true
    const blocked = Math.min(hostBlockedFor?.(APPLE_HOST) ?? 0, UPGRADE_REFUSAL_WAIT_MAX_MS)
    await wait(Math.max(blocked, gap), signal)
    return false
  }

  /** Covers found and not yet handed to the Catalogue. */
  const pending: { row: UpgradeRow; write: UpgradeWrite }[] = []
  /** Hands them over; the rows are `upgraded` once the Catalogue has them. False: could not, they stay for next time. */
  async function flush(): Promise<boolean> {
    if (!pending.length) return true
    const taken = pending.splice(0)
    let ok = false
    try {
      ok = await deps.write(taken.map((entry) => entry.write))
    } catch {
      ok = false
    }
    if (!ok) return false
    for (const { row } of taken) finishRow(row, 'upgraded')
    return true
  }

  /**
   * Reads the Apple cover at its large size: the larger one only (`UPGRADE_MIN_HEIGHT` and above, and higher than the one it replaces).
   * Queued for the Catalogue; false when it is no better.
   */
  async function take(row: UpgradeRow, artwork: string | null | undefined): Promise<boolean> {
    if (!artwork || !APPLE_ARTWORK.test(artwork)) return false
    const url = appleArtwork(artwork, COVER_LARGE.width, COVER_LARGE.height)
    let image: Awaited<ReturnType<ProbeImage>>
    try {
      image = await probe(url)
    } catch {
      return false
    }
    if (!image) return false
    const verdict = coverVerdict(image)
    if (verdict !== 'ok' && verdict !== 'low') return false
    const height = Math.max(image.width, image.height)
    if (height < UPGRADE_MIN_HEIGHT || height <= heightOf(row)) return false
    const { thumbhash, colors } = describeCover(image.pixels)
    pending.push({
      row,
      write: {
        book_id: row.bookId,
        cover_url: url,
        cover_thumbhash: thumbhash,
        cover_dominant: colors?.dominant ?? null,
        cover_secondary: colors?.secondary ?? null,
        replaces: row.cover,
      },
    })
    return true
  }

  const paused: UpgradeRun = { done: false, paused: true }
  try {
    // 1. What the Catalogue has now.
    const open = todo()
    if (!open.length) return { done: true, paused: false }
    const now1 = new Map<string, string | null>()
    for (let from = 0; from < open.length; from += 200) {
      const seen = await deps.currentCovers(open.slice(from, from + 200).map((row) => row.bookId))
      if (!seen) return paused
      for (const [id, cover] of seen) now1.set(id, cover)
    }
    for (const row of open) {
      if (!now1.has(row.bookId)) {
        finishRow(row, 'skipped')
        continue
      }
      row.cover = now1.get(row.bookId) ?? null
      // Another member's upgrade (or the check) already put the large cover there.
      if (!upgradable(row.cover)) finishRow(row, 'skipped')
    }
    save()

    // 2. How big the cover is: only a small one is asked about.
    const measured = todo()
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(UPGRADE_MEASURE_PARALLEL, measured.length) }, async () => {
        while (!stopped()) {
          const row = measured[next++]
          if (!row) return
          if (!row.cover) heights.set(row.bookId, 0)
          else if (GOODREADS_COVER.test(row.cover)) heights.set(row.bookId, COVER_HEIGHT.goodreads)
          else if (HARDCOVER_COVER.test(row.cover)) heights.set(row.bookId, COVER_HEIGHT.hardcover)
          else {
            let height = 0
            try {
              const image = await probe(row.cover)
              height = image ? Math.max(image.width, image.height) : 0
            } catch {
              height = 0
            }
            if (height >= UPGRADE_MIN_HEIGHT) finishRow(row, 'skipped')
            else heights.set(row.bookId, height)
          }
        }
      }),
    )
    if (stopped()) return paused
    save()

    // 3. Apple by ISBN, 40 at a time.
    const asked = new Set<string>()
    const byIsbn = todo().filter((row) => row.isbn13)
    for (let from = 0; from < byIsbn.length; from += APPLE_ISBN_BATCH) {
      if (stopped()) return paused
      const batch = byIsbn.slice(from, from + APPLE_ISBN_BATCH)
      // An ISBN the import's own lookup already asked Apple for costs nothing (`primedApple`).
      const fresh = batch.filter((row) => search.primedApple(row.isbn13!) === undefined)
      if (fresh.length) {
        for (const row of fresh) asked.add(row.bookId)
        counters.asked += fresh.length
        for (;;) {
          await pace()
          counters.calls++
          const { failed } = await search.primeIsbns(
            fresh.map((row) => ({ isbn13: row.isbn13!, title: row.title, authors: row.authors })),
            (row, book) => isSameWork({ title: row.title, authors: [...row.authors] }, book),
            { signal },
          )
          if (!failed) {
            refusalsInRow = 0
            break
          }
          if (await refused()) {
            await flush()
            save()
            return paused
          }
        }
      }
      for (const row of batch) {
        const book: BookSnapshot | null | undefined = search.primedApple(row.isbn13!)
        // Not answered, or Apple has no such edition: the title search below may still find the work's.
        if (!book) continue
        if (await take(row, book.coverUrl)) continue
        finishRow(row, 'none')
      }
      if (!(await flush())) {
        save()
        return paused
      }
      save()
    }

    // 4. Apple by title, for the rest.
    let sinceSave = 0
    for (const row of todo()) {
      if (stopped()) {
        await flush()
        save()
        return paused
      }
      if (!row.title.trim()) {
        finishRow(row, 'none')
        continue
      }
      let result: 'better' | 'none' = 'none'
      // The row's storefront first, the other after it; each one search.
      for (const storefront of [0, 1] as const) {
        let outcome: Awaited<ReturnType<Search['searchCovers']>> | null = null
        for (;;) {
          await pace()
          counters.calls++
          try {
            outcome = await search.searchCovers(titleQuery(row), { signal, storefront })
          } catch {
            if (stopped()) {
              await flush()
              save()
              return paused
            }
            outcome = null
          }
          if (outcome && !outcome.failed) {
            refusalsInRow = 0
            break
          }
          if (await refused()) {
            await flush()
            save()
            return paused
          }
        }
        if (!asked.has(row.bookId)) {
          asked.add(row.bookId)
          counters.asked++
        }
        const fitting = rankEditions({ ...row, binding: null }, outcome.results)
          .map((result) => result.book)
          .filter((book) => book.coverUrl && languageFits(row, book))
        for (const book of fitting.slice(0, 3)) {
          if (await take(row, book.coverUrl)) {
            result = 'better'
            break
          }
        }
        if (result === 'better') break
      }
      if (result === 'none') finishRow(row, 'none')
      if (++sinceSave >= UPGRADE_SAVE_EVERY) {
        sinceSave = 0
        if (!(await flush())) {
          save()
          return paused
        }
        save()
      }
    }
    if (!(await flush())) {
      save()
      return paused
    }
    save()
    return { done: isDone(list), paused: false }
  } catch {
    // Stopped, or something that is not the upgrade's to show: what is worked off is kept, the rest waits.
    await flush().catch(() => false)
    save()
    return paused
  }
}
