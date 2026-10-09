import { defineStore } from 'pinia'
import { bookKey, sourceKeys, type Book, type BookSnapshot } from '~/data/books'
import { probeImageInBrowser, resolveBookCover } from '~/data/covers'
import { forgetLibrary, readLibrary, saveLibrary } from '~/data/deviceLibrary'
import {
  addWithFromDraft,
  checkAddDraft,
  createLibrary,
  newAddDraft,
  sortEntries,
  type AddDraft,
  type EntryStatus,
  type Library,
  type LibraryEntry,
  type LibraryErrorCode,
} from '~/data/library'
import { applyWrites } from '~/data/queuedWrites'
import { reuseEntries } from '~/data/reuseEntries'
import type { ReadAs } from '~/data/readAs'
import { isoDay } from '~/utils/dates'
import { onIdle } from '~/utils/idle'
import { afterMotion } from '~/utils/motion'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'
import { useSyncStore } from '~/stores/sync'

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
 *
 * Offline the changes still happen (issue #93): they wait in the outbox
 * (stores/sync.ts) and the entry moves as if the database had answered. Every
 * load lays the writes still waiting over what the database returned
 * (`applyWrites`), so a refresh never shows a change undone that is only not
 * synced yet; once a write is refused, the next load is what undoes it.
 */
export const useLibraryStore = defineStore('library', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const search = useSearchStore()
  const sync = useSyncStore()

  let repository: Library | null = null
  function library(): Library | null {
    if (!backend) return null
    // Offline the writes that can wait go into the outbox; the others are refused
    // before anything is sent (data/library.ts, WriteOptions).
    repository ??= createLibrary(backend, { online: isOnline, queue: sync.queue })
    return repository
  }

  // ------------------------------------------------------------ the lists

  /**
   * Each Status's entries, newest first by the list's own day (data/library.ts, `entries`).
   * Shallow: a list is replaced, never changed in place, and so is an entry, so the
   * entries stay plain objects (no proxy for each of a few hundred Books and their
   * fields) and a refresh keeps the ones that did not change (`reuseEntries`).
   */
  const lists = shallowReactive<Record<EntryStatus, LibraryEntry[]>>({ want_to_read: [], reading: [], finished: [] })
  const wantToRead = computed(() => lists.want_to_read)
  const reading = computed(() => lists.reading)
  const finished = computed(() => lists.finished)
  /** Whether the lists have been loaded once (the empty state waits for it). */
  const loaded = ref(false)
  const loadError = ref<LibraryErrorCode | null>(null)

  const STATUSES: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']

  /** When this device last changed the Library (`performance.now()`): reads asked for before it are stale. */
  let lastChange = -Infinity
  /** When the lists showing were asked for (`performance.now()`), by the last load that landed. */
  let loadedAt = -Infinity

  /**
   * Asks for the three lists and shows them. While something moves (the cover
   * flying back into its row, the Profile's View Transition) the answer waits
   * for it to end before it is applied, so re-rendering the lists does not
   * land on a frame of it; the first load is applied at once.
   */
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
    if (loaded.value) {
      await afterMotion()
      // Another member meanwhile, or a newer answer already shown.
      if (member !== session.member?.id || asked < loadedAt) return
      if (lastChange > asked) return load()
    }
    loadError.value = null
    // The writes still waiting, laid over what the database has (issue #93).
    const merged = applyWrites(
      { want_to_read: results[0]!.data!, reading: results[1]!.data!, finished: results[2]!.data! },
      sync.items,
    )
    // What did not change stays the object it was, and a list that did not change the
    // list it was: the screens re-render only what changed, nothing on most refreshes.
    let changed = !loaded.value
    const before = STATUSES.flatMap((status) => lists[status])
    for (const status of STATUSES) {
      const next = reuseEntries(lists[status], merged[status])
      if (next === lists[status]) continue
      lists[status] = next
      changed = true
    }
    if (changed) reconcile(before)
    for (const entry of STATUSES.flatMap((status) => lists[status])) if (entryByKey.get(entry.book.id) !== entry) remember(entry)
    loaded.value = true
    loadedAt = asked
    if (changed) save()
  }

  /**
   * After a read replaced the lists: what the screens learned from the entries that are gone
   * (a write the database refused, an add whose entry now has the database's id) they learn
   * again. The pages and search's results forget a gone entry; one that took its place
   * (the same Book, now with the database's ids) is what they show from here, under the page
   * key the other one was reached by. So a refused add leaves no mark on its result, no page
   * keeping an entry that is not there, and a synced one is the entry the database has.
   */
  function reconcile(before: LibraryEntry[]) {
    const now = STATUSES.flatMap((status) => lists[status])
    const ids = new Set(now.map((entry) => entry.id))
    const gone = before.filter((entry) => !ids.has(entry.id))
    if (!gone.length) return
    const known = new Set(before.map((entry) => entry.id))
    const arrived = now.filter((entry) => !known.has(entry.id))
    for (const entry of gone) {
      const keys = [...entryByKey].filter(([, held]) => held.id === entry.id).map(([key]) => key)
      for (const key of keys) entryByKey.delete(key)
      search.markRemoved(entry.id)
      const successor = arrived.find((next) => keys.some((key) => key === next.book.id || sourceKeys(next.book).includes(key)))
      if (successor) remember(successor, { keys })
    }
    for (const entry of arrived) search.markAdded(entry)
  }

  /**
   * The writes waiting in the outbox laid over the lists as they are (issue #93):
   * once the outbox has been read, for a copy the device saved before a write that
   * waited (the app closed in between). Writes the lists show already change nothing.
   */
  function rebase() {
    if (!loaded.value || !sync.items.length) return
    const merged = applyWrites({ want_to_read: lists.want_to_read, reading: lists.reading, finished: lists.finished }, sync.items)
    if (STATUSES.every((status) => merged[status] === lists[status])) return
    for (const status of STATUSES) lists[status] = merged[status]
    for (const entry of STATUSES.flatMap((status) => lists[status])) remember(entry)
    save()
  }

  /** One of the member's entries as the device shows it (the outbox answers from it). */
  function entryById(entryId: string): LibraryEntry | null {
    for (const status of STATUSES) {
      const found = lists[status].find((entry) => entry.id === entryId)
      if (found) return found
    }
    return null
  }

  /**
   * The member's entry for a Book as the device shows it: by the Catalogue id, or by a page key
   * (an entry added from a search result shows under its page key until the database answers).
   */
  function entryForBook(bookId: string): LibraryEntry | null {
    for (const status of STATUSES) {
      const found = lists[status].find((entry) => entry.book.id === bookId || sourceKeys(entry.book).includes(bookId))
      if (found) return found
    }
    return null
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
  const entryByKey = shallowReactive(new Map<string, LibraryEntry>())

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
   * An entry now points at another edition (issue #41, changed here): the keys
   * of the old Book's pages forget it (that Book is not in the Library any
   * more; the entry is under its new Book's key), search's results learn which
   * edition she has, and it takes its place in its list as `entryChanged` does.
   */
  function editionChanged(entry: LibraryEntry) {
    for (const [key, known] of entryByKey) if (known.id === entry.id) entryByKey.delete(key)
    search.markRemoved(entry.id)
    entryChanged(entry)
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
    save()
    if (readInYear.value !== null) void loadReadInYear()
  }

  // ---------------------------------------------------------------- Read as

  /**
   * Says how the member read the entry (issue #169); null takes her word back, the
   * edition's format is the default again. Needs the connection (the repository refuses
   * it offline). Only her word is taken from the answer: a finish or a start still
   * waiting in the outbox is not in the database's entry yet, and the device's own copy
   * must not go back to before it. Returns the entry, or null with the code.
   */
  async function setReadAs(entry: LibraryEntry, readAs: ReadAs | null): Promise<{ entry: LibraryEntry } | { error: LibraryErrorCode }> {
    const repo = library()
    if (!repo) return { error: 'unknown' }
    const result = await repo.setReadAs(entry.id, readAs)
    if (result.error) return { error: result.error }
    const changed = { ...(entryById(entry.id) ?? entry), readAs: result.data.readAs ?? null }
    entryChanged(changed)
    return { entry: changed }
  }

  /**
   * Hides the entry from her followers, or shows it again (social v1). Waits in the outbox
   * offline, so it does not need the connection. Returns the entry, or null with the code.
   */
  async function setHidden(entry: LibraryEntry, hidden: boolean): Promise<{ entry: LibraryEntry } | { error: LibraryErrorCode }> {
    const repo = library()
    if (!repo) return { error: 'unknown' }
    const result = await repo.setHidden(entry.id, hidden)
    if (result.error) return { error: result.error }
    const changed = { ...(entryById(entry.id) ?? entry), hidden: result.data.hidden ?? hidden }
    entryChanged(changed)
    return { entry: changed }
  }

  // ---------------------------------------------------------------- Add sheet

  /** The Book the Add sheet is about; null while it is closed. */
  const adding = ref<BookSnapshot | Book | null>(null)
  /** The Status and first read the member is adding the Book with (`AddDraft`). */
  const addDraft = reactive<AddDraft>(newAddDraft())
  const addBusy = ref(false)
  const addError = ref<LibraryErrorCode | null>(null)
  /** The sheet was opened from search's results: confirming shows the entry at once and the outbox sends it (`confirmAdd`). */
  let addOptimistic = false

  // A change of mind is a new try: the last refusal no longer applies.
  watch(addDraft, () => (addError.value = null))

  /**
   * Opens the Add sheet for a Book. `optimistic` (the search palette's +): confirming does not
   * wait for the network, see `confirmAdd`.
   */
  function openAdd(book: BookSnapshot | Book, { optimistic = false }: { optimistic?: boolean } = {}) {
    addOptimistic = optimistic
    adding.value = book
    Object.assign(addDraft, newAddDraft())
    addError.value = null
  }

  function closeAdd() {
    if (!addBusy.value) adding.value = null
  }

  /**
   * A Book about to enter the Catalogue (an add, a new edition) gets its Cover
   * resolved first, once: Apple artwork → Apple by ISBN → OpenLibrary by cover
   * id or ISBN → the Placeholder cover (data/covers.ts, resolveBookCover), with
   * its thumbhash and colours. A Catalogue Book keeps the Cover it has.
   */
  async function withCover(book: BookSnapshot | Book): Promise<BookSnapshot> {
    if ('id' in book) return { ...book }
    const cover = await resolveBookCover(book, {
      probe: probeImageInBrowser,
      lookupAppleIsbn: (isbn13) => search.repository().lookupAppleIsbn(isbn13),
    })
    return { ...book, ...cover }
  }

  /**
   * Adds the sheet's Book. A Book that is not in the Catalogue yet gets its
   * Cover resolved first (the first image of the cover chain that will do, with
   * its thumbhash and colours; the Placeholder cover if none will). One
   * database call does the rest (the entry and, for Currently reading and
   * Finished, its first read). Returns the entry, or null with `addError` set.
   *
   * From search's results (`openAdd`, `optimistic`) none of that is waited for: the add goes
   * into the outbox like an offline write (data/library.ts, `AddHow`), the entry is in its list,
   * the result's mark has flipped and the sheet is shut as soon as it is there, and the outbox
   * sends it (resolving the Cover first) right away. What the database refuses comes back as a
   * failure in the sync sheet and the entry goes away again (`reconcile`).
   */
  async function confirmAdd(): Promise<LibraryEntry | null> {
    const book = adding.value
    const repo = library()
    if (!book || !repo || addBusy.value) return null
    // A day the database would refuse is told before anything is sent (or a cover looked up).
    addError.value = checkAddDraft(addDraft, isoDay())
    if (addError.value) return null
    // Only while there is a line to write into (somebody signed in): else it asks the database as before.
    const optimistic = addOptimistic && sync.queue.open()
    addBusy.value = true
    try {
      const result = await repo.addToLibrary(
        optimistic ? { ...book } : await withCover(book),
        addWithFromDraft(addDraft),
        { optimistic },
      )
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

  /** Cancels the write waiting for an idle moment, if there is one. */
  let saving: (() => void) | null = null

  /**
   * Writes the Library for the next start (data/deviceLibrary.ts) once the
   * browser is idle: the copy is a few hundred KB of JSON, too long a write for
   * the frame a change or a load lands in. The page going away writes it at once.
   */
  function save() {
    if (!import.meta.client) return
    saving?.()
    saving = onIdle(
      () => {
        saving = null
        write()
      },
      { timeout: 2000, fallback: 500 },
    )
  }

  /** The waiting write, now (the page is hidden or going away). */
  function flushSave() {
    if (!saving) return
    saving()
    saving = null
    write()
  }

  /** Writes the Library as it is now. Only once it was loaded. */
  function write() {
    const member = session.member
    if (!import.meta.client || !member || !loaded.value) return
    saveLibrary(window.localStorage, {
      member: member.name ? { id: member.id, email: member.email, name: member.name } : { id: member.id, email: member.email },
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
    saving?.()
    saving = null
    loadedAt = -Infinity
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

  // The device's copy waiting for an idle moment is written before the app is put away.
  if (import.meta.client) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSave()
    })
    window.addEventListener('pagehide', flushSave)
  }

  return {
    library,
    lists,
    wantToRead,
    reading,
    finished,
    loaded,
    loadError,
    load,
    rebase,
    entryById,
    entryForBook,
    readInYear,
    readInYearOf,
    loadReadInYear,
    entryByKey,
    remember,
    entryChanged,
    editionChanged,
    entryRemoved,
    setReadAs,
    setHidden,
    withCover,
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
