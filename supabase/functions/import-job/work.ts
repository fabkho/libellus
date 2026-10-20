/**
 * The matching of an import job's rows (`Work`, runner.ts), the way the app matches a whole file
 * (web/app/stores/import.ts `choose`, web/app/data/bookImport.ts), with the same code: each row goes through
 * `findEdition` (the Catalogue first, its ISBN, then the title ladder over Open Library and the National Library), eight
 * at a time. A first-pass row a source could not be asked about (`unsure`) is deferred to the second pass (the app's
 * "once more, at the end"). What a row came to (`matchResult`: the verdict, the preview's review tier, the edition it
 * found) is saved on its row.
 *
 * The cover the match shows (the edition's own, or a sibling edition's lent by `coverLender`) is the row's cover decision,
 * saved with it; a row without one goes on to the cover stage (covers.ts: its own phase, after every row is matched).
 *
 * Not here yet (the next pieces of the job): the write (`import_job_write`, `fill_book_covers`). Until it is in, a saved
 * row says what the match found and nothing is written (`outcome` is null), so the function is not deployed for members
 * before it is.
 *
 * The rows a batch does not reach before its deadline stay pending (the next chunk takes them).
 */
import {
  type Edition,
  findEdition,
  isMatched,
  type Lookups,
  rememberingAnswers,
  reviewOf,
} from '../../../web/app/data/bookImport.ts'
import type { Book, BookSnapshot } from '../../../web/app/data/books.ts'
import type { ImportBook } from '../../../web/app/data/import/rows.ts'
import { coverSizeOf } from './cover_size.ts'
import type { Job, JobRow, RowResult, Work, WorkContext } from './runner.ts'

/**
 * Rows looked up at once. The app looks up 4 (`IMPORT_CONCURRENCY`); the job 8: Open Library's search answers in ~2.4 s
 * (measured, up to its 10 s deadline) and a row asks it ~4 times, so 4 rows at once used a third of the shared pace
 * (3 a second). The pace, not this, keeps Open Library's limit.
 */
export const MATCH_CONCURRENCY = 8
/** What a batch keeps for saving its results: the lookups are cut off this long before the batch's deadline. */
export const SAVE_RESERVE_MS = 10_000

/** The file's row as uploaded: the parsed row and the Collections she kept for it. */
export type UploadedRow = ImportBook & { collections?: string[] }

/** What the review after the job shows of a row's edition: the Book it was matched to, how, and the notes. */
export type EditionSummary = {
  via: Edition['via']
  unsure: boolean
  choose: boolean
  notes: unknown[]
  book: {
    id: string | null
    title: string
    authors: string[]
    isbn13: string | null
    year: number | null
    language: string | null
    source: string
    format: string | null
    coverUrl: string | null
    coverThumbhash: string | null
  }
}

/** A row's match: the file's row, the edition found for it and the preview's review of both. */
export type Matched = { row: JobRow; book: UploadedRow; edition: Edition; matched: boolean; review: ReturnType<typeof reviewOf> }

function summary(book: Book | BookSnapshot, edition: Edition, review: ReturnType<typeof reviewOf>): EditionSummary {
  return {
    via: edition.via,
    unsure: edition.unsure,
    choose: review.choose,
    notes: review.notes,
    book: {
      id: 'id' in book ? book.id : null,
      title: book.title,
      authors: [...book.authors],
      isbn13: book.isbn13 ?? null,
      year: book.year ?? null,
      language: book.language ?? null,
      source: book.source,
      format: book.format ?? null,
      // The cover it shows: its own, or another edition's it borrows.
      coverUrl: (edition.coverFrom ?? book).coverUrl ?? book.coverUrl ?? null,
      coverThumbhash: (edition.coverFrom ?? book).coverThumbhash ?? book.coverThumbhash ?? null,
    },
  }
}

/** What a matched row is saved as (`RowResult`): nothing is written yet, so no outcome. `cover` `none` sends the row on to the cover stage (covers.ts). Pure. */
export function matchResult({ edition, matched, review }: Matched): Extract<RowResult, { verdict: unknown }> {
  const shown = (edition.coverFrom ?? edition.book).coverUrl
  const cover: 'own' | 'lent' | 'goodreads' | 'none' = !shown
    ? 'none'
    : edition.goodreadsOnly || edition.coverKind === 'goodreads'
    ? 'goodreads'
    // `mergeCover` puts a lent cover on a found edition's Book itself (`filled`) and on the file's own row as `coverFrom`.
    : edition.filled || !edition.book.coverUrl
    ? 'lent'
    : 'own'
  return {
    verdict: matched ? 'matched' : 'fromFile',
    tier: review.tier,
    outcome: null,
    edition: summary(edition.book, edition, review),
    cover,
    // The address of the cover shown, so the row's cover decision (edition / lent) is whole when the match is saved.
    ...(shown ? { cover_url: shown, cover_size: coverSizeOf(shown) } : {}),
  }
}

/** Runs `task` over `items`, at most `limit` at once. */
export async function eachLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await task(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/**
 * Matches one row. Resolves null when the deadline cut the lookup off (the row stays pending); anything
 * else rejects (the batch failed). `edition.unsure` tells a source could not be asked: the caller defers a first-pass row.
 */
export async function matchRow(row: JobRow, lookups: Lookups, signal?: AbortSignal): Promise<Matched | null> {
  const book = row.payload as UploadedRow
  let edition: Edition
  try {
    edition = await findEdition(book, lookups, signal)
  } catch (error) {
    if (signal?.aborted) return null
    throw error
  }
  const matched = isMatched(edition)
  return { row, book, edition, matched, review: reviewOf(book, edition, matched) }
}

export type WorkDeps = {
  /** The chunk's lookups (sources.ts `jobSources`), for this job and runner. */
  lookups: (job: Job, runner: string) => Lookups
  now?: () => number
  log?: (message: string) => void
}

/** The worker the runner calls per batch. The lookups (and the answers they keep) live for one chunk. */
export function createWork(deps: WorkDeps): Work {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((message: string) => console.log(message))
  let chunk: { key: string; lookups: Lookups } | null = null

  return async (job: Job, rows: JobRow[], context: WorkContext) => {
    const key = `${job.id}|${context.runner}`
    if (chunk?.key !== key) chunk = { key, lookups: rememberingAnswers(deps.lookups(job, context.runner)) }
    const { lookups } = chunk
    const left = context.deadline - now()
    // Too late for a batch: its rows stay pending for the next chunk.
    if (left <= SAVE_RESERVE_MS) return

    const began = now()
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), left - SAVE_RESERVE_MS)
    let saved = 0
    let deferred = 0
    try {
      await eachLimited(rows, MATCH_CONCURRENCY, async (row) => {
        if (context.stopped() || deadline.signal.aborted) return
        const found = await matchRow(row, lookups, deadline.signal)
        if (!found) return
        if (found.edition.unsure && row.pass === 0) {
          deferred++
          await context.save(row.idx, { defer: true })
          return
        }
        await context.save(row.idx, matchResult(found))
        saved++
      })
    } finally {
      clearTimeout(timer)
    }
    log(`import-job: batch of ${rows.length}: ${saved} matched, ${deferred} deferred, ${now() - began} ms`)
  }
}
