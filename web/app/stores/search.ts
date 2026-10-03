import { defineStore } from 'pinia'
import { bookKey, type Book, type BookSnapshot } from '~/data/books'
import { createCatalogueSearch } from '~/data/catalogueSearch'
import type { LibraryEntry } from '~/data/library'
import { editionKeys, workKey } from '~/data/merge'
import {
  createSearch,
  isAbort,
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  type Search,
  type SearchOutcome,
} from '~/data/search'

/**
 * One result: the Book (a Catalogue Book, or what a source said about one),
 * the member's entry if she has this very Book, and whether she has another
 * edition of it instead.
 */
export type SearchHit = { key: string; book: BookSnapshot | Book; entry: LibraryEntry | null; otherEdition: boolean }

/**
 * idle: nothing to search yet (the query is too short) · loading: a query is
 * waiting out the debounce or some source has not answered yet · done: every
 * source has answered · failed: none could (or the device is offline).
 */
export type SearchPhase = 'idle' | 'loading' | 'done' | 'failed'

/**
 * The search overlay's view state. Search never navigates (issue #1, Screens
 * and navigation): the Search tab — or the search prompt on an empty Home —
 * opens a palette over the current page, which stays where it is behind it.
 *
 * Typing runs the query after a short pause (SEARCH_DEBOUNCE_MS) once it is
 * long enough (MIN_QUERY_LENGTH). The list fills as the sources answer, each
 * answer merged into it; a newer query aborts the one in flight, and results
 * only ever land for the query they were asked for, so an outdated answer can
 * never overwrite a newer one. Where results come from is the repository's
 * business; the member sees one list.
 */
export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false)
  const query = ref('')
  // Taken while the store is set up (inside Nuxt's context), not later in a timer.
  const backend = useBackend()
  const catalogue = backend ? createCatalogueSearch(backend) : null

  const hits = ref<SearchHit[]>([])
  const phase = ref<SearchPhase>('idle')
  /** The query the shown hits answer. */
  const answered = ref('')
  /** The hits shown answer an older query while a newer one is on its way. */
  const outdated = computed(
    () => phase.value === 'loading' && hits.value.length > 0 && answered.value !== query.value.trim(),
  )

  /** Books seen in results, by page key, so a book page opens without asking again. The last few hundred. */
  const seen = new Map<string, BookSnapshot | Book>()
  const SEEN_LIMIT = 300
  function remember(key: string, book: BookSnapshot | Book) {
    seen.delete(key)
    seen.set(key, book)
    if (seen.size > SEEN_LIMIT) seen.delete(seen.keys().next().value!)
  }

  let source: Search | null = null
  /** The search repository, set up for this device's languages (the storefronts follow them). */
  function repository(): Search {
    source ??= createSearch({
      fetch: (url, init) => fetch(url, init),
      languages: import.meta.client ? (navigator.languages ?? [navigator.language]) : [],
      catalogue: catalogue ?? undefined,
    })
    return source
  }

  /**
   * The member's Library as search marks it: read when the search opens (it
   * may have changed since), kept up to date by adds made from here.
   */
  let library: Promise<LibraryEntry[]> | null = null
  function libraryEntries(): Promise<LibraryEntry[]> {
    library ??= catalogue ? catalogue.libraryEntries().catch(() => ((library = null), [])) : Promise.resolve([])
    return library
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: AbortController | null = null

  function cancel() {
    clearTimeout(timer)
    inFlight?.abort()
    inFlight = null
  }

  function show(text: string, outcome: SearchOutcome) {
    hits.value = outcome.results.map(({ book, entry, otherEdition }) => {
      const key = bookKey(book)
      remember(key, book)
      return { key, book, entry, otherEdition }
    })
    answered.value = text
    phase.value = outcome.pending ? 'loading' : outcome.failed ? 'failed' : 'done'
  }

  async function run(text: string) {
    // Offline nothing can answer: say so at once instead of waiting for every source to fail.
    if (import.meta.client && navigator.onLine === false) {
      show(text, { results: [], pending: false, failed: true })
      return
    }
    const controller = new AbortController()
    inFlight = controller
    try {
      const outcome = await repository().search(text, {
        signal: controller.signal,
        library: libraryEntries(),
        // A source's answer shows as soon as there is something to show; an
        // older list stays (dimmed) until then.
        onUpdate: (update) => {
          if (!controller.signal.aborted && (update.results.length || !update.pending)) show(text, update)
        },
      })
      if (!controller.signal.aborted) show(text, outcome)
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return
      show(text, { results: [], pending: false, failed: true })
    } finally {
      if (inFlight === controller) inFlight = null
    }
  }

  watch(query, (value) => {
    cancel()
    const text = value.trim()
    if (text.length < MIN_QUERY_LENGTH) {
      hits.value = []
      answered.value = ''
      phase.value = 'idle'
      return
    }
    phase.value = 'loading'
    timer = setTimeout(() => run(text), SEARCH_DEBOUNCE_MS)
  })

  function open() {
    isOpen.value = true
    library = null
    void libraryEntries()
  }

  /** Cancel, a tap on the page behind, a swipe down, Escape, or leaving the page. */
  function close() {
    isOpen.value = false
    query.value = ''
  }

  /** A Book that appeared in results, for its page (`/book/<key>`). */
  function seenBook(key: string): BookSnapshot | Book | null {
    return seen.get(key) ?? null
  }

  /** After an add, the hit shows its status instead of the +, and its other editions say she has one. */
  function markAdded(entry: LibraryEntry) {
    // Not read yet: the next read finds the entry in the database anyway.
    if (library) library = library.then((entries) => [entry, ...entries.filter((e) => e.id !== entry.id)])
    const added = new Set(editionKeys(entry.book))
    const work = workKey(entry.book)
    for (const hit of hits.value) {
      if (editionKeys(hit.book).some((key) => added.has(key))) {
        hit.entry = entry
        hit.otherEdition = false
      } else if (!hit.entry && workKey(hit.book) === work) {
        hit.otherEdition = true
      }
    }
  }

  /** Signing out forgets what was searched. */
  function reset() {
    cancel()
    close()
    hits.value = []
    answered.value = ''
    phase.value = 'idle'
    seen.clear()
    library = null
  }

  return { isOpen, query, hits, phase, answered, outdated, open, close, seenBook, markAdded, reset, repository }
})
