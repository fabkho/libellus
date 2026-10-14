import { parseIsbn, type Book, type BookSnapshot } from './books'
import { createApple } from './apple'
import type { Dnb } from './dnb'
import type { CatalogueSearch } from './catalogueSearch'
import { abortError, type FetchLike } from './fetching'
import type { LibraryEntry } from './library'
import { editionKeys, isbn13Of, MATCH, matchQuality, mergeResults, normalise, SOURCE_ORDER, workKey, type Found, type SearchResult, type SourceName } from './merge'
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
 * of "nothing found". `editions`: every edition the sources named, one per
 * edition (an ISBN or a source id), not one per book as `results`: what the
 * import chooses an edition from. `unanswered`: the sources that failed (a
 * refusal, a timeout, an error) or answered only in part (an Apple storefront
 * that did not): what they have is not known, which is no "nothing found" (the
 * import asks again later).
 */
export type SearchOutcome = {
  results: SearchResult[]
  pending: boolean
  failed: boolean
  editions?: (BookSnapshot | Book)[]
  unanswered?: SourceName[]
}

export type SearchOptions = {
  signal?: AbortSignal
  /** The member's Library, to mark what she has; a promise is waited for before the first merge. */
  library?: readonly LibraryEntry[] | Promise<readonly LibraryEntry[]>
  /** Called with the merged list each time a source answers (or fails), the last time with `pending: false`. */
  onUpdate?: (outcome: SearchOutcome) => void
  /** Only these sources (all when left out): the import asks Apple only the questions that can change its answer. */
  sources?: readonly SourceName[]
}

/** One row of a batch lookup by ISBN: its ISBN, and what tells a result of the batch apart as its edition (title, authors). */
export type IsbnRow = { isbn13: string; title: string; authors: readonly string[] }

/** How many ISBNs one Apple lookup asks for at once (measured: 40 answer in one request, the same hits as 40 lookups). */
export const APPLE_ISBN_BATCH = 40

