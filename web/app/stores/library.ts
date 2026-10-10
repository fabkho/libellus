import { defineStore } from 'pinia'
import { bookKey, parseBookKey, sourceKeys, type Book, type BookSnapshot } from '~/data/books'
import { probeImageInBrowser, resolveBookCover } from '~/data/covers'
import { forgetLibrary, readDescriptions, readLibrary, saveDescriptions, saveLibrary } from '~/data/deviceLibrary'
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
import { FRESH_MS } from '~/utils/fresh'
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
 * Home and Library ask for the lists when their tab is shown, but not again while what
 * they hold is fresh (`FRESH_MS`, `load({ ifStale })`): a change made on this device is in the
 * lists already, and a change made elsewhere is read at the next visit after the window. A forced
 * `load()` (back online, the outbox drained, an import) never waits for it.
 *
 * The lists leave the description out (`LIST_BOOK_COLUMNS`): it is 65 % of a Book's JSON and only
 * the book page shows it. The device keeps the descriptions of the Books in the Library apart
 * (`descriptions`, `descriptionOf`): filled from the book page, from what an older copy still holds
 * and, once the Library is loaded and the browser idle, by a request for the ones it lacks, so an
 * owned Book's page reads in full offline.
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
  /**
   * What the stores that keep a window of freshness of their own (stores/stats.ts, stores/genres.ts)
   * watch to know a change of hers is not in what they hold yet. `changes` goes up with any change to
   * an entry made on this device (a write, a removal, the outbox drained: `touch`); what another device
   * changed is read at the next visit after the window, as for the lists. `roster` only when entries came or went or one now has another Book (what the genres
   * are keyed by). Plain counters: the reader does not care how far, only that it moved.
   */
  const changes = ref(0)
  const roster = ref(0)
  function touch({ rosterToo = true } = {}) {
    changes.value++
    if (rosterToo) roster.value++
  }
  /** When the lists showing were asked for (`performance.now()`), by the last load that landed. */
  let loadedAt = -Infinity
  /** The load on its way, and the one that follows it for whoever asked meanwhile (`load`). */
  let loading: Promise<void> | null = null
  let following: Promise<void> | null = null

  /**
   * Asks for the three lists and shows them. One at a time: a screen that comes
   * back while a load is on its way (Home, each time a Book page is closed) does
   * not start another; one more load follows the one on its way, for all that
   * asked meanwhile, so every ask is answered by lists asked for after it.
   * Without that each return to Home started its own read of the whole Library,
   * and on a slow connection they piled up faster than they came in: 55 at once
   * after a dozen round-trips with 400 Books (e2e/perf/flight-soak.spec.ts),
   * sharing the bandwidth with the Book page's own reads, whose writes-as-POST
   * then timed out and put the app offline until the pile had drained.
   */
  function load({ ifStale = false }: { ifStale?: boolean } = {}): Promise<void> {
    if (ifStale) {
      // Home and Library asking for a visit: lists that are fresh stand, and a load on its way is the answer.
      if (loading) return loading
      if (loaded.value && !loadError.value && performance.now() - loadedAt < FRESH_MS) return Promise.resolve()
    }
    if (!loading) {
      loading = fetchLists().finally(() => (loading = null))
      return loading
    }
    following ??= loading
      .catch(() => undefined)
      .then(() => {
        following = null
        return load()
      })
    return following
  }

  /**
   * One load. While something moves (the cover flying back into its row, the
   * Profile's View Transition) the answer waits for it to end before it is
   * applied, so re-rendering the lists does not land on a frame of it; the
   * first load is applied at once.
   */
  async function fetchLists(): Promise<void> {
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
    if (lastChange > asked) return fetchLists()
    const failed = results.find((result) => result.error)
    if (failed) {
      loadError.value = failed.error
      return
    }
    if (loaded.value) {
      await afterMotion()
      // Another member meanwhile, or a newer answer already shown.
      if (member !== session.member?.id || asked < loadedAt) return
      if (lastChange > asked) return fetchLists()
    }
    loadError.value = null
    // What the lists on screen know that the new ones do not (a snapshot's description, an older copy's).
    keepDescriptionsOf(STATUSES.flatMap((status) => lists[status]))
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
    fillDescriptions()
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
  /** When the count showing was asked for (`performance.now()`); a count from the device's copy is as good as none. */
  let countedAt = -Infinity

  /** Counts this year's finished sessions (data/library.ts, `readInYear`): one call. */
  async function loadReadInYear({ ifStale = false }: { ifStale?: boolean } = {}) {
    const repo = library()
    if (!repo) return
    const member = session.member?.id
    const year = Number(isoDay().slice(0, 4))
    // A count this fresh stands (a finish on this device asks for a new one itself).
    if (ifStale && readInYear.value !== null && readInYearOf.value === year && performance.now() - countedAt < FRESH_MS) return
    const ask = ++countAsks
    if (!isOnline()) return
    const asked = performance.now()
    const result = await repo.readInYear(year)
    // Another member, or a newer count asked for meanwhile (a finish): that one wins.
    if (member !== session.member?.id || ask !== countAsks) return
    if (result.error) return
    readInYearOf.value = year
    readInYear.value = result.data
    countedAt = asked
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
    const was = entryById(entry.id)
    touch({ rosterToo: !was || was.book.id !== entry.book.id })
    for (const status of STATUSES) lists[status] = lists[status].filter((e) => e.id !== entry.id)
    lists[entry.status] = sortEntries([entry, ...lists[entry.status]])
    remember(entry, { keys })
    keepDescriptionsOf([entry])
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
    touch()
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

  // ----------------------------------------------------------- descriptions

  /**
   * The description of each Book in the Library, by Book id (`''`: it has none). The lists leave it
   * out (`LIST_BOOK_COLUMNS`); the book page reads it from here when its Book has none of its own
   * (`descriptionOf`). Shallow: a Book's text is set once.
   */
  const descriptions = shallowReactive(new Map<string, string>())

  let descriptionsRead = false
  /** The device's descriptions, read the first time something needs them (not at start: it is a few hundred KB to parse). */
  function readDeviceDescriptions() {
    if (descriptionsRead) return
    descriptionsRead = true
    const member = session.member?.id
    if (!import.meta.client || !member) return
    const kept = readDescriptions(window.localStorage, member)
    if (kept) for (const [id, text] of Object.entries(kept)) if (!descriptions.has(id)) descriptions.set(id, text)
  }

  /** The description of a Book as the device knows it, null when it has none or is not known yet. */
  function descriptionOf(book: Pick<Book, 'description'> & { id?: string }): string | null {
    if (book.description) return book.description
    readDeviceDescriptions()
    return (book.id ? descriptions.get(book.id) : undefined) || null
  }

  /** What the database said about a Book's description (null: none), once it did. */
  function rememberDescription(bookId: string, description: string | null | undefined) {
    if (description === undefined) return
    readDeviceDescriptions()
    const text = description ?? ''
    if (descriptions.get(bookId) === text) return
    descriptions.set(bookId, text)
    saveDescriptionsLater()
  }

  /** The descriptions the entries carry (a snapshot's, an older device copy's): kept, not asked for again. */
  function keepDescriptionsOf(entries: readonly LibraryEntry[]) {
    for (const entry of entries) if (entry.book.description) rememberDescription(entry.book.id, entry.book.description)
  }

  let filling = false
  /**
   * Asks, once the browser is idle, for the descriptions of the Library's Catalogue Books that the
   * device does not hold yet: all of them the first time (a few hundred KB, in pieces), then only
   * the ones added since. So an owned Book reads in full offline without the lists carrying them.
   */
  function fillDescriptions() {
    if (filling || !import.meta.client || !isOnline()) return
    filling = true
    const member = session.member?.id
    onIdle(
      async () => {
        try {
          const repo = library()
          if (!repo || member !== session.member?.id) return
          readDeviceDescriptions()
          const missing = STATUSES.flatMap((status) => lists[status])
            .map((entry) => entry.book.id)
            .filter((id) => !descriptions.has(id) && parseBookKey(id)?.kind === 'catalogue')
          if (!missing.length) return
          const result = await repo.descriptions(missing)
          if (result.error || member !== session.member?.id) return
          for (const id of missing) rememberDescription(id, result.data.get(id) ?? null)
        } finally {
          filling = false
        }
      },
      { timeout: 5000, fallback: 2500 },
    )
  }

  let savingDescriptions: (() => void) | null = null
  function saveDescriptionsLater() {
    if (!import.meta.client) return
    savingDescriptions?.()
    savingDescriptions = onIdle(
      () => {
        savingDescriptions = null
        writeDescriptions()
      },
      { timeout: 4000, fallback: 1500 },
    )
  }

  /** The descriptions of the Books she has, now. Only once the Library was loaded (else nothing is known to drop). */
  function writeDescriptions() {
    const member = session.member
    if (!import.meta.client || !member || !loaded.value) return
    const have = new Set(STATUSES.flatMap((status) => lists[status]).map((entry) => entry.book.id))
    const kept: Record<string, string> = {}
    for (const [id, text] of descriptions) if (have.has(id)) kept[id] = text
    saveDescriptions(window.localStorage, member.id, kept)
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
    if (savingDescriptions) {
      savingDescriptions()
      savingDescriptions = null
      writeDescriptions()
    }
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
    // A copy from before the lists left the description out still has them: kept, so they are not asked for.
    keepDescriptionsOf(STATUSES.flatMap((status) => lists[status]))
    // Last year's tally is no answer to this year's question.
    if (saved.readInYear?.year === readInYearOf.value) readInYear.value = saved.readInYear.count
    loaded.value = true
  }

  function reset() {
    saving?.()
    saving = null
    savingDescriptions?.()
    savingDescriptions = null
    descriptions.clear()
    descriptionsRead = false
    loadedAt = -Infinity
    countedAt = -Infinity
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
    changes,
    roster,
    touch,
    rebase,
    entryById,
    entryForBook,
    readInYear,
    readInYearOf,
    loadReadInYear,
    descriptionOf,
    rememberDescription,
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
