import { defineStore } from 'pinia'
import { formatOf, isbnParts, type Book, type BookFormat, type BookSnapshot } from '~/data/books'
import { createCatalogueSearch } from '~/data/catalogueSearch'
import { createEditions, type Editions } from '~/data/editions'
import { isAbort } from '~/data/fetching'
import type { LibraryEntry, LibraryErrorCode } from '~/data/library'
import {
  newOwnEditionDraft,
  ownEditionSnapshot,
  validateOwnEdition,
  type OwnEditionDraft,
  type OwnEditionField,
} from '~/data/ownEdition'
import { useEditionStore } from '~/stores/edition'
import { useImportStore } from '~/stores/import'
import { useSessionStore } from '~/stores/session'

/**
 * "My edition isn't listed" (Change edition, and the import's Choose edition):
 * the step after the list of editions. She types (or scans) her copy's ISBN and
 * every source is asked for it (data/editions.ts, `lookupIsbn`); the edition
 * found is shown with its facts and taken with "Use this edition". When no
 * source knows it, she makes her own edition (data/ownEdition.ts): its format,
 * and its year, publisher, pages, language and cover if she likes.
 *
 * What taking it does is the host's: on the Book page the entry changes to it
 * (stores/edition.ts, with the format she said); in the import the preview's
 * row takes it, nothing is written until the import runs.
 */
export type OwnEditionTarget =
  | { kind: 'entry'; entry: LibraryEntry }
  | { kind: 'import'; key: string; book: BookSnapshot }

/** isbn: typing or looking up · found: an edition the sources know · own: her own edition's form. */
export type OwnEditionStep = 'isbn' | 'found' | 'own'

