import { defineStore } from 'pinia'
import { createCatalogueSearch } from '~/data/catalogueSearch'
import type { Book, BookSnapshot } from '~/data/books'
import { createCoverFill, mergeCover, type CoverFill, type CoverFillProgress, type CoverFound } from '~/data/coverFill'
import { GOODREADS_COVERS } from '~/data/coverRank'
import { probeImageInBrowser, verifyCover } from '~/data/covers'
import { createDnb, DNB_IMPORT_GAP_MS } from '~/data/dnb'
import { accessTokenOf, viaOwnServer } from '~/data/openLibraryProxy'
import { createGoodreadsCover } from '~/data/goodreadsCover'
import {
  createBookImport,
  editionChoices,
  fileEdition,
  libraryIndex,
  libraryTitleIndex,
  reviewOf,
  importedKeys,
  pacedFetch,
  type PacedFetch,
  type BookImport,
  type Edition,
  type EditionChoice,
  type ImportRow,
  type Lookups,
  type ReviewNote,
  type RowOutcome,
} from '~/data/bookImport'
import { appendEditions } from '~/data/editions'
import { decodeExport, NotACsvFileError } from '~/data/import/csv'
import { parseExport } from '~/data/import/detect'
import {
  countByStatus,
  MissingColumnsError,
  UnknownExportError,
  type ImportBook,
  type ImportFile,
  type ImportSource,
  type SkippedRow,
} from '~/data/import/rows'
import type { LibraryEntry, LibraryErrorCode } from '~/data/library'
import { editionKeys } from '~/data/merge'
import { createSearch, isAbort, type Search } from '~/data/search'
import { candidateKey } from '~/stores/edition'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'
import { isoDay } from '~/utils/dates'
import { writeImportHint } from '~/utils/importHint'
import { clearMatches, readMatches, writeMatches, type StoredMatch } from '~/utils/importMatches'
import { parseAppConfig } from '~/utils/appConfig'

/** No book answered for this long while looking up: the screen offers to go on with what is there. */
const STALL_MS = 45_000
/** Import is pressed: the cover fill's rows still being asked get this long before the write starts; what is not in by then follows if it can. */
const COVER_GRACE_MS = 3000

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
 * app's CSV, told by its header, which BetterReads does not read yet;
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
  /** Her edition is hers to choose (Choose edition): matched by title or only from the file. */
  choose: boolean
  /**
   * Whether it is a book to look at for sure: nothing identifies it (no edition found and no ISBN in the
   * file, or a source could not be asked), or the row was skipped. The other rows only carry a note
   * (found by its title, a missing cover, a custom shelf …) and the screen keeps them behind a toggle.
   */
  look: boolean
  /** The row has no cover and the last-resort "Find a cover" (Goodreads) may be asked for it. */
  findCover?: boolean
  /** The edition she chose, as it will be written: its language, year and pages show on the row. */
  held?: Edition['book']
  notes: ReviewNote[]
}

