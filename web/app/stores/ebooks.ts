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
import { clearlyAnotherBook, findQuery } from '~/data/ebooks/match'
import type { LibraryEntry } from '~/data/library'
import { SHARED_EBOOKS_CACHE } from '~/data/localData'
import { useLibraryStore } from '~/stores/library'
import { useSearchStore } from '~/stores/search'
import { useSessionStore } from '~/stores/session'

/** Where a report came from: a share, a scan of the folder. */
export type ReportSource = Extract<EbookSource, 'share' | 'folder'>

/** A file picked for a Book that looks like another book: the member says whether to link it anyway. */
export type PickQuestion = { file: File; entry: LibraryEntry; title: string | null; authors: string[] }

/** How long after Find book an added Book is taken for the file's. */
const FIND_WINDOW_MS = 15 * 60_000

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
  const search = useSearchStore()

  /** The browser can keep copies (the origin private file system): without it nothing ebook-related is offered. */
  const supported = import.meta.client && typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
  /** The browser can pick a folder (Chrome on Android and desktop; not Safari or Firefox). */
  const folderSupported = supported && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

  const records = shallowRef<readonly EbookRecord[]>([])
  const missing = shallowRef<ReadonlySet<string>>(new Set())
  const loaded = ref(false)
  const folder = shallowRef<EbookFolder | null>(null)
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
  /** The question for a file picked for a Book that is clearly another book. */
  const question = shallowRef<PickQuestion | null>(null)
  /** Why the last action failed: not an EPUB, no room, or a folder that could not be read. */
  const error = ref<'not_epub' | 'storage' | 'folder' | null>(null)
  /** The entry the last Add ebook was for, so its page alone says how it went. */
  const pickedFor = ref<string | null>(null)

  const linked = computed(() => records.value.filter((record) => record.state === 'linked'))
  const waiting = computed(() => records.value.filter((record) => record.state === 'unlinked'))

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
    return [...library.reading, ...library.wantToRead, ...library.finished]
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
          question.value = { file, entry, title: metadata.title, authors: metadata.authors }
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

  /** Find book: search opens with the file's title and first author; the Book she adds next is linked to the file. */
  function find(record: EbookRecord) {
    finding.value = record
    findingSince = Date.now()
    search.open()
    search.query = findQuery(record.metadata, record.name)
  }

  // The Book she added while finding is the file's; any other add may be the Book a waiting file is.
  library.$onAction(({ name, args, after }) => {
    if (name === 'confirmAdd') {
      after(async (entry) => {
        if (!entry) return
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

  /**
   * When the app opens with a picked folder whose permission is still there
   * (desktop Chrome may keep it; Android never does across a restart), the
   * folder is scanned without a tap. Never asks.
   */
  async function scanIfAllowed() {
    if (folder.value && (await folderGranted())) await scan()
  }

  function clearReport() {
    report.value = null
  }

  function stopFinding() {
    finding.value = null
  }

  function reset() {
    for (const id of [...coverUrls.keys()]) revoke(id)
    records.value = []
    missing.value = new Set()
    folder.value = null
    report.value = null
    choosing.value = null
    finding.value = null
    question.value = null
    error.value = null
    pickedFor.value = null
    loaded.value = false
    repository = null
    persistAsked = false
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      reset()
      if (now) void load().then(scanIfAllowed)
    },
    { immediate: true },
  )

  return {
    supported,
    folderSupported,
    records,
    missing,
    loaded,
    folder,
    busy,
    report,
    choosing,
    finding,
    question,
    error,
    pickedFor,
    linked,
    waiting,
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
    coverOf,
    pickFolder,
    scan,
    folderGranted,
    clearReport,
    stopFinding,
    reset,
  }
})
