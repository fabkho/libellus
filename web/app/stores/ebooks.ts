import { defineStore } from 'pinia'
import {
  createEbooks,
  indexedDbEbookRecords,
  memoryEbookRecords,
  reportOf,
  type Added,
  type EbookFolder,
  type EbookRecord,
  type EbookReport,
  type EbookSource,
  type Ebooks,
} from '~/data/ebooks/ebooks'
import { memberDir, memoryFiles, opfsFiles } from '~/data/ebooks/files'
import { firstEbookLinked, hasOpenableEbook } from '~/data/reader/prefetch'
import { readEbooksSnapshot, saveEbooksSnapshot } from '~/data/ebooks/snapshot'
import { clearlyAnotherBook, fileAuthors, fileTitle, findQuery } from '~/data/ebooks/match'
import type { Book, BookSnapshot } from '~/data/books'
import type { LibraryEntry, LibraryErrorCode } from '~/data/library'
import { workKey } from '~/data/merge'
import { SHARED_EBOOKS_CACHE } from '~/data/localData'
import { isLocalId } from '~/data/queuedWrites'
import { useEditionStore } from '~/stores/edition'
import { useLibraryStore } from '~/stores/library'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'
import { useSyncStore } from '~/stores/sync'
import { prefetchReader } from '~/utils/readerChunks'

/** Where a report came from: a share, a scan of the folder. */
export type ReportSource = Extract<EbookSource, 'share' | 'folder'>

/** A file picked for a Book that looks like another book: the member says whether to link it anyway. */
export type PickQuestion = { file: File; entry: LibraryEntry; title: string | null; authors: string[] }

/** How long after Find book an added Book is taken for the file's. */
const FIND_WINDOW_MS = 15 * 60_000

/** How long the note after a link from search offers Undo. */
export const LINK_UNDO_MS = 5000

/**
 * Find book found another edition of a Book in her Library: the file goes to
 * her edition (the default) or her entry changes to the edition found and the
 * file goes with it. The sheet asking it (components/ebooks/EditionChoiceSheet.vue).
 */
export type EditionChoice = { record: EbookRecord; entry: LibraryEntry; book: Book | BookSnapshot }

/** A link made from search, while its note shows: the Book, and the record as it was before when Undo can put it back. */
export type LinkUndo = { before: EbookRecord | null; title: string; bookId: string }

/** A file for a Book that has an ebook already: replace that one with it, or keep the one there (the file is ignored). */
export type CopyQuestion = { record: EbookRecord; entry: LibraryEntry; current: EbookRecord; fromSearch: boolean }

type DirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
  requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
}

/**
 * Ebook files on this device, linked to Books (issue #131, phase 1;
 * data/ebooks/). The member's records, which copies are missing, the picked
 * folder, the last share's or scan's report, and the actions the screens
 * offer: take shared files in, add a file for one Book (with a question when
 * it is clearly another book), scan the folder (asking for the permission
 * only on her tap), pick a Book for a waiting file (a candidate, or Find book:
 * search opens with its title and author, and the Book she adds is linked to
 * it), unlink, ignore.
 *
 * Nothing leaves the device; the server never hears about any of it. Another
 * member, or nobody, empties it; signing out deletes the records and copies
 * (stores/session.ts, `forgetDevice`).
 */
