import { defineStore } from 'pinia'
import { createCatalogueSearch } from '~/data/catalogueSearch'
import { probeImageInBrowser } from '~/data/covers'
import {
  createBookImport,
  libraryIndex,
  libraryTitleIndex,
  importedKeys,
  pacedFetch,
  type BookImport,
  type Edition,
  type ImportRow,
  type RowOutcome,
} from '~/data/bookImport'
import { decodeExport, NotACsvFileError } from '~/data/import/csv'
import { parseExport } from '~/data/import/detect'
import {
  countByStatus,
  MissingColumnsError,
  UnknownExportError,
  type ImportBook,
  type ImportFile,
  type ImportProblem,
  type ImportSource,
  type SkippedRow,
} from '~/data/import/rows'
import type { LibraryEntry, LibraryErrorCode } from '~/data/library'
import { createSearch, isAbort } from '~/data/search'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'
import { isoDay } from '~/utils/dates'

/**
 * pick: no file yet · reading: the file is being read · matching: editions
 * are being looked up · preview: what the import would do · importing: rows
 * are being written · done: the summary.
 */
export type ImportPhase = 'pick' | 'reading' | 'matching' | 'preview' | 'importing' | 'done'

/**
 * Why a file could not be used. Copy: `import.fileError.<code>`. `notCsv`: a
 * spreadsheet or anything else that is no text table; `notSupported`: a CSV
 * no supported app wrote; `storygraph`, `librarything`, `bookshelf`: another
 * app's CSV, told by its header, which Libellus does not read yet;
 * `missingColumns`: a supported app's export without columns its rows need
 * (`fileErrorDetail` says which app and which columns).
 */
export type FileError =
  | 'notSupported'
  | 'notCsv'
  | 'storygraph'
  | 'librarything'
  | 'bookshelf'
  | 'missingColumns'
  | 'empty'
  | 'unreadable'
  | 'unknown'

/**
 * What the preview says about one book of the file:
 * imported — imported from this file before, nothing to do;
 * inLibrary — the Book is in her Library already, her entry stays;
 * matched — an edition was found (by ISBN, or by title and author);
 * fromFile — no source knows it: added with what the file says.
 */
export type RowVerdict = 'imported' | 'inLibrary' | 'matched' | 'fromFile'

export type PreviewRow = {
  book: ImportBook
  edition: Edition | null
  verdict: RowVerdict | null
}

/** A row the member should look at: not found, matched by its title, carried over with a change, or skipped. */
export type Attention = {
  key: string
  title: string
  authors: string[]
  /** The edition it will be added as, when one was found: its cover shows what she gets. */
  edition: Edition['book'] | null
  notes: (
    | ImportProblem
    | { code: 'fromFile' }
    | { code: 'fromFileIsbn' }
    | { code: 'unsure' }
    | { code: 'byTitle'; year: number | null; language: string | null }
  )[]
}

/** One of her other shelves (Goodreads) or lists (Hardcover), offered as a Collection: how many books are on it, and whether she keeps it. */
export type OfferedShelf = { name: string; count: number; chosen: boolean }

/**
 * The import screen (issues #40, #111): pick a file from any supported app (told
 * by its header) → preview (counts per
 * Status, how many matched an edition, what needs a look) → import with
 * progress → summary. The file is read on the device; editions are looked up
 * a few rows at a time and the screen fills in as they come
 * (data/bookImport.ts); the writes are one database call per few rows.
 * Offline, choosing a file and importing are disabled (issue #15).
 */
