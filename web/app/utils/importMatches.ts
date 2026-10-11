/**
 * What a long import lookup found, kept on the device so a reload (or a phone that
 * put the page to sleep) does not throw away half an hour of lookups: choosing the
 * same file again finds those rows already answered and only looks up the rest.
 * Framework-free, so Vitest pins it in plain Node.
 *
 * Per member, and only what was found for sure (an edition by ISBN or by title, no
 * doubt about a source that could not be asked): a row nothing was found for is
 * asked again. The Book keeps what the preview and the write need, without its
 * description (the long text); the kept answers expire after a week, and a full
 * storage just means nothing is kept.
 */

export const IMPORT_MATCHES_KEY = 'libellus.import-matches'
export const IMPORT_MATCHES_DAYS = 7
/** At most this many rows are kept (a Library export is a few thousand books at most). */
export const IMPORT_MATCHES_MAX = 3000

export type StoredMatch = { book: Record<string, unknown>; via: 'isbn' | 'title'; coverFrom?: Record<string, unknown> | null }
type Stored = { member: string; at: number; rows: Record<string, StoredMatch> }

export type MatchStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const lean = (book: Record<string, unknown>) => ({ ...book, description: null })

/** The rows this device found for the member that are not older than a week; empty for anything unreadable. */
export function readMatches(storage: Pick<MatchStorage, 'getItem'>, member: string, now = Date.now()): Map<string, StoredMatch> {
  try {
    const stored = JSON.parse(storage.getItem(IMPORT_MATCHES_KEY) ?? 'null') as Stored | null
    if (!stored || stored.member !== member || typeof stored.rows !== 'object' || !stored.rows) return new Map()
    if (now - stored.at > IMPORT_MATCHES_DAYS * 86_400_000) return new Map()
    return new Map(Object.entries(stored.rows).filter(([, row]) => row && typeof row === 'object' && row.book && (row.via === 'isbn' || row.via === 'title')))
  } catch {
    return new Map()
  }
}

/** Keeps the rows (older kept ones included); storage that refuses keeps nothing and says nothing. */
export function writeMatches(storage: Pick<MatchStorage, 'setItem' | 'removeItem'>, member: string, rows: ReadonlyMap<string, StoredMatch>, now = Date.now()): void {
  try {
    const kept = Object.fromEntries(
      [...rows.entries()].slice(-IMPORT_MATCHES_MAX).map(([key, row]) => [
        key,
        { via: row.via, book: lean(row.book), ...(row.coverFrom ? { coverFrom: lean(row.coverFrom) } : {}) },
      ]),
    )
    storage.setItem(IMPORT_MATCHES_KEY, JSON.stringify({ member, at: now, rows: kept } satisfies Stored))
  } catch {
    try {
      storage.removeItem(IMPORT_MATCHES_KEY)
    } catch {
      /* nothing to keep it in */
    }
  }
}

export function clearMatches(storage: Pick<MatchStorage, 'removeItem'>): void {
  try {
    storage.removeItem(IMPORT_MATCHES_KEY)
  } catch {
    /* nothing to clear */
  }
}
