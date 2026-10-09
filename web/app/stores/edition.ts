import { defineStore } from 'pinia'
import { formatOf, type Book, type BookFormat, type BookSnapshot } from '~/data/books'
import { createCatalogueSearch } from '~/data/catalogueSearch'
import { createEditions, type EditionCandidate, type Editions } from '~/data/editions'
import { isAbort } from '~/data/fetching'
import { probeImageInBrowser, resolveOwnCover } from '~/data/covers'
import type { LibraryEntry, LibraryErrorCode, Result } from '~/data/library'
import { editionKeys } from '~/data/merge'
import { useBookStore } from '~/stores/book'
import { useCollectionsStore } from '~/stores/collections'
import { useLibraryStore } from '~/stores/library'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'

/** A candidate's identity when picked: its first edition key (a Catalogue id, an ISBN-13, a source id). */
export function candidateKey(book: Book | BookSnapshot): string {
  return editionKeys(book)[0] ?? book.title
}

/**
 * The Change edition sheet (issue #41): the entry it is about, the editions it
 * can change to as they arrive (data/editions.ts), the one the member picked,
 * and the change itself. The list opens with the current edition picked; the
 * sheet's action changes to another. A Book entering the Catalogue gets its
 * Cover resolved first, as on add; one call does the rest
 * (data/library.ts, `changeEdition`). On success the Library, the book pages,
 * search and the Collections learn the entry's new Book without a reload.
 */
