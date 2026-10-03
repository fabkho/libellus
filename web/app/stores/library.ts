import { defineStore } from 'pinia'
import { bookKey, type Book, type BookSnapshot } from '~/data/books'
import { probeImageInBrowser, resolveBookCover } from '~/data/covers'
import { createLibrary, type EntryStatus, type Library, type LibraryEntry, type LibraryErrorCode } from '~/data/library'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'

/**
 * The statuses the Add sheet offers. Only *Want to read* in #6; #9 adds
 * Currently reading and Finished with their dates, here and in the sheet.
 */
export const ADDABLE_STATUSES: readonly EntryStatus[] = ['want_to_read']

/**
 * The member's Library as the screens show it, and the Add sheet. Lists load
 * when a screen asks and refresh in the background when it comes back; an add
 * goes into the list at once. Signing out (or another member signing in)
 * forgets all of it.
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

  // ------------------------------------------------------------ Want to read

  const wantToRead = ref<LibraryEntry[]>([])
  /** Whether the list has been loaded once (the empty state waits for it). */
  const loaded = ref(false)
  const loadError = ref<LibraryErrorCode | null>(null)

  async function load() {
    const repo = library()
    if (!repo) return
    const member = session.member?.id
    const result = await repo.entries('want_to_read')
    if (member !== session.member?.id) return
    if (result.error) {
      loadError.value = result.error
      return
    }
    loadError.value = null
    wantToRead.value = result.data
    loaded.value = true
  }

  // ---------------------------------------------------------------- Add sheet

  /** The Book the Add sheet is about; null while it is closed. */
  const adding = ref<BookSnapshot | Book | null>(null)
  const addStatus = ref<EntryStatus>('want_to_read')
  const addBusy = ref(false)
  const addError = ref<LibraryErrorCode | null>(null)
  /** Entries added this visit, by the page key of the Book they were added from. */
  const addedByKey = reactive(new Map<string, LibraryEntry>())

  function openAdd(book: BookSnapshot | Book) {
    adding.value = book
    addStatus.value = 'want_to_read'
    addError.value = null
  }

  function closeAdd() {
    if (!addBusy.value) adding.value = null
  }

  /**
   * Adds the sheet's Book. A Book that is not in the Catalogue yet gets its
   * Cover resolved first (the first image of the cover chain that will do, with
   * its thumbhash and colours; the Placeholder cover if none will). One
   * database call does the rest. Returns the entry, or null with `addError` set.
   */
  async function confirmAdd(): Promise<LibraryEntry | null> {
    const book = adding.value
    const repo = library()
    if (!book || !repo || addBusy.value) return null
    addBusy.value = true
    addError.value = null
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
      const result = await repo.addToLibrary(snapshot, { status: addStatus.value })
      if (result.error) {
        addError.value = result.error
        return null
      }
      const entry = result.data
      wantToRead.value = [entry, ...wantToRead.value.filter((e) => e.id !== entry.id)]
      addedByKey.set(bookKey(book), entry)
      addedByKey.set(entry.book.id, entry)
      search.markAdded(entry)
      adding.value = null
      return entry
    } finally {
      addBusy.value = false
    }
  }

  function reset() {
    wantToRead.value = []
    loaded.value = false
    loadError.value = null
    adding.value = null
    addError.value = null
    addedByKey.clear()
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
    wantToRead,
    loaded,
    loadError,
    load,
    adding,
    addStatus,
    addBusy,
    addError,
    addedByKey,
    openAdd,
    closeAdd,
    confirmAdd,
    reset,
  }
})
