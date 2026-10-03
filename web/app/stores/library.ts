import { defineStore } from 'pinia'
import { bookKey, type Book, type BookSnapshot } from '~/data/books'
import { probeImageInBrowser, resolveBookCover } from '~/data/covers'
import {
  addWithFromDraft,
  checkAddDraft,
  createLibrary,
  isNotFinished,
  newAddDraft,
  sortEntries,
  type AddDraft,
  type EntryStatus,
  type Library,
  type LibraryEntry,
  type LibraryErrorCode,
} from '~/data/library'
import { isoDay } from '~/utils/dates'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'

/**
 * The statuses the Add sheets offer, in the order they are listed: a Book can
 * be added Want to read, Currently reading (with its start date) or Finished
 * (with its dates, Rating and review), and the entry gets its first read in
 * the same call.
 */
export const ADDABLE_STATUSES: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']

/**
 * The member's Library as the screens show it, and the Add sheet. The three
 * Status lists load together when a screen asks and refresh in the background
 * when it comes back; an add, a start, a finish, an abandon or a read again moves the entry into its
 * new list at once (`entryChanged`). Signing out (or another member signing
 * in) forgets all of it.
 */
export const useLibraryStore = defineStore('library', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const search = useSearchStore()

  let repository: Library | null = null
  function library(): Library | null {
    if (!backend) return null
    repository ??= createLibrary(backend)
    return repository
  }

  // ------------------------------------------------------------ the lists

  /** Each Status's entries, newest first by the list's own day (data/library.ts, `entries`). */
  const lists = reactive<Record<EntryStatus, LibraryEntry[]>>({ want_to_read: [], reading: [], finished: [] })
  const wantToRead = computed(() => lists.want_to_read)
  const reading = computed(() => lists.reading)
  const finished = computed(() => lists.finished)
  /**
   * *Not finished*, a filter of Finished: the entries whose latest session was
   * abandoned, in Finished's order. Derived from the list, so it moves with
   * every start, finish, abandon and read again like the lists do.
   */
  const notFinished = computed(() => lists.finished.filter(isNotFinished))
  /** Whether the lists have been loaded once (the empty state waits for it). */
  const loaded = ref(false)
  const loadError = ref<LibraryErrorCode | null>(null)

  const STATUSES: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']

  /** When this device last changed the Library (`performance.now()`): reads asked for before it are stale. */
  let lastChange = -Infinity

  async function load() {
    const repo = library()
    if (!repo) return
    const member = session.member?.id
    const asked = performance.now()
    const results = await Promise.all(STATUSES.map((status) => repo.entries(status)))
    if (member !== session.member?.id) return
    // An add, start or finish landed while the lists were on their way: they
    // may not have it yet, so ask again rather than show the older state.
    if (lastChange > asked) return load()
    const failed = results.find((result) => result.error)
    if (failed) {
      loadError.value = failed.error
      return
    }
    loadError.value = null
    STATUSES.forEach((status, i) => (lists[status] = results[i]!.data!))
    for (const entry of STATUSES.flatMap((status) => lists[status])) remember(entry)
    loaded.value = true
  }

  /**
   * The member's entries as this device last saw them, by the page keys of
   * their Books (the book store prefers them over a page loaded earlier).
   */
  const entryByKey = reactive(new Map<string, LibraryEntry>())

  /**
   * The newest known state of an entry, from a read (`asked`: when that read
   * was asked for; dropped if this device changed the Library since) or from a
   * change made here.
   */
  function remember(entry: LibraryEntry, { keys = [], asked }: { keys?: string[]; asked?: number } = {}) {
    if (asked !== undefined && lastChange > asked) return
    for (const [key, known] of entryByKey) if (known.id === entry.id) entryByKey.set(key, entry)
    for (const key of [entry.book.id, ...keys]) entryByKey.set(key, entry)
  }

  /**
   * An entry changed on this device (added, started, finished): it moves to
   * its Status's list in its place, the book pages that show it and search's
   * results learn its new state, without a reload.
   */
  function entryChanged(entry: LibraryEntry, ...keys: string[]) {
    lastChange = performance.now()
    for (const status of STATUSES) lists[status] = lists[status].filter((e) => e.id !== entry.id)
    lists[entry.status] = sortEntries([entry, ...lists[entry.status]])
    remember(entry, { keys })
    search.markAdded(entry)
  }

  // ---------------------------------------------------------------- Add sheet

  /** The Book the Add sheet is about; null while it is closed. */
  const adding = ref<BookSnapshot | Book | null>(null)
  /** The Status and first read the member is adding the Book with (`AddDraft`). */
  const addDraft = reactive<AddDraft>(newAddDraft())
  const addBusy = ref(false)
  const addError = ref<LibraryErrorCode | null>(null)

  // A change of mind is a new try: the last refusal no longer applies.
  watch(addDraft, () => (addError.value = null))

  function openAdd(book: BookSnapshot | Book) {
    adding.value = book
    Object.assign(addDraft, newAddDraft())
    addError.value = null
  }

  function closeAdd() {
    if (!addBusy.value) adding.value = null
  }

  /**
   * Adds the sheet's Book. A Book that is not in the Catalogue yet gets its
   * Cover resolved first (the first image of the cover chain that will do, with
   * its thumbhash and colours; the Placeholder cover if none will). One
   * database call does the rest (the entry and, for Currently reading and
   * Finished, its first read). Returns the entry, or null with `addError` set.
   */
  async function confirmAdd(): Promise<LibraryEntry | null> {
    const book = adding.value
    const repo = library()
    if (!book || !repo || addBusy.value) return null
    // A day the database would refuse is told before anything is sent (or a cover looked up).
    addError.value = checkAddDraft(addDraft, isoDay())
    if (addError.value) return null
    addBusy.value = true
    try {
      let snapshot: BookSnapshot = { ...book }
      if (!('id' in book)) {
        // Apple artwork → Apple by ISBN → OpenLibrary by cover id or ISBN →
        // the Placeholder cover (data/covers.ts, resolveBookCover).
        const cover = await resolveBookCover(snapshot, {
          probe: probeImageInBrowser,
          lookupAppleIsbn: (isbn13) => search.repository().lookupAppleIsbn(isbn13),
        })
        snapshot = { ...snapshot, ...cover }
      }
      const result = await repo.addToLibrary(snapshot, addWithFromDraft(addDraft))
      if (result.error) {
        addError.value = result.error
        return null
      }
      const entry = result.data
      entryChanged(entry, bookKey(book))
      adding.value = null
      return entry
    } finally {
      addBusy.value = false
    }
  }

  function reset() {
    for (const status of STATUSES) lists[status] = []
    loaded.value = false
    loadError.value = null
    adding.value = null
    addError.value = null
    entryByKey.clear()
    search.reset()
  }

  // Another member, or nobody: nothing of the last one's Library stays.
  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return {
    library,
    lists,
    wantToRead,
    reading,
    finished,
    notFinished,
    loaded,
    loadError,
    load,
    entryByKey,
    remember,
    entryChanged,
    adding,
    addDraft,
    addBusy,
    addError,
    openAdd,
    closeAdd,
    confirmAdd,
    reset,
  }
})
