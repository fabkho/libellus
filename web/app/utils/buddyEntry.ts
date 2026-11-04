import type { BuddyCard, BuddyWhere } from '~/data/buddyReads'

/**
 * The entry points of a buddy read: what the Book page's action and Home's *Reading together* card say, as plain data (Vitest drives them in Node). They read what
 * `my_buddy_reads()` answered (`BuddyCard`, held by stores/buddyInvites.ts) and nothing else; the words are the components'. A count here is a number, never a
 * message's words (part 5.5: the server counts only what her Section has opened, and no screen outside a thread draws more than numbers and names).
 */

/** Unread counts above this are drawn "99+": the badge stays a small pill. */
export const UNREAD_SHOWN_MAX = 99

/** A Book she can start a buddy read of: a Catalogue Book. A Manual book is her own record and has no work to read together (`buddy_book_invalid`). */
export const canReadTogether = (book: { source: string } | null | undefined): boolean => Boolean(book) && book!.source !== 'manual'

/** The reads that are going on, in the order the server gave them (newest start first). */
export const activeReads = (reads: readonly BuddyCard[] | null | undefined): BuddyCard[] => (reads ?? []).filter((read) => read.status === 'active')

/** Her active read of a Book (hosted or joined), or null; the server's order says which when there are two. */
export const readOfBook = (reads: readonly BuddyCard[] | null | undefined, bookId: string | null | undefined): BuddyCard | null =>
  bookId ? (activeReads(reads).find((read) => read.book.id === bookId) ?? null) : null

/**
 * What the Book page's action says, for any Book (docs/parity.md, *Buddy read, the Book page action*): **open** the read she is in, **start** one (`adds`: the Book is
 * not in her Library, so the setup sheet adds it as Currently reading when she creates the read), or **unavailable** (a Manual book: it has no work to read together).
 */
export type BookEntryAction = { kind: 'open'; read: BuddyCard } | { kind: 'start'; adds: boolean } | { kind: 'unavailable' }

/** `book`: the page's Book (null while it is unknown: nothing to offer); `held`: the Book is in her Library; `reads`: her list, or null before it was read. */
export function bookEntryAction(
  book: { id?: string; source: string } | null | undefined,
  held: boolean,
  reads: readonly BuddyCard[] | null | undefined,
): BookEntryAction | null {
  if (!book) return null
  if (!canReadTogether(book)) return { kind: 'unavailable' }
  const read = readOfBook(reads, book.id)
  return read ? { kind: 'open', read } : { kind: 'start', adds: !held }
}

/** The rows of Home's card: her active reads, those with news first; the server's order within each group. */
export function homeReads(reads: readonly BuddyCard[] | null | undefined): BuddyCard[] {
  const active = activeReads(reads)
  return [...active.filter((read) => read.unread > 0), ...active.filter((read) => read.unread <= 0)]
}

/** What is new across the active reads. */
export const unreadTotal = (reads: readonly BuddyCard[] | null | undefined): number => activeReads(reads).reduce((sum, read) => sum + Math.max(0, read.unread), 0)

/** A badge for a count: nothing at 0, the number, then `99+`; `count` stays the real number for the spoken name. */
export function unreadBadge(count: number): { text: string; count: number } | null {
  const n = Math.max(0, Math.floor(count))
  return n === 0 ? null : { text: n > UNREAD_SHOWN_MAX ? `${UNREAD_SHOWN_MAX}+` : String(n), count: n }
}

/** Where she stands, as a message key and its values (`together.where.*`): the Section she is in, all of it read, or not set yet. */
export function whereWords(where: BuddyWhere): { key: 'together.where.section' | 'together.where.end' | 'together.where.notSet'; values: { n?: number } } {
  if (where.kind === 'section') return { key: 'together.where.section', values: { n: where.section } }
  return { key: where.kind === 'end' ? 'together.where.end' : 'together.where.notSet', values: {} }
}
