/** The slice of the Storage interface the app needs; `window.localStorage` fits. */
export type KeyValueStorage = {
  readonly length: number
  key: (index: number) => string | null
  removeItem: (key: string) => void
}

/**
 * Everything Libellus keeps on the device itself starts with this, so signing
 * out can find it without knowing every feature: the pending sign-in address
 * now, the offline library cache later (#15). A feature that caches something
 * names its keys `libellus.<thing>`; nothing else has to change.
 */
export const LOCAL_DATA_PREFIX = 'libellus.'

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
