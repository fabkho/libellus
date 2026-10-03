import { defineStore } from 'pinia'
import { bookKey, type Book, type BookSnapshot } from '~/data/books'
import {
  createCollections,
  isValidName,
  MOSAIC_SIZE,
  type Collection,
  type CollectionErrorCode,
  type Collections,
  type CollectionSummary,
} from '~/data/collections'
import { loadPixelsInBrowser, resolveCover } from '~/data/covers'
import type { LibraryEntry } from '~/data/library'
import { appleArtwork } from '~/data/search'
import { useLibraryStore } from '~/stores/library'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'

/**
 * loading: nothing to show yet · ready: the Collection · missing: not one of
 * the member's (deleted, or a wrong address) · error: it could not be read.
 */
export type CollectionPagePhase = 'loading' | 'ready' | 'missing' | 'error'
export type CollectionPage = { phase: CollectionPagePhase; collection: Collection | null }

/** The Book the collection picker is about, and the address of its page. */
export type Picking = { book: Book | BookSnapshot; key: string; entry: LibraryEntry | null }

/** What the name sheet is doing: a new Collection, or a new name for one. */
export type Naming = { mode: 'create' } | { mode: 'rename'; id: string }

/**
 * The member's Collections as the screens show them: the list (Library →
 * Collections), one Collection's page, which Collections a Book is on (the book
 * page), the collection picker and the name sheet. Every change goes through
 * the repository as one call and shows at once; the list refreshes behind it.
 * Signing out (or another member signing in) forgets all of it.
 */
