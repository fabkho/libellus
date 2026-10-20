/**
 * The cover stage of an import job (`CoverWork`, runner.ts): its own phase after every row is matched, in chunks, one
 * step per row, each saved as it is decided (`import_job_save_cover`, supabase/migrations/20261103010000_import_job_covers.sql).
 *
 * A row reaches the stage without a cover: its own edition had none and no sibling edition lent one (the match applies
 * `coverLender` / `mergeCover`, web/app/data/bookImport.ts, and saves the cover of those rows as 'edition' / 'lent').
 * The sources are the ones the app's cover fill asks today (web/app/data/coverFill.ts, whose request addresses and
 * answer readers are used here, not copied), **without Apple** (it runs later on the device as the one-time upgrade):
 *
 *   1. Open Library ('pending' step): `api/books` by the row's ISBNs, 24 rows in one call (the very edition's cover),
 *      else a title and author search for another edition of the work. Both through the job's shared pace
 *      (sources.ts `jobFetch`). A call that fails asks the row once more in the next chunk, then goes on without it.
 *   2. Goodreads ('goodreads' step, only once step 1 is through for every row, "at the end of the job"): for EVERY row
 *      still without a cover that has a title and an author (a Goodreads file's row and any other), through the
 *      `goodreads-rating` function's cover route (web/app/data/goodreadsCover.ts: the ISBN-13 first, then the whole
 *      title, then the main title; the function does the searching), one ask every `GOODREADS_GAP_MS` on the shared
 *      pace (`edge_pace` bucket `goodreads-cover`). No time budget, no stop after failures:
 *        - an address: the row's cover; Goodreads has none (answered, found or not): no cover;
 *        - `later` (every search answered an empty list: unknown, or throttled softly), or not asked at all: asked
 *          again in a later chunk, at least `GOODREADS_RETRY_S` later, up to `GOODREADS_TRIES` tries, then no cover;
 *        - `blocked`: the stage waits for the job (`context.waitUntil`: the job pauses `GOODREADS_BLOCK_PAUSE_MS`, the
 *          function's own breaker, and resumes in a later chunk); the row is not charged;
 *        - a batch in which nothing at all was answered fails as a whole (the runner pauses the job and backs off).
 *
 * No image is read: the address is stored with its source and its size when the address says it (Open Library's
 * `-L.jpg`, Goodreads' `…l/`). Reading the image (decode, thumbhash) costs CPU the Free plan's 2 s does not have; the
 * Library takes them later. Framework-free: the fetch, Goodreads and the pace come in from outside.
 */
import { coverFromBooksAnswer, coverFromWorkAnswer, coverIsbns, COVER_FILL_GOODREADS_GAP_MS, type OpenLibraryBooksAnswer, type OpenLibraryWorkAnswer, openLibraryBooksUrl, openLibraryWorkUrl } from '../../../web/app/data/coverFill.ts'
import type { FetchLike } from '../../../web/app/data/fetching.ts'
import { goodreadsIsbn } from '../../../web/app/data/goodreads.ts'
import type { GoodreadsCover } from '../../../web/app/data/goodreadsCover.ts'
import { PaceBusy, type Pace } from '../_shared/pace.ts'
import type { CoverResult, CoverRow, CoverWork, Job, WorkContext } from './runner.ts'
import { coverSizeOf } from './cover_size.ts'
import { abortable } from './sources.ts'
import { eachLimited, SAVE_RESERVE_MS, type UploadedRow } from './work.ts'

/** Rows asked at Open Library at once (its pace, not this, keeps its limit). */
export const COVER_OPENLIBRARY_CONCURRENCY = 8
/** Rows asked at Goodreads at once: the pace spaces their starts, this hides an ask's own wait. */
export const COVER_GOODREADS_CONCURRENCY = 2
/** One Goodreads ask every this long, for everybody: the function allows 40 a minute, 1.6 s is 37. */
export const GOODREADS_GAP_MS = COVER_FILL_GOODREADS_GAP_MS
/** Tries a row has at Goodreads (unsure, or not asked), and the least time between two (a later chunk). */
export const GOODREADS_TRIES = 3
export const GOODREADS_RETRY_S = 30
/** How long the stage waits for the job when Goodreads says it is blocking us (the function's breaker is 10 minutes). */
export const GOODREADS_BLOCK_PAUSE_MS = 600_000
/** Tries a row has at Open Library when its calls fail (the second is in the next chunk). */
export const OPENLIBRARY_TRIES = 2

const found = (source: 'openlibrary' | 'goodreads', url: string): CoverResult => ({ source, url, size: coverSizeOf(url) })

type Wanted = { row: CoverRow; book: UploadedRow; edition: { isbn13: string | null } }

function wanted(row: CoverRow): Wanted {
  const book = row.payload as UploadedRow
  const shown = (row.edition as { book?: { isbn13?: string | null } } | null)?.book
  return { row, book, edition: { isbn13: shown?.isbn13 ?? null } }
}

/** A row Goodreads can be asked about: a title and an author (the function refuses less). */
export const goodreadsAskable = (book: Pick<UploadedRow, 'title' | 'authors'>): boolean =>
  Boolean(book.title?.trim()) && (book.authors ?? []).some((author) => author?.trim())

export type CoverDeps = {
  /** Open Library through the shared pace (sources.ts `jobFetch`). */
  fetch: FetchLike
  goodreads: GoodreadsCover
  /** The shared pace of Goodreads asks (`edge_pace`); a turn further away than the pace's wait is `PaceBusy`. */
  pace: Pace
  now?: () => number
  log?: (message: string) => void
}

