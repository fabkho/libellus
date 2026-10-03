import { defineStore } from 'pinia'
import {
  checkSessionEdit,
  sessionEditOf,
  type LibraryEntry,
  type LibraryErrorCode,
  type ReadingSession,
  type SessionEdit,
} from '~/data/library'
import { isoDay } from '~/utils/dates'
import { useBookStore } from '~/stores/book'
import { useCollectionsStore } from '~/stores/collections'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

/** The read the Edit sheet (or the delete question) is about, and the entry it belongs to. */
export type HistoryTarget = { entry: LibraryEntry; session: ReadingSession }

/**
 * The reading history on the book page and what changes it (issue #11): a
 * Book's reads, the Edit sheet, deleting one read and removing the Book from
 * the Library. Each change is one call to the Library repository; on success
 * the entry follows (`library.entryChanged`, or `entryRemoved` with the book
 * pages and Collections that show it) and the history is read again. On
 * failure the sheet or question stays open with the reason and the same button
 * tries again. Days are the member's own calendar days; the sheet refuses a
 * day the database would refuse, so the member hears why before anything is
 * sent. Signing out (or another member signing in) forgets all of it.
 */
export const useHistoryStore = defineStore('history', () => {
  const library = useLibraryStore()
  const books = useBookStore()
  const collections = useCollectionsStore()
  const session = useSessionStore()

  // --------------------------------------------------------------- the reads

  /** Each entry's reads, newest first, as this visit last read them. */
  const sessions = reactive(new Map<string, ReadingSession[]>())
  const loadError = ref<LibraryErrorCode | null>(null)
  const asks = new Map<string, number>()

  /** Reads an entry's history (again). Only the latest ask lands, so an older answer never overwrites a newer one. */
  async function load(entryId: string) {
    const repo = library.library()
    if (!repo) return
    const member = session.member?.id
    const ask = (asks.get(entryId) ?? 0) + 1
    asks.set(entryId, ask)
    const result = await repo.sessions(entryId)
    if (member !== session.member?.id || asks.get(entryId) !== ask) return
    if (result.error) {
      // Keep what is showing over a failed refresh.
      loadError.value = result.error
      return
    }
    loadError.value = null
    sessions.set(entryId, result.data)
  }

  /** The count on Home follows reads that were edited or deleted, not only finished. */
  function recount() {
    if (library.readInYear !== null) void library.loadReadInYear()
  }

  // ------------------------------------------------------------- Edit sheet

  /** The read the Edit sheet is about; null while it is closed. */
  const editing = ref<HistoryTarget | null>(null)
  const draft = reactive<SessionEdit>({ startedOn: '', endedOn: '', rating: null, review: '', abandonReason: '' })
  const editBusy = ref(false)
  const editError = ref<LibraryErrorCode | null>(null)

  // A change of mind is a new try: the last refusal no longer applies.
  watch(draft, () => (editError.value = null))

  function openEdit(entry: LibraryEntry, read: ReadingSession) {
    editing.value = { entry, session: read }
    Object.assign(draft, sessionEditOf(read))
    editError.value = null
  }

  function closeEdit() {
    if (!editBusy.value) editing.value = null
  }

  /** Saves the edit. Returns the entry as it is now, or null with `editError` set. */
  async function confirmEdit(): Promise<LibraryEntry | null> {
    const target = editing.value
    const repo = library.library()
    if (!target || !repo || editBusy.value) return null
    editError.value = checkSessionEdit(target.session, draft, isoDay())
    if (editError.value) return null
    editBusy.value = true
    try {
      const result = await repo.updateSession(target.entry.id, target.session, draft)
      if (result.error) {
        editError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      await load(target.entry.id)
      recount()
      editing.value = null
      return result.data
    } finally {
      editBusy.value = false
    }
  }

  // ---------------------------------------------------------- Delete a read

  /** The read the delete question is about; null while it is closed. */
  const deleting = ref<HistoryTarget | null>(null)
  const deleteBusy = ref(false)
  const deleteError = ref<LibraryErrorCode | null>(null)

  /** Asks whether to delete the read the Edit sheet is open on. */
  function askDelete() {
    if (!editing.value) return
    deleting.value = editing.value
    deleteError.value = null
  }

  function cancelDelete() {
    if (!deleteBusy.value) deleting.value = null
  }

  /** Deletes the read. Returns the entry as it is now (Want to read after its only read), or null with `deleteError` set. */
  async function confirmDelete(): Promise<LibraryEntry | null> {
    const target = deleting.value
    const repo = library.library()
    if (!target || !repo || deleteBusy.value) return null
    deleteBusy.value = true
    try {
      const result = await repo.deleteSession(target.entry.id, target.session.id)
      if (result.error) {
        deleteError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      await load(target.entry.id)
      recount()
      deleting.value = null
      editing.value = null
      return result.data
    } finally {
      deleteBusy.value = false
    }
  }

  // -------------------------------------------------- Remove from the Library

  /** The entry the removal question is about; null while it is closed. */
  const removing = ref<LibraryEntry | null>(null)
  const removeBusy = ref(false)
  const removeError = ref<LibraryErrorCode | null>(null)

  function askRemove(entry: LibraryEntry) {
    removing.value = entry
    removeError.value = null
  }

  function cancelRemove() {
    if (!removeBusy.value) removing.value = null
  }

  /**
   * Removes the entry with its reads and its places on Collections. It leaves
   * the Library's lists, the book pages that show it, search's marks and the
   * Collections. Returns whether it is gone, with `removeError` set if not.
   */
  async function confirmRemove(): Promise<boolean> {
    const entry = removing.value
    const repo = library.library()
    if (!entry || !repo || removeBusy.value) return false
    removeBusy.value = true
    try {
      const result = await repo.removeFromLibrary(entry.id)
      // Gone already (removed on another device): that is what was asked for.
      if (result.error && result.error !== 'entry_not_found') {
        removeError.value = result.error
        return false
      }
      library.entryRemoved(entry.id)
      books.dropEntry(entry.id)
      collections.entryRemoved(entry.id)
      sessions.delete(entry.id)
      asks.delete(entry.id)
      removing.value = null
      return true
    } finally {
      removeBusy.value = false
    }
  }

  function reset() {
    sessions.clear()
    asks.clear()
    loadError.value = null
    editing.value = null
    deleting.value = null
    removing.value = null
    editError.value = null
    deleteError.value = null
    removeError.value = null
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return {
    sessions,
    loadError,
    load,
    editing,
    draft,
    editBusy,
    editError,
    openEdit,
    closeEdit,
    confirmEdit,
    deleting,
    deleteBusy,
    deleteError,
    askDelete,
    cancelDelete,
    confirmDelete,
    removing,
    removeBusy,
    removeError,
    askRemove,
    cancelRemove,
    confirmRemove,
    reset,
  }
})
