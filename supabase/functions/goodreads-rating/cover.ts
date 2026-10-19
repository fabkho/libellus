/**
 * The Goodreads cover search for one Book (docs/covers.md, "Goodreads, the last resort"): which searches are asked
 * in which order, what accepts a result, and what an empty answer means. No I/O of its own: Goodreads' `auto_complete`
 * and the clock's `sleep` come in from outside (handler.ts wires them), so the tests run it on recordings.
 *
 * Order, stopping at the first accepted hit (a search costs a request, 1 a second, and the member's bucket
 * counts the whole lookup as one call):
 *
 *   1. the ISBN-13 (`coverQueries`): the result by one of the Book's authors, whatever its title (the ISBN names the edition);
 *   2. the whole title with the first author's name; the same-work rule (`matchTitle`, with the fuzzy title rule);
 *   3. the main title with the surname (what a title alone cuts off a series or subtitle for).
 *
 * In every result set, the hit with the given Goodreads book id (the file's own row) wins over what the rule takes.
 *
 * **An empty list is not a miss.** `auto_complete` answers `[]` (200, an empty JSON list) both for a book it does not
 * know and, measured on a real export, for a request it throttles softly: 29 of 34 asks in a row. The two cannot
 * be told apart by one answer, so:
 *
 *   - a query that answered a non-empty list proves Goodreads is answering: when no query accepted a hit after that,
 *     it is a miss (`unsure: false`), cached by the handler;
 *   - when EVERY query answered `[]`, the first (the most exact) is asked again, after 1.5 s and again after 3 s
 *     (`RETRY_DELAYS_MS`, inside `MAX_SEARCH_MS`); the first retry that answers a list takes the search on through
 *     the queries that were empty, once more;
 *   - when still nothing answered a list, the search is `unsure`: neither found nor missing. The handler answers
 *     `{ status: 'unsure' }` and stores nothing; a book Goodreads does not know costs those few requests every time
 *     it is asked, and the client asks again at most once (data/coverFill.ts).
 */
import { type AutoCompleteBook, type CoverQuery, coverQueries, type LookupBook, matchIsbnResult, matchTitle, pickByBookId } from './goodreads.ts'

/** Waits before the retries of an all-empty search: it grows. */
export const RETRY_DELAYS_MS = [1500, 3000]
/** Retries stop when the search has run this long (the client gives a call 20 s). */
export const MAX_SEARCH_MS = 12_000

export type CoverSearch = {
  /** What the file's id, the ISBN or the rule accepted; null for none. */
  hit: AutoCompleteBook | null
  /** What the same-work rule accepted by title (only that is cached: the caller names the title, not the id or ISBN); null for none. */
  byRule: AutoCompleteBook | null
  /** Every query answered `[]`, even after the retries: Goodreads has none, or is not answering (nothing may be cached). */
  unsure: boolean
  /** Requests made; of them, the ones that answered `[]`. */
  asked: number
  empty: number
}

export async function searchCover(
  book: LookupBook,
  goodreadsBookId: string | null,
  deps: { autoComplete: (query: string) => Promise<AutoCompleteBook[]>; sleep: (ms: number) => Promise<void>; now: () => number },
): Promise<CoverSearch> {
  const queries = coverQueries(book)
  const search: CoverSearch = { hit: null, byRule: null, unsure: false, asked: 0, empty: 0 }
  const started = deps.now()
  /** Queries that answered a list. */
  const answered = new Set<CoverQuery>()

  /** Asks one query; true when a hit was accepted (the search is over). */
  async function ask(query: CoverQuery): Promise<boolean> {
    const results = await deps.autoComplete(query.q)
    search.asked++
    if (!results.length) {
      search.empty++
      return false
    }
    answered.add(query)
    const rule = query.kind === 'isbn' ? matchIsbnResult(book, results) : matchTitle(book, results)
    if (query.kind !== 'isbn' && rule && !search.byRule) search.byRule = rule
    search.hit = pickByBookId(results, goodreadsBookId) ?? rule
    return search.hit !== null
  }

  for (const query of queries) if (await ask(query)) return search
  // Every query answered `[]`: throttled, or unknown. Retry the most exact one with growing waits.
  for (const delay of RETRY_DELAYS_MS) {
    if (answered.size || !queries.length || deps.now() - started + delay > MAX_SEARCH_MS) break
    await deps.sleep(delay)
    if (await ask(queries[0]!)) return search
    // Goodreads answers a list now: the queries that were empty are asked once more.
    if (answered.size) for (const query of queries.slice(1)) if (await ask(query)) return search
  }
  search.unsure = answered.size === 0 && queries.length > 0
  return search
}