export const useEbooksStore = defineStore('ebooks', () => {
  const session = useSessionStore()
  const library = useLibraryStore()
  const sync = useSyncStore()
  const search = useSearchStore()

  /** The browser can keep copies (the origin private file system): without it nothing ebook-related is offered. */
  const supported = import.meta.client && typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
  /** The browser can pick a folder (Chrome on Android and desktop; not Safari or Firefox). */
  const folderSupported = supported && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

  const records = shallowRef<readonly EbookRecord[]>([])
  const missing = shallowRef<ReadonlySet<string>>(new Set())
  const loaded = ref(false)
  const folder = shallowRef<EbookFolder | null>(null)
  /**
   * The records shown come from the device's snapshot (data/ebooks/snapshot.ts)
   * until IndexedDB answers: the page's first frame is complete, and the read
   * then reconciles it.
   */
  const restored = ref(false)
  /** The folder as the snapshot remembers it (no handle), until the real one is read. */
  const rememberedFolder = shallowRef<Pick<EbookFolder, 'name' | 'pickedAt' | 'scannedAt'> | null>(null)
  /** The folder to show: the picked one, else the remembered one. */
  const folderShown = computed(() => folder.value ?? (loaded.value ? null : rememberedFolder.value))
  /** Whether the lists can be shown: read, or restored from the snapshot. */
  const known = computed(() => loaded.value || restored.value)
  /** A share or a scan is being taken in: how far. */
  const busy = ref<{ source: ReportSource | 'picker'; done: number; total: number } | null>(null)
  /** What the last share or scan did ("3 ebooks · 2 linked · 1 needs you"), until another replaces it. */
  const report = shallowRef<(EbookReport & { source: ReportSource }) | null>(null)
  /** The file the candidate sheet is about. */
  const choosing = shallowRef<EbookRecord | null>(null)
  /**
   * The waiting file whose Book the member is looking for (Find book): the next
   * Book she adds (from the search, or from a result's page) is linked to it,
   * within `FIND_WINDOW_MS`. Coming back to the ebooks page ends it.
   */
  const finding = shallowRef<EbookRecord | null>(null)
  let findingSince = 0
  /** The edition question after Find book found another edition of one of her Books. */
  const editionChoice = shallowRef<EditionChoice | null>(null)
  /** Why switching the edition for a file failed (it stays unlinked). */
  const editionError = ref<LibraryErrorCode | null>(null)
  const editionBusy = ref(false)
  /** The question about another copy of a Book that has an ebook already. */
  const copyQuestion = shallowRef<CopyQuestion | null>(null)
  /** The last link made from search, while Undo is on offer. */
  const linkUndo = shallowRef<LinkUndo | null>(null)
  let undoTimer: ReturnType<typeof setTimeout> | undefined
  /** The question for a file picked for a Book that is clearly another book. */
  const question = shallowRef<PickQuestion | null>(null)
  /** Why the last action failed: not an EPUB, no room, or a folder that could not be read. */
  const error = ref<'not_epub' | 'storage' | 'folder' | null>(null)
  /** The entry the last Add ebook was for, so its page alone says how it went. */
  const pickedFor = ref<string | null>(null)

  const linked = computed(() => records.value.filter((record) => record.state === 'linked'))
  const waiting = computed(() => records.value.filter((record) => record.state === 'unlinked'))
  /**
   * The waiting files that are another copy of a Book with an ebook already
   * (matching found that one Book, and it has a file): the page shows them
   * apart and quietly, with Replace and Keep the current one.
   */
  const copies = computed(() => waiting.value.filter((record) => copyOf(record) !== null))
  /** The waiting files that need her to say which Book they are. */
  const unmatched = computed(() => waiting.value.filter((record) => copyOf(record) === null))

  /** The entry a waiting file is another copy for, and the file linked to it now; null when it is not one. */
  function copyOf(record: EbookRecord): { entry: LibraryEntry; current: EbookRecord } | null {
    if (record.state !== 'unlinked' || record.candidates.length !== 1) return null
    const entry = library.entryForBook(record.candidates[0]!)
    const current = entry ? linkFor(entry) : null
    return entry && current && current.id !== record.id ? { entry, current } : null
  }

  let repository: { memberId: string; ebooks: Ebooks } | null = null
  function repo(): Ebooks | null {
    const memberId = session.member?.id
    if (!supported || !memberId) return null
    if (repository?.memberId !== memberId) {
      const files = typeof navigator.storage?.getDirectory === 'function' ? opfsFiles() : memoryFiles()
      repository = {
        memberId,
        ebooks: createEbooks({
          memberId,
          records: typeof indexedDB === 'undefined' ? memoryEbookRecords() : indexedDbEbookRecords(indexedDB),
          files,
          ingest: workerIngest(memberDir(memberId)),
        }),
      }
    }
    return repository.ebooks
  }

  let reads: Promise<void> = Promise.resolve()
  /**
   * Reads the member's records and which copies are gone. Reads queue: each
   * starts after the one before, so one asked for after a change sees it, and
   * one for the member signed in now is never answered by the last one's.
   */
  function load(): Promise<void> {
    const read = async () => {
      const ebooks = repo()
      if (!ebooks) return
      const memberId = session.member?.id
      const [list, picked] = await Promise.all([ebooks.list(), ebooks.folder()])
      const gone = await ebooks.missing(list)
      if (memberId !== session.member?.id) return
      records.value = list
      missing.value = gone
      // A folder that could not be stored stays for the session.
      folder.value = picked ?? folder.value
      loaded.value = true
      if (memberId && typeof localStorage !== 'undefined') saveEbooksSnapshot(localStorage, memberId, { records: list, missing: gone, folder: folder.value })
    }
    reads = reads.then(read, read)
    return reads
  }

  /** The file linked to an entry's Book (through the entry, so a change of edition keeps it). */
  function linkFor(entry: Pick<LibraryEntry, 'id' | 'book'> | null | undefined): EbookRecord | null {
    if (!entry) return null
    return linked.value.find((record) => record.entryId === entry.id || record.bookId === entry.book.id) ?? null
  }

  /**
   * The member's Library as matching sees it: read again when there is a
   * connection (a Book added on another device, or since this device saved its
   * copy), else the device's copy (offline, linking works all the same).
   */
  async function entries(): Promise<LibraryEntry[]> {
    if (!library.loaded || isOnline()) await library.load()
    // An entry still waiting to sync (added from search, optimistic) has no id the database knows: a link kept on the device would name it.
    return [...library.reading, ...library.wantToRead, ...library.finished].filter((entry) => !isLocalId(entry.id))
  }

  /** Ask the browser to keep the copies under storage pressure, once there is one worth keeping. */
  let persistAsked = false
  function persist() {
    if (persistAsked || !linked.value.length) return
    persistAsked = true
    void navigator.storage?.persist?.().catch(() => false)
  }

  async function refresh() {
    await load()
    persist()
  }

  /** Takes in files that arrived together (a share), linking what fits; the report says what happened. One batch at a time. */
  let batches: Promise<unknown> = Promise.resolve()
  function addFiles(files: readonly File[], source: ReportSource): Promise<EbookReport | null> {
    const next = batches.then(
      () => takeIn(files, source),
      () => takeIn(files, source),
    )
    batches = next
    return next
  }

  async function takeIn(files: readonly File[], source: ReportSource): Promise<EbookReport | null> {
    const ebooks = repo()
    if (!ebooks || !files.length) return null
    busy.value = { source, done: 0, total: files.length }
    try {
      const all = await entries()
      const results: Added[] = []
      for (const file of files) {
        results.push(await ebooks.add(file, { source, name: file.name, lastModified: file.lastModified }, all))
        busy.value = { source, done: results.length, total: files.length }
      }
      const done = { ...reportOf(results), source }
      report.value = done
      await refresh()
      return done
    } finally {
      busy.value = null
    }
  }

  /**
   * The share sheet's files, kept by the service worker in Cache Storage until
   * now (public/sw-share.js): every share waiting there is taken in, then
   * removed from the cache. A share that arrives meanwhile stays for the next
   * time; one that could not be taken in (no member, no storage) stays too.
   */
  async function takeShared(): Promise<EbookReport | null> {
    if (typeof caches === 'undefined' || !repo()) return null
    const cache = await caches.open(SHARED_EBOOKS_CACHE)
    const files: File[] = []
    const taken: string[] = []
    for (const metaRequest of (await cache.keys()).filter((request) => new URL(request.url).pathname.endsWith('/meta'))) {
      const meta = (await (await cache.match(metaRequest))?.json().catch(() => null)) as {
        id: string
        files: { index: number; name: string; type: string; lastModified: number }[]
      } | null
      if (!meta) continue
      for (const item of meta.files) {
        const response = await cache.match(`/__shared/${meta.id}/${item.index}`)
        if (response) files.push(new File([await response.blob()], item.name, { type: item.type || 'application/epub+zip', lastModified: item.lastModified }))
      }
      taken.push(metaRequest.url, ...meta.files.map((item) => new URL(`/__shared/${meta.id}/${item.index}`, metaRequest.url).href))
    }
    const done = files.length ? await addFiles(files, 'share') : null
    if (done || !files.length) for (const url of taken) await cache.delete(url)
    return done
  }

  // ---------------------------------------------------------------- one Book

  /**
   * A file picked for a Book (Add ebook, Replace file): linked to it at once,
   * unless it clearly is another book (its ISBN or title differs): then the
   * member is asked (`question`) and `confirmPick` links it anyway.
   */
  async function addForBook(file: File, entry: LibraryEntry, { checked = false } = {}): Promise<boolean> {
    const ebooks = repo()
    if (!ebooks) return false
    error.value = null
    pickedFor.value = entry.id
    busy.value = { source: 'picker', done: 0, total: 1 }
    try {
      if (!checked) {
        const metadata = await peek(file)
        if (metadata === 'not_epub') {
          error.value = 'not_epub'
          return false
        }
        if (metadata && clearlyAnotherBook(metadata, entry.book)) {
          question.value = { file, entry, title: fileTitle(metadata), authors: fileAuthors(metadata) }
          return false
        }
      }
      const added = await ebooks.addForBook(file, { source: 'picker', name: file.name, lastModified: file.lastModified }, entry)
      if (!added.ok) {
        error.value = added.error
        return false
      }
      await refresh()
      return true
    } finally {
      busy.value = null
    }
  }

  /** The file's metadata without keeping it (the check before linking it to a Book). */
  async function peek(file: File) {
    try {
      const { readEpub } = await import('~/data/ebooks/epub')
      return readEpub(new Uint8Array(await file.arrayBuffer()), { cover: false })
    } catch (failure) {
      return (failure as { name?: string }).name === 'EpubError' ? ('not_epub' as const) : null
    }
  }

  async function confirmPick(): Promise<boolean> {
    const asked = question.value
    if (!asked) return false
    question.value = null
    return addForBook(asked.file, asked.entry, { checked: true })
  }

  function cancelPick() {
    question.value = null
  }

  async function link(record: EbookRecord, entry: LibraryEntry) {
    const ebooks = repo()
    if (!ebooks) return
    await ebooks.link(record, entry)
    choosing.value = null
    await refresh()
  }

  async function unlink(record: EbookRecord) {
    const ebooks = repo()
    if (!ebooks) return
    await ebooks.unlink(record)
    revoke(record.id)
    await load()
  }

  async function ignore(record: EbookRecord) {
    const ebooks = repo()
    if (!ebooks) return
    await ebooks.ignore(record)
    await load()
  }

  /** The Books a waiting file could be, as the Library has them now. */
  function candidatesOf(record: EbookRecord): LibraryEntry[] {
    return record.candidates.map((bookId) => library.entryForBook(bookId)).filter((entry): entry is LibraryEntry => entry !== null)
  }

  function choose(record: EbookRecord) {
    choosing.value = record
  }

  /**
   * Find book: search opens with the file's title and first author, linking
   * (`search.linking`): her own Books come first and a tap links the file to
   * one (`linkFound`), another edition of one asks which (`chooseEdition`),
   * and the Book she adds next is linked to the file.
   */
  function find(record: EbookRecord) {
    finding.value = record
    findingSince = Date.now()
    search.open({ linking: true })
    search.query = findQuery(record.metadata, record.name)
  }

  /** The file being found, as it is now: null when it was linked or ignored meanwhile. */
  async function sought(): Promise<EbookRecord | null> {
    const record = finding.value
    if (!record) return null
    return (await repo()?.list())?.find((r) => r.id === record.id && r.state === 'unlinked') ?? null
  }

  /**
   * Links the file being found to one of her entries (a tap in search's "In
   * your Library"); search closes, Undo is offered. An entry with an ebook
   * already asks first (`copyQuestion`): replace it, or keep it.
   */
  async function linkFound(entry: LibraryEntry): Promise<boolean> {
    const record = await sought()
    if (!record) return false
    const current = linkFor(entry)
    if (current && current.id !== record.id) {
      copyQuestion.value = { record, entry, current, fromSearch: true }
      return false
    }
    await link(record, entry)
    finding.value = null
    search.close()
    offerUndo(record, entry)
    return true
  }

  /** Another copy of a linked Book, from its row on the page: the same question as from search. */
  function askCopy(record: EbookRecord) {
    const copy = copyOf(record)
    if (copy) copyQuestion.value = { record, ...copy, fromSearch: false }
  }

  /** Replace: this file is the Book's ebook now; the one linked before goes from the device (record and copy). */
  async function replaceCopy() {
    const asked = copyQuestion.value
    if (!asked) return
    copyQuestion.value = null
    await link(asked.record, asked.entry)
    if (asked.fromSearch) {
      finding.value = null
      search.close()
    }
    // The old copy is gone: nothing to undo to, the note only says where it went.
    offerUndo(null, asked.entry)
  }

  /** Keep the current one: this file is ignored (its copy deleted, never offered again). */
  async function keepCurrent() {
    const asked = copyQuestion.value
    if (!asked) return
    copyQuestion.value = null
    await ignore(asked.record)
    if (asked.fromSearch) {
      finding.value = null
      search.close()
    }
  }

  /** Another edition of one of her Books, tapped while finding a file's Book: the sheet asks which edition the file is. */
  function chooseEdition(book: Book | BookSnapshot, known: readonly LibraryEntry[] = []) {
    const record = finding.value
    const work = workKey(book)
    // Her entry for that book: from what search read (`known`), else as this device has the Library.
    const entry = [...known, ...library.reading, ...library.wantToRead, ...library.finished].find((e) => workKey(e.book) === work)
    if (!record || !entry) return
    editionError.value = null
    editionChoice.value = { record, entry, book }
  }

  /**
   * The answer: `mine` links the file to her edition; `switch` changes her
   * entry to the edition found first (#41, one call) and links the file to it.
   */
  async function settleEdition(answer: 'mine' | 'switch'): Promise<boolean> {
    const asked = editionChoice.value
    if (!asked || editionBusy.value) return false
    editionBusy.value = true
    editionError.value = null
    try {
      let entry = asked.entry
      if (answer === 'switch') {
        const edition = useEditionStore()
        const changed = await edition.changeTo(entry, asked.book)
        if (!changed) {
          editionError.value = edition.error ?? 'unknown'
          return false
        }
        entry = changed
      }
      editionChoice.value = null
      return await linkFound(entry)
    } finally {
      editionBusy.value = false
    }
  }

  function offerUndo(before: EbookRecord | null, entry: LibraryEntry) {
    clearTimeout(undoTimer)
    linkUndo.value = { before, title: entry.book.title, bookId: entry.book.id }
    undoTimer = setTimeout(() => (linkUndo.value = null), LINK_UNDO_MS)
  }

  /** Undo: the file waits again as it did before the link. */
  async function undoLink() {
    const undo = linkUndo.value
    const ebooks = repo()
    clearTimeout(undoTimer)
    linkUndo.value = null
    if (!undo?.before || !ebooks) return
    await ebooks.restore(undo.before)
    await load()
  }

  // The Book she added while finding is the file's; any other add may be the Book a waiting file is.
  library.$onAction(({ name, args, after }) => {
    if (name === 'confirmAdd') {
      after(async (entry) => {
        if (!entry) return
        // Not synced yet (added from search, optimistic): a waiting file is matched once it has (below).
        if (isLocalId((entry as LibraryEntry).id)) return
        const sought = Date.now() - findingSince < FIND_WINDOW_MS ? finding.value : null
        finding.value = null
        // As it is now: ignored or linked meanwhile, it is not hers to link any more.
        const record = sought ? (await repo()?.list())?.find((r) => r.id === sought.id && r.state === 'unlinked') : null
        if (record) await link(record, entry as LibraryEntry)
        else if (waiting.value.length) {
          await repo()?.rematch(await entries())
          await refresh()
        }
      })
    }
    if (name === 'editionChanged') {
      const entry = args[0] as LibraryEntry
      after(async () => {
        await repo()?.followEdition(entry)
        await load()
      })
    }
  })

  // -------------------------------------------------------------------- covers

  /** The linked file itself, for the reader (#131 phase 2); null when the copy is gone. */
  async function fileOf(record: EbookRecord): Promise<File | null> {
    return (await repo()?.read(record)) ?? null
  }

  /** Object URLs of the files' own cover images, made once per file. */
  const coverUrls = reactive(new Map<string, string>())
  function coverOf(record: EbookRecord): string | null {
    if (!record.coverPath) return null
    const known = coverUrls.get(record.id)
    if (known !== undefined) return known || null
    coverUrls.set(record.id, '')
    void repo()
      ?.cover(record)
      .then((blob) => blob && coverUrls.set(record.id, URL.createObjectURL(blob)))
    return null
  }
  function revoke(id: string) {
    const url = coverUrls.get(id)
    if (url) URL.revokeObjectURL(url)
    coverUrls.delete(id)
  }

  // -------------------------------------------------------------------- folder

  /** Picks the ebook folder (the platform's folder picker, then its permission dialog). Null when she cancelled. */
  async function pickFolder(): Promise<EbookFolder | null> {
    const ebooks = repo()
    const picker = (window as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
    if (!ebooks || !picker) return null
    error.value = null
    let handle: FileSystemDirectoryHandle
    try {
      handle = await picker({ id: 'libellus-ebooks', mode: 'read' })
    } catch {
      return null
    }
    const picked: EbookFolder = { handle, name: handle.name, pickedAt: new Date().toISOString(), scannedAt: null }
    try {
      await ebooks.setFolder(picked)
    } catch {
      // A handle the browser cannot store (DataCloneError): kept for this session only.
    }
    folder.value = picked
    return picked
  }

  /**
   * Scans the folder. Called from the member's tap: Android forgets the
   * permission when the app restarts, and asking for it again needs a tap
   * (`requestPermission`), so it is only ever asked for here, never unasked.
   * Where the handle cannot be stored (a stand-in), `handle` is the folder itself.
   */
  async function scan(handle?: FileSystemDirectoryHandle): Promise<EbookReport | null> {
    const ebooks = repo()
    const root = (handle ?? folder.value?.handle) as PermissionHandle | undefined
    if (!ebooks || !root || busy.value) return null
    error.value = null
    try {
      const state = (await root.queryPermission?.({ mode: 'read' })) ?? 'granted'
      if (state !== 'granted' && (await root.requestPermission?.({ mode: 'read' })) !== 'granted') {
        error.value = 'folder'
        return null
      }
    } catch {
      error.value = 'folder'
      return null
    }
    busy.value = { source: 'folder', done: 0, total: 0 }
    try {
      const { report: done } = await ebooks.scan(root, await entries(), (count, total) => (busy.value = { source: 'folder', done: count, total }))
      report.value = { ...done, source: 'folder' }
      // Kept with the folder by the repository; a folder kept for this session only learns it here.
      if (folder.value) folder.value = { ...folder.value, scannedAt: new Date().toISOString() }
      await refresh()
      return report.value
    } catch {
      error.value = 'folder'
      return null
    } finally {
      busy.value = null
    }
  }

  /** Whether the folder can be scanned without asking (the permission is still there this session). */
  async function folderGranted(): Promise<boolean> {
    const root = folder.value?.handle as PermissionHandle | undefined
    try {
      return Boolean(root) && (await root!.queryPermission?.({ mode: 'read' })) === 'granted'
    } catch {
      return false
    }
  }

  /** When this app session began: a scan from before it may have missed files added since (the hint on the page). */
  const openedAt = Date.now()

  function clearReport() {
    report.value = null
  }

  function stopFinding() {
    finding.value = null
  }

  /** The page as the device last showed it, at once (data/ebooks/snapshot.ts). */
  function restore(memberId: string) {
    if (!supported || typeof localStorage === 'undefined') return
    const snapshot = readEbooksSnapshot(localStorage, memberId)
    if (!snapshot) return
    records.value = snapshot.records
    missing.value = new Set(snapshot.missing)
    rememberedFolder.value = snapshot.folder
    restored.value = true
  }

  function reset() {
    for (const id of [...coverUrls.keys()]) revoke(id)
    records.value = []
    missing.value = new Set()
    folder.value = null
    rememberedFolder.value = null
    restored.value = false
    report.value = null
    choosing.value = null
    finding.value = null
    editionChoice.value = null
    editionError.value = null
    copyQuestion.value = null
    clearTimeout(undoTimer)
    linkUndo.value = null
    question.value = null
    error.value = null
    pickedFor.value = null
    loaded.value = false
    repository = null
    persistAsked = false
  }

  // The reader is fetched ahead for a member who uses ebooks on this device (data/reader/prefetch.ts): at once when
  // she links her first one, so it is there before her first Read now. Later starts: plugins/reader-prefetch.client.ts.
  watch(
    () => hasOpenableEbook({ records: records.value, missing: missing.value }),
    (now, before) => {
      if (firstEbookLinked(before, now, loaded.value)) prefetchReader()
    },
  )

  // What was added from search while the outbox held it may be a Book a waiting file is: matched now it is synced.
  watch(
    () => sync.pending,
    async (now, before) => {
      if (now !== 0 || !before || !waiting.value.length) return
      await repo()?.rematch(await entries())
      await refresh()
    },
  )

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      reset()
      // Never a scan unasked (owner, #131): the page hints at Scan again instead.
      if (now) {
        restore(now)
        void load()
      }
    },
    { immediate: true },
  )

  return {
    supported,
    folderSupported,
    records,
    missing,
    loaded,
    known,
    folder,
    folderShown,
    busy,
    report,
    choosing,
    finding,
    editionChoice,
    copyQuestion,
    editionError,
    editionBusy,
    linkUndo,
    question,
    error,
    pickedFor,
    linked,
    waiting,
    copies,
    unmatched,
    copyOf,
    askCopy,
    replaceCopy,
    keepCurrent,
    load,
    linkFor,
    addFiles,
    takeShared,
    addForBook,
    confirmPick,
    cancelPick,
    link,
    unlink,
    ignore,
    candidatesOf,
    choose,
    find,
    linkFound,
    chooseEdition,
    settleEdition,
    undoLink,
    coverOf,
    fileOf,
    pickFolder,
    scan,
    folderGranted,
    openedAt,
    clearReport,
    stopFinding,
    reset,
  }
})
