import type { LibraryEntry } from '../library'
import { openLocalDatabase } from '../localData'
import type { EpubMetadata } from './epub'
import type { EbookFiles, Ingested } from './files'
import { matchEbook } from './match'

/**
 * Ebook files on the device, linked to Books (issue #131, phase 1). A file
 * arrives from one of three places — the picked ebook folder (a scan), the
 * share sheet (the manifest's share target), or the file picker on a Book
 * page — and is taken in the same way: its metadata read and the file copied
 * into the origin private file system (`files.ts`, in a worker), then matched
 * to a Book in the member's Library (`match.ts`). What the device knows about
 * each file is one record in IndexedDB (`ebooks` store of the device's
 * database): where its copy is, what it was called, its fingerprint, what its
 * package document says, and the Book it is linked to.
 *
 * A record is
 *   - linked: to one Book (one file per Book; linking another replaces it),
 *   - unlinked: waiting for the member (*Unlinked ebooks*: no Book fits, or
 *     several do and she picks; `candidates` names them),
 *   - ignored: she said so; its copy is deleted, the record stays so the same
 *     file is not offered again.
 *
 * Nothing is uploaded: the server never learns about the files. Each member
 * has her own records and copies; signing out removes all of them
 * (`localData.ts`). A copy the browser evicted shows as missing; the next scan
 * or share of the same file writes it again.
 *
 * Framework-free: the store hands in the storage, the files, the ingest (the
 * worker) and the clock; the tests memory and the in-process ingest.
 */

export type EbookSource = 'folder' | 'share' | 'picker'
export type EbookState = 'linked' | 'unlinked' | 'ignored'

export type EbookRecord = {
  /** The copy's id (`fileIdOf`: fingerprint and size). With `memberId` the record's key. */
  id: string
  memberId: string
  /** SHA-256 of the file's first megabyte. */
  hash: string
  /** The copy in OPFS. */
  path: string
  /** The cover image's copy in OPFS, null when the file has none. */
  coverPath: string | null
  /** The original file's name, size and last change (null for a shared file: the share sheet gives the time it was received). */
  name: string
  size: number
  lastModified: number | null
  /** Where it was found inside the picked folder (`Fiction/Moby Dick.epub`), null when it came another way. */
  folderPath: string | null
  metadata: EpubMetadata
  state: EbookState
  bookId: string | null
  /** The Library entry it was linked through, so it follows a change of edition (the entry keeps its id). */
  entryId: string | null
  /** The Books it could be, when matching found several (or a title without its author). */
  candidates: string[]
  linkedAt: string | null
  addedAt: string
  source: EbookSource
}

/** The picked ebook folder: its handle (structured-cloned into IndexedDB), its name to show, when it was last scanned. */
export type EbookFolder = { handle: FileSystemDirectoryHandle; name: string; pickedAt: string; scannedAt: string | null }

export type EbookRecords = {
  list: (memberId: string) => Promise<EbookRecord[]>
  put: (record: EbookRecord) => Promise<void>
  remove: (memberId: string, id: string) => Promise<void>
  folder: (memberId: string) => Promise<EbookFolder | null>
  putFolder: (memberId: string, folder: EbookFolder | null) => Promise<void>
}

/** Takes one file in (reads it, copies it into the member's folder). The worker in the app. */
export type Ingest = (file: Blob) => Promise<Ingested>

/** How a file came in: the source, and what the original was called and when it last changed. */
export type Arrival = { source: EbookSource; name: string; lastModified: number | null; folderPath?: string | null }

/** Why a file was not taken in: not an EPUB, or the device could not keep the copy (storage full, no OPFS). */
export type EbookErrorCode = 'not_epub' | 'storage'

export type Added =
  | { ok: true; record: EbookRecord; duplicate: boolean }
  | { ok: false; name: string; error: EbookErrorCode }

/** What a share or a scan did, in the words the result says it with ("3 ebooks · 2 linked · 1 needs you"). */
export type EbookReport = {
  total: number
  linked: number
  needsYou: number
  /** Files the member ignored before (counted in `total`, not shown again). */
  ignored: number
  failed: number
  /** The records it touched, for the list under the line. */
  ids: string[]
}

