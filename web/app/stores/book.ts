import { defineStore } from 'pinia'
import { parseBookKey, type Book, type BookSnapshot } from '~/data/books'
import type { LibraryEntry, LibraryErrorCode } from '~/data/library'
import { useLibraryStore } from '~/stores/library'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'

/**
 * loading: nothing to show yet · ready: the Book (and the entry, if any) ·
 * missing: no Book behind this address · error: it could not be asked for.
 */
export type BookPagePhase = 'loading' | 'ready' | 'missing' | 'error'

export type BookPage = {
  phase: BookPagePhase
  /** A Catalogue Book, or what a source said about one that is not in the Catalogue yet. */
  book: Book | BookSnapshot | null
  entry: LibraryEntry | null
  error: LibraryErrorCode | null
}

/**
 * The book pages (`/book/<key>`), by key. A page is asked for as soon as the
 * finger touches its link (UiPressLink), so it is usually ready when the route
 * changes. A search result shows at once from what search already found, then
 * learns whether the Book is in the Catalogue and in the member's Library.
 */
export const useBookStore = defineStore('book', () => {
  const library = useLibraryStore()
  const search = useSearchStore()
  const pages = reactive(new Map<string, BookPage>())
  const loading = new Map<string, Promise<void>>()

  /** The page, with the member's entry from an add made since it loaded. */
  function page(key: string): BookPage | null {
    const found = pages.get(key) ?? null
    const added = library.addedByKey.get(key) ?? (found?.book && 'id' in found.book ? library.addedByKey.get(found.book.id) : undefined)
    if (found && added) return { ...found, phase: 'ready', book: added.book, entry: added }
    return found
  }

  async function resolve(key: string): Promise<BookPage> {
    const parsed = parseBookKey(key)
    const repo = library.library()
    if (!parsed || !repo) return { phase: 'missing', book: null, entry: null, error: null }

    if (parsed.kind === 'catalogue') {
      const [book, entry] = await Promise.all([repo.book(parsed.id), repo.entryForBook(parsed.id)])
      const error = book.error ?? entry.error
      if (error) return { phase: 'error', book: null, entry: null, error }
      return { phase: book.data ? 'ready' : 'missing', book: book.data, entry: entry.data, error: null }
    }

    // A search result: in the Catalogue already (by its ISBN or source id)?
    const seen = search.seenBook(key)
    const catalogued = await repo.catalogueBook({
      appleId: parsed.kind === 'apple' ? parsed.appleId : undefined,
      openLibraryEditionKey: parsed.kind === 'openlibrary' ? parsed.editionKey : undefined,
      isbn13: parsed.kind === 'isbn' ? parsed.isbn13 : (seen?.isbn13 ?? undefined),
    })
    if (catalogued.error) {
      return seen
        ? { phase: 'ready', book: seen, entry: null, error: null }
        : { phase: 'error', book: null, entry: null, error: catalogued.error }
    }
    if (catalogued.data) {
      const entry = await repo.entryForBook(catalogued.data.id)
      return { phase: 'ready', book: catalogued.data, entry: entry.data, error: entry.error }
    }
    if (seen) return { phase: 'ready', book: seen, entry: null, error: null }

    // Opened from a link or after a reload: ask the source again.
    try {
      const source = search.repository()
      const book =
        parsed.kind === 'apple'
          ? await source.lookupApple(parsed.appleId)
          : parsed.kind === 'openlibrary'
            ? await source.lookupOpenLibrary(parsed.editionKey)
            : await source.lookupIsbn(parsed.isbn13)
      return { phase: book ? 'ready' : 'missing', book, entry: null, error: null }
    } catch {
      return { phase: 'error', book: null, entry: null, error: 'unknown' }
    }
  }

  /** Asks for a page (again). Shows what search knew while the rest arrives. */
  function load(key: string): Promise<void> {
    const running = loading.get(key)
    if (running) return running
    if (!pages.has(key)) {
      const seen = search.seenBook(key)
      pages.set(key, { phase: seen ? 'ready' : 'loading', book: seen, entry: null, error: null })
    }
    const task = resolve(key)
      .then((resolved) => {
        // Keep a page that shows something over a failed refresh.
        const current = pages.get(key)
        if (resolved.phase === 'error' && current?.book) return
        pages.set(key, resolved)
      })
      .finally(() => loading.delete(key))
    loading.set(key, task)
    return task
  }

  /** On touch-down: start before the route does, unless it is already there. */
  function prefetch(key: string) {
    if (!pages.has(key)) void load(key)
  }

  function reset() {
    pages.clear()
    loading.clear()
  }

  // The entries on these pages are the member's: another member starts afresh.
  const session = useSessionStore()
  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return { page, load, prefetch, reset }
})
