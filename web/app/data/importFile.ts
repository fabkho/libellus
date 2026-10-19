import { LOCAL_DATABASE, openLocalDatabase } from './localData'

/**
 * The file of an import whose lookups are still running, kept on the device so that closing the app does not
 * end the import: opened again, the app finds the file, takes a place in the import queue again and looks up the
 * books that are left (what the lookups found is kept apart, `utils/importMatches.ts`, so they are not asked
 * twice). Without this a closed app forgot which file it was importing and she had to choose it again.
 *
 * One record per member (`importFiles`, the device's IndexedDB database: signing out deletes it, and the file with
 * it: a Goodreads export holds her reviews). The bytes as they were read, not a parsed copy: the import reads
 * them exactly as it does a file she picks. Kept for a week at most, like the matches. The import clears it when
 * the lookups end (the preview), when she cancels and when the books are written; it is kept again while the write
 * runs, for a write that was cut off. Framework-free: the database comes in from outside.
 */

/** How long a kept file is picked up again. */
export const IMPORT_FILE_DAYS = 7
/** A file larger than this is not kept (a Library export is a few hundred KB). */
export const IMPORT_FILE_MAX_BYTES = 8 * 1024 * 1024

export type KeptImportFile = { name: string; bytes: ArrayBuffer; at: number }

export type ImportFileKeeper = {
  read: (memberId: string, now?: number) => Promise<KeptImportFile | null>
  write: (memberId: string, file: { name: string; bytes: ArrayBuffer }, now?: number) => Promise<void>
  clear: (memberId: string) => Promise<void>
}

const STORE = 'importFiles'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const fresh = (found: KeptImportFile | undefined, now: number): found is KeptImportFile =>
  Boolean(found && typeof found.name === 'string' && found.bytes instanceof ArrayBuffer && found.bytes.byteLength > 0 && now - found.at <= IMPORT_FILE_DAYS * 86_400_000)

/** The file in the device's IndexedDB database. Every call resolves or rejects: the caller treats a failure as "nothing kept". */
export function indexedDbImportFiles(factory: IDBFactory, name = LOCAL_DATABASE): ImportFileKeeper {
  let opened: Promise<IDBDatabase> | null = null
  function open(): Promise<IDBDatabase> {
    opened ??= openLocalDatabase(factory, { name, onClose: () => (opened = null) }).catch((error) => {
      opened = null
      throw error
    })
    return opened
  }
  async function write(store: IDBTransaction): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      store.oncomplete = () => resolve()
      store.onerror = () => reject(store.error)
      store.onabort = () => reject(store.error)
    })
  }
  return {
    async read(memberId, now = Date.now()) {
      const db = await open()
      const found = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(memberId))) as KeptImportFile | undefined
      return fresh(found, now) ? found : null
    },
    async write(memberId, file, now = Date.now()) {
      if (file.bytes.byteLength > IMPORT_FILE_MAX_BYTES) return
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ name: file.name, bytes: file.bytes, at: now } satisfies KeptImportFile, memberId)
      await write(tx)
    },
    async clear(memberId) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(memberId)
      await write(tx)
    },
  }
}

/** The same in memory (the tests; a browser without IndexedDB, where nothing outlives the page anyway). */
export function memoryImportFiles(): ImportFileKeeper {
  const kept = new Map<string, KeptImportFile>()
  return {
    async read(memberId, now = Date.now()) {
      const found = kept.get(memberId)
      return fresh(found, now) ? found : null
    },
    async write(memberId, file, now = Date.now()) {
      if (file.bytes.byteLength > IMPORT_FILE_MAX_BYTES) return
      kept.set(memberId, { name: file.name, bytes: file.bytes, at: now })
    },
    async clear(memberId) {
      kept.delete(memberId)
    },
  }
}
