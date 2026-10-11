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
 * picked ebook folder, `data/ebooks/`, #131; her profile photo, `data/avatar.ts`,
 * #156). A feature that needs one adds its
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
  // The member's profile photo, its two files (key: the member's id).
  avatars: {},
}
export const LOCAL_DATABASE_VERSION = 3

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
    // Blocked (an upgrade while another tab holds the database): every opener closes its
    // connection on `versionchange`, so the open goes on as soon as the other tab has.
  })
}

/**
 * Member-keyed things that sit outside the `libellus.` prefix (a map of member id → what she
 * chose: Home's import offer, `utils/importHint.ts`; the Library's remembered views,
 * `data/libraryView.ts`). They are a member's, so signing out, a dead session and another
 * member signing in clear them with the rest (security round F10); the names are here so
 * nothing else has to be told, and tests/device-data.test.ts keeps them equal to the owners'.
 */
export const MEMBER_KEYS_OUTSIDE_PREFIX: readonly string[] = ['libellus-import-hint', 'libellus-library-view']

/**
 * Forgets what this device cached about the member: a shared phone must not
 * keep someone's library after they sign out (SPEC.md, Access). Supabase's own
 * session key is removed by `auth.signOut`, not here. `keep` names keys that are
 * not the member's (a sign-in or a share that waits for one: a session that ended
 * on its own keeps those). Returns what it removed.
 */
export function clearLocalData(storage: KeyValueStorage, { keep = [] }: { keep?: readonly string[] } = {}): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key && !keep.includes(key) && (key.startsWith(LOCAL_DATA_PREFIX) || MEMBER_KEYS_OUTSIDE_PREFIX.includes(key))) keys.push(key)
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
 *
 * `keep` names stores to leave as they are, and then the database stays and the others are
 * emptied: the outbox of a member whose session ended, whose writes are kept (they are
 * keyed by her id, are sent only for her, and are lost by nothing but her own sign-out).
 */
export function clearLocalDatabase(
  factory: Pick<IDBFactory, 'deleteDatabase'> & Partial<Pick<IDBFactory, 'open'>>,
  name = LOCAL_DATABASE,
  { keep = [] }: { keep?: readonly string[] } = {},
): Promise<void> {
  if (keep.length && factory.open) return Promise.race([emptyStores(factory as IDBFactory, name, keep), new Promise<void>((resolve) => setTimeout(resolve, GIVE_UP_MS * 3))])
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = factory.deleteDatabase(name)
    } catch {
      resolve()
      return
    }
    // A delete waits for every open connection, and one asked while another is still waiting
    // (a service worker holds `workbox-expiration` open) gets no event at all: the app must not
    // wait for it. It goes through by itself once the connections close.
    const giveUp = setTimeout(resolve, GIVE_UP_MS)
    const done = () => {
      clearTimeout(giveUp)
      resolve()
    }
    req.onsuccess = done
    req.onerror = done
    req.onblocked = done
  })
}

/** How long a database delete is waited for (see `clearLocalDatabase`). */
const GIVE_UP_MS = 1000