export const useImportStore = defineStore('import', () => {
  const backend = useBackend()
  const libraryStore = useLibraryStore()

  const phase = ref<ImportPhase>('pick')
  const fileName = ref<string | null>(null)
  const fileError = ref<FileError | null>(null)
  /** For `missingColumns`: the app the file is from and the columns it lacks. */
  const fileErrorDetail = ref<{ source: ImportSource; columns: string[] } | null>(null)
  /** The app the file came from, told by its header. */
  const source = ref<ImportSource | null>(null)

  // Rows can be thousands: kept out of deep reactivity, `version` says when they changed.
  const books = shallowRef<ImportBook[]>([])
  const skipped = shallowRef<SkippedRow[]>([])
  const editions = shallowRef<(Edition | null)[]>([])
  /** Each row's verdict, decided once when its edition arrives (a file can be thousands of rows). */
  const verdicts = shallowRef<(RowVerdict | null)[]>([])
  const version = ref(0)
  /** Rows imported before: key → entry id. */
  let importedBefore = new Map<string, string>()
  let owned: (book: Edition['book']) => LibraryEntry | null = () => null
  let ownedUnderAnyEdition: ReturnType<typeof libraryTitleIndex> = () => null

  const progress = reactive({ done: 0, total: 0 })
  const outcomes = shallowRef<RowOutcome[]>([])
  const writeError = ref<LibraryErrorCode | null>(null)

  let repository: BookImport | null = null
  let catalogue: ReturnType<typeof createCatalogueSearch> | null = null
  function importer(): BookImport | null {
    if (!backend) return null
    catalogue ??= createCatalogueSearch(backend)
    repository ??= createBookImport(backend, {
      lookups: {
        catalogue,
        search: createSearch({
          // Apple refuses a burst; a little room between its requests keeps it answering.
          fetch: pacedFetch((url, init) => fetch(url, init), { gapMs: { 'itunes.apple.com': 250 } }),
          languages: import.meta.client ? (navigator.languages ?? [navigator.language]) : [],
          catalogue,
        }),
      },
      probe: probeImageInBrowser,
      online: isOnline,
    })
    return repository
  }

  let lookup: AbortController | null = null

  // ------------------------------------------------------------------ preview

  /**
   * Found as an edition a source knows. A Catalogue Book that another
   * member's import made from her file (`import`) is no better known than
   * this file's own row: it counts as from the file.
   */
  const matchedEdition = (edition: Edition) => Boolean(edition.via) && edition.book.source !== 'import'

  function verdictOf(book: ImportBook, edition: Edition | null): RowVerdict | null {
    if (importedBefore.has(book.key)) return 'imported'
    // Hers under another edition: nothing to look up (#104).
    if (ownedUnderAnyEdition(book)) return 'inLibrary'
    if (!edition) return null
    if (owned(edition.book)) return 'inLibrary'
    return matchedEdition(edition) ? 'matched' : 'fromFile'
  }

  const rows = computed<PreviewRow[]>(() => {
    void version.value
    return books.value.map((book, index) => ({ book, edition: editions.value[index] ?? null, verdict: verdicts.value[index] ?? null }))
  })

  const byStatus = computed(() => countByStatus(books.value))
  const count = (verdict: RowVerdict) => rows.value.filter((row) => row.verdict === verdict).length
  const matched = computed(() => count('matched'))
  const fromFile = computed(() => count('fromFile'))
  const alreadyThere = computed(() => count('imported') + count('inLibrary'))
  const toImport = computed(() => rows.value.filter((row) => row.verdict === 'matched' || row.verdict === 'fromFile'))

  /** Her other shelves in the file, most books first: each offered as a Collection, kept unless she says no. */
  const declined = ref(new Set<string>())
  const shelves = computed<OfferedShelf[]>(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const book of books.value) {
      for (const name of book.shelves) {
        const key = name.toLowerCase()
        const shelf = counts.get(key) ?? { name, count: 0 }
        shelf.count++
        counts.set(key, shelf)
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((shelf) => ({ ...shelf, chosen: !declined.value.has(shelf.name.toLowerCase()) }))
  })
  function toggleShelf(name: string) {
    const key = name.toLowerCase()
    const next = new Set(declined.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    declined.value = next
  }

  /** Rows that were not found or carried over with a change, then the skipped ones, in file order. */
  const attention = computed<Attention[]>(() => {
    const list: Attention[] = []
    for (const { book, edition, verdict } of rows.value) {
      if (verdict === 'imported' || verdict === 'inLibrary') continue
      const notes: Attention['notes'] = []
      if (verdict === 'fromFile') {
        notes.push(edition?.unsure ? { code: 'unsure' } : edition?.book.isbn13 ? { code: 'fromFileIsbn' } : { code: 'fromFile' })
      }
      // Found by title: another edition of the work, which she may want to change after.
      if (verdict === 'matched' && edition?.via === 'title') {
        notes.push({ code: 'byTitle', year: edition.book.year, language: edition.book.language })
      }
      notes.push(...book.problems)
      const shown = verdict === 'matched' || edition?.coverFrom ? (edition?.coverFrom ?? edition?.book ?? null) : null
      if (notes.length) list.push({ key: book.key, title: book.title, authors: book.authors, edition: shown, notes })
    }
    for (const row of skipped.value) {
      list.push({ key: `skipped:${row.row}`, title: row.title, authors: [], edition: null, notes: [row.problem] })
    }
    return list
  })

  // ------------------------------------------------------------------ actions

  function reset() {
    lookup?.abort()
    lookup = null
    phase.value = 'pick'
    fileName.value = null
    fileError.value = null
    fileErrorDetail.value = null
    source.value = null
    books.value = []
    skipped.value = []
    editions.value = []
    verdicts.value = []
    importedBefore = new Map()
    declined.value = new Set()
    owned = () => null
    ownedUnderAnyEdition = () => null
    progress.done = 0
    progress.total = 0
    outcomes.value = []
    writeError.value = null
    version.value++
  }

  /** Reads the file and looks its books up. */
  async function choose(file: File) {
    const repo = importer()
    if (!repo || !catalogue || phase.value === 'importing') return
    reset()
    fileName.value = file.name
    phase.value = 'reading'

    let parsed: ImportFile
    try {
      // Whichever supported app wrote it: told by its header (data/import/detect.ts).
      parsed = parseExport(decodeExport(new Uint8Array(await file.arrayBuffer())), isoDay())
    } catch (error) {
      if (error instanceof MissingColumnsError) fileErrorDetail.value = { source: error.source, columns: error.missing }
      fileError.value =
        error instanceof NotACsvFileError
          ? 'notCsv'
          : error instanceof UnknownExportError
            ? (error.app ?? 'notSupported')
            : error instanceof MissingColumnsError
              ? 'missingColumns'
              : 'unreadable'
      phase.value = 'pick'
      return
    }
    source.value = parsed.source
    if (!parsed.books.length) {
      fileError.value = 'empty'
      phase.value = 'pick'
      return
    }

    // What she has already: rows imported before are not looked up again.
    const [keys, library] = await Promise.all([importedKeys(backend!), catalogue.libraryEntries().catch(() => null)])
    if (keys.error || !library) {
      fileError.value = 'unknown'
      phase.value = 'pick'
      return
    }
    importedBefore = keys.data
    owned = libraryIndex(library)
    ownedUnderAnyEdition = libraryTitleIndex(library, keys.data)
    books.value = parsed.books
    skipped.value = parsed.skipped
    editions.value = parsed.books.map(() => null)
    verdicts.value = parsed.books.map((book) => verdictOf(book, null))

    // Rows decided already (imported before, or hers under another edition) are not looked up.
    const pending = parsed.books.map((book, index) => ({ book, index })).filter(({ index }) => verdicts.value[index] === null)
    progress.total = pending.length
    progress.done = 0
    phase.value = 'matching'
    version.value++

    const controller = new AbortController()
    lookup = controller
    const found = new Set<number>()
    try {
      await repo.match(
        pending.map(({ book }) => book),
        {
          signal: controller.signal,
          onEdition(index, edition) {
            const at = pending[index]!.index
            editions.value[at] = edition
            verdicts.value[at] = verdictOf(parsed.books[at]!, edition)
            if (!found.has(at)) {
              found.add(at)
              progress.done++
            }
            version.value++
          },
        },
      )
    } catch (error) {
      if (isAbort(error)) return
      throw error
    } finally {
      if (lookup === controller) lookup = null
    }
    if (controller.signal.aborted) return
    phase.value = 'preview'
  }

  /** Writes every row that is not in her Library yet. */
  async function start() {
    const repo = importer()
    if (!repo || phase.value !== 'preview') return
    const kept = new Set(shelves.value.filter((shelf) => shelf.chosen).map((shelf) => shelf.name.toLowerCase()))
    const chosenShelves = (book: ImportBook) => book.shelves.filter((name) => kept.has(name.toLowerCase()))
    const pending: ImportRow[] = toImport.value.map(({ book, edition }) => ({
      key: book.key,
      title: book.title,
      authors: book.authors,
      status: book.status,
      session: book.session,
      extraReads: book.extraReads,
      earlierReads: book.earlierReads,
      pageCount: book.pageCount,
      otherKeys: book.otherKeys,
      addedOn: book.addedOn,
      collections: chosenShelves(book),
      book: edition!.book,
      coverFrom: edition!.coverFrom ?? null,
    }))
    writeError.value = null
    outcomes.value = []
    progress.total = pending.length
    progress.done = 0
    phase.value = 'importing'

    const written = await repo.write(pending, {
      onWritten(chunk) {
        outcomes.value = [...outcomes.value, ...chunk]
        progress.done += chunk.length
      },
    })
    if (written.error) writeError.value = written.error
    phase.value = 'done'
    // The Library shows the new books the next time it is opened.
    void libraryStore.load()
  }

  // Another member, or nobody: nothing of the last one's file stays.
  const session = useSessionStore()
  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  const added = computed(() => outcomes.value.filter((outcome) => outcome.outcome === 'added').length)
  const kept = computed(
    () => alreadyThere.value + outcomes.value.filter((outcome) => outcome.outcome === 'imported' || outcome.outcome === 'in_library').length,
  )
  const failed = computed(() => {
    const byKey = new Map(books.value.map((book) => [book.key, book]))
    return outcomes.value
      .filter((outcome) => outcome.outcome === 'failed')
      .map((outcome) => ({ ...outcome, book: byKey.get(outcome.key) ?? null }))
  })
  /** A few of the Books just added, covers first, for the summary. */
  const addedCovers = computed(() => {
    const added = new Set(outcomes.value.filter((outcome) => outcome.outcome === 'added').map((outcome) => outcome.key))
    return rows.value
      .filter((row) => added.has(row.book.key) && row.edition)
      .map((row) => row.edition!.book)
      .sort((a, b) => Number(Boolean(b.coverUrl)) - Number(Boolean(a.coverUrl)))
      .slice(0, 5)
  })
  /** Rows the import did not reach (a call failed or the connection went). */
  const notReached = computed(() => (phase.value === 'done' ? Math.max(0, progress.total - outcomes.value.length) : 0))

  return {
    phase,
    fileName,
    fileError,
    fileErrorDetail,
    source,
    books,
    rows,
    byStatus,
    matched,
    fromFile,
    alreadyThere,
    toImport,
    shelves,
    toggleShelf,
    attention,
    progress,
    outcomes,
    writeError,
    added,
    kept,
    failed,
    addedCovers,
    notReached,
    choose,
    start,
    reset,
  }
})
