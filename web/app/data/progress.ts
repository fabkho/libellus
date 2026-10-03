import type { Book } from './books'
import type { LibraryErrorCode, ReadingSession } from './library'

/**
 * Reading progress (issue #39), the client side of `update_progress`: how far
 * the member is in the open read, as a page or a percent, latest value only.
 * The database is the authority (`progress_page_fits`); this is what the
 * sheet checks and the book page and Home show, so a native client copies it
 * 1:1.
 */

/** What is recorded: a page or a percent, exactly one. */
export type ProgressValue = { page: number } | { percent: number }

/** Which of the two the Update progress sheet is entering. */
export type ProgressMode = 'page' | 'percent'

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

/** The sheet's field for a mode, from what is stored: its number, '' for none. */
export function progressFieldOf(current: ProgressValue | null, mode: ProgressMode): string {
  if (!current) return ''
  if (mode === 'page') return 'page' in current ? String(current.page) : ''
  return 'percent' in current ? String(current.percent) : ''
}

/** The largest number a mode takes for a Book: its page count, or 100. */
export function progressMax(mode: ProgressMode, pageCount: number | null): number {
  return mode === 'page' && pageCount ? pageCount : 100
}

/**
 * What the sheet's field holds as a value, or the reason it cannot be one:
 * whole digits, no more than the mode's maximum. The database refuses the same.
 */
export function parseProgress(
  field: string,
  mode: ProgressMode,
  pageCount: number | null,
): { value: ProgressValue; error: null } | { value: null; error: LibraryErrorCode } {
  const text = field.trim()
  if (!/^\d{1,9}$/.test(text)) return { value: null, error: 'progress_invalid' }
  const n = Number(text)
  if (n > progressMax(mode, pageCount)) return { value: null, error: 'progress_invalid' }
  return { value: mode === 'page' ? { page: n } : { percent: n }, error: null }
}

/**
 * The field after switching mode, so the place in the book carries over: a page
 * becomes the percent it is of the page count and back. Empty stays empty.
 */
export function convertProgressField(field: string, to: ProgressMode, pageCount: number | null): string {
  const text = field.trim()
  if (!pageCount || !/^\d+$/.test(text)) return ''
  const n = Number(text)
  if (to === 'percent') return String(Math.min(100, Math.round((n / pageCount) * 100)))
  return String(Math.min(pageCount, Math.round((n / 100) * pageCount)))
}
