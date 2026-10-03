import { defineStore } from 'pinia'
import { bookKey, type BookSnapshot } from '~/data/books'
import { createLibrary, type LibraryEntry } from '~/data/library'
import { createSearch, isAbort, MIN_QUERY_LENGTH, SEARCH_DEBOUNCE_MS, type Search } from '~/data/search'

/** One result: the Book a source found, and the member's entry for it if it is in the Library. */
export type SearchHit = { key: string; book: BookSnapshot; entry: LibraryEntry | null }

/**
 * idle: nothing to search yet (the query is too short) · loading: a query is
 * waiting out the debounce or in flight · done: the results match the query ·
 * failed: no source answered.
 */
export type SearchPhase = 'idle' | 'loading' | 'done' | 'failed'

/**
 * The search overlay's view state. Search never navigates (issue #1, Screens
 * and navigation): the Search tab — or the search prompt on an empty Home —
 * opens a palette over the current page, which stays where it is behind it.
 *
 * Typing runs the query after a short pause (SEARCH_DEBOUNCE_MS) once it is
 * long enough (MIN_QUERY_LENGTH). A newer query aborts the one in flight, and
 * results only ever land for the query they were asked for, so an outdated
 * answer can never overwrite a newer one. Where results come from is the
 * repository's business; the member sees one list.
 */
export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false)
  const query = ref('')
  // Taken while the store is set up (inside Nuxt's context), not later in a timer.
  const backend = useBackend()

  const hits = ref<SearchHit[]>([])
  const phase = ref<SearchPhase>('idle')
  /** The query the shown hits answer. */
  const answered = ref('')

  /** Books seen in results, by page key, so a book page opens without asking again. The last few hundred. */
  const seen = new Map<string, BookSnapshot>()
  const SEEN_LIMIT = 300
  function remember(key: string, book: BookSnapshot) {
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
    })
    return source
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: AbortController | null = null

  function cancel() {
    clearTimeout(timer)
    inFlight?.abort()
    inFlight = null
  }

  async function run(text: string) {
    const controller = new AbortController()
    inFlight = controller
    try {
      const outcome = await repository().search(text, { signal: controller.signal })
      const found = outcome.results.map((book) => ({ key: bookKey(book), book, entry: null as LibraryEntry | null }))

      // Which of them the member already has (shown instead of the + button),
      // and which are in the Catalogue already: those bring their resolved
      // thumbhash and colours, so their rows have the blur while loading.
      const appleIds = found.map((hit) => hit.book.appleId).filter((id): id is string => Boolean(id))
      if (backend && appleIds.length) {
        const library = createLibrary(backend)
        const [statuses, catalogued] = await Promise.all([
          library.statusesByAppleId(appleIds),
          library.catalogueByAppleId(appleIds),
        ])
        if (controller.signal.aborted) return
        for (const hit of found) {
          const appleId = hit.book.appleId!
          hit.entry = statuses.data?.get(appleId) ?? null
          const book = catalogued.data?.get(appleId)
          if (book) hit.book = { ...hit.book, coverThumbhash: book.coverThumbhash, coverColors: book.coverColors }
        }
      }
      for (const hit of found) remember(hit.key, hit.book)

      if (controller.signal.aborted) return
      hits.value = found
      answered.value = text
      phase.value = outcome.failed ? 'failed' : 'done'
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return
      hits.value = []
      answered.value = text
      phase.value = 'failed'
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
  }

  /** Cancel, a tap on the page behind, a swipe down, Escape, or leaving the page. */
  function close() {
    isOpen.value = false
    query.value = ''
  }

  /** A Book that appeared in results, for its page (`/book/<key>`). */
  function seenBook(key: string): BookSnapshot | null {
    return seen.get(key) ?? null
  }

  /** After an add, the hit shows its status instead of the + button. */
  function markAdded(entry: LibraryEntry) {
    for (const hit of hits.value) {
      if (
        (hit.book.appleId && hit.book.appleId === entry.book.appleId) ||
        (hit.book.isbn13 && hit.book.isbn13 === entry.book.isbn13)
      ) {
        hit.entry = entry
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
  }

  return { isOpen, query, hits, phase, answered, open, close, seenBook, markAdded, reset, repository }
})
