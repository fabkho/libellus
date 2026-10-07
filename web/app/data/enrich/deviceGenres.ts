import { LOCAL_DATA_PREFIX, type DeviceStorage } from '../localData'
import type { EntryGenres } from './bookGenres'
import { isGenreId } from './genres'

/**
 * What the device keeps of the genres of the member's Library (issue #168), so the Book page's
 * chips, the Library's genre filter and the Profile's figures work without a connection: the
 * answer of `library_genres` as of the last load, written after every load and every correction.
 * Under `libellus.` like every cache, so signing out removes it (data/localData.ts); read back
 * only for the member it was saved for.
 */
export const DEVICE_GENRES_KEY = `${LOCAL_DATA_PREFIX}genres`
export const DEVICE_GENRES_VERSION = 1

type Saved = { version: number; memberId: string; entries: EntryGenres[] }

export function saveDeviceGenres(storage: DeviceStorage, memberId: string, entries: readonly EntryGenres[]): void {
  try {
    storage.setItem(DEVICE_GENRES_KEY, JSON.stringify({ version: DEVICE_GENRES_VERSION, memberId, entries } satisfies Saved))
  } catch {
    // Full or switched off: the genres are asked for again next time.
  }
}

export function readDeviceGenres(storage: DeviceStorage, memberId: string): EntryGenres[] | null {
  try {
    const saved = JSON.parse(storage.getItem(DEVICE_GENRES_KEY) ?? 'null') as Partial<Saved> | null
    if (saved?.version !== DEVICE_GENRES_VERSION || saved.memberId !== memberId || !Array.isArray(saved.entries)) return null
    return saved.entries.flatMap((e) =>
      e && typeof e.entryId === 'string' && typeof e.bookId === 'string' && Array.isArray(e.genres)
        ? [{ entryId: e.entryId, bookId: e.bookId, genres: e.genres.filter(isGenreId), overridden: e.overridden === true }]
        : [],
    )
  } catch {
    return null
  }
}
