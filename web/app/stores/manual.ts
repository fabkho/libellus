import { defineStore } from 'pinia'
import { parseIsbn } from '~/data/books'
import type { LibraryEntry } from '~/data/library'
import {
  createManualBooks,
  validateManualBook,
  type ManualBookErrorCode,
  type ManualBookField,
} from '~/data/manualBooks'
import { useLibraryStore } from '~/stores/library'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'

/**
 * The manual-book sheet: "Add manually", reached from the empty search. The
 * form's fields, what is wrong with them, and the one call that makes the Book
 * and puts it into the Library. A search that found nothing hands over what was
 * typed: an ISBN fills the ISBN, anything else the title.
 */
export const useManualStore = defineStore('manual', () => {
  const backend = useBackend()
  const library = useLibraryStore()
  const search = useSearchStore()

  const isOpen = ref(false)
  const title = ref('')
  const author = ref('')
  const isbn = ref('')
  const pageCount = ref('')
  /** Fields marked wrong after a try; each clears when its text changes. */
  const invalid = reactive<Partial<Record<ManualBookField, true>>>({})
  const busy = ref(false)
  const error = ref<ManualBookErrorCode | null>(null)

  function open(typed = '') {
    const text = typed.trim()
    const looksLikeIsbn = Boolean(parseIsbn(text))
    title.value = looksLikeIsbn ? '' : text
    author.value = ''
    isbn.value = looksLikeIsbn ? text : ''
    pageCount.value = ''
    clearInvalid()
    error.value = null
    isOpen.value = true
  }

  function close() {
    if (!busy.value) isOpen.value = false
  }

  function clearInvalid() {
    for (const field of Object.keys(invalid) as ManualBookField[]) delete invalid[field]
  }

  for (const [field, source] of [['title', title], ['author', author], ['isbn', isbn], ['pageCount', pageCount]] as const) {
    watch(source, () => {
      delete invalid[field]
      error.value = null
    })
  }

  let repository: ReturnType<typeof createManualBooks> | null = null

  /**
   * Adds the Book. A form with something wrong stays open with the fields
   * marked; a failed call stays open with `error`. Returns the entry on success,
   * and the search that led here is over.
   */
  async function submit(): Promise<LibraryEntry | null> {
    if (busy.value || !backend) return null
    clearInvalid()
    const input = { title: title.value, author: author.value, isbn: isbn.value, pageCount: pageCount.value }
    const wrong = validateManualBook(input)
    if (Object.keys(wrong).length) {
      Object.assign(invalid, wrong)
      return null
    }
    busy.value = true
    error.value = null
    try {
      repository ??= createManualBooks(backend)
      const result = await repository.addManualBook(input)
      if (result.error) {
        error.value = result.error
        return null
      }
      const entry = result.data
      // Into Want to read at once, and its book page knows it (stores/library.ts).
      library.entryChanged(entry)
      isOpen.value = false
      search.close()
      return entry
    } finally {
      busy.value = false
    }
  }

  const session = useSessionStore()
  watch(
    () => session.member?.id,
    () => {
      isOpen.value = false
    },
  )

  return { isOpen, title, author, isbn, pageCount, invalid, busy, error, open, close, submit }
})
