import type { BookSnapshot } from './books.ts'
import { abortError } from './fetching.ts'
import type { GoogleVolume } from './googleBooksRecord.ts'

/**
 * Google Books as the last source of a lookup, asked of the `google-books` edge function
 * (supabase/functions/google-books): what the Catalogue, Apple Books, Open Library and the National Library
 * do not know, for Search (a query they leave nearly empty, an ISBN none of them has), the edition picker,
 * the import's rows nothing else found, and, server side, the genres of a Catalogue Book that has none
 * (`enrich`). **The browser never talks to Google**: the function holds the API key, keeps an answer in a table
 * for at most a day and counts every request against a daily budget (about 900 of the ~1,000 a day the free
 * quota allows the whole app), so what is asked is kept small and late.
 *
 * It is the one source that may be absent: the function answers `unavailable` while its key is not set, its
 * budget is spent, Google refuses or it is slow, and then every method here answers "nothing" (`null`, `[]`),
 * never an error, never `unsure` to the import: the other sources carry on and the member sees nothing of it.
 * Only an abort rejects. Where a result came from never reaches the member (source `google`, internal): a
 * Google edition is written to the Catalogue as source `import` (`bookToRow`, data/library.ts), by the
 * function itself from what Google says about the ISBN (`catalogued`, data/library.ts), as the National
 * Library's is. Its cover is a link to Google's image, never copied (docs/covers.md, "Google").
 *
 * No description (Google's terms allow no permanent copy of it), and only editions with an ISBN (an edition
 * without one cannot be a Catalogue Book). Framework-free: the store hands in the Supabase client.
 */

export const GOOGLE_BOOKS_FUNCTION = 'google-books'

/** The import's own pace between two calls: it asks only for rows nothing else found, a few hundred at most. */
export const GOOGLE_IMPORT_GAP_MS = 500

/** The part of the Supabase client this needs: `functions.invoke`. */
export type FunctionsClient = {
  functions: {
    invoke: (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>
  }
}

/** One Google volume as the snapshot the app shows: source `google`, no id, no description; null for one without an ISBN-13 or an author (it cannot be a Catalogue Book). */
export function snapshotFromGoogleVolume(volume: GoogleVolume): BookSnapshot | null {
  if (!volume.isbn13 || !volume.authors.length) return null
  return {
    title: volume.title,
    authors: [...volume.authors],
    isbn13: volume.isbn13,
    isbn10: volume.isbn10,
    pageCount: volume.pageCount,
    year: volume.year,
    language: volume.language,
    publisher: volume.publisher,
    description: null,
    coverUrl: volume.coverUrl,
    coverThumbhash: null,
    coverColors: null,
    source: 'google',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

export type GoogleBooks = {
  /** The edition with this ISBN-13; null when Google has none or could not answer. */
  lookupIsbn: (isbn13: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** Free text, as typed in Search (Google's own relevance). `[]` when it has none or could not answer. */
  search: (query: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot[]>
  /** Editions of a work, by its title and first author. `[]` as `search`. */
  editions: (book: Pick<BookSnapshot, 'title' | 'authors'>, options?: { signal?: AbortSignal }) => Promise<BookSnapshot[]>
}

export type GoogleBooksOptions = {
  online?: () => boolean
  /** The member's languages (`de-DE`, `en`): one of them narrows the question, several only order the answer. */
  languages?: () => readonly string[]
  /** Who is asking, for the function's budgets: an import says so and gets its own, larger bucket. */
  purpose?: 'import'
  /** At least this many milliseconds between two calls (0: right away). */
  gapMs?: number
}

export function createGoogleBooks(client: FunctionsClient, { online = () => true, languages = () => [], purpose, gapMs = 0 }: GoogleBooksOptions = {}): GoogleBooks {
  let nextAt = 0
  let queue: Promise<void> = Promise.resolve()
  function paced<T>(task: () => Promise<T>): Promise<T> {
    if (!gapMs) return task()
    const turn = queue.then(async () => {
      const hold = nextAt - Date.now()
      if (hold > 0) await new Promise((resolve) => setTimeout(resolve, hold))
      nextAt = Date.now() + gapMs
    })
    queue = turn.catch(() => {})
    return turn.then(task)
  }

  /** The function's answer, or null when it had none to give (offline, unavailable, any error). Rejects only on abort. */
  async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    if (!online()) return null
    return paced(async () => {
      if (signal?.aborted) throw abortError()
      let answer: { data: unknown; error: unknown }
      try {
        answer = await client.functions.invoke(GOOGLE_BOOKS_FUNCTION, { body: purpose ? { ...body, purpose } : body })
      } catch {
        if (signal?.aborted) throw abortError()
        return null
      }
      if (signal?.aborted) throw abortError()
      const data = answer.data as Record<string, unknown> | null
      return answer.error || !data || typeof data.status !== 'string' ? null : data
    })
  }

  const snapshots = (answer: Record<string, unknown> | null): BookSnapshot[] =>
    answer?.status === 'ok' && Array.isArray(answer.volumes)
      ? (answer.volumes as GoogleVolume[]).map(snapshotFromGoogleVolume).filter((book): book is BookSnapshot => book !== null)
      : []

  const asked = () => {
    const list = languages().filter(Boolean).slice(0, 4)
    return list.length ? { languages: list } : {}
  }

  return {
    async lookupIsbn(isbn13, { signal } = {}) {
      const answer = await call({ action: 'isbn', isbn13 }, signal)
      return answer?.status === 'found' ? snapshotFromGoogleVolume(answer.volume as GoogleVolume) : null
    },
    async search(query, { signal } = {}) {
      return snapshots(await call({ action: 'search', query: query.trim().slice(0, 200), ...asked() }, signal))
    },
    async editions(book, { signal } = {}) {
      // No language narrowing: the picker and a row's other editions are in every language.
      return snapshots(await call({ action: 'search', title: book.title, authors: book.authors.slice(0, 5) }, signal))
    },
  }
}
