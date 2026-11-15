/**
 * The parts of the page-count backfill (`backfill-page-counts.ts`) that need no database and no network: which Books
 * are candidates, what the run asks and what its summary says, and how one `google-books` answer is read. Pure and
 * tested (web/tests/page-count-backfill.test.ts); the runner beside this file does the I/O.
 *
 * The candidates are exactly the reads `readsWithoutPages` counts (`app/data/stats.ts`): a finished read whose page
 * count is unknown — her own `library_entries.page_count_override` is null *and* the edition's `books.page_count` is
 * null — where the Book has an ISBN-13 to ask Google about. One Book is one candidate however many finished reads it
 * has: `books.page_count` belongs to the edition, so one write settles every read of it at once.
 *
 * A Manual book (owner_id set) is left out: it is one member's own row, not an edition of the Catalogue, and writing
 * it is not this backfill's business. The count that book's reads are missing is hers to set, on her entry.
 */

/** One Book to ask about: the edition, its ISBN and the finished reads waiting on it. */
export type PageCountCandidate = {
  bookId: string
  isbn13: string | null
  isbn10: string | null
  /** How many finished reads of this Book have no page count (the Books behind `pagesMissing`). */
  reads: number
}

/**
 * The candidate query, verbatim as the runner sends it. Null-only in both halves of the rule the app applies
 * (`coalesce(page_count_override, page_count)`): an edition that has a count is no candidate, and a read whose entry
 * carries her own total is no missing count. Catalogue Books only (`owner_id is null`); one row per Book.
 */
export const CANDIDATES_SQL = `
  select b.id                                          as book_id,
         b.isbn13,
         b.isbn10,
         count(distinct s.id)::int                      as reads
    from public.books b
    join public.library_entries e on e.book_id = b.id
    join public.reading_sessions s on s.entry_id = e.id
   where b.owner_id is null
     and b.page_count is null
     and e.page_count_override is null
     and s.outcome = 'finished'
     and coalesce(b.isbn13, b.isbn10) is not null
   group by b.id, b.isbn13, b.isbn10
   order by b.id
`.trim()

/** The ISBN-13 to ask Google about: the Book's own, or its ISBN-10 turned into one (Google's `isbn:` wants 13). */
export function askableIsbn(candidate: PageCountCandidate, toIsbn13: (input: string) => string | null): string | null {
  if (candidate.isbn13) return candidate.isbn13
  return candidate.isbn10 ? toIsbn13(candidate.isbn10) : null
}

/** What the `google-books` function answered to `{ action: 'isbn' }`, as the backfill reads it. */
export type Lookup =
  /** Google knows the edition and says how many pages it has. */
  | { kind: 'answered'; pageCount: number }
  /** Google knows the edition but says nothing about pages (or something that is no page count). */
  | { kind: 'no-pages' }
  /** Google has no volume with this ISBN: a normal outcome, not an error. */
  | { kind: 'unknown' }
  /** The function could not ask (`not_configured`, `budget`, `blocked`, `error`): the run stops asking. */
  | { kind: 'unavailable'; reason: string }

/** The count the database would accept: the same range as `progress_invalid` and the RPC (1 … 99999). */
export function validPageCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 99999 ? value : null
}

/**
 * One answer body of `{ action: 'isbn' }` (supabase/functions/google-books/handler.ts) as a Lookup. The volume's
 * `pageCount` is already parsed and range-checked by the function (1 … 10000, else null), so a null here means
 * Google did not say, never that it said something impossible.
 */
export function readAnswer(status: number, body: unknown): Lookup {
  const answer = (body ?? {}) as { status?: unknown; reason?: unknown; volume?: { pageCount?: unknown } | null }
  if (status >= 500) return { kind: 'unavailable', reason: `http_${status}` }
  if (status === 413) return { kind: 'unavailable', reason: 'payload_too_large' }
  if (status === 429) return { kind: 'unavailable', reason: 'rate_limited' }
  if (status === 400) return { kind: 'unknown' }
  if (answer.status === 'unavailable') {
    return { kind: 'unavailable', reason: typeof answer.reason === 'string' ? answer.reason : 'unavailable' }
  }
  if (answer.status === 'not_found' || !answer.volume) return { kind: 'unknown' }
  const pageCount = validPageCount(answer.volume.pageCount)
  return pageCount === null ? { kind: 'no-pages' } : { kind: 'answered', pageCount }
}

/** What one run did, printed at the end. */
export type RunSummary = {
  candidates: number
  /** Books whose ISBN could be asked about (the rest are skipped and named). */
  askable: number
  asked: number
  /** Google said how many pages. */
  answered: number
  /** Google knew the edition but had no count, or did not know it at all. */
  without: number
  /** Books the RPC answered `true` for. */
  written: number
  /** Books the RPC answered `false` for: somebody filled the count between the query and the write. */
  taken: number
  /** Candidates still without a count when the run ended (`--apply` only; in a dry run, every candidate). */
  left: number
  /** The function could not ask, and the run stopped asking. */
  stopReason: string | null
}

/** How many Books ended the run still without a count. */
export function remaining(summary: Pick<RunSummary, 'candidates' | 'written'>): number {
  return summary.candidates - summary.written
}

/** The one line the run ends with (and the PR body quotes): Books, asked, answered, written, left. */
export function summaryLine(summary: RunSummary): string {
  const parts = [
    `${summary.candidates} candidate Book(s)`,
    `${summary.askable} with a usable ISBN`,
    `${summary.asked} asked`,
    `${summary.answered} answered`,
    `${summary.without} without a count from Google`,
    `${summary.written} written`,
    `${summary.taken} already filled`,
    `${summary.left} left`,
  ]
  return `Summary: ${parts.join(', ')}${summary.stopReason ? ` (stopped: ${summary.stopReason})` : ''}`
}
