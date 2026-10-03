import { parseIsbn, type BookSnapshot } from './books'
import { createApple } from './apple'
import type { CatalogueSearch } from './catalogueSearch'
import { abortError, type FetchLike } from './fetching'
import type { LibraryEntry } from './library'
import { MATCH, matchQuality, mergeResults, SOURCE_ORDER, type Found, type SearchResult, type SourceName } from './merge'
import { createOpenLibrary } from './openLibrary'

/**
 * Finding Books (issue #1, Search): one query, three sources at once — the own
 * Catalogue, Apple Books and OpenLibrary — and one list out of their answers
 * (merge.ts). Each source's answer is merged in as it arrives, so the list
 * grows while the slower ones are still on their way. A source that fails is
 * left out without a word; only when every source fails does the outcome say
 * so. Where a result came from never reaches the member.
 *
 * Framework-free: `fetch` and the Catalogue come in from outside, so the tests
 * answer from recordings and never call a live API.
 */

export { appleArtwork, COVER_LARGE, isbnFromArtwork, plainText, splitAuthors, storefrontsFor } from './apple'
export { isAbort, type FetchLike } from './fetching'
export type { SearchResult } from './merge'

/** Below this many characters nothing is asked: one letter matches everything. */
export const MIN_QUERY_LENGTH = 2

/** How long typing has to pause before a query goes out. */
export const SEARCH_DEBOUNCE_MS = 220

/**
 * What one query found so far. `pending`: some source has not answered yet.
 * `failed`: every source that was asked failed, so the list says so instead
 * of "nothing found".
 */
export type SearchOutcome = { results: SearchResult[]; pending: boolean; failed: boolean }

export type SearchOptions = {
  signal?: AbortSignal
  /** The member's Library, to mark what she has; a promise is waited for before the first merge. */
  library?: readonly LibraryEntry[] | Promise<readonly LibraryEntry[]>
  /** Called with the merged list each time a source answers (or fails), the last time with `pending: false`. */
  onUpdate?: (outcome: SearchOutcome) => void
}

export type Search = {
  /**
   * Every source at once; resolves with the full outcome once all have answered.
   * An ISBN (ISBN-10 converted) is looked up as an ISBN in every source instead
   * of searched as text. Rejects with an AbortError when `signal` aborts; no
   * update is reported after that.
   */
  search: (query: string, options?: SearchOptions) => Promise<SearchOutcome>
  /** One Apple Book by its track id: a book page opened cold. Null when no storefront has it; rejects when none answered. */
  lookupApple: (appleId: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** One edition by ISBN-13: Apple Books first, then OpenLibrary. Null or a rejection as `lookupApple`. */
  lookupIsbn: (isbn13: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** One Apple Book by ISBN-13 (its artwork is the best cover there is). Null when Apple has none. */
  lookupAppleIsbn: (isbn13: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** One OpenLibrary edition by its key (`OL61022665M`). Null or a rejection as `lookupApple`. */
  lookupOpenLibrary: (editionKey: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
}

export function createSearch(options: {
  fetch: FetchLike
  languages: readonly string[]
  /** The own Catalogue; left out where there is no backend. */
  catalogue?: CatalogueSearch
}): Search {
  const apple = createApple(options)
  const openLibrary = createOpenLibrary(options)

  type Ask = (signal?: AbortSignal) => Promise<Found[]>

  function asks(text: string): Partial<Record<SourceName, Ask>> {
    // An ISBN is a lookup, not a word to match.
    const isbn = parseIsbn(text)
    const catalogue = options.catalogue
    return {
      ...(catalogue ? { catalogue: (signal?: AbortSignal) => catalogue.search(isbn ?? text, signal) } : {}),
      apple: (signal) => (isbn ? apple.lookupIsbn(isbn, signal) : apple.search(text, signal)),
      openlibrary: (signal) => (isbn ? openLibrary.lookupIsbn(isbn, signal) : openLibrary.search(text, signal)),
    }
  }

  async function search(query: string, { signal, library = [], onUpdate }: SearchOptions = {}): Promise<SearchOutcome> {
    const text = query.trim()
    if (text.length < MIN_QUERY_LENGTH) return { results: [], pending: false, failed: false }

    const sources = asks(text)
    const names = SOURCE_ORDER.filter((name) => sources[name])
    const answers: Partial<Record<SourceName, Found[]>> = {}
    const failures = new Set<SourceName>()
    // The Library only marks results; if it cannot be read, nothing is marked.
    const entries = Promise.resolve(library).catch(() => [] as readonly LibraryEntry[])

    async function outcome(): Promise<SearchOutcome> {
      const answered = Object.keys(answers).length + failures.size
      return {
        results: mergeResults(text, answers, await entries),
        pending: answered < names.length,
        failed: failures.size === names.length,
      }
    }

    // Updates go out one after another, in the order the sources answered.
    let reported = Promise.resolve()
    await Promise.all(
      names.map((name) =>
        sources[name]!(signal)
          .then(
            (found) => void (answers[name] = found),
            () => void failures.add(name),
          )
          .then(() => {
            reported = reported.then(async () => {
              const now = await outcome()
              if (!signal?.aborted) onUpdate?.(now)
            })
            return reported
          }),
      ),
    )
    if (signal?.aborted) throw abortError()
    return outcome()
  }

  async function lookupAppleIsbn(isbn13: string, { signal }: { signal?: AbortSignal } = {}) {
    return (await apple.lookupIsbn(isbn13, signal))[0]?.book ?? null
  }

  return {
    search,
    lookupApple: (appleId, { signal } = {}) => apple.lookupId(appleId, signal),
    lookupAppleIsbn,
    async lookupIsbn(isbn13, { signal } = {}) {
      const [fromApple, fromOpenLibrary] = await Promise.allSettled([
        lookupAppleIsbn(isbn13, { signal }),
        openLibrary.lookupIsbn(isbn13, signal),
      ])
      if (signal?.aborted) throw abortError()
      if (fromApple.status === 'fulfilled' && fromApple.value) return fromApple.value
      if (fromOpenLibrary.status === 'fulfilled' && fromOpenLibrary.value[0]) return fromOpenLibrary.value[0].book
      if (fromApple.status === 'rejected' && fromOpenLibrary.status === 'rejected') throw fromApple.reason
      return null
    },
    lookupOpenLibrary: (editionKey, { signal } = {}) => openLibrary.lookupEdition(editionKey, signal),
  }
}

/**
 * Search without a connection (issue #15): the member's own Library, the
 * entries this device last saw, by title and author (every word of the query
 * beginning a word of the title or an author, as `matchQuality` reads it), or
 * by ISBN. Best match first, the Library's order among equals. Pure: the
 * search store hands in the entries.
 */
export function searchLibrary(entries: readonly LibraryEntry[], query: string): SearchResult[] {
  const isbn = parseIsbn(query)
  const found: { entry: LibraryEntry; score: number; index: number }[] = []
  entries.forEach((entry, index) => {
    const score = isbn
      ? entry.book.isbn13 === isbn ? MATCH.title : 0
      : matchQuality(query, entry.book)
    // `someWords` or less: only some of the query's words matched, not a match here.
    if (score > MATCH.someWords) found.push({ entry, score, index })
  })
  found.sort((a, b) => b.score - a.score || a.index - b.index)
  return found.map(({ entry }) => ({ book: entry.book, entry, otherEdition: false }))
}
