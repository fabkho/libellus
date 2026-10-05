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
 * to sync, `data/outbox.ts`, #93). A feature that needs one adds its store there.
 */
export const LOCAL_DATABASE = 'libellus'

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