export const useEditionStore = defineStore('edition', () => {
  const backend = useBackend()
  const library = useLibraryStore()
  const books = useBookStore()
  const collections = useCollectionsStore()
  const session = useSessionStore()
  const search = useSearchStore()

  let source: Editions | null = null
  function repository(): Editions {
    source ??= createEditions({
      fetch: (url, init) => fetch(url, init),
      languages: import.meta.client ? (navigator.languages ?? [navigator.language]) : [],
      catalogue: backend ? createCatalogueSearch(backend) : undefined,
    })
    return source
  }

  /** The entry the sheet is about; null while it is closed. */
  const changing = ref<LibraryEntry | null>(null)
  /**
   * The sheet opened on a Book that is not in her Library (the page `page`, by its key): she
   * looks at its editions and picks one to see. Nothing is written; `viewing` holds the pick.
   * Never set together with `changing`.
   */
  const browsing = ref<{ page: string; book: Book | BookSnapshot } | null>(null)
  /**
   * The edition a Book page that is not in her Library shows in place of its own: local view
   * state, the page's (it asks `viewOf`) and gone with it (`stopViewing`). Not an entry, not in
   * the Catalogue, not in the outbox.
   */
  const viewing = ref<{ page: string; book: Book | BookSnapshot } | null>(null)
  /** Whether the sheet is open, for an entry or for a Book to look at. */
  const active = computed(() => changing.value !== null || browsing.value !== null)
  /** The Book the editions are looked up for: the entry's, or the one being looked at. */
  const subject = computed(() => changing.value?.book ?? browsing.value?.book ?? null)
  const candidates = ref<EditionCandidate[]>([])
  /** Some source has not answered yet. */
  const pending = ref(false)
  /** Every source failed: only the current edition is known. */
  const failed = ref(false)
  /** The picked candidate's key; the current edition's while nothing else is picked. */
  const picked = ref<string | null>(null)
  const busy = ref(false)
  const error = ref<LibraryErrorCode | null>(null)
  /**
   * The format she says the picked edition is (hardcover, paperback, ebook,
   * audiobook); null while she has not said, and then the edition's own shows
   * (`shownFormat`). Picking another edition forgets it.
   */
  const format = ref<BookFormat | null>(null)
  /**
   * The last change: the Book the entry had, and the entry with its new one.
   * Set in the same tick as the Library learns it, so a book page showing the
   * old Book follows its entry in that same render (no frame of the old Book
   * shown as not in the Library) and animates the change (#61).
   */
  const moved = ref<{ from: string; to: LibraryEntry } | null>(null)

  let inFlight: AbortController | null = null

  function cancel() {
    inFlight?.abort()
    inFlight = null
  }

  /** Asks every source for the entry's editions; the list grows as they answer. */
  async function look() {
    const book = subject.value
    if (!book) return
    cancel()
    const controller = new AbortController()
    inFlight = controller
    pending.value = true
    failed.value = false
    try {
      const outcome = await repository().find(book, {
        signal: controller.signal,
        onUpdate: (update) => {
          candidates.value = update.candidates
          pending.value = update.pending
          failed.value = update.failed
        },
      })
      candidates.value = outcome.candidates
      failed.value = outcome.failed
    } catch (thrown) {
      if (isAbort(thrown)) return
      failed.value = true
    } finally {
      if (inFlight === controller) {
        inFlight = null
        pending.value = false
      }
    }
  }

  function open(entry: LibraryEntry) {
    browsing.value = null
    changing.value = entry
    start(entry.book)
  }

  /**
   * The same sheet for a Book that is not in her Library (page `page`): the same list of
   * editions, the shown one first, marked and picked. Picking another and confirming changes
   * what the page shows (`viewing`) and nothing else.
   */
  function browse(page: string, book: Book | BookSnapshot) {
    changing.value = null
    browsing.value = { page, book }
    start(book)
  }

  function start(book: Book | BookSnapshot) {
    candidates.value = [{ book, current: true }]
    picked.value = candidateKey(book)
    error.value = null
    format.value = null
    void look()
  }

  function close() {
    if (busy.value) return
    cancel()
    changing.value = null
    browsing.value = null
  }

  /** The edition page `page` shows in place of its own, if she picked one there. */
  function viewOf(page: string): Book | BookSnapshot | null {
    return viewing.value?.page === page ? viewing.value.book : null
  }

  /** The page is left (or shows another Book): it shows its own edition again. */
  function stopViewing() {
    viewing.value = null
  }

  function pick(candidate: EditionCandidate) {
    if (busy.value) return
    if (!isPicked(candidate.book)) format.value = null
    picked.value = candidateKey(candidate.book)
    error.value = null
  }

  /**
   * Whether a Book is the picked one. A row keeps its place while a slower
   * source fills in its details (data/editions.ts, `appendEditions`), which can
   * add a key in front of the one it was picked by (an ISBN-13 before an Apple
   * id): the pick follows any of the row's keys.
   */
  function isPicked(book: Book | BookSnapshot): boolean {
    return picked.value !== null && editionKeys(book).includes(picked.value)
  }

  /** The picked candidate, unless it is the edition the entry has. */
  const choice = computed(() => {
    const found = candidates.value.find((candidate) => isPicked(candidate.book))
    return found && !found.current ? found : null
  })

  /**
   * The format the picked edition is, as the sheet shows it: what she said
   * here, else her word on her own edition (the current one), else what its
   * source said (`formatOf`). Null when nobody knows.
   */
  const shownFormat = computed<BookFormat | null>(() => {
    if (format.value) return format.value
    const found = candidates.value.find((candidate) => isPicked(candidate.book))
    if (!found) return null
    return formatOf(found.book, found.current ? changing.value?.formatOverride : null)
  })

  /** She said another format for the edition she has: the sheet's action saves it. */
  const formatChanged = computed(() => {
    const entry = changing.value
    if (!entry || choice.value || !format.value) return false
    return format.value !== formatOf(entry.book, entry.formatOverride)
  })

  /**
   * The format she said, when it goes along with what the action does: another
   * format than the picked edition's source said (with another edition picked,
   * it is saved with the change), or than her own edition has (the action
   * saves it). Null when she has said nothing, or what is already so.
   */
  const formatSaid = computed<BookFormat | null>(() => {
    if (!format.value) return null
    const found = choice.value
    if (found) return format.value !== formatOf(found.book) ? format.value : null
    return formatChanged.value ? format.value : null
  })

  function chooseFormat(value: BookFormat) {
    if (busy.value) return
    format.value = value
    error.value = null
  }

  /**
   * Changes the entry to the picked edition, with the format she said for it;
   * or, with her own edition picked, saves the format she said. Returns the
   * entry, or null with `error` set (the sheet stays open to try another).
   */
  async function confirm(): Promise<LibraryEntry | null> {
    const candidate = choice.value
    const looking = browsing.value
    if (looking) {
      // Nothing to write: the page shows the edition she picked, until she leaves it.
      if (!candidate) return null
      viewing.value = { page: looking.page, book: candidate.book }
      cancel()
      browsing.value = null
      return null
    }
    const entry = changing.value
    if (!entry || busy.value || !(candidate || formatChanged.value)) return null
    // What the row said she is changing to is what she gets: her word, else the format the row
    // showed (the database keeps it as hers only where it differs from the Book it finds).
    const changed = candidate ? await changeTo(entry, candidate.book, format.value ?? formatOf(candidate.book)) : await setFormat(entry, format.value)
    if (changed) {
      cancel()
      changing.value = null
    }
    return changed
  }

  /**
   * After the database moved an entry to another Book: the page showing the
   * old one follows it (`moved`), the Library, the book pages, search and the
   * Collections learn it. Null with `error` set when it was refused.
   */
  function afterMove(entry: LibraryEntry, result: Result<LibraryEntry>): LibraryEntry | null {
    if (result.error) {
      error.value = result.error
      return null
    }
    const changed = result.data
    if (changed.book.id === entry.book.id) {
      // The edition it had (found again by its ISBN, say): only her format may have changed.
      library.entryChanged(changed)
      return changed
    }
    moved.value = { from: entry.book.id, to: changed }
    library.editionChanged(changed)
    // The old Book's pages show it as a Book that is not in the Library.
    books.dropEntry(changed.id)
    collections.entryChanged(changed)
    return changed
  }

  async function busyWith(work: () => Promise<LibraryEntry | null>): Promise<LibraryEntry | null> {
    if (busy.value) return null
    busy.value = true
    error.value = null
    try {
      return await work()
    } finally {
      busy.value = false
    }
  }

  /** Her word on the format of the edition the entry has (null: the Book's own). */
  async function setFormat(entry: LibraryEntry, value: BookFormat | null): Promise<LibraryEntry | null> {
    const repo = library.library()
    if (!repo) return null
    return busyWith(async () => {
      const result = await repo.setFormat(entry.id, value)
      if (result.error) {
        error.value = result.error
        return null
      }
      library.entryChanged(result.data)
      return result.data
    })
  }

  /**
   * "My edition isn't listed", no source knowing it: makes her own edition
   * (data/ownEdition.ts) and moves the entry to it. Its Cover is the image she
   * gave, else what her ISBN has at Apple or OpenLibrary (`resolveOwnCover`).
   */
  async function useOwn(entry: LibraryEntry, book: BookSnapshot): Promise<LibraryEntry | null> {
    const repo = library.library()
    if (!repo) return null
    return busyWith(async () => {
      const cover = await resolveOwnCover(book, {
        probe: probeImageInBrowser,
        lookupAppleIsbn: (isbn13) => search.repository().lookupAppleIsbn(isbn13),
      })
      return afterMove(entry, await repo.useOwnEdition(entry.id, { ...book, ...cover }))
    })
  }

  /**
   * Changes an entry to another edition, from this sheet or from elsewhere
   * (an ebook file linked to the edition found for it, #131). Returns the entry
   * with its new Book, or null with `error` set.
   */
  async function changeTo(entry: LibraryEntry, book: Book | BookSnapshot, withFormat?: BookFormat | null): Promise<LibraryEntry | null> {
    const repo = library.library()
    if (!repo) return null
    return busyWith(async () => afterMove(entry, await repo.changeEdition(entry.id, await library.withCover(book), withFormat)))
  }

  function reset() {
    cancel()
    changing.value = null
    browsing.value = null
    viewing.value = null
    candidates.value = []
    picked.value = null
    error.value = null
    format.value = null
    moved.value = null
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return {
    changing,
    browsing,
    viewing,
    active,
    subject,
    candidates,
    pending,
    failed,
    picked,
    busy,
    error,
    moved,
    choice,
    format,
    shownFormat,
    formatChanged,
    formatSaid,
    isPicked,
    open,
    browse,
    viewOf,
    stopViewing,
    close,
    pick,
    chooseFormat,
    look,
    confirm,
    changeTo,
    setFormat,
    useOwn,
    reset,
  }
})
