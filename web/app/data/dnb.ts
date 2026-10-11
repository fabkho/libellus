import type { BookSnapshot } from './books'
import type { DnbEdition } from './dnbRecord'
import { abortError } from './fetching'

/**
 * German editions from the German National Library (DNB), asked of the `dnb-lookup` edge function
 * (supabase/functions/dnb-lookup): what Apple Books and Open Library do not know of a German book,
 * for the barcode scan and the ISBN lookups (`lookupIsbn`) and for the edition picker (`editions`).
 * The data is CC0 (no attribution, no storing limit); it has no covers (the function adds an Open
 * Library cover by ISBN where there is one) and no genres. The browser never talks to the DNB.
 *
 * A DNB edition is a snapshot of source `import`: a member may only add a Catalogue Book, so when
 * one is added or picked, the library repository (data/library.ts `catalogued`) asks the function
 * for its `book` action, which makes the Catalogue Book from what the DNB says about the ISBN,
 * never from what the app sends. Where a result came from never reaches the member. Framework-free: the store hands in the Supabase client (only its `functions`).
 */

export const DNB_FUNCTION = 'dnb-lookup'

/** The part of the Supabase client this needs: `functions.invoke`. */
export type FunctionsClient = {
  functions: {
    invoke: (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>
  }
}

/** One DNB edition as the snapshot the app shows: no id, no cover of its own (the function's Open Library cover, if any). */
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
    source: 'import',
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

export function createDnb(client: FunctionsClient, { online = () => true }: { online?: () => boolean } = {}): Dnb {
  async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!online()) throw new Error('offline')
    const { data, error } = await client.functions.invoke(DNB_FUNCTION, { body })
    if (signal?.aborted) throw abortError()
    const answer = data as Record<string, unknown> | null
    if (error || !answer || typeof answer.status !== 'string') throw new Error('dnb unavailable')
    return answer
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
