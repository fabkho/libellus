import { LOCAL_DATA_PREFIX, type DeviceStorage } from '../localData'
import type { AuthorPage, BookAuthor } from './authors'
import type { BookSeries, StartedSeries, SeriesInfo } from './series'

/**
 * What the author pages and the series (issue #167) last showed on this
 * device, so they open offline and without a loading step the next time:
 * the author pages opened lately, the series line of the Books opened
 * lately, the series sheets, Home's "Next in your series", and the linked
 * authors of her Library's Books (the rows' author lines). Written after each
 * load, read when the stores are set up. Signing out removes it with the
 * rest of `libellus.`; another member's copy is never read.
 *
 * Bounded, newest first: an author page can hold a long bibliography, so only
 * the last `LIMITS.authors` are kept (each read moves its page to the front).
 * A write the storage refuses drops the copy (the next load tries again).
 */

export const DEVICE_ENRICH_KEY = `${LOCAL_DATA_PREFIX}enrich`
/** Bumped when the shape changes: an older copy is then ignored, never misread. */
export const DEVICE_ENRICH_VERSION = 2

export const LIMITS = { authors: 12, bookSeries: 120, series: 30 } as const

export type EnrichCopy = {
  memberId: string
  /** Author pages by the key they were opened with, newest first. */
  authors: Record<string, AuthorPage>
  /** The series line of a Book, by Book id, newest first. */
  bookSeries: Record<string, BookSeries>
  /** A series sheet, by series id, newest first. */
  series: Record<string, SeriesInfo>
  /** The linked authors of Books, by Book id (her Library's and the pages she opened). */
  bookAuthors: Record<string, BookAuthor[]>
  /** Home's "Next in your series": the series she has started, as last asked. */
  started: StartedSeries[] | null
  /** The started series she muted, as last asked (absent in a copy written before muting existed). */
  muted?: StartedSeries[] | null
}

export function emptyCopy(memberId: string): EnrichCopy {
  return { memberId, authors: {}, bookSeries: {}, series: {}, bookAuthors: {}, started: null, muted: null }
}

/** The saved copy, if there is one and it is this member's; else an empty one. */
export function readEnrichCopy(storage: DeviceStorage, memberId: string): EnrichCopy {
  let raw: string | null = null
  try {
    raw = storage.getItem(DEVICE_ENRICH_KEY)
  } catch {
    return emptyCopy(memberId)
  }
  if (!raw) return emptyCopy(memberId)
  try {
    const parsed = JSON.parse(raw) as { version?: number; data?: EnrichCopy }
    const data = parsed?.version === DEVICE_ENRICH_VERSION ? parsed.data : null
    if (data && data.memberId === memberId) return { ...emptyCopy(memberId), ...data }
    if (data) return emptyCopy(memberId)
  } catch {
    // A torn or foreign value: as good as none.
  }
  try {
    storage.removeItem(DEVICE_ENRICH_KEY)
  } catch {
    // Nothing more to do.
  }
  return emptyCopy(memberId)
}

/** Writes the copy. Returns whether the storage took it. */
export function saveEnrichCopy(storage: DeviceStorage, copy: EnrichCopy): boolean {
  try {
    storage.setItem(DEVICE_ENRICH_KEY, JSON.stringify({ version: DEVICE_ENRICH_VERSION, data: copy }))
    return true
  } catch {
    try {
      storage.removeItem(DEVICE_ENRICH_KEY)
    } catch {
      // Nothing more to do.
    }
    return false
  }
}

/**
 * `record` with `value` at `key`, moved to the front, and at most `limit`
 * entries: the oldest go first. Keys are ids (uuids, Q…, OL…), never bare
 * numbers, so the object keeps the order they were put in.
 */
export function remembered<T>(record: Record<string, T>, key: string, value: T, limit: number): Record<string, T> {
  const next: Record<string, T> = { [key]: value }
  for (const [k, v] of Object.entries(record)) {
    if (Object.keys(next).length >= limit) break
    if (k !== key) next[k] = v
  }
  return next
}