export const useCollectionsStore = defineStore('collections', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const library = useLibraryStore()
  const search = useSearchStore()

  let repository: Collections | null = null
  function repo(): Collections | null {
    if (!backend) return null
    repository ??= createCollections(backend)
    return repository
  }

  // --------------------------------------------------------------------- list

  const list = ref<CollectionSummary[]>([])
  const loaded = ref(false)
  const loadError = ref<CollectionErrorCode | null>(null)

  let listing: Promise<void> | null = null

  /** Reads the list (again). Asking while a read is on its way waits for that one. */
  function loadList(): Promise<void> {
    listing ??= readList().finally(() => (listing = null))
    return listing
  }

  async function readList() {
    const collections = repo()
    if (!collections) return
    const member = session.member?.id
    const result = await collections.list()
    if (member !== session.member?.id) return
    if (result.error) {
      loadError.value = result.error
      return
    }
    loadError.value = null
    list.value = result.data
    loaded.value = true
  }

  /** The list entry, kept in step with a change made here. */
  function patchSummary(id: string, change: (summary: CollectionSummary) => CollectionSummary) {
    list.value = list.value.map((summary) => (summary.id === id ? change(summary) : summary))
  }

  // -------------------------------------------------------------- one page

  const pages = reactive(new Map<string, CollectionPage>())

  function page(id: string): CollectionPage | null {
    return pages.get(id) ?? null
  }

  async function loadCollection(id: string) {
    const collections = repo()
    if (!collections) return
    if (!pages.has(id)) {
      // Known from the list: its name shows at once while its Books arrive.
      const known = list.value.find((summary) => summary.id === id)
      pages.set(id, {
        phase: 'loading',
        collection: known ? { id, name: known.name, position: known.position, createdAt: known.createdAt, entries: [] } : null,
      })
    }
    const member = session.member?.id
    const result = await collections.get(id)
    if (member !== session.member?.id) return
    if (result.error) {
      // Keep what is showing over a failed refresh.
      if (pages.get(id)?.phase !== 'ready') pages.set(id, { phase: 'error', collection: pages.get(id)?.collection ?? null })
      return
    }
    pages.set(id, result.data ? { phase: 'ready', collection: result.data } : { phase: 'missing', collection: null })
  }

  function setEntries(id: string, entries: LibraryEntry[]) {
    const current = pages.get(id)
    if (current?.collection) pages.set(id, { ...current, collection: { ...current.collection, entries } })
    patchSummary(id, (summary) => ({ ...summary, count: entries.length, covers: entries.slice(0, MOSAIC_SIZE).map((e) => e.book) }))
  }

  // ------------------------------------------------------------- memberships

  /** The Collections each entry is on, by entry id, as far as this visit knows. */
  const memberships = reactive(new Map<string, string[]>())

  async function loadMemberships(entryId: string) {
    const collections = repo()
    if (!collections) return
    const result = await collections.memberships(entryId)
    if (!result.error) memberships.set(entryId, result.data)
  }

  /** The member's Collections an entry is on, in her order. */
  function collectionsOf(entryId: string | null | undefined): CollectionSummary[] {
    if (!entryId) return []
    const ids = memberships.get(entryId) ?? []
    return list.value.filter((summary) => ids.includes(summary.id))
  }

  // ------------------------------------------------------------- the changes

  async function create(name: string): Promise<{ data: CollectionSummary; error: null } | { data: null; error: CollectionErrorCode }> {
    const collections = repo()
    if (!collections) return { data: null, error: 'unknown' }
    if (!isValidName(name)) return { data: null, error: 'name_invalid' }
    const result = await collections.create(name)
    if (result.error) return result
    list.value = [...list.value.filter((summary) => summary.id !== result.data.id), result.data]
    loaded.value = true
    return result
  }

  async function rename(id: string, name: string): Promise<CollectionErrorCode | null> {
    const collections = repo()
    if (!collections) return 'unknown'
    if (!isValidName(name)) return 'name_invalid'
    const result = await collections.rename(id, name)
    if (result.error) return result.error
    patchSummary(id, (summary) => ({ ...summary, name: result.data.name }))
    const current = pages.get(id)
    if (current?.collection) pages.set(id, { ...current, collection: { ...current.collection, name: result.data.name } })
    return null
  }

  async function remove(id: string): Promise<CollectionErrorCode | null> {
    const collections = repo()
    if (!collections) return 'unknown'
    const result = await collections.delete(id)
    // Gone already (another device) is as good as deleted.
    if (result.error && result.error !== 'collection_missing') return result.error
    list.value = list.value.filter((summary) => summary.id !== id)
    pages.delete(id)
    for (const [entry, ids] of memberships) memberships.set(entry, ids.filter((other) => other !== id))
    return null
  }

  /**
   * Puts a Book on a Collection. A Book that was not in the Library is now, on
   * Want to read: the Library, the book page and search learn of it at once.
   */
  async function addBook(id: string, book: Book | BookSnapshot, key = bookKey(book)): Promise<CollectionResultLike<LibraryEntry>> {
    const collections = repo()
    if (!collections) return { data: null, error: 'unknown' }
    const result = await collections.addEntry(id, await withCover(book))
    if (result.error) return result
    const entry = result.data
    memberships.set(entry.id, [...new Set([...(memberships.get(entry.id) ?? []), id])])
    const current = pages.get(id)
    if (current?.collection) setEntries(id, [...current.collection.entries.filter((e) => e.id !== entry.id), entry])
    else
      patchSummary(id, (summary) => ({
        ...summary,
        count: summary.count + 1,
        covers: summary.covers.length < MOSAIC_SIZE ? [...summary.covers, entry.book] : summary.covers,
      }))
    if (!library.addedByKey.has(entry.book.id)) {
      // New to the Library (or not seen there this visit): show it everywhere.
      library.addedByKey.set(key, entry)
      library.addedByKey.set(entry.book.id, entry)
      if (!library.wantToRead.some((e) => e.id === entry.id) && entry.status === 'want_to_read') {
        library.wantToRead = [entry, ...library.wantToRead]
      }
      search.markAdded(entry)
    }
    return result
  }

  /**
   * A search result may enter the Catalogue with this add, and the Catalogue
   * keeps its first snapshot: its Cover is resolved first, as the Add sheet
   * does (stores/library.ts, confirmAdd) — thumbhash and colours from a small
   * copy of the image; without them if that fails.
   */
  async function withCover(book: Book | BookSnapshot): Promise<Book | BookSnapshot> {
    if ('id' in book || !book.coverUrl || book.coverThumbhash) return book
    // Its own small URL, so no cached non-CORS response of the large image can taint the canvas.
    const cover = await resolveCover(appleArtwork(book.coverUrl, 100, 150), loadPixelsInBrowser)
    return cover ? { ...book, coverThumbhash: cover.thumbhash, coverColors: cover.colors } : book
  }

  async function removeEntry(id: string, entryId: string): Promise<CollectionErrorCode | null> {
    const collections = repo()
    if (!collections) return 'unknown'
    const result = await collections.removeEntry(id, entryId)
    if (result.error && result.error !== 'not_in_collection') return result.error
    memberships.set(entryId, (memberships.get(entryId) ?? []).filter((other) => other !== id))
    const current = pages.get(id)
    if (current?.collection) setEntries(id, current.collection.entries.filter((e) => e.id !== entryId))
    else void loadList()
    return null
  }

  // ------------------------------------------------------------------ reorder

  /** Set when the last new order could not be saved; the page shows the order the database has. */
  const reorderError = ref<CollectionErrorCode | null>(null)
  // Moves are saved one after another, so the database ends in the last order.
  let saving: Promise<unknown> = Promise.resolve()

  /**
   * Moves an entry to place `to` (0-based) at once, and saves the new order
   * behind it. By the entry's id, so a list that changed under a drag (a
   * reload after a failed save) never moves the wrong Book.
   */
  function move(id: string, entryId: string, to: number) {
    const current = pages.get(id)?.collection
    if (!current) return
    const from = current.entries.findIndex((entry) => entry.id === entryId)
    if (from < 0 || from === to || to < 0 || to >= current.entries.length) return
    const entries = [...current.entries]
    const [moved] = entries.splice(from, 1)
    entries.splice(to, 0, moved!)
    setEntries(id, entries)
    reorderError.value = null
    const order = entries.map((e) => e.id)
    saving = saving
      .then(async () => {
        const result = await repo()?.reorder(id, order)
        if (result?.error) {
          reorderError.value = result.error
          await Promise.all([loadCollection(id), loadList()])
        }
      })
      // A save that threw must not stop the ones after it.
      .catch(() => {
        reorderError.value = 'unknown'
      })
  }

  // ------------------------------------------------------------------ picker

  const picking = ref<Picking | null>(null)
  /** The Collections a change is on its way for. */
  const pickerBusy = reactive(new Set<string>())
  const pickerError = ref<CollectionErrorCode | null>(null)

  function openPicker(book: Book | BookSnapshot, entry: LibraryEntry | null, key = bookKey(book)) {
    picking.value = { book, key, entry }
    pickerError.value = null
    void loadList()
    if (entry) void loadMemberships(entry.id)
  }

  function closePicker() {
    picking.value = null
  }

  /** Whether the picker knows which Collections its Book is on (always, for a Book not in the Library). */
  const pickerReady = computed(() => {
    const entry = picking.value?.entry
    return !entry || memberships.has(entry.id)
  })

  /** Whether the picker's Book is on a Collection. */
  function picked(id: string): boolean {
    const entry = picking.value?.entry
    return Boolean(entry && memberships.get(entry.id)?.includes(id))
  }

  /** Puts the picker's Book on a Collection, or takes it off. */
  async function toggle(id: string) {
    const current = picking.value
    if (!current || pickerBusy.has(id) || !pickerReady.value) return
    pickerBusy.add(id)
    pickerError.value = null
    try {
      if (current.entry && picked(id)) {
        pickerError.value = await removeEntry(id, current.entry.id)
      } else {
        const result = await addBook(id, current.book, current.key)
        if (result.error) pickerError.value = result.error
        else if (picking.value === current) picking.value = { ...current, entry: result.data }
      }
    } finally {
      pickerBusy.delete(id)
    }
  }

  /** A new Collection from the picker, with the picker's Book on it. */
  async function createAndPick(name: string): Promise<boolean> {
    if (!picking.value) return false
    pickerError.value = null
    const created = await create(name)
    if (created.error) {
      pickerError.value = created.error
      return false
    }
    await toggle(created.data.id)
    return !pickerError.value
  }

  // --------------------------------------------------------------- name sheet

  const naming = ref<Naming | null>(null)
  const name = ref('')
  const nameBusy = ref(false)
  const nameError = ref<CollectionErrorCode | null>(null)
  watch(name, () => (nameError.value = null))

  function openCreate() {
    naming.value = { mode: 'create' }
    name.value = ''
    nameError.value = null
  }

  function openRename(id: string) {
    naming.value = { mode: 'rename', id }
    name.value = page(id)?.collection?.name ?? list.value.find((summary) => summary.id === id)?.name ?? ''
    nameError.value = null
  }

  function closeNaming() {
    if (!nameBusy.value) naming.value = null
  }

  /** Saves the name sheet. Returns the Collection's id, or null with `nameError` set. */
  async function submitName(): Promise<string | null> {
    const current = naming.value
    if (!current || nameBusy.value) return null
    nameBusy.value = true
    nameError.value = null
    try {
      if (current.mode === 'create') {
        const created = await create(name.value)
        if (created.error) {
          nameError.value = created.error
          return null
        }
        naming.value = null
        return created.data.id
      }
      const failed = await rename(current.id, name.value)
      if (failed) {
        nameError.value = failed
        return null
      }
      naming.value = null
      return current.id
    } finally {
      nameBusy.value = false
    }
  }

  // ------------------------------------------------------------------- reset

  function reset() {
    list.value = []
    loaded.value = false
    loadError.value = null
    pages.clear()
    memberships.clear()
    picking.value = null
    pickerError.value = null
    naming.value = null
    reorderError.value = null
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return {
    list,
    loaded,
    loadError,
    loadList,
    page,
    loadCollection,
    memberships,
    loadMemberships,
    collectionsOf,
    create,
    rename,
    remove,
    addBook,
    removeEntry,
    reorderError,
    move,
    picking,
    pickerBusy,
    pickerError,
    pickerReady,
    openPicker,
    closePicker,
    picked,
    toggle,
    createAndPick,
    naming,
    name,
    nameBusy,
    nameError,
    openCreate,
    openRename,
    closeNaming,
    submitName,
    reset,
  }
})

type CollectionResultLike<T> = { data: T; error: null } | { data: null; error: CollectionErrorCode }
