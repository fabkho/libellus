import type { Book } from './books'
import type { ReadingSession } from './library'

/**
 * Reading progress (issue #39), the client side of `update_progress`: how far
 * the member is in the open read, as a page or a percent, latest value only.
 * The database is the authority (`progress_page_fits`); this is what the
 * sheet checks and the book page and Home show, so a native client copies it
 * 1:1.
 *
 * The page count that counts (issue #60) is the member's own total for the entry
 * when she set one (an ebook's pages follow the font size), else the edition's:
 * `pageCountOf`. Everything below that asks for a `pageCount` is given that one.
 */

/** The most pages a total (or a page, where there is no total) can be: the database's ceiling. */
export const PAGE_CEILING = 99999

/** What is recorded: a page or a percent, exactly one. */
export type ProgressValue = { page: number } | { percent: number }

/**
 * `updateProgress`'s word for "take the read back to no progress" (Undo of a first
 * save, issue #104): the database clears the value instead of storing 0
 * (`update_progress(p_clear => true)`).
 */
export const NO_PROGRESS = 'none' as const

/** Which of the two the Update progress sheet is entering. */
export type ProgressMode = 'page' | 'percent'

/** The page count that counts for an entry: the member's own total, else the edition's, else null. */
export function pageCountOf(entry: { book: Pick<Book, 'pageCount'>; pageCountOverride?: number | null }): number | null {
  return entry.pageCountOverride ?? entry.book.pageCount ?? null
}

/** How far a read is, as stored: the page or the percent, null while none is set. */
export function progressOf(session: ReadingSession | null | undefined): ProgressValue | null {
  if (session?.progressPage != null) return { page: session.progressPage }
  if (session?.progressPercent != null) return { percent: session.progressPercent }
  return null
}

/** How far through, 0–1, for the bar: a page against the page count when there is one. */
export function progressFraction(progress: ProgressValue | null, pageCount: number | null): number {
  if (!progress) return 0
  if ('percent' in progress) return Math.min(Math.max(progress.percent / 100, 0), 1)
  if (!pageCount) return 0
  return Math.min(Math.max(progress.page / pageCount, 0), 1)
}

/** Whole percent for a page against the page count; null when the Book has no page count. */
export function progressPercentOf(progress: ProgressValue | null, pageCount: number | null): number | null {
  if (!progress) return null
  if ('percent' in progress) return progress.percent
  return pageCount ? Math.round(progressFraction(progress, pageCount) * 100) : null
}

/** The last page, or 100 %: the value that says the read is done (the sheet then offers Finish). */
export function progressReachedEnd(progress: ProgressValue | null, pageCount: number | null): boolean {
  if (!progress) return false
  if ('percent' in progress) return progress.percent >= 100
  return Boolean(pageCount) && progress.page >= pageCount!
}

/**
 * What the sheet starts in: pages when the Book has a page count (unless the
 * progress already there is a percentage), otherwise a percentage.
 */
export function progressModeFor(book: Pick<Book, 'pageCount'>, current: ProgressValue | null): ProgressMode {
  if (!book.pageCount) return 'percent'
  return current && 'percent' in current ? 'percent' : 'page'
}

/** The largest number a mode takes: the page count in pages (any page up to the ceiling without one), 100 in percent. */
export function progressMax(mode: ProgressMode, pageCount: number | null): number {
  if (mode === 'percent') return 100
  return pageCount || PAGE_CEILING
}

/**
 * A number in one mode as the other (issue #68: the wheel switching Pages | Percent),
 * so the place in the book carries over: page 240 of 480 is 50 %, and back. Without a
 * page count there is nothing to convert through: 0.
 */
export function convertProgress(value: number, to: ProgressMode, pageCount: number | null): number {
  if (!pageCount) return 0
  if (to === 'percent') return Math.min(100, Math.round((value / pageCount) * 100))
  return Math.min(pageCount, Math.round((value / 100) * pageCount))
}

/** What the wheel starts on in a mode: the stored value, converted when it is the other kind; 0 for none. */
export function progressIn(current: ProgressValue | null, mode: ProgressMode, pageCount: number | null): number {
  if (!current) return 0
  if (mode === 'page') return 'page' in current ? current.page : convertProgress(current.percent, 'page', pageCount)
  return 'percent' in current ? current.percent : convertProgress(current.page, 'percent', pageCount)
}

/** The wheel's number as what is recorded. */
export function progressValueOf(value: number, mode: ProgressMode): ProgressValue {
  return mode === 'page' ? { page: value } : { percent: value }
}

/** Whether two values are the same place, recorded the same way. */
export function sameProgress(a: ProgressValue | null, b: ProgressValue | null): boolean {
  if (!a || !b) return a === b
  if ('page' in a) return 'page' in b && a.page === b.page
  return 'percent' in b && a.percent === b.percent
}

/** A total the member set, as stored: one that only repeats the edition's page count is none. */
export function ownTotal(total: number | null, editionCount: number | null): number | null {
  return total === null || total === editionCount ? null : total
}

/** Where the total wheel starts for a Book with no page count at all: a common one. */
export const TOTAL_GUESS = 300

/**
 * How far a save moved the read (issue #68, "+24" on Home's card next to Undo): in
 * the unit it was saved in, from where it was (none is 0), the earlier value
 * converted through the page count when it was the other kind. Null when it did
 * not move or cannot be told.
 */
export function progressGain(
  before: ProgressValue | null,
  after: ProgressValue,
  pageCount: number | null,
): { amount: number; unit: ProgressMode } | null {
  const unit: ProgressMode = 'page' in after ? 'page' : 'percent'
  const to = 'page' in after ? after.page : after.percent
  let from = 0
  if (before) {
    const sameKind = ('page' in before) === (unit === 'page')
    if (!sameKind && !pageCount) return null
    from = progressIn(before, unit, pageCount)
  }
  return to === from ? null : { amount: to - from, unit }
}
