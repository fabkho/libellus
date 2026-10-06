import type { EpubMetadata } from './epub'

/**
 * The ebook files on the device (issue #131): every linked EPUB is copied into
 * the origin private file system (OPFS), so reading it later needs no
 * permission, works offline, and survives the original being moved. The
 * folder handle only finds files (phase 0, the spike on branch
 * `spike/ebook-files`). Nothing here leaves the device.
 *
 * A copy's name is its fingerprint: the SHA-256 of its first megabyte and its
 * size (`<hash32>-<size>.epub`), so the same file shared twice, found in the
 * folder and picked again is one copy. Each member's copies sit in a folder of
 * their own (`ebooks/<member id>/`); signing out removes all of `ebooks/`
 * (`data/localData.ts`).
 */

/** How much of a file its fingerprint reads. */
export const FINGERPRINT_BYTES = 1024 * 1024
/**
 * Which reading of the package document a record's metadata comes from. 2:
 * the text decoded by its byte order mark or XML declaration and composed
 * (NFC). A scan reads a known file's copy again when its record was read
 * with an older one, and matches it again (data/ebooks/ebooks.ts, `scan`).
 */
export const EPUB_READER_VERSION = 2
/** The OPFS folder that holds every copy. */
export const EBOOKS_DIR = 'ebooks'

/** The folder of one member's copies. */
export const memberDir = (memberId: string) => `${EBOOKS_DIR}/${memberId}`

/** A copy's id: what the fingerprint says, and the size. */
export const fileIdOf = (hash: string, size: number) => `${hash.slice(0, 32)}-${size}`

export async function sha256Hex(bytes: Uint8Array, subtle: SubtleCrypto = crypto.subtle): Promise<string> {
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Where copies are written and read: OPFS in the browser, a Map in the tests. Paths are `/`-separated, relative to the root. */
export type EbookFiles = {
  write: (path: string, data: Blob | Uint8Array) => Promise<void>
  read: (path: string) => Promise<File | null>
  /** The stored size, null when there is no file (never written, or evicted). */
  size: (path: string) => Promise<number | null>
  remove: (path: string) => Promise<void>
  /** Removes a folder with everything in it. */
  removeDir: (path: string) => Promise<void>
}

function split(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter(Boolean)
  return { dirs: parts.slice(0, -1), name: parts.at(-1)! }
}

const notFound = (error: unknown) => error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')

/**
 * The origin private file system. Writes with `createWritable` where it exists
 * (Chrome, also in a worker), else with a sync access handle (Safari, which
 * only writes OPFS files from a worker).
 */
export function opfsFiles(root: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory()): EbookFiles {
  async function folder(dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let dir = await root()
    try {
      for (const name of dirs) dir = await dir.getDirectoryHandle(name, { create })
    } catch (error) {
      if (notFound(error)) return null
      throw error
    }
    return dir
  }
  async function handle(path: string): Promise<FileSystemFileHandle | null> {
    const { dirs, name } = split(path)
    const dir = await folder(dirs, false)
    if (!dir) return null
    try {
      return await dir.getFileHandle(name)
    } catch (error) {
      if (notFound(error)) return null
      throw error
    }
  }
  return {
    async write(path, data) {
      const { dirs, name } = split(path)
      const dir = (await folder(dirs, true))!
      const file = await dir.getFileHandle(name, { create: true })
      if ('createWritable' in file && typeof file.createWritable === 'function') {
        const writable = await file.createWritable()
        await writable.write(data as Blob)
        await writable.close()
        return
      }
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer())
      const access = await (file as unknown as { createSyncAccessHandle: () => Promise<SyncAccess> }).createSyncAccessHandle()
      try {
        access.truncate(0)
        access.write(bytes, { at: 0 })
        access.flush()
      } finally {
        access.close()
      }
    },
    async read(path) {
      const file = await handle(path)
      return file ? file.getFile() : null
    },
    async size(path) {
      const file = await handle(path)
      return file ? (await file.getFile()).size : null
    },
    async remove(path) {
      const { dirs, name } = split(path)
      const dir = await folder(dirs, false)
      try {
        await dir?.removeEntry(name)
      } catch (error) {
        if (!notFound(error)) throw error
      }
    },
    async removeDir(path) {
      const { dirs, name } = split(path)
      const dir = await folder(dirs, false)
      try {
        await dir?.removeEntry(name, { recursive: true })
      } catch (error) {
        if (!notFound(error)) throw error
      }
    },
  }
}

type SyncAccess = {
  truncate: (size: number) => void
  write: (bytes: Uint8Array, options: { at: number }) => number
  flush: () => void
  close: () => void
}

/** Files kept in memory (the tests; a browser without OPFS keeps nothing between visits). */
export function memoryFiles(): EbookFiles & { saved: Map<string, Uint8Array> } {
  const saved = new Map<string, Uint8Array>()
  return {
    saved,
    async write(path, data) {
      saved.set(path, data instanceof Uint8Array ? data.slice() : new Uint8Array(await data.arrayBuffer()))
    },
    async read(path) {
      const bytes = saved.get(path)
      return bytes ? new File([bytes as Uint8Array<ArrayBuffer>], path.split('/').pop()!) : null
    },
    async size(path) {
      return saved.get(path)?.length ?? null
    },
    async remove(path) {
      saved.delete(path)
    },
    async removeDir(path) {
      for (const key of [...saved.keys()]) if (key.startsWith(`${path}/`)) saved.delete(key)
    },
  }
}

/** What taking a file in found out and where its copy is. */
export type Ingested = {
  id: string
  hash: string
  size: number
  /** The copy (`ebooks/<member>/<id>.epub`). */
  path: string
  /** Its cover image, when the file has one (`ebooks/<member>/<id>.cover`). */
  coverPath: string | null
  metadata: EpubMetadata
  /** The reading its metadata comes from (`EPUB_READER_VERSION`). */
  reader: number
  /** Whether the copy was written now (false: it was there already, the same bytes). */
  wrote: boolean
}