export const useOwnEditionStore = defineStore('ownEdition', () => {
  const backend = useBackend()
  const edition = useEditionStore()
  const imports = useImportStore()
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

  /** What the sheet is about; null while it is closed. */
  const target = ref<OwnEditionTarget | null>(null)
  const step = ref<OwnEditionStep>('isbn')
  const isbn = ref('')
  /** The ISBN as typed is no ISBN (its length or its check digit). */
  const isbnInvalid = ref(false)
  const looking = ref(false)
  /** No source knows the ISBN she looked up. */
  const notFound = ref(false)
  /** Neither Apple nor OpenLibrary answered: whether they know it cannot be told. */
  const lookFailed = ref(false)
  /** The edition with her ISBN. */
  const found = ref<Book | BookSnapshot | null>(null)
  /** The format she says the found edition is; null: its own (`foundFormat`). */
  const format = ref<BookFormat | null>(null)
  const draft = reactive<OwnEditionDraft>(newOwnEditionDraft({ language: null }))
  const invalid = reactive<Partial<Record<OwnEditionField, true>>>({})
  const busy = ref(false)
  const error = ref<LibraryErrorCode | null>(null)

  let asking: AbortController | null = null

  /** The Book whose edition she is looking for: the entry's, or the import row as the file has it. */
  const book = computed<BookSnapshot | null>(() => {
    const now = target.value
    if (!now) return null
    return now.kind === 'entry' ? now.entry.book : now.book
  })

  /** The found edition's format as the sheet shows it: what she said, else what its source said. */
  const foundFormat = computed<BookFormat | null>(() => format.value ?? (found.value ? formatOf(found.value) : null))

  function cancel() {
    asking?.abort()
    asking = null
    looking.value = false
  }

  function clearInvalid() {
    for (const field of Object.keys(invalid) as OwnEditionField[]) delete invalid[field]
  }

  function open(next: OwnEditionTarget) {
    cancel()
    target.value = next
    step.value = 'isbn'
    isbn.value = ''
    isbnInvalid.value = false
    notFound.value = false
    lookFailed.value = false
    found.value = null
    format.value = null
    Object.assign(draft, newOwnEditionDraft(next.kind === 'entry' ? next.entry.book : next.book))
    clearInvalid()
    error.value = null
  }

  function close() {
    if (busy.value) return
    cancel()
    target.value = null
  }

  // Typing again clears what the last lookup said.
  watch(isbn, () => {
    isbnInvalid.value = false
    notFound.value = false
    lookFailed.value = false
  })
  watch(
    () => ({ ...draft }),
    (now, before) => {
      for (const field of Object.keys(invalid) as OwnEditionField[]) if (now[field] !== before[field]) delete invalid[field]
      error.value = null
    },
  )

  /** Looks the ISBN up in every source (a scanned one comes in as `scanned`). */
  async function lookup(scanned?: string) {
    if (scanned !== undefined) isbn.value = scanned
    const book_ = book.value
    const parts = isbnParts(isbn.value)
    if (!book_ || busy.value) return
    if (!parts) {
      isbnInvalid.value = true
      return
    }
    cancel()
    const controller = new AbortController()
    asking = controller
    looking.value = true
    notFound.value = false
    lookFailed.value = false
    try {
      const outcome = await repository().lookupIsbn(book_, parts.isbn13, { signal: controller.signal })
      if (asking !== controller) return
      if (outcome.edition) {
        found.value = outcome.edition
        format.value = null
        error.value = null
        step.value = 'found'
      } else if (outcome.failed) lookFailed.value = true
      else notFound.value = true
    } catch (thrown) {
      if (isAbort(thrown)) return
      if (asking === controller) lookFailed.value = true
    } finally {
      if (asking === controller) {
        asking = null
        looking.value = false
      }
    }
  }

  /** Back from the found edition (or her form) to the ISBN. */
  function back() {
    if (busy.value) return
    cancel()
    step.value = 'isbn'
    error.value = null
  }

  /** Her own edition's form, with the ISBN she typed when it is one. */
  function startOwn() {
    if (busy.value) return
    cancel()
    if (isbnParts(isbn.value) && !draft.isbn) draft.isbn = isbn.value.trim()
    clearInvalid()
    error.value = null
    step.value = 'own'
  }

  function chooseFormat(value: BookFormat) {
    if (busy.value) return
    format.value = value
    error.value = null
  }

  function chooseDraftFormat(value: BookFormat) {
    if (busy.value) return
    draft.format = value
  }

  /**
   * Takes the found edition. On the Book page the entry changes to it with
   * the format she said (the edition it already has: only her format is
   * saved); in the import the row takes it. True when it was taken.
   */
  async function useFound(): Promise<LibraryEntry | true | null> {
    const now = target.value
    const picked = found.value
    if (!now || !picked || busy.value) return null
    if (now.kind === 'import') {
      imports.useEdition(now.key, picked)
      target.value = null
      return true
    }
    busy.value = true
    error.value = null
    try {
      const same = 'id' in picked && picked.id === now.entry.book.id
      const changed = same
        ? await edition.setFormat(now.entry, format.value ?? formatOf(picked, now.entry.formatOverride))
        : await edition.changeTo(now.entry, picked, format.value)
      if (!changed) {
        error.value = edition.error ?? 'unknown'
        return null
      }
      target.value = null
      return changed
    } finally {
      busy.value = false
    }
  }

  /**
   * Makes her own edition from the form: on the Book page the entry moves to
   * it; in the import the row takes it (the import makes it). What is wrong
   * is marked and nothing is sent. Returns the entry (Book page), true
   * (import), or null.
   */
  async function saveOwn(): Promise<LibraryEntry | true | null> {
    const now = target.value
    const book_ = book.value
    if (!now || !book_ || busy.value) return null
    clearInvalid()
    const wrong = validateOwnEdition(draft, new Date().getFullYear())
    if (Object.keys(wrong).length) {
      Object.assign(invalid, wrong)
      return null
    }
    const snapshot = ownEditionSnapshot(book_, draft)
    if (now.kind === 'import') {
      imports.useEdition(now.key, snapshot)
      target.value = null
      return true
    }
    busy.value = true
    error.value = null
    try {
      const changed = await edition.useOwn(now.entry, snapshot)
      if (!changed) {
        error.value = edition.error ?? 'unknown'
        return null
      }
      target.value = null
      return changed
    } finally {
      busy.value = false
    }
  }

  function reset() {
    cancel()
    target.value = null
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return {
    target,
    step,
    isbn,
    isbnInvalid,
    looking,
    notFound,
    lookFailed,
    found,
    format,
    foundFormat,
    draft,
    invalid,
    busy,
    error,
    book,
    open,
    close,
    lookup,
    back,
    startOwn,
    chooseFormat,
    chooseDraftFormat,
    useFound,
    saveOwn,
    reset,
  }
})