export type Search = {
  /**
   * Every source at once; resolves with the full outcome once all have answered.
   * An ISBN (ISBN-10 converted) is looked up as an ISBN in every source instead
   * of searched as text. Rejects with an AbortError when `signal` aborts; no
   * update is reported after that.
   */
  search: (query: string, options?: SearchOptions) => Promise<SearchOutcome>
  /**
   * Apple Books' ebook editions for a title and author, from its first storefront only (one request): where
   * the other sources were asked already and only a cover is wanted (the import's cover fill). `failed` when
   * Apple did not answer (refused, unreachable).
   */
  searchCovers: (query: string, options?: { signal?: AbortSignal; storefront?: 0 | 1 }) => Promise<{ results: { book: BookSnapshot }[]; pending: false; failed: boolean }>
  /** One Apple Book by its track id: a book page opened cold. Null when no storefront has it; rejects when none answered. */
  lookupApple: (appleId: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /**
   * One edition by ISBN-13: Apple Books first, then OpenLibrary, then the National Library (a German
   * edition they do not know). Null or a rejection as `lookupApple`; with `strict`, also a rejection when
   * nothing was found and one of them (the National Library included) did not answer (a refusal is no
   * "not found": it is "not asked").
   */
  lookupIsbn: (isbn13: string, options?: { signal?: AbortSignal; strict?: boolean }) => Promise<BookSnapshot | null>
  /**
   * Asks Apple for many ISBNs at once (`APPLE_ISBN_BATCH` a request, both storefronts) and keeps the answers,
   * so `lookupIsbn` and `lookupAppleIsbn` of those ISBNs ask Apple nothing more: a whole file's ISBNs cost a few
   * dozen requests instead of two each. A result whose artwork names its ISBN is that ISBN's; another is the
   * edition of the batch's row whose work it is (`belongs`). A batch that fails, or a result two rows could own,
   * leaves those ISBNs to their own lookup. Never rejects (but on abort).
   */
  primeIsbns: (rows: readonly IsbnRow[], belongs: (row: IsbnRow, book: BookSnapshot) => boolean, options?: { signal?: AbortSignal }) => Promise<void>
  /** One Apple Book by ISBN-13 (its artwork is the best cover there is). Null when Apple has none. */
  lookupAppleIsbn: (isbn13: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** One OpenLibrary edition by its key (`OL61022665M`). Null or a rejection as `lookupApple`. */
  lookupOpenLibrary: (editionKey: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** The editions of an Open Library work (`OL45883W`), with the work's authors: every edition Choose edition can offer. */
  workEditions: (work: { key: string; authors: readonly string[] }, options?: { signal?: AbortSignal }) => Promise<BookSnapshot[]>
}

/** Every edition the sources named, in source order, each once (its ISBN or a source id): what `editions` holds. */
function everyEdition(answers: Partial<Record<SourceName, readonly Found[]>>): (Book | BookSnapshot)[] {
  const seen = new Set<string>()
  const out: (Book | BookSnapshot)[] = []
  for (const source of SOURCE_ORDER) {
    for (const { book } of answers[source] ?? []) {
      const keys = editionKeys(book)
      if (keys.some((key) => seen.has(key))) continue
      for (const key of keys) seen.add(key)
      out.push(book)
    }
  }
  return out
}

export function createSearch(options: {
  fetch: FetchLike
  languages: readonly string[]
  /** The own Catalogue; left out where there is no backend. */
  catalogue?: CatalogueSearch
  /**
   * The German National Library (data/dnb.ts), a last resort for an ISBN: asked only when the
   * other sources found nothing for it, so a German edition they do not know still shows.
   */
  dnb?: Pick<Dnb, 'lookupIsbn'>
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
      // Asked after the others (`search` below waits for them): an ISBN only, and only when none of them had it.
      ...(isbn && options.dnb
        ? { dnb: async (signal?: AbortSignal): Promise<Found[]> => {
            const book = await options.dnb!.lookupIsbn(isbn, { signal })
            return book ? [{ book, source: 'dnb' as const, popularity: 0 }] : []
          } }
        : {}),
    }
  }

  async function search(query: string, { signal, library = [], onUpdate, sources: only }: SearchOptions = {}): Promise<SearchOutcome> {
    const text = query.trim()
    if (text.length < MIN_QUERY_LENGTH) return { results: [], pending: false, failed: false, editions: [], unanswered: [] }

    const sources = asks(text)
    const names = SOURCE_ORDER.filter((name) => sources[name] && (!only || only.includes(name)))
    const answers: Partial<Record<SourceName, Found[]>> = {}
    const failures = new Set<SourceName>()
    const partial = new Set<SourceName>()
    // The Library only marks results; if it cannot be read, nothing is marked.
    const entries = Promise.resolve(library).catch(() => [] as readonly LibraryEntry[])

    async function outcome(): Promise<SearchOutcome> {
      const answered = Object.keys(answers).length + failures.size
      return {
        results: mergeResults(text, answers, await entries),
        pending: answered < names.length,
        failed: failures.size === names.length,
        editions: everyEdition(answers),
        unanswered: [...new Set([...failures, ...partial])],
      }
    }

    // Updates go out one after another, in the order the sources answered.
    let reported = Promise.resolve()
    const answerOf = (name: SourceName, ask: Ask | undefined = sources[name]) =>
      (ask ? ask(signal) : Promise.resolve([] as Found[]))
        .then(
          (found: Found[] & { partial?: boolean }) => {
            answers[name] = found
            if (found.partial) partial.add(name)
          },
          () => void failures.add(name),
        )
        .then(() => {
          reported = reported.then(async () => {
            const now = await outcome()
            if (!signal?.aborted) onUpdate?.(now)
          })
          return reported
        })
    const direct = names.filter((name) => name !== 'dnb').map((name) => answerOf(name))
    // The National Library is a last resort: it is asked once the others have answered and none had the ISBN.
    const last = names.includes('dnb')
      ? Promise.allSettled(direct).then(() =>
          answerOf('dnb', Object.values(answers).some((found) => found.length > 0) ? async () => [] : sources.dnb),
        )
      : null
    await Promise.all(last ? [...direct, last] : direct)
    if (signal?.aborted) throw abortError()
    return outcome()
  }

  /** What a batch lookup (`primeIsbns`) found per ISBN: its Apple edition, or null when Apple surely has none. */
  const primed = new Map<string, BookSnapshot | null>()

  async function lookupAppleIsbn(isbn13: string, { signal }: { signal?: AbortSignal } = {}) {
    if (primed.has(isbn13)) return primed.get(isbn13) ?? null
    return (await apple.lookupIsbn(isbn13, signal))[0]?.book ?? null
  }

  async function primeIsbns(rows: readonly IsbnRow[], belongs: (row: IsbnRow, book: BookSnapshot) => boolean, { signal }: { signal?: AbortSignal } = {}) {
    const unique = [...new Map(rows.filter((row) => !primed.has(row.isbn13)).map((row) => [row.isbn13, row])).values()]
    for (let from = 0; from < unique.length; from += APPLE_ISBN_BATCH) {
      if (signal?.aborted) throw abortError()
      const batch = unique.slice(from, from + APPLE_ISBN_BATCH)
      const asked = new Set(batch.map((row) => row.isbn13))
      let found: Found[]
      try {
        found = await apple.lookupIsbns([...asked], signal)
      } catch {
        if (signal?.aborted) throw abortError()
        // Not answered (refused, unreachable): these ISBNs are asked one by one, as before.
        continue
      }
      const owned = new Map<string, BookSnapshot>()
      const unsure = new Set<string>()
      let orphan = false
      for (const { book } of found) {
        // The artwork of most editions is named after their ISBN: that ISBN's edition for sure.
        const named = book.isbn13 && asked.has(book.isbn13) ? book.isbn13 : null
        const owners = named ? [named] : batch.filter((row) => belongs(row, book)).map((row) => row.isbn13)
        if (owners.length === 1) {
          if (!owned.has(owners[0]!)) owned.set(owners[0]!, { ...book, isbn13: owners[0]! })
        } else if (owners.length) {
          // Two rows of one work: either may be its edition, so both are asked on their own.
          for (const isbn13 of owners) unsure.add(isbn13)
        } else {
          orphan = true
        }
      }
      for (const isbn13 of asked) {
        if (owned.has(isbn13) && !unsure.has(isbn13)) primed.set(isbn13, owned.get(isbn13)!)
        // A result nobody could be told to own may be any unanswered ISBN's: those are asked on their own.
        else if (!unsure.has(isbn13) && !orphan) primed.set(isbn13, null)
      }
    }
  }

  return {
    search,
    async searchCovers(query, { signal, storefront = 0 } = {}) {
      try {
        return { results: (await apple.searchFirst(query.trim(), signal, storefront)).map(({ book }) => ({ book })), pending: false, failed: false }
      } catch {
        if (signal?.aborted) throw abortError()
        return { results: [], pending: false, failed: true }
      }
    },
    lookupApple: (appleId, { signal } = {}) => apple.lookupId(appleId, signal),
    lookupAppleIsbn,
    primeIsbns,
    async lookupIsbn(isbn13, { signal, strict = false } = {}) {
      const [fromApple, fromOpenLibrary] = await Promise.allSettled([
        strict && !primed.has(isbn13)
          ? apple.lookupIsbn(isbn13, signal).then((found) => {
              // Strict: a storefront that did not answer may sell it; nothing found is not "Apple has none".
              if (!found.length && found.partial) throw new Error('A storefront did not answer')
              return found[0]?.book ?? null
            })
          : lookupAppleIsbn(isbn13, { signal }),
        openLibrary.lookupIsbn(isbn13, signal),
      ])
      if (signal?.aborted) throw abortError()
      if (fromApple.status === 'fulfilled' && fromApple.value) return fromApple.value
      if (fromOpenLibrary.status === 'fulfilled' && fromOpenLibrary.value[0]) return fromOpenLibrary.value[0].book
      // A German edition neither knows (a book page opened cold, after a reload; the import's ISBN step): the National Library.
      let dnbUnanswered = false
      if (options.dnb) {
        try {
          const german = await options.dnb.lookupIsbn(isbn13, { signal })
          if (german) return german
        } catch {
          if (signal?.aborted) throw abortError()
          // Its refusal is no "not found": whether it has the ISBN cannot be told.
          dnbUnanswered = true
        }
      }
      if (fromApple.status === 'rejected' && fromOpenLibrary.status === 'rejected') throw fromApple.reason
      // Strict: one of them (or the National Library) did not answer, so "neither has it" cannot be told.
      if (strict && (dnbUnanswered || fromApple.status === 'rejected' || fromOpenLibrary.status === 'rejected')) {
        if (fromApple.status === 'rejected') throw fromApple.reason
        if (fromOpenLibrary.status === 'rejected') throw (fromOpenLibrary as PromiseRejectedResult).reason
        throw new Error('The National Library did not answer')
      }
      return null
    },
    lookupOpenLibrary: (editionKey, { signal } = {}) => openLibrary.lookupEdition(editionKey, signal),
    workEditions: (work, { signal } = {}) => openLibrary.workEditions(work, signal),
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

/**
 * The member's own Library entries a query is about, for the group at the
 * front of the results ("In your Library", #131): her books come first,
 * whatever the sources answer. An entry is in it when
 *
 * 1. it matches the query as search reads it (`matchQuality` above
 *    `someWords`: the title, the title and author, the author — or its ISBN);
 * 2. a result is another edition of it (the same title and first author,
 *    `otherEdition`): a source found the book by words her edition does not
 *    have (another language's title, a subtitle), so it is hers that is meant;
 * 3. with `byAuthor` (looking for an ebook file's Book: the query is the
 *    file's title and first author), its first author's surname is a word of
 *    the query: a translated title still finds her edition by its author.
 *
 * Best match first, then (2), then (3), each in the Library's order. Pure.
 */
export function libraryGroup(
  entries: readonly LibraryEntry[],
  query: string,
  results: readonly SearchResult[] = [],
  { byAuthor = false }: { byAuthor?: boolean } = {},
): LibraryEntry[] {
  const text = query.trim()
  if (text.length < MIN_QUERY_LENGTH) return []
  const isbn = parseIsbn(text)
  const otherWorks = new Set(results.filter((result) => result.otherEdition).map((result) => workKey(result.book)))
  const queryWords = new Set(normalise(text).split(' '))
  const found: { entry: LibraryEntry; rank: number; index: number }[] = []
  entries.forEach((entry, index) => {
    const quality = isbn ? (isbn13Of(entry.book) === isbn ? MATCH.title : 0) : matchQuality(text, entry.book)
    let rank = quality > MATCH.someWords ? quality : 0
    if (!rank && otherWorks.has(workKey(entry.book))) rank = 2
    if (!rank && byAuthor && !isbn) {
      const surname = normalise(entry.book.authors[0] ?? '').split(' ').at(-1) ?? ''
      if (surname.length > 1 && queryWords.has(surname)) rank = 1
    }
    if (rank) found.push({ entry, rank, index })
  })
  found.sort((a, b) => b.rank - a.rank || a.index - b.index)
  return found.map(({ entry }) => entry)
}