/** The Choose edition sheet's state: the row it is about, what it offers, and the pick. */
export type EditionChoosing = {
  key: string
  rows: EditionChoice[]
  /** The edition search has not answered fully yet. */
  pending: boolean
  /** Every source of the search failed. */
  failed: boolean
  /** The picked row's key (`candidateKey`); the current edition's while nothing else is picked. */
  picked: string
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
  /** The second, slower pass over the books nothing was found for: null while the first pass runs or when there is none. */
  const secondPass = ref<{ done: number; total: number } | null>(null)
  /** No answer for a while: the screen offers to go on with what is there (`finishNow`). */
  const stalled = ref(false)
  let lastAnswerAt = 0
  let stallTimer: ReturnType<typeof setInterval> | null = null
  /** The background search for covers of rows that have none: null when nothing was asked for. */
  const coverProgress = ref<CoverFillProgress | null>(null)
  const outcomes = shallowRef<RowOutcome[]>([])
  const writeError = ref<LibraryErrorCode | null>(null)

  /** Rows whose edition she chose herself, by index: the match does not touch them again. */
  const chosen = shallowRef(new Set<number>())
  const searchLanguages = useSearchLanguages()
  let repository: BookImport | null = null
  let repositoryLanguage = ''
  let catalogue: ReturnType<typeof createCatalogueSearch> | null = null
  /** One paced `fetch` for the whole import (the lookups and the cover fill): Apple's refusals are known to both. */
  let liveFetch: PacedFetch | null = null
  let searcher: Search | null = null
  function importer(): BookImport | null {
    const config = parseAppConfig(useRuntimeConfig().public)
    if (!backend || !config.ok) return null
    catalogue ??= createCatalogueSearch(backend)
    const languages = searchLanguages()
    if (repositoryLanguage !== languages[0]) repository = null
    repositoryLanguage = languages[0] ?? ''
    // Apple refuses a burst; a little room between its requests keeps it answering. The import's Open Library
    // goes through the `openlibrary` function (identified to Open Library, about 3/s) and falls back to direct
    // at 1/s if the function ever fails (data/openLibraryProxy.ts). The gap's host key is the URL the caller
    // asked with, so `openlibrary.org` paces both ways and the function's share is ~3/s.
    liveFetch ??= pacedFetch(
      viaOwnServer((url, init) => fetch(url, init), {
        functionUrl: `${config.config.supabaseUrl}/functions/v1/openlibrary`,
        apikey: config.config.supabaseAnonKey,
        token: accessTokenOf(backend),
      }),
      { gapMs: { 'itunes.apple.com': 250, 'openlibrary.org': 340 } },
    )
    if (!repository) {
      // The National Library (data/dnb.ts): the ISBN fallback and the title ladder's one question, on the import's own budget (`purpose`) and pace (`gapMs`).
      const dnb = createDnb(backend, { online: isOnline, purpose: 'import', gapMs: DNB_IMPORT_GAP_MS })
      searcher = createSearch({ fetch: liveFetch, languages, catalogue, dnb })
      const live = liveFetch
      const lookups: Lookups = {
        catalogue,
        search: searcher,
        dnb,
        // The paced host's cooldown: the second pass waits it out instead of meeting another refusal.
        busyFor: () => live.blockedFor('itunes.apple.com'),
        // The last resort for a Goodreads file's row no source knows (flagged): Goodreads' cover of her book id, checked.
        ...(GOODREADS_COVERS
          ? {
              goodreads: async (query) => {
                const answer = await goodreadsCovers()?.find(query)
                if (answer === 'blocked') {
                  goodreadsBlocked()
                  return 'blocked'
                }
                if (!answer?.coverUrl) return null
                const cover = await verifyCover(answer.coverUrl, { probe: probeImageInBrowser }).catch(() => null)
                return cover?.coverUrl ? cover : null
              },
            }
          : {}),
      }
      repository = createBookImport(backend, {
        lookups,
        probe: probeImageInBrowser,
        online: isOnline,
      })
    }
    return repository
  }

  // ------------------------------------------------------------ covers, meanwhile

  let fill: CoverFill | null = null

  function stopFill() {
    const ending = fill
    // Detached first: what its last report says is no business of the next file or member.
    fill = null
    ending?.stop()
    coverProgress.value = null
  }

  /** A row a source identified (or whose ISBN the file names) whose edition has no cover: asked for in the background (data/coverFill.ts). */
  function wantCover(index: number) {
    const book = books.value[index]
    const edition = editions.value[index]
    if (!fill || !book || !edition) return
    const verdict = verdicts.value[index]
    // A Catalogue Book without a cover gets the one found when the import is written (`fill_book_covers`); a member's pick is hers.
    const wanted =
      (verdict === 'matched' || verdict === 'fromFile') &&
      !chosen.value.has(index) &&
      !edition.unsure &&
      !edition.book.coverUrl &&
      !edition.coverFrom?.coverUrl
    if (!wanted) return fill.drop(book.key)
    // A Goodreads file's row carries the file's own book id (its key): the last-resort Goodreads cover stage asks only about those.
    const goodreadsId = /^goodreads:(\d{1,20})$/.exec(book.key)?.[1]
    fill.add({ key: book.key, row: book, book: edition.book, alternatives: edition.alternatives, ...(goodreadsId ? { goodreadsId } : {}) })
  }

  /** The fill found a cover: it goes on the row's edition (its own, or the cover its ISBN-only Book borrows), in the preview and in what the write will take. */
  function coverFound(key: string, found: CoverFound) {
    const index = indexOf(key)
    const edition = editions.value[index]
    if (index < 0 || !edition || chosen.value.has(index)) return
    const next = mergeCover(edition, found)
    if (!next) return
    editions.value[index] = next
    remember(key, next)
    version.value++
  }

  let goodreadsCover: ReturnType<typeof createGoodreadsCover> | null = null
  function goodreadsCovers() {
    if (!backend) return null
    return (goodreadsCover ??= createGoodreadsCover(backend, { online: isOnline }))
  }

  /**
   * Goodreads is turning the function away (the function's breaker is open): one entry in the error log, no toast; the
   * rows go on without a Goodreads cover, the cloth stands in. The log folds a repeat into a count.
   */
  function goodreadsBlocked() {
    reportError('error', 'goodreads cover source blocked')
  }

  /** "Find a cover" on one row (any file): asked now, one row, not through the fill's lane. */
  const coverSearch = ref<{ key: string; state: 'asking' | 'found' | 'none' | 'failed' } | null>(null)

  /**
   * Asks the Goodreads function for this row's cover (a Goodreads file's row with its book id), checks the image
   * like the fill does, and puts it on the row like `coverFound`. Nothing is written: the preview takes it.
   */
  async function findCover(key: string) {
    if (!GOODREADS_COVERS || phase.value !== 'preview' || coverSearch.value?.state === 'asking') return
    const index = indexOf(key)
    const book = books.value[index]
    if (!book || !editions.value[index]) return
    const mine = { key, state: 'asking' as const }
    coverSearch.value = mine
    const settle = (state: 'found' | 'none' | 'failed') => {
      if (coverSearch.value === mine) coverSearch.value = { key, state }
    }
    const goodreadsBookId = /^goodreads:(\d{1,20})$/.exec(key)?.[1] ?? null
    const answer = await goodreadsCovers()?.find({ title: book.title, authors: book.authors, goodreadsBookId })
    if (!answer) return settle('failed')
    // Blocked: the same quiet "no cover found" a miss gets, and the owner's log hears of it.
    if (answer === 'blocked') {
      goodreadsBlocked()
      return settle('none')
    }
    const cover = answer.coverUrl ? await verifyCover(answer.coverUrl, { probe: probeImageInBrowser }).catch(() => null) : null
    if (!cover?.coverUrl || coverSearch.value !== mine) return settle('none')
    coverFound(key, { ...cover, coverUrl: cover.coverUrl, source: 'goodreads', kind: 'goodreads' })
    settle('found')
  }

  function startFill() {
    stopFill()
    if (!liveFetch || !searcher) return
    const own: CoverFill = (fill = createCoverFill({
      fetch: liveFetch,
      search: searcher,
      probe: probeImageInBrowser,
      hostBlockedFor: (host) => liveFetch?.blockedFor(host) ?? 0,
      goodreads: async (query) => {
        const answer = await goodreadsCovers()?.find(query)
        // Not asked (offline, refused, over the limit): a failure the stage's breaker counts.
        if (!answer) throw new Error('goodreads cover unavailable')
        return answer === 'blocked' ? answer : answer.coverUrl
      },
      onBlocked: goodreadsBlocked,
      onFound: (key, found) => {
        if (fill === own) coverFound(key, found)
      },
      onProgress: (progress) => {
        if (fill !== own) return
        coverProgress.value = progress.total ? progress : null
        // Every row answered: what was found is kept on the device with the matches (a reload does not ask again).
        if (progress.total && progress.done >= progress.total) keepMatches()
      },
    }))
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
    for (const [index, { book, edition, verdict }] of rows.value.entries()) {
      if (verdict === 'imported' || verdict === 'inLibrary' || chosen.value.has(index)) continue
      if (!edition || (verdict !== 'matched' && verdict !== 'fromFile')) continue
      // The one rule of the preview (data/bookImport.ts): a row without a cover, or that nothing identifies, needs a look.
      const review = reviewOf(book, edition, verdict === 'matched')
      const findCover = GOODREADS_COVERS && !review.shown?.coverUrl
      // The row whose cover was just found stays, so its status ("Cover found.") is read where it was asked.
      if (review.tier !== 'quiet' || findCover || coverSearch.value?.key === book.key)
        list.push({
          key: book.key,
          title: book.title,
          authors: book.authors,
          edition: review.shown,
          choose: review.choose,
          look: review.tier === 'needsLook',
          notes: review.notes,
          ...(findCover ? { findCover } : {}),
        })
    }
    for (const row of skipped.value) {
      list.push({ key: `skipped:${row.row}`, title: row.title, authors: [], edition: null, choose: false, look: true, notes: [row.problem] })
    }
    return list
  })

  /** Books whose edition she chose herself, in file order: each can be changed again. */
  const choices = computed<Attention[]>(() => {
    const list: Attention[] = []
    for (const [index, { book, edition, verdict }] of rows.value.entries()) {
      if (!chosen.value.has(index) || !edition) continue
      list.push({
        key: book.key,
        title: book.title,
        authors: book.authors,
        edition: edition.coverFrom ?? edition.book,
        choose: true,
        look: false,
        held: edition.book,
        notes: [{ code: verdict === 'inLibrary' ? 'chosenInLibrary' : 'chosen' }, ...book.problems],
      })
    }
    return list
  })

  // ------------------------------------------------------------------ actions

  function stopWatching() {
    if (stallTimer) clearInterval(stallTimer)
    stallTimer = null
    stalled.value = false
    secondPass.value = null
  }

  /** Marks that something answered, and starts watching for the opposite while the lookup runs. */
  function answered() {
    lastAnswerAt = Date.now()
    stalled.value = false
  }
  function watchForStall() {
    answered()
    if (!import.meta.client) return
    stallTimer = setInterval(() => {
      if (Date.now() - lastAnswerAt > STALL_MS) stalled.value = true
    }, 5000)
  }

  function reset() {
    lookup?.abort()
    lookup = null
    stopFill()
    stopWatching()
    stopChoosing()
    coverSearch.value = null
    chosen.value = new Set()
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

  /**
   * Every looked-up row ends with an edition: one nothing answered for (the lookup was
   * stopped, or it never got to it) is the file's own row, marked as not looked up.
   * A row never stays "pending": it is Added from the file and needs a look.
   */
  function settle(pending: { book: ImportBook; index: number }[]) {
    for (const { book, index } of pending) {
      if (editions.value[index]) continue
      const edition: Edition = { ...fileEdition(book), unsure: true }
      editions.value[index] = edition
      verdicts.value[index] = verdictOf(book, edition)
    }
    version.value++
  }
  let looking: { book: ImportBook; index: number }[] = []

  // What the lookup found for sure, kept on the device every few rows: a reload loses no lookups.
  const matchMemory = new Map<string, StoredMatch>()
  let unsaved = 0
  function keepMatches() {
    unsaved = 0
    const memberId = session.member?.id
    if (import.meta.client && memberId && matchMemory.size) writeMatches(window.localStorage, memberId, matchMemory)
  }
  function remember(key: string, edition: Edition) {
    // A row nothing was found for, or that could not be asked, is asked again next time.
    if (!edition.via || edition.unsure) return
    matchMemory.set(key, { book: edition.book as unknown as StoredMatch['book'], via: edition.via, coverFrom: (edition.coverFrom ?? null) as StoredMatch['coverFrom'] })
    if (++unsaved >= 25) keepMatches()
  }

  /**
   * Goes on to the preview with what the lookup has found: the rest is added as the
   * file says and listed as "needs a look". For a lookup that stalls or that she
   * does not want to wait for; the books can be chosen again in the preview.
   */
  function finishNow() {
    if (phase.value !== 'matching') return
    const controller = lookup
    lookup = null
    controller?.abort()
    settle(looking)
    stopWatching()
    keepMatches()
    fill?.holdSearch(false)
    phase.value = 'preview'
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
    chosen.value = new Set()
    verdicts.value = parsed.books.map((book) => verdictOf(book, null))

    // Rows decided already (imported before, or hers under another edition) are not looked up.
    const undecided = parsed.books.map((book, index) => ({ book, index })).filter(({ index }) => verdicts.value[index] === null)
    // What an earlier lookup of this file found for sure (kept on this device) is not looked up again.
    const memberId = session.member?.id
    const remembered = import.meta.client && memberId ? readMatches(window.localStorage, memberId) : new Map<string, StoredMatch>()
    matchMemory.clear()
    for (const [key, match] of remembered) matchMemory.set(key, match)
    startFill()
    const pending = undecided.filter(({ book, index }) => {
      const match = remembered.get(book.key)
      if (!match) return true
      editions.value[index] = {
        book: match.book as unknown as Edition['book'],
        via: match.via,
        unsure: false,
        ...(match.coverFrom ? { coverFrom: match.coverFrom as unknown as Edition['book'] } : {}),
      }
      verdicts.value[index] = verdictOf(book, editions.value[index]!)
      // Rows kept from an earlier run that still have no cover go on looking for one.
      wantCover(index)
      return false
    })
    progress.total = undecided.length
    progress.done = undecided.length - pending.length
    phase.value = 'matching'
    version.value++

    const controller = new AbortController()
    lookup = controller
    looking = pending
    const found = new Set<number>()
    watchForStall()
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
            remember(parsed.books[at]!.key, edition)
            answered()
            version.value++
            // An identified row without a cover is looked at in the background, while the lookup goes on.
            wantCover(at)
          },
          onSecondPass(done, total) {
            secondPass.value = { done, total }
            answered()
          },
        },
      )
    } catch (error) {
      if (isAbort(error)) return
      // Whatever went wrong, the lookup ends: what was found stands, the rest is the file's own.
    } finally {
      if (lookup === controller) lookup = null
    }
    if (controller.signal.aborted) return
    settle(pending)
    stopWatching()
    keepMatches()
    fill?.holdSearch(false)
    phase.value = 'preview'
  }

  // ------------------------------------------------------- choosing an edition

  /** The sheet is about this row; null while it is closed. */
  const choosing = ref<EditionChoosing | null>(null)
  let asking: AbortController | null = null

  function indexOf(key: string): number {
    return books.value.findIndex((book) => book.key === key)
  }

  function stopChoosing() {
    asking?.abort()
    asking = null
    choosing.value = null
  }

  /**
   * Asks the sources for the row's editions once the sheet is open: the
   * match's own pool, questions and ranking (`BookImport.candidates`: every
   * question of the ladder, the Open Library work's editions, the paced
   * `fetch` the lookup and the cover fill share, so a busy Apple is waited for,
   * not met with a refusal). Their finds are added behind what the match found,
   * in that ranking, and never move a row that is shown. A lookup of the work
   * needs the network: offline there is none, and the sheet says so.
   */
  async function lookForEditions(index: number) {
    const book = books.value[index]
    const edition = editions.value[index]
    const repo = importer()
    if (!book || !edition || !repo || !isOnline()) return
    asking?.abort()
    const controller = new AbortController()
    asking = controller
    const now = choosing.value
    if (!now) return
    now.pending = true
    now.failed = false
    try {
      const outcome = await repo.candidates(book, edition, { signal: controller.signal })
      const sheet = choosing.value
      if (!sheet || asking !== controller) return
      const fresh: EditionChoice[] = outcome.editions.map((found) => ({ book: found, current: false }))
      const merged = appendEditions(sheet.rows, [...sheet.rows.filter((row) => row.current), ...fresh])
      // A row keeps its place and what it is (the file's own row).
      sheet.rows = merged.map((row, at) => (sheet.rows[at]?.file ? { ...row, file: true } : row))
      sheet.pending = false
      sheet.failed = outcome.failed
    } catch (thrown) {
      if (isAbort(thrown)) return
      if (asking === controller && choosing.value) {
        choosing.value.pending = false
        choosing.value.failed = true
      }
    }
  }

  /** Opens the sheet for a row of the preview (only once every row is looked up). */
  function openChoice(key: string) {
    if (phase.value !== 'preview') return
    const index = indexOf(key)
    const book = books.value[index]
    const edition = editions.value[index]
    if (!book || !edition) return
    stopChoosing()
    choosing.value = { key, rows: editionChoices(book, edition), pending: false, failed: false, picked: candidateKey(edition.book) }
    void lookForEditions(index)
  }

  /** The row the sheet is about, as the file has it (its title, authors, language): what "My edition isn't listed" starts from. */
  const choosingBook = computed<BookSnapshot | null>(() => {
    const index = choosing.value ? indexOf(choosing.value.key) : -1
    const book = books.value[index]
    return book ? fileEdition(book).book : null
  })

  /** Searches again after a failed search, or once the connection is back. */
  function retryChoice() {
    const index = choosing.value ? indexOf(choosing.value.key) : -1
    if (index >= 0) void lookForEditions(index)
  }

  function closeChoice() {
    stopChoosing()
  }

  /** Whether a Book is the picked one (any of its keys: a row's key can change as a slower source fills it in). */
  function isPicked(book: Edition['book']): boolean {
    const sheet = choosing.value
    if (!sheet) return false
    const keys = editionKeys(book)
    // The row as the file has it (a Manual book) has no key but its title, as `candidateKey` says.
    return (keys.length ? keys : [book.title]).includes(sheet.picked)
  }

  function pick(choice: EditionChoice) {
    if (choosing.value) choosing.value.picked = candidateKey(choice.book)
  }

  /** The row she picked, unless it is the edition the preview has now. */
  const choice = computed(() => {
    const found = choosing.value?.rows.find((row) => isPicked(row.book))
    return found && !found.current ? found : null
  })

  /**
   * The picked edition replaces the row's, in the preview only: the row moves
   * to Matched (or From file, when she keeps it as the file has it) and the
   * import writes that edition. Nothing is written here.
   */
  function confirmChoice() {
    const sheet = choosing.value
    const picked = choice.value
    if (!sheet || !picked) return
    useEdition(sheet.key, picked.file ? null : picked.book)
  }

  /**
   * A row takes an edition, in the preview only: the one picked in the sheet,
   * the one found by its ISBN or the one she made herself ("My edition isn't
   * listed"), or, with `null`, the row as the file has it. Nothing is written.
   */
  function useEdition(key: string, picked: Book | BookSnapshot | null) {
    const index = indexOf(key)
    const book = books.value[index]
    const before = editions.value[index]
    if (!book || !before) return
    const alternatives = before.alternatives ?? []
    const next: Edition = picked ? { book: picked, via: 'title', unsure: false, alternatives } : fileEdition(book, alternatives)
    editions.value[index] = next
    verdicts.value[index] = verdictOf(book, next)
    chosen.value = new Set(chosen.value).add(index)
    fill?.drop(book.key)
    version.value++
    stopChoosing()
  }

  /** Writes every row that is not in her Library yet. */
  async function start() {
    const repo = importer()
    if (!repo || phase.value !== 'preview') return
    stopChoosing()
    // Pressed while covers are still being asked for: a short grace, then the write takes what is there.
    phase.value = 'importing'
    progress.total = toImport.value.length
    progress.done = 0
    outcomes.value = []
    writeError.value = null
    fill?.holdSearch(false)
    if (fill) await fill.settled(COVER_GRACE_MS)
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
      coverFilled: edition!.filled,
    }))
    progress.total = pending.length

    // Rows not written yet take the covers that came in meanwhile (the fill goes on during the write).
    const at = new Map(books.value.map((book, index) => [book.key, index]))
    const written = await repo.write(pending, {
      onWritten(chunk) {
        outcomes.value = [...outcomes.value, ...chunk]
        progress.done += chunk.length
      },
      refresh(row) {
        const edition = editions.value[at.get(row.key) ?? -1]
        return edition ? { ...row, book: edition.book, coverFrom: edition.coverFrom ?? null, coverFilled: edition.filled } : row
      },
    })
    stopFill()
    if (written.error) writeError.value = written.error
    else if (import.meta.client) clearMatches(window.localStorage)
    phase.value = 'done'
    // Home stops offering the import to her (utils/importHint.ts).
    if (import.meta.client && session.member && outcomes.value.some((outcome) => outcome.outcome === 'added' || outcome.outcome === 'imported'))
      writeImportHint(window.localStorage, session.member.id, 'imported')
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
    choices,
    choosing,
    choice,
    isPicked,
    pick,
    openChoice,
    findCover,
    coverSearch,
    retryChoice,
    closeChoice,
    confirmChoice,
    useEdition,
    choosingBook,
    progress,
    secondPass,
    coverProgress,
    stalled,
    finishNow,
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
