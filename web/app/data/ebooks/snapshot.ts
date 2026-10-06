import { LOCAL_DATA_PREFIX, type DeviceStorage } from '../localData'
import type { EbookFolder, EbookRecord } from './ebooks'

/**
 * The Ebooks page as this device last showed it (#131): the member's ebook
 * records (what the files say about themselves, their state, the Books they
 * are linked to: never the files' contents), which copies were missing, and
 * the folder's name and last scan. The records live in IndexedDB, read
 * asynchronously; this copy is in the key-value storage, read synchronously
 * while the store is set up, so the page's first frame is the page and not a
 * jump a few hundred milliseconds later. Written whenever the records are
 * read; the IndexedDB read then reconciles it. Signing out removes it with
 * everything under `libellus.`.
 *
 * Framework-free: the store hands in the storage, the tests an in-memory one.
 */

/** Bumped when the shape changes: an older copy is then ignored, never misread. */
export const EBOOKS_SNAPSHOT_VERSION = 1
export const EBOOKS_SNAPSHOT_KEY = `${LOCAL_DATA_PREFIX}ebooks`

/** What the snapshot needs of the device's key-value storage (`window.localStorage`). */
type SnapshotStorage = Pick<DeviceStorage, 'getItem' | 'setItem'>

export type EbooksSnapshot = {
  version: number
  memberId: string
  records: EbookRecord[]
  missing: string[]
  /** The picked folder without its handle (that one is in IndexedDB). */
  folder: Pick<EbookFolder, 'name' | 'pickedAt' | 'scannedAt'> | null
}

export function saveEbooksSnapshot(
  storage: SnapshotStorage,
  memberId: string,
  state: { records: readonly EbookRecord[]; missing: ReadonlySet<string>; folder: EbookFolder | Pick<EbookFolder, 'name' | 'pickedAt' | 'scannedAt'> | null },
): void {
  const snapshot: EbooksSnapshot = {
    version: EBOOKS_SNAPSHOT_VERSION,
    memberId,
    // Ignored files are never shown: they stay out.
    records: state.records.filter((record) => record.state !== 'ignored').map((record) => ({ ...record })),
    missing: [...state.missing],
    folder: state.folder ? { name: state.folder.name, pickedAt: state.folder.pickedAt, scannedAt: state.folder.scannedAt } : null,
  }
  try {
    storage.setItem(EBOOKS_SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // Full or unavailable: the page waits for IndexedDB, as on a first visit.
  }
}

/** The member's snapshot, or null (none yet, another member's, an older shape, unreadable). */
export function readEbooksSnapshot(storage: SnapshotStorage, memberId: string): EbooksSnapshot | null {
  try {
    const raw = storage.getItem(EBOOKS_SNAPSHOT_KEY)
    if (!raw) return null
    const snapshot = JSON.parse(raw) as EbooksSnapshot
    if (snapshot?.version !== EBOOKS_SNAPSHOT_VERSION || snapshot.memberId !== memberId || !Array.isArray(snapshot.records)) return null
    return snapshot
  } catch {
    return null
  }
}