export function reportOf(results: readonly Added[]): EbookReport {
  const report: EbookReport = { total: results.length, linked: 0, needsYou: 0, ignored: 0, failed: 0, ids: [] }
  const seen = new Set<string>()
  for (const result of results) {
    if (!result.ok) {
      report.failed++
      continue
    }
    if (seen.has(result.record.id)) {
      // The same file twice in one share: one ebook.
      report.total--
      continue
    }
    seen.add(result.record.id)
    report.ids.push(result.record.id)
    if (result.record.state === 'linked') report.linked++
    else if (result.record.state === 'unlinked') report.needsYou++
    else report.ignored++
  }
  return report
}

export type Ebooks = ReturnType<typeof createEbooks>

export function createEbooks({
  memberId,
  records,
  files,
  ingest,
  now = () => new Date(),
}: {
  memberId: string
  records: EbookRecords
  files: EbookFiles
  ingest: Ingest
  now?: () => Date
}) {
  const stamp = () => now().toISOString()

  async function list(): Promise<EbookRecord[]> {
    return records.list(memberId)
  }

  async function take(file: Blob): Promise<Ingested | EbookErrorCode> {
    try {
      return await ingest(file)
    } catch (error) {
      // `EpubError` (`epub.ts`), by name: it may come from the worker, and this module stays free of fflate.
      if ((error as { name?: string })?.name === 'EpubError') return 'not_epub'
      return 'storage'
    }
  }

  /** The record that already knows this copy, updated with what this arrival adds (a folder path, a name). */
  async function known(taken: Ingested, arrival: Arrival): Promise<EbookRecord | null> {
    const existing = (await records.list(memberId)).find((record) => record.id === taken.id)
    if (!existing) return null
    const updated: EbookRecord = {
      ...existing,
      // The copy may have been evicted and just written again.
      path: taken.path,
      coverPath: taken.coverPath,
      folderPath: arrival.folderPath ?? existing.folderPath,
      lastModified: arrival.source === 'folder' ? arrival.lastModified : existing.lastModified,
    }
    await records.put(updated)
    return updated
  }

  function fresh(taken: Ingested, arrival: Arrival): EbookRecord {
    return {
      id: taken.id,
      memberId,
      hash: taken.hash,
      path: taken.path,
      coverPath: taken.coverPath,
      name: arrival.name,
      size: taken.size,
      // The share sheet hands over the time it received the file, not the file's own.
      lastModified: arrival.source === 'share' ? null : arrival.lastModified,
      folderPath: arrival.folderPath ?? null,
      metadata: taken.metadata,
      state: 'unlinked',
      bookId: null,
      entryId: null,
      candidates: [],
      linkedAt: null,
      addedAt: stamp(),
      source: arrival.source,
    }
  }

  /**
   * Takes a file in and links it if a Book fits (`matchEbook`). A file the
   * device knows already keeps its record (and its link, or its Ignore); its
   * copy is written again if it was gone. A match to a Book that has another
   * file linked is left to the member, never replaced on its own.
   */
  async function add(file: Blob, arrival: Arrival, entries: readonly LibraryEntry[]): Promise<Added> {
    const taken = await take(file)
    if (typeof taken === 'string') return { ok: false, name: arrival.name, error: taken }
    const existing = await known(taken, arrival)
    if (existing?.state === 'linked') return { ok: true, record: existing, duplicate: true }
    if (existing?.state === 'ignored') {
      // Ignored before: the copy taking it in just wrote goes again.
      await files.remove(taken.path)
      return { ok: true, record: existing, duplicate: true }
    }

    // New, or still waiting: the Library may have the Book by now.
    const record: EbookRecord = { ...(existing ?? fresh(taken, arrival)), candidates: [] }
    const match = matchEbook(taken.metadata, entries)
    const linkedBooks = new Set((await records.list(memberId)).filter((r) => r.state === 'linked').map((r) => r.bookId))
    if (match.kind === 'linked' && !linkedBooks.has(match.entry.book.id)) {
      Object.assign(record, { state: 'linked', bookId: match.entry.book.id, entryId: match.entry.id, linkedAt: stamp() })
    } else if (match.kind === 'linked') {
      record.candidates = [match.entry.book.id]
    } else if (match.kind === 'ambiguous') {
      record.candidates = match.candidates.map((entry) => entry.book.id)
    }
    await records.put(record)
    return { ok: true, record, duplicate: Boolean(existing) }
  }

  /**
   * Links a record to a Book: the member picked it (a candidate, Find book, Add
   * ebook). The file linked to that Book before is replaced: its record and its
   * copy go.
   */
  async function link(record: EbookRecord, entry: LibraryEntry): Promise<EbookRecord> {
    for (const other of await records.list(memberId)) {
      if (other.id !== record.id && other.state === 'linked' && (other.bookId === entry.book.id || other.entryId === entry.id)) await unlink(other)
    }
    const linked: EbookRecord = { ...record, state: 'linked', bookId: entry.book.id, entryId: entry.id, candidates: [], linkedAt: stamp() }
    await records.put(linked)
    return linked
  }

  /** Takes a file in for one Book (Add ebook, Replace file): linked to it whatever it says (the caller asks first when it is clearly another book). */
  async function addForBook(file: Blob, arrival: Arrival, entry: LibraryEntry): Promise<Added> {
    const taken = await take(file)
    if (typeof taken === 'string') return { ok: false, name: arrival.name, error: taken }
    const existing = await known(taken, arrival)
    return { ok: true, record: await link(existing ?? fresh(taken, arrival), entry), duplicate: Boolean(existing) }
  }

  /** Removes the file from the device: its copy, its cover, its record. The Book stays. */
  async function unlink(record: EbookRecord): Promise<void> {
    await files.remove(record.path)
    if (record.coverPath) await files.remove(record.coverPath)
    await records.remove(memberId, record.id)
  }

  /** Not a Book of hers: its copy goes, the record stays so the same file is not offered again. */
  async function ignore(record: EbookRecord): Promise<EbookRecord> {
    await files.remove(record.path)
    const ignored: EbookRecord = { ...record, state: 'ignored', bookId: null, entryId: null, candidates: [], linkedAt: null }
    await records.put(ignored)
    return ignored
  }

  /**
   * Tries the waiting files again against the Library as it is now (a Book was
   * added since): any that fits one Book without a file of its own is linked.
   */
  async function rematch(entries: readonly LibraryEntry[]): Promise<EbookRecord[]> {
    const all = await records.list(memberId)
    const linkedBooks = new Set(all.filter((r) => r.state === 'linked').map((r) => r.bookId))
    const linked: EbookRecord[] = []
    for (const record of all) {
      if (record.state !== 'unlinked') continue
      const match = matchEbook(record.metadata, entries)
      if (match.kind !== 'linked' || linkedBooks.has(match.entry.book.id)) continue
      linkedBooks.add(match.entry.book.id)
      const updated: EbookRecord = { ...record, state: 'linked', bookId: match.entry.book.id, entryId: match.entry.id, candidates: [], linkedAt: stamp() }
      await records.put(updated)
      linked.push(updated)
    }
    return linked
  }

  /** The entry a linked record now points at changed edition (the entry keeps its id): the record follows it. */
  async function followEdition(entry: LibraryEntry): Promise<EbookRecord[]> {
    const moved: EbookRecord[] = []
    for (const record of await records.list(memberId)) {
      if (record.entryId !== entry.id || record.bookId === entry.book.id) continue
      const updated = { ...record, bookId: entry.book.id }
      await records.put(updated)
      moved.push(updated)
    }
    return moved
  }

  /** The linked and waiting records whose copy is gone (evicted by the browser). */
  async function missing(list: readonly EbookRecord[]): Promise<Set<string>> {
    const gone = new Set<string>()
    for (const record of list) {
      if (record.state === 'ignored') continue
      if ((await files.size(record.path)) !== record.size) gone.add(record.id)
    }
    return gone
  }

  async function read(record: EbookRecord): Promise<File | null> {
    return files.read(record.path)
  }

  async function cover(record: EbookRecord): Promise<Blob | null> {
    if (!record.coverPath) return null
    const file = await files.read(record.coverPath)
    return file ? new Blob([file], { type: record.metadata.coverType ?? 'image/jpeg' }) : null
  }

  // ------------------------------------------------------------------ the folder

  const folder = () => records.folder(memberId)
  const setFolder = (value: EbookFolder | null) => records.putFolder(memberId, value)

  /**
   * Looks through the picked folder (and its subfolders) for EPUBs and takes in
   * the ones the device does not have yet. A file whose place in the folder is
   * known and whose copy is here is not opened at all; one at an unknown place
   * with the size and last change of a known file is that file, moved; anything
   * else is read and fingerprinted (`add`), which also finds a known file under
   * another name and writes an evicted copy again. The caller has the
   * permission already (a scan asks for it on the member's tap).
   */
  async function scan(
    root: FileSystemDirectoryHandle,
    entries: readonly LibraryEntry[],
    onProgress?: (done: number, found: number) => void,
  ): Promise<{ report: EbookReport; results: Added[] }> {
    const found: { path: string; handle: FileSystemFileHandle }[] = []
    for await (const item of epubsIn(root)) found.push(item)
    const before = await records.list(memberId)
    const gone = await missing(before)
    const byPath = new Map(before.filter((r) => r.folderPath).map((r) => [r.folderPath!, r]))
    const results: Added[] = []
    let done = 0
    onProgress?.(done, found.length)
    for (const { path, handle } of found) {
      const atPath = byPath.get(path)
      if (atPath && !gone.has(atPath.id)) {
        results.push({ ok: true, record: atPath, duplicate: true })
      } else {
        let file: File | null = null
        try {
          file = await handle.getFile()
        } catch {
          results.push({ ok: false, name: path, error: 'storage' })
        }
        if (file) {
          const moved = before.find(
            (r) => !gone.has(r.id) && r.size === file!.size && r.lastModified === file!.lastModified && r.name === file!.name,
          )
          if (moved) {
            const updated = { ...moved, folderPath: path }
            await records.put(updated)
            results.push({ ok: true, record: updated, duplicate: true })
          } else {
            results.push(await add(file, { source: 'folder', name: file.name, lastModified: file.lastModified, folderPath: path }, entries))
          }
        }
      }
      onProgress?.(++done, found.length)
    }
    const current = await folder()
    if (current) await setFolder({ ...current, scannedAt: stamp() })
    return { report: reportOf(results), results }
  }

  return { list, add, addForBook, link, unlink, ignore, rematch, followEdition, missing, read, cover, folder, setFolder, scan }
}

