import type { LibraryEntry } from '../data/library'

/**
 * The app's shortcuts (issue #91) open `/?search=1` (the search palette) and
 * `/?progress=1` (Update progress on the Book being read most recently). The
 * shell reads them once and takes them off the address.
 */
export const LAUNCH_SEARCH = 'search'
export const LAUNCH_PROGRESS = 'progress'
/** With `search`: the text to put in the palette (a share that found no Book). */
export const LAUNCH_QUERY = 'q'

/**
 * The Currently reading entry whose progress was updated last (an entry never
 * updated counts from the day the read was started in the app), null when
 * nothing is being read.
 */
export function mostRecentlyUpdated(entries: readonly LibraryEntry[]): LibraryEntry | null {
  let best: LibraryEntry | null = null
  let bestAt = -Infinity
  for (const entry of entries) {
    if (entry.status !== 'reading') continue
    const session = entry.latestSession
    const at = Date.parse(session?.progressUpdatedAt ?? session?.createdAt ?? entry.addedAt)
    if (best === null || at > bestAt) {
      best = entry
      bestAt = at
    }
  }
  return best
}
