import { defineStore } from 'pinia'
import type { Book, BookSnapshot } from '~/data/books'
import { createCatalogueSearch } from '~/data/catalogueSearch'
import { createEditions, type EditionCandidate, type Editions } from '~/data/editions'
import { isAbort } from '~/data/fetching'
import type { LibraryEntry, LibraryErrorCode } from '~/data/library'
import { editionKeys } from '~/data/merge'
import { useBookStore } from '~/stores/book'
import { useCollectionsStore } from '~/stores/collections'
import { useLibraryStore } from '~/stores/library'
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
    const entry = changing.value
    if (!entry) return
    cancel()
    const controller = new AbortController()
    inFlight = controller
    pending.value = true
    failed.value = false
    try {
      const outcome = await repository().find(entry.book, {
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
    changing.value = entry
    candidates.value = [{ book: entry.book, current: true }]
    picked.value = candidateKey(entry.book)
    error.value = null
    void look()
  }

  function close() {
    if (busy.value) return
    cancel()
    changing.value = null
  }

  function pick(candidate: EditionCandidate) {
    if (busy.value) return
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
   * Changes the entry to the picked edition. Returns the entry with its new
   * Book, or null with `error` set (the sheet stays open to try another).
   */
  async function confirm(): Promise<LibraryEntry | null> {
    const entry = changing.value
    const candidate = choice.value
    const repo = library.library()
    if (!entry || !candidate || !repo || busy.value) return null
    busy.value = true
    error.value = null
    try {
      const result = await repo.changeEdition(entry.id, await library.withCover(candidate.book))
      if (result.error) {
        error.value = result.error
        return null
      }
      const changed = result.data
      moved.value = { from: entry.book.id, to: changed }
      library.editionChanged(changed)
      // The old Book's pages show it as a Book that is not in the Library.
      books.dropEntry(changed.id)
      collections.entryChanged(changed)
      cancel()
      changing.value = null
      return changed
    } finally {
      busy.value = false
    }
  }

  function reset() {
    cancel()
    changing.value = null
    candidates.value = []
    picked.value = null
    error.value = null
    moved.value = null
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return { changing, candidates, pending, failed, picked, busy, error, moved, choice, isPicked, open, close, pick, look, confirm, reset }
})
