import type { BookSnapshot } from './books.ts'
import type { DnbEdition } from './dnbRecord.ts'
import { abortError } from './fetching.ts'

/**
 * German editions from the German National Library (DNB), asked of the `dnb-lookup` edge function
 * (supabase/functions/dnb-lookup): what Apple Books and Open Library do not know of a German book,
 * for the barcode scan and the ISBN lookups (`lookupIsbn`), for the edition picker (`editions`) and
 * for the import's match (data/bookImport.ts: the title ladder's one DNB question, and the ISBN
 * fallback of `createSearch`). The data is CC0 (no attribution, no storing limit); it has no covers
 * of its own (the function adds an Open Library cover by ISBN where there is one) and no genres.
 * The browser never talks to the DNB.
 *
 * A DNB edition is a snapshot of source `dnb` in the app, written to the Catalogue as source
 * `import` (its `book_source` has no `dnb`; `bookToRow`, data/library.ts): a member may only add a
 * Catalogue Book, so when one is added or picked, the library repository (data/library.ts
 * `catalogued`) asks the function for its `book` action, which makes the Catalogue Book from what
 * the DNB says about the ISBN, never from what the app sends. Where a result came from never
 * reaches the member. Framework-free: the store hands in the Supabase client (only its `functions`).
 *
 * Two budgets keep the function's upstream polite (supabase/functions/dnb-lookup/README.md): a
 * member 30 calls a minute (the scan and the picker), an import 120 (`purpose: 'import'`, its own
 * bucket). An import paces itself to the same 120 (`gapMs`: 500 ms between calls) so a whole file
 * meets no refusal.
 */

export const DNB_FUNCTION = 'dnb-lookup'

/** The import's own pace between two calls: 500 ms is 120 a minute, its budget in the function (supabase/functions/dnb-lookup/README.md). */
export const DNB_IMPORT_GAP_MS = 500

/** The part of the Supabase client this needs: `functions.invoke`. */
export type FunctionsClient = {
  functions: {
    invoke: (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>
  }
}

/** One DNB edition as the snapshot the app shows: source `dnb`, no id, no cover of its own (the function's Open Library cover, if any). */
export function snapshotFromDnbEdition(edition: DnbEdition): BookSnapshot {
  return {
    title: edition.title,
    authors: [...edition.authors],
    isbn13: edition.isbn13,
    isbn10: null,
    pageCount: edition.pages,
    year: edition.year,
    language: edition.language,
    publisher: edition.publisher,
    description: null,
    coverUrl: edition.coverUrl ?? null,
    coverThumbhash: null,
    coverColors: null,
    source: 'dnb',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

export type Dnb = {
  /** The edition with this ISBN-13; null when the DNB has none. Rejects when the function could not answer (offline, over its limit, the DNB down). */
  lookupIsbn: (isbn13: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** The DNB's editions of a work, by its title and first author. Rejects as `lookupIsbn`. */
  editions: (book: Pick<BookSnapshot, 'title' | 'authors'>, options?: { signal?: AbortSignal }) => Promise<BookSnapshot[]>
}

export type DnbOptions = {
  online?: () => boolean
  /** Who is asking, for the function's budgets (supabase/functions/dnb-lookup/README.md): an import says so and gets its own, larger bucket. */
  purpose?: 'import'
  /** At least this many milliseconds between two calls (0: right away). An import paces itself to its budget: 500 ms is 120 a minute. */
  gapMs?: number
}

export function createDnb(client: FunctionsClient, { online = () => true, purpose, gapMs = 0 }: DnbOptions = {}): Dnb {
  /** Calls start one `gapMs` apart, in the order they were made (a whole file asks one per row). */
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

  async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!online()) throw new Error('offline')
    return paced(async () => {
      if (signal?.aborted) throw abortError()
      const { data, error } = await client.functions.invoke(DNB_FUNCTION, { body: purpose ? { ...body, purpose } : body })
      if (signal?.aborted) throw abortError()
      const answer = data as Record<string, unknown> | null
      if (error || !answer || typeof answer.status !== 'string') throw new Error('dnb unavailable')
      return answer
    })
  }

  return {
    async lookupIsbn(isbn13, { signal } = {}) {
      const answer = await call({ action: 'isbn', isbn13 }, signal)
      return answer.status === 'found' ? snapshotFromDnbEdition(answer.edition as DnbEdition) : null
    },
    async editions(book, { signal } = {}) {
      const answer = await call({ action: 'editions', title: book.title, authors: book.authors.slice(0, 5) }, signal)
      return answer.status === 'ok' && Array.isArray(answer.editions) ? (answer.editions as DnbEdition[]).map(snapshotFromDnbEdition) : []
    },
  }
}
