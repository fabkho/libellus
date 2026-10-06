/** The slice of the Storage interface the app needs; `window.localStorage` fits. */
export type KeyValueStorage = {
  readonly length: number
  key: (index: number) => string | null
  removeItem: (key: string) => void
}

/** What a cache on the device reads and writes as well: `window.localStorage` again. */
export type DeviceStorage = KeyValueStorage & {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * Everything Libellus keeps on the device itself starts with this, so signing
 * out can find it without knowing every feature: the pending sign-in address
 * and the offline Library (`data/deviceLibrary.ts`, #15). A feature that
 * caches something names its keys `libellus.<thing>`; nothing else has to change.
 */
export const LOCAL_DATA_PREFIX = 'libellus.'

/**
 * What the device keeps in IndexedDB rather than under `libellus.` keys: one
 * database, `libellus`, with a store per feature (the outbox of writes waiting
 * to sync, `data/outbox.ts`, #93; the ebook files linked to Books and the
 * picked ebook folder, `data/ebooks/`, #131). A feature that needs one adds its
 * store to `LOCAL_STORES` and raises `LOCAL_DATABASE_VERSION`; every feature
 * opens the database through `openLocalDatabase`, so they agree on its version.
 */
export const LOCAL_DATABASE = 'libellus'

/** The stores of `LOCAL_DATABASE` and how each is keyed. */
export const LOCAL_STORES: Record<string, IDBObjectStoreParameters & { indexes?: Record<string, string | string[]> }> = {
  // One record per member (key: the member's id), the whole line at once.
  outbox: {},
  // One record per ebook file and member, found by member.
  ebooks: { keyPath: ['memberId', 'id'], indexes: { memberId: 'memberId' } },
  // The picked ebook folder's handle per member (key: the member's id).
  ebookFolders: {},
}
export const LOCAL_DATABASE_VERSION = 2

/**
 * Opens the device's database, creating the stores it lacks. Another tab
 * deleting it (signing out there) or upgrading it closes this connection:
 * `onClose` lets the caller open it again next time.
 */
export function openLocalDatabase(factory: IDBFactory, { name = LOCAL_DATABASE, onClose }: { name?: string; onClose?: () => void } = {}): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(name, LOCAL_DATABASE_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const [store, { indexes, ...options }] of Object.entries(LOCAL_STORES)) {
        if (db.objectStoreNames.contains(store)) continue
        const created = db.createObjectStore(store, options)
        for (const [index, keyPath] of Object.entries(indexes ?? {})) created.createIndex(index, keyPath)
      }
    }
    req.onsuccess = () => {
      req.result.onversionchange = () => {
        req.result.close()
        onClose?.()
      }
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Forgets what this device cached about the member: a shared phone must not
 * keep someone's library after they sign out (SPEC.md, Access). Supabase's own
 * session key is removed by `auth.signOut`, not here. Returns what it removed.
 */
export function clearLocalData(storage: KeyValueStorage): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(LOCAL_DATA_PREFIX)) keys.push(key)
  }
  // Collected first: removing while iterating shifts the indexes.
  for (const key of keys) storage.removeItem(key)
  return keys
}

/**
 * Deletes the device's IndexedDB database (`LOCAL_DATABASE`) with everything in
 * it, writes still waiting to sync included: on a shared phone they must not
 * reach the next member's session. Resolves when it is gone, or when it could
 * not be (blocked by another tab, which closes its connection on the change).
 */
export function clearLocalDatabase(factory: Pick<IDBFactory, 'deleteDatabase'>, name = LOCAL_DATABASE): Promise<void> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = factory.deleteDatabase(name)
    } catch {
      resolve()
      return
    }
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

/**
 * Deletes the files the device keeps for the member (issue #131): the copies of
 * her ebook files in the origin private file system (`ebooks/`,
 * `data/ebooks/files.ts`) and any ebook shared to the app that was not taken in
 * yet (the service worker's cache, `public/sw-share.js`). Nothing of it was
 * ever uploaded, so this is the only copy Libellus had. Resolves either way.
 */
export async function clearLocalFiles({
  storage,
  caches,
}: {
  storage?: Pick<StorageManager, 'getDirectory'> | null
  caches?: Pick<CacheStorage, 'delete'> | null
}): Promise<void> {
  try {
    const root = await storage?.getDirectory?.()
    await root?.removeEntry('ebooks', { recursive: true })
  } catch {
    // Nothing there, or no OPFS in this browser.
  }
  try {
    await caches?.delete(SHARED_EBOOKS_CACHE)
  } catch {
    // No Cache Storage (an insecure context).
  }
}

/** The cache the service worker keeps shared ebook files in until the app takes them (`public/sw-share.js`). */
export const SHARED_EBOOKS_CACHE = 'libellus-shared-ebooks'
