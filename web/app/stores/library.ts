import { defineStore } from 'pinia'
import { bookKey, type Book, type BookSnapshot } from '~/data/books'
import { probeImageInBrowser, resolveBookCover } from '~/data/covers'
import { forgetLibrary, readLibrary, saveLibrary } from '~/data/deviceLibrary'
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
 *
 * The device keeps a copy (data/deviceLibrary.ts, issue #15): written after
 * every load and change, read back when the store is set up, so the app opens
 * on the last-loaded Library, connection or not. Offline nothing is asked for;
 * the lists refresh by themselves once the connection is back.
 */
export const useLibraryStore = defineStore('library', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const search = useSearchStore()

  let repository: Library | null = null
  function library(): Library | null {
    if (!backend) return null
    // Writes refused offline, before anything is sent (data/library.ts, WriteOptions).
    repository ??= createLibrary(backend, { online: isOnline })
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
    // Offline the device's copy is all there is; asking would only fail. (With
    // no copy it is asked anyway, so the screen can say it did not load.)
    if (!isOnline() && loaded.value) return
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
    save()
  }

  // ---------------------------------------------------------- Read in <year>

  /** Sessions finished in `readInYearOf` (Home); null until counted. */
  const readInYear = ref<number | null>(null)
  /** The calendar year the count is for: the member's current year when it was asked. */
  const readInYearOf = ref(Number(isoDay().slice(0, 4)))

  let countAsks = 0

  /** Counts this year's finished sessions (data/library.ts, `readInYear`): one call. */
  async function loadReadInYear() {
    const repo = library()
    if (!repo) return
    const member = session.member?.id
    const year = Number(isoDay().slice(0, 4))
    const ask = ++countAsks
    if (!isOnline()) return
    const result = await repo.readInYear(year)
    // Another member, or a newer count asked for meanwhile (a finish): that one wins.
    if (member !== session.member?.id || ask !== countAsks) return
    if (result.error) return
    readInYearOf.value = year
    readInYear.value = result.data
    save()
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
    save()
    // A finish adds to the year's count. Only a count Home has shown is kept
    // current; the next visit counts anyway.
    if (entry.status === 'finished' && readInYear.value !== null) void loadReadInYear()
  }

  /**
   * An entry left the Library (removed here): it leaves its list, and the book
   * pages that show it and search's results learn it is gone, without a reload.
   */
  function entryRemoved(entryId: string) {
    lastChange = performance.now()
    for (const status of STATUSES) lists[status] = lists[status].filter((e) => e.id !== entryId)
    for (const [key, known] of entryByKey) if (known.id === entryId) entryByKey.delete(key)
    search.markRemoved(entryId)
    if (readInYear.value !== null) void loadReadInYear()
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

  // ------------------------------------------------------- the device's copy

  /** Writes the Library as it is now, for the next start (data/deviceLibrary.ts). Only once it was loaded. */
  function save() {
    const member = session.member
    if (!import.meta.client || !member || !loaded.value) return
    saveLibrary(window.localStorage, {
      member: { id: member.id, email: member.email },
      lists: { want_to_read: lists.want_to_read, reading: lists.reading, finished: lists.finished },
      readInYear: readInYear.value === null ? null : { year: readInYearOf.value, count: readInYear.value },
    })
  }

  /**
   * Puts back the Library this device saw last, if it is this member's: the
   * screens show it at once (no empty first frame, no network needed) and a
   * load refreshes it behind them.
   */
  function restore() {
    const member = session.member?.id
    if (!import.meta.client || !member || loaded.value) return
    const saved = readLibrary(window.localStorage, member)
    if (!saved) return
    for (const status of STATUSES) lists[status] = saved.lists[status]
    for (const entry of STATUSES.flatMap((status) => lists[status])) remember(entry)
    // Last year's tally is no answer to this year's question.
    if (saved.readInYear?.year === readInYearOf.value) readInYear.value = saved.readInYear.count
    loaded.value = true
  }

  function reset() {
    for (const status of STATUSES) lists[status] = []
    loaded.value = false
    loadError.value = null
    readInYear.value = null
    adding.value = null
    addError.value = null
    entryByKey.clear()
    search.reset()
  }

  // Another member, or nobody: nothing of the last one's Library stays, on
  // the screens or on the device. Signing out here clears the device already;
  // this also covers a session that ended elsewhere.
  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      reset()
      if (before && !now && import.meta.client) forgetLibrary(window.localStorage)
      restore()
    },
  )
  restore()

  // Back online: what changed elsewhere meanwhile shows without a tap.
  const online = useOnline()
  watch(online, (now) => {
    if (now && loaded.value) void load()
  })

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
    readInYear,
    readInYearOf,
    loadReadInYear,
    entryByKey,
    remember,
    entryChanged,
    entryRemoved,
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