/** Every `.epub` in a folder and its subfolders, with its path inside it. */
export async function* epubsIn(dir: FileSystemDirectoryHandle, prefix = ''): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  const entries = (dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()
  for await (const [name, handle] of entries) {
    if (handle.kind === 'directory') yield* epubsIn(handle as FileSystemDirectoryHandle, `${prefix}${name}/`)
    else if (name.toLowerCase().endsWith('.epub')) yield { path: `${prefix}${name}`, handle: handle as FileSystemFileHandle }
  }
}

// ---------------------------------------------------------------------- storage

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** The records in the device's database (`ebooks` and `ebookFolders`, `localData.ts`). */
export function indexedDbEbookRecords(factory: IDBFactory): EbookRecords {
  let opened: Promise<IDBDatabase> | null = null
  const open = () =>
    (opened ??= openLocalDatabase(factory, { onClose: () => (opened = null) }).catch((error) => {
      opened = null
      throw error
    }))
  return {
    async list(memberId) {
      const db = await open()
      const found = await request(db.transaction('ebooks', 'readonly').objectStore('ebooks').index('memberId').getAll(memberId))
      return found as EbookRecord[]
    },
    async put(record) {
      const db = await open()
      const tx = db.transaction('ebooks', 'readwrite')
      // A plain copy: what the screens hand in may be wrapped (a reactive proxy), which IndexedDB cannot clone.
      tx.objectStore('ebooks').put(JSON.parse(JSON.stringify(record)))
      await done(tx)
    },
    async remove(memberId, id) {
      const db = await open()
      const tx = db.transaction('ebooks', 'readwrite')
      tx.objectStore('ebooks').delete([memberId, id])
      await done(tx)
    },
    async folder(memberId) {
      const db = await open()
      const found = await request(db.transaction('ebookFolders', 'readonly').objectStore('ebookFolders').get(memberId))
      return (found as EbookFolder | undefined) ?? null
    },
    async putFolder(memberId, value) {
      const db = await open()
      const tx = db.transaction('ebookFolders', 'readwrite')
      if (value) tx.objectStore('ebookFolders').put(value, memberId)
      else tx.objectStore('ebookFolders').delete(memberId)
      await done(tx)
    },
  }
}

/** The records in memory (the tests; a browser without IndexedDB). */
export function memoryEbookRecords(): EbookRecords {
  const saved = new Map<string, EbookRecord>()
  const folders = new Map<string, EbookFolder>()
  const key = (memberId: string, id: string) => `${memberId}|${id}`
  return {
    async list(memberId) {
      return [...saved.values()].filter((record) => record.memberId === memberId).map((record) => structuredClone(record))
    },
    async put(record) {
      saved.set(key(record.memberId, record.id), structuredClone(record))
    },
    async remove(memberId, id) {
      saved.delete(key(memberId, id))
    },
    async folder(memberId) {
      return folders.get(memberId) ?? null
    },
    async putFolder(memberId, value) {
      if (value) folders.set(memberId, value)
      else folders.delete(memberId)
    },
  }
}