export function createCoverWork(deps: CoverDeps): CoverWork {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((message: string) => console.log(message))

  /** GETs JSON from Open Library; null when it did not answer (refused, down, cut off by the deadline). */
  async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
    try {
      const response = await abortable(deps.fetch(url, { signal }), signal)
      return response.ok ? ((await response.json()) as T) : null
    } catch {
      return null
    }
  }

  /** Open Library's step for a batch: the ISBNs in one call, the work's search for what is left. */
  async function openLibraryStep(rows: CoverRow[], context: WorkContext, signal: AbortSignal) {
    const items = rows.map(wanted)
    const isbns = [...new Set(items.flatMap((item) => coverIsbns({ row: item.book, book: { isbn13: item.edition.isbn13, isbn10: null } })))]
    const byIsbn = isbns.length ? await getJson<OpenLibraryBooksAnswer>(openLibraryBooksUrl(isbns), signal) : null
    let decided = 0
    let toGoodreads = 0
    let again = 0
    await eachLimited(items, COVER_OPENLIBRARY_CONCURRENCY, async ({ row, book, edition }) => {
      if (context.stopped() || signal.aborted) return
      const own = coverIsbns({ row: book, book: { isbn13: edition.isbn13, isbn10: null } })
      let failed = own.length > 0 && byIsbn === null
      let url = byIsbn ? coverFromBooksAnswer(byIsbn, own) : null
      if (!url && book.title?.trim()) {
        const work = await getJson<OpenLibraryWorkAnswer>(openLibraryWorkUrl(book), signal)
        if (signal.aborted) return
        if (work) url = coverFromWorkAnswer(book, work)
        else failed = true
      }
      if (url) {
        decided++
        await context.saveCover(row.idx, found('openlibrary', url))
      } else if (failed && row.cover_tries + 1 < OPENLIBRARY_TRIES) {
        again++
        await context.saveCover(row.idx, { retry: true, wait_seconds: 0 })
      } else if (goodreadsAskable(book)) {
        toGoodreads++
        await context.saveCover(row.idx, { next: 'goodreads' })
      } else {
        decided++
        await context.saveCover(row.idx, { source: 'none' })
      }
    })
    log(`import-job: open library covers for ${rows.length} rows: ${decided} decided, ${toGoodreads} to goodreads, ${again} again`)
  }

  /** Goodreads' step for a batch (see the header for what each answer means). */
  async function goodreadsStep(rows: CoverRow[], context: WorkContext, signal: AbortSignal) {
    let cover = 0
    let none = 0
    let later = 0
    let answered = 0
    const unanswered: CoverRow[] = []
    await eachLimited(rows, COVER_GOODREADS_CONCURRENCY, async (row) => {
      if (context.stopped() || signal.aborted) return
      const { book, edition } = wanted(row)
      if (!goodreadsAskable(book)) {
        none++
        await context.saveCover(row.idx, { source: 'none' })
        return
      }
      try {
        await abortable(deps.pace.take(), signal)
      } catch (error) {
        // Its turn is further away than the stage waits: nobody else asks Goodreads, but the job should not hammer it either.
        if (error instanceof PaceBusy) context.waitUntil(now() + error.retryAfterSeconds * 1000)
        return
      }
      if (context.stopped() || signal.aborted) return
      const isbn13 = goodreadsIsbn({ isbn13: book.isbn13 ?? null, isbn10: book.isbn10 ?? null }) ?? edition.isbn13
      const goodreadsBookId = /^goodreads:(\d{1,20})$/.exec(row.key)?.[1] ?? null
      let answer: Awaited<ReturnType<GoodreadsCover['find']>>
      try {
        answer = await abortable(deps.goodreads.find({ title: book.title, authors: book.authors, isbn13, goodreadsBookId }), signal)
      } catch {
        return
      }
      if (answer === 'blocked') {
        // Blocked: the stage waits for the job, the row is not charged and is asked again when the job goes on.
        context.waitUntil(now() + GOODREADS_BLOCK_PAUSE_MS)
        return
      }
      if (answer === null) {
        unanswered.push(row)
        return
      }
      answered++
      if (answer === 'later') {
        later++
        await retryOrGiveUp(row, context)
      } else if (answer.coverUrl) {
        cover++
        await context.saveCover(row.idx, found('goodreads', answer.coverUrl))
      } else {
        none++
        await context.saveCover(row.idx, { source: 'none' })
      }
    })
    // Nothing answered at all: the function or Goodreads is down. The batch fails as a whole (the job pauses and backs off)
    // and no row is charged a try for it.
    if (!answered && unanswered.length && !context.stopped()) throw new Error('goodreads-rating did not answer')
    for (const row of unanswered) await retryOrGiveUp(row, context)
    log(`import-job: goodreads covers for ${rows.length} rows: ${cover} found, ${none} none, ${later} unsure, ${unanswered.length} not asked`)
  }

  const retryOrGiveUp = (row: CoverRow, context: WorkContext) =>
    context.saveCover(row.idx, row.cover_tries + 1 >= GOODREADS_TRIES ? { source: 'none' } : { retry: true, wait_seconds: GOODREADS_RETRY_S })

  return async (_job: Job, rows: CoverRow[], context: WorkContext) => {
    const left = context.deadline - now()
    // Too late for a batch: its rows stay pending for the next chunk.
    if (left <= SAVE_RESERVE_MS) return
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), left - SAVE_RESERVE_MS)
    try {
      // A batch is one step: the store hands out Open Library's rows before any Goodreads row.
      if (rows[0]?.cover_state === 'goodreads') await goodreadsStep(rows, context, deadline.signal)
      else await openLibraryStep(rows, context, deadline.signal)
    } finally {
      clearTimeout(timer)
    }
  }
}