/** Empties every store of the database but `keep`; resolves either way. */
async function emptyStores(factory: IDBFactory, name: string, keep: readonly string[]): Promise<void> {
  let db: IDBDatabase | null = null
  try {
    db = await openLocalDatabase(factory, { name })
    const stores = [...db.objectStoreNames].filter((store) => !keep.includes(store))
    if (!stores.length) return
    const open = db
    await new Promise<void>((resolve) => {
      const tx = open.transaction(stores, 'readwrite')
      for (const store of stores) tx.objectStore(store).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // Nothing there, or no IndexedDB.
  } finally {
    db?.close()
  }
}

/**
 * Deletes the files and caches the device keeps for the member (issue #131, F10): the copies
 * of her ebook files in the origin private file system (`ebooks/`, `data/ebooks/files.ts`), any
 * ebook shared to the app that was not taken in yet (the service worker's cache,
 * `public/sw-share.js`), the covers and portraits her browsing kept (`libellus-covers`,
 * `libellus-portraits`: the addresses of what she looked at, search results included) and the
 * expiry list the service worker keeps for them (`workbox-expiration`, a URL and a time each).
 * Not `libellus-reader` and `libellus-barcode-decoder`: those are the app's own files, the
 * same for everyone, and keeping them is what lets a book open offline. Nothing of the
 * ebook files was ever uploaded, so this is the only copy Libellus had. Resolves either way.
 */
export async function clearLocalFiles({
  storage,
  caches,
  databases,
}: {
  storage?: Pick<StorageManager, 'getDirectory'> | null
  caches?: Pick<CacheStorage, 'delete'> | null
  databases?: Pick<IDBFactory, 'deleteDatabase'> | null
}): Promise<void> {
  try {
    const root = await storage?.getDirectory?.()
    await root?.removeEntry('ebooks', { recursive: true })
  } catch {
    // Nothing there, or no OPFS in this browser.
  }
  for (const cache of MEMBER_CACHES) {
    try {
      await caches?.delete(cache)
    } catch {
      // No Cache Storage (an insecure context).
    }
  }
  if (databases) await clearLocalDatabase(databases, EXPIRATION_DATABASE)
}

/** The cache the service worker keeps shared ebook files in until the app takes them (`public/sw-share.js`). */
export const SHARED_EBOOKS_CACHE = 'libellus-shared-ebooks'

/** The service worker's caches of what the member looked at (nuxt.config.ts, workbox runtimeCaching). */
export const MEMBER_CACHES: readonly string[] = [SHARED_EBOOKS_CACHE, 'libellus-covers', 'libellus-portraits']

/** Workbox's list of when each cached address was used last, for every cache's expiry. */
export const EXPIRATION_DATABASE = 'workbox-expiration'

/** What the device keeps, as the browser offers it: each part may be missing (an insecure context, a test). */
export type DeviceEnvironment = {
  storage: DeviceStorage
  indexedDB?: Pick<IDBFactory, 'deleteDatabase'> & Partial<Pick<IDBFactory, 'open'>> | null
  caches?: Pick<CacheStorage, 'delete'> | null
  files?: Pick<StorageManager, 'getDirectory'> | null
}

/**
 * The device forgets the member: every `libellus.` key and the member-keyed ones outside the prefix
 * (`clearLocalData`), the IndexedDB database (outbox, ebook records, profile photo), the ebook files,
 * the caches of what she browsed and their expiry list (`clearLocalFiles`). `sessionEnded` is a
 * session that died by itself: the keys named in `keep` (the sign-in or share that waits) and the
 * outbox stay, as her unsynced writes are not lost by a token that expired; her own sign-out, deleting
 * her account and another member signing in clear all of it. The one place that knows the list, run
 * by `stores/session.ts` and by tests/device-data.test.ts.
 */
export async function forgetMemberData(
  { storage, indexedDB, caches, files }: DeviceEnvironment,
  { sessionEnded = false, keep = [], memberId = null }: { sessionEnded?: boolean; keep?: readonly string[]; memberId?: string | null } = {},
): Promise<void> {
  clearLocalData(storage, { keep: sessionEnded ? keep : [] })
  if (indexedDB) await clearLocalDatabase(indexedDB, LOCAL_DATABASE, { keep: sessionEnded ? ['outbox'] : [] })
  await clearLocalFiles({ storage: files, caches, databases: indexedDB })
  // The outbox that stays is hers: if another member signs in, it goes (`otherMemberHere`).
  if (sessionEnded && memberId) storage.setItem(OUTBOX_OWNER_KEY, memberId)
}

/** Whose unsynced writes stayed on the device when her session ended (see `forgetMemberData`). */
export const OUTBOX_OWNER_KEY = `${LOCAL_DATA_PREFIX}outboxOwner`

/**
 * Whether what the device holds is another member's than `memberId`: the saved Library
 * (`savedMemberId`, `readSavedMember`) or the outbox a dead session left. Signing in as someone
 * else then clears the device first, so nothing of the last member is shown to or sent for her.
 */
export function otherMemberHere(storage: Pick<DeviceStorage, 'getItem'>, memberId: string, savedMemberId: string | null): boolean {
  return [savedMemberId, storage.getItem(OUTBOX_OWNER_KEY)].some((owner) => Boolean(owner) && owner !== memberId)
}
