import type { Collection, CollectionSummary } from './collections'
import type { EntryStatus, LibraryEntry } from './library'
import { LOCAL_DATA_PREFIX, type DeviceStorage } from './localData'
import type { ReadingRecord } from './stats'

/**
 * The member's Library as this device last saw it (issue #15): the three
 * Status lists with each entry's latest session, the year's tally, the
 * Collections, and the Profile's reading record. Written after every load and every change, read when the app
 * starts, so it opens on the last-loaded Library without a connection and
 * without a flash of an empty one. Signing out removes it with everything
 * else under `libellus.` (`clearLocalData`).
 *
 * Kept in the device's key-value storage (`localStorage`), not IndexedDB: it
 * is read synchronously while the stores are set up, before the first frame,
 * so a restored screen never renders empty first. A Library of a few hundred
 * Books is a few hundred kilobytes, far inside the storage's limit; a write
 * the storage refuses is dropped (the next load tries again), never an error
 * the member sees.
 *
 * Framework-free like every repository: the stores hand in the storage, the
 * tests an in-memory one.
 */

/** Bumped when the shape changes: an older copy is then ignored, never misread. */
export const DEVICE_LIBRARY_VERSION = 1
export const DEVICE_LIBRARY_KEY = `${LOCAL_DATA_PREFIX}library`
export const DEVICE_COLLECTIONS_KEY = `${LOCAL_DATA_PREFIX}collections`
export const DEVICE_STATS_KEY = `${LOCAL_DATA_PREFIX}stats`

/**
 * Who the saved Library belongs to: also how the app knows who was signed in
 * when it starts offline (with her name, so the greeting does not lose it).
 */
export type SavedMember = { id: string; email: string; name?: string }

export type SavedLibrary = {
  member: SavedMember
  /** When it was written (ISO), for the record; nothing expires it. */
  savedAt: string
  lists: Record<EntryStatus, LibraryEntry[]>
  /** Home's "Read in <year>", once counted. */
  readInYear: { year: number; count: number } | null
}

export type SavedCollections = {
  memberId: string
  savedAt: string
  /** The list (Library → Collections) with each Collection's size and first covers. */
  list: CollectionSummary[]
  /** The Collections opened on this device, with their entries in her order. */
  collections: Collection[]
  /** Which Collections each entry is on, by entry id, as far as this device knows. */
  memberships: Record<string, string[]>
}

/**
 * The Profile's reading record as the last load saw it (data/stats.ts): read
 * when the Profile or a year in review opens, so the figures are there at once
 * and the load that follows only refreshes them.
 */
export type SavedStats = {
  memberId: string
  savedAt: string
  record: ReadingRecord
}

type Envelope<T> = { version: number; data: T }

function read<T>(storage: DeviceStorage, key: string): T | null {
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Envelope<T>
    if (parsed?.version === DEVICE_LIBRARY_VERSION && parsed.data) return parsed.data
  } catch {
    // A torn or foreign value: as good as none.
  }
  storage.removeItem(key)
  return null
}

function write<T>(storage: DeviceStorage, key: string, data: T): boolean {
  try {
    storage.setItem(key, JSON.stringify({ version: DEVICE_LIBRARY_VERSION, data } satisfies Envelope<T>))
    return true
  } catch {
    // Full (or storage switched off): an older copy would be wrong, so none.
    try {
      storage.removeItem(key)
    } catch {
      // Nothing more to do.
    }
    return false
  }
}

const isList = (value: unknown): value is unknown[] => Array.isArray(value)

/** Writes the member's Library. Returns whether the storage took it. */
export function saveLibrary(
  storage: DeviceStorage,
  library: Omit<SavedLibrary, 'savedAt'>,
  savedAt = new Date(),
): boolean {
  return write<SavedLibrary>(storage, DEVICE_LIBRARY_KEY, { ...library, savedAt: savedAt.toISOString() })
}

/** The saved Library, if there is one and it is this member's. */
export function readLibrary(storage: DeviceStorage, memberId: string): SavedLibrary | null {
  const saved = read<SavedLibrary>(storage, DEVICE_LIBRARY_KEY)
  if (!saved || saved.member?.id !== memberId) return null
  const { want_to_read, reading, finished } = saved.lists ?? {}
  if (!isList(want_to_read) || !isList(reading) || !isList(finished)) return null
  return saved
}

/** The member whose Library this device holds: who was signed in, for a start without a connection. */
export function readSavedMember(storage: DeviceStorage): SavedMember | null {
  const member = read<SavedLibrary>(storage, DEVICE_LIBRARY_KEY)?.member
  if (!member?.id || !member.email) return null
  return typeof member.name === 'string' && member.name
    ? { id: member.id, email: member.email, name: member.name }
    : { id: member.id, email: member.email }
}

/** Writes the member's Collections. Returns whether the storage took it. */
export function saveCollections(
  storage: DeviceStorage,
  collections: Omit<SavedCollections, 'savedAt'>,
  savedAt = new Date(),
): boolean {
  return write<SavedCollections>(storage, DEVICE_COLLECTIONS_KEY, { ...collections, savedAt: savedAt.toISOString() })
}

/** The saved Collections, if there are any and they are this member's. */
export function readCollections(storage: DeviceStorage, memberId: string): SavedCollections | null {
  const saved = read<SavedCollections>(storage, DEVICE_COLLECTIONS_KEY)
  if (!saved || saved.memberId !== memberId || !isList(saved.list) || !isList(saved.collections)) return null
  return { ...saved, memberships: saved.memberships ?? {} }
}

/** Writes the member's reading record. Returns whether the storage took it. */
export function saveStats(storage: DeviceStorage, memberId: string, record: ReadingRecord, savedAt = new Date()): boolean {
  return write<SavedStats>(storage, DEVICE_STATS_KEY, { memberId, savedAt: savedAt.toISOString(), record })
}

/** The saved reading record, if there is one and it is this member's. */
export function readStats(storage: DeviceStorage, memberId: string): ReadingRecord | null {
  const saved = read<SavedStats>(storage, DEVICE_STATS_KEY)
  if (!saved || saved.memberId !== memberId) return null
  const { reads, days } = saved.record ?? {}
  if (!isList(reads) || !isList(days)) return null
  return saved.record
}

/**
 * Forgets the saved Library, Collections and reading record, and nothing else: for a member
 * who stopped being signed in without signing out here (the session ended on
 * the server). Signing out clears all of `libellus.` instead.
 */
export function forgetLibrary(storage: DeviceStorage): void {
  storage.removeItem(DEVICE_LIBRARY_KEY)
  storage.removeItem(DEVICE_COLLECTIONS_KEY)
  storage.removeItem(DEVICE_STATS_KEY)
}
