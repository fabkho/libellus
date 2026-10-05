import { parseLibraryFile, type LibraryBook } from './export/regalLibraryFile'

/**
 * Your shelf (#23): the owner's Library as the portfolio shows it, read from
 * the published Regal library file (`books.fabkho.dev/v2/library.json`, made
 * from this app's data by `export:regal` and Regal assets). Regal's own
 * components draw it in 3D; this is what the app needs before they have
 * loaded and without them: how many Books, which were read in a year, and the
 * colours of their Spines for the pile that stands in while the 3D comes.
 *
 * Who may see it is `utils/shelfOwner.ts`.
 *
 * Framework-free: the fetch is handed in, like search's.
 */

/** A Book on the shelf, as far as Libellus needs it. */
export type ShelfBook = {
  id: string
  title: string
  authors: string[]
  /** `YYYY-MM-DD`, the last time it was finished; null when the file doesn't say. */
  dateRead: string | null
  /** The Spine's colour (`#rrggbb`): its art's average, else its palette's background; null without either. */
  spine: string | null
  /** Page count, which sets a Book's thickness on the shelf; null when unknown. */
  pages: number | null
}

export type Shelf = {
  /** Every Book in the file, newest read first, Books without a read day last. */
  books: ShelfBook[]
  /** When the file was written (ISO 8601). */
  generatedAt: string
}

/** Why there is no shelf: no connection, no answer (or not a 2xx), or not a library file Regal can show. */
export type ShelfError = 'offline' | 'unreachable' | 'invalid'

export type ShelfResult = { data: Shelf; error: null } | { data: null; error: ShelfError }

function shelfBookOf(book: LibraryBook): ShelfBook {
  return {
    id: book.id,
    title: book.title,
    authors: book.authors,
    dateRead: book.dateRead ?? null,
    spine: book.assets?.spineColor ?? book.assets?.palette?.background ?? null,
    pages: book.pages ?? null,
  }
}

/** Newest read first; undated last, by title (Regal's Stack orders them its own way). */
function byDateRead(a: ShelfBook, b: ShelfBook): number {
  if (a.dateRead && b.dateRead) return b.dateRead.localeCompare(a.dateRead) || a.title.localeCompare(b.title)
  if (a.dateRead) return -1
  if (b.dateRead) return 1
  return a.title.localeCompare(b.title)
}

/** A library file's text as a shelf, or why it isn't one (Regal's validator, vendored in export/). */
export function readShelf(text: string): ShelfResult {
  const parsed = parseLibraryFile(text)
  if (!parsed.ok) return { data: null, error: 'invalid' }
  return {
    data: { books: parsed.library.books.map(shelfBookOf).sort(byDateRead), generatedAt: parsed.library.generatedAt },
    error: null,
  }
}

/**
 * The Books finished in a year (by `dateRead`, as Regal's Stack filters a
 * year): what a year in review stacks. Newest first, as the shelf has them.
 */
export function booksReadIn(books: ShelfBook[], year: number): ShelfBook[] {
  const prefix = `${String(year).padStart(4, '0')}-`
  return books.filter((book) => book.dateRead?.startsWith(prefix))
}

export type ShelfSource = {
  /** The library file's URL. */
  src: string
  fetch: typeof globalThis.fetch
  /** Whether there is a connection (`isOnline` in the app): tells a failed fetch offline from unreachable. */
  online: () => boolean
}

export function createShelf({ src, fetch, online }: ShelfSource) {
  return {
    /**
     * Reads the library file. Offline too: the service worker keeps the last one
     * it saw (nuxt.config.ts), so only a fetch that fails is offline.
     */
    async load(): Promise<ShelfResult> {
      let text: string
      try {
        // Credentials stay home: the file is public, and its host allows the app's origin.
        const response = await fetch(src, { credentials: 'omit' })
        if (!response.ok) return { data: null, error: 'unreachable' }
        text = await response.text()
      } catch {
        return { data: null, error: online() ? 'unreachable' : 'offline' }
      }
      return readShelf(text)
    },
  }
}

export type ShelfRepository = ReturnType<typeof createShelf>
