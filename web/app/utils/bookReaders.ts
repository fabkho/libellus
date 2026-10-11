import type { BookReader, ReaderState } from '../data/socialShapes'

/**
 * Readers on a Book's page (social v2a, contract §1.5): what the screen keeps of the database's list. Pure.
 * The database orders it (finished with a review, finished, reading, abandoned, wants to read; newest first within
 * each); the client keeps that order, merges pages by it, and never re-sorts what it was given except to merge.
 */

/** How many readers the Book page's section shows before *See all*. */
export const READERS_SHOWN = 5

/** The rank of a row in the list: the database's `rk`. */
export function readerRank(reader: Pick<BookReader, 'state' | 'review'>): 1 | 2 | 3 | 4 | 5 {
  if (reader.state === 'finished') return reader.review ? 1 : 2
  if (reader.state === 'reading') return 3
  if (reader.state === 'abandoned') return 4
  return 5
}

/** The list's order: rank, then the newest day first (a missing day last), then the member's id. */
export function compareReaders(a: BookReader, b: BookReader): number {
  return (
    readerRank(a) - readerRank(b) ||
    (b.day ?? '').localeCompare(a.day ?? '') ||
    a.member.id.localeCompare(b.member.id)
  )
}

/**
 * A page of readers laid after what is there: a member the page names again replaces her earlier row (the list moved
 * between two calls), and the result stays in the list's order.
 */
export function mergeReaders(have: readonly BookReader[], page: readonly BookReader[]): BookReader[] {
  const now = new Map(have.map((r) => [r.member.id, r]))
  for (const reader of page) now.set(reader.member.id, reader)
  return [...now.values()].sort(compareReaders)
}

/** The `book.readers.*` key that says a row's state ("Finished {day}", "Reading since {day}", "Wants to read"). */
export function readerStateKey(state: ReaderState): string {
  return `book.readers.${state}`
}

/** A member left her circle (unfollow, block, remove as follower): her row goes. */
export function readersWithout(list: readonly BookReader[], id: string): BookReader[] {
  return list.filter((r) => r.member.id !== id)
}
