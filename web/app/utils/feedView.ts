import { DEVICE_FEED_KEY, FEED_PAGE, type FeedEntry, type FeedKind } from '../data/feed'
import { daysBetween } from './dates'

/**
 * What the feed page and Home's circle decide before they draw (social v1, U5): which words a day
 * gets, which empty state shows, how a refreshed first page joins the pages already loaded, and
 * how the device's copy is dated. Pure, so the tests pin it and a native port copies it.
 */

/** How the feed words a day: today and yesterday in words, the days of this week by weekday, older ones by date. */
export type FeedDayLabel = 'today' | 'yesterday' | 'weekday' | 'date'

/** The most days back that still read as a weekday ("Monday"): beyond it "3 Oct" is clearer. */
export const WEEKDAY_DAYS = 6

/** `day` and `today` are calendar days (`YYYY-MM-DD`). A day in the future (a clock off) is today. */
export function feedDayLabel(day: string, today: string): FeedDayLabel {
  const ago = daysBetween(day, today)
  if (ago <= 0) return 'today'
  if (ago === 1) return 'yesterday'
  return ago <= WEEKDAY_DAYS ? 'weekday' : 'date'
}

/**
 * Which empty state the page shows when the feed has no entries. The feed answers `[]` both
 * for a member who follows nobody and for one whose people did nothing yet; `following` (how
 * many she follows) tells them apart. Not known yet (`null`: not asked, or the ask failed or is
 * waiting for a connection): the quiet one, which is true for both.
 */
export type FeedEmpty = 'nobody' | 'quiet'

export function feedEmptyState(following: number | null): FeedEmpty {
  return following === 0 ? 'nobody' : 'quiet'
}

/** The verb's string key for an entry (`feed.<key>`). */
export function feedVerbKey(kind: FeedKind, again: boolean): 'started' | 'startedAgain' | 'finished' | 'abandoned' | 'want' | 'reviewed' {
  return kind === 'started' && again ? 'startedAgain' : kind
}

/** The batch wording's string key for a kind (`feed.<key>`, with `{count}`). */
export function feedBatchKey(kind: FeedKind): 'batchStarted' | 'batchFinished' | 'batchAbandoned' | 'batchWant' | 'batchReviewed' {
  return (
    {
      started: 'batchStarted',
      finished: 'batchFinished',
      abandoned: 'batchAbandoned',
      want: 'batchWant',
      reviewed: 'batchReviewed',
    } as const
  )[kind]
}

/** Newest first, as the feed answers: `at` then `id`, descending. */
function newer(a: Pick<FeedEntry, 'at' | 'id'>, b: Pick<FeedEntry, 'at' | 'id'>): boolean {
  const [x, y] = [Date.parse(a.at), Date.parse(b.at)]
  if (x !== y) return x > y
  if (a.at !== b.at) return a.at > b.at
  return a.id > b.id
}

/**
 * The list after a refresh: the fresh first page, then what was already loaded below it (older
 * than the fresh page's last entry), so a refresh does not cut the list back to one page under
 * the member's thumb. A first page that is not full is the whole feed: nothing below it is kept.
 */
export function mergeFirstPage(current: readonly FeedEntry[], fresh: readonly FeedEntry[]): FeedEntry[] {
  const last = fresh.at(-1)
  if (!last || fresh.length < FEED_PAGE) return [...fresh]
  const seen = new Set(fresh.map((entry) => entry.id))
  return [...fresh, ...current.filter((entry) => !seen.has(entry.id) && newer(last, entry))]
}

/** An older page's entries after the ones she has, without any she already has. */
export function appendPage(current: readonly FeedEntry[], page: readonly FeedEntry[]): FeedEntry[] {
  const seen = new Set(current.map((entry) => entry.id))
  return [...current, ...page.filter((entry) => !seen.has(entry.id))]
}

/**
 * When the device's copy was taken, as the offline line words it: the time ("14:02") on the
 * same calendar day, with the weekday ("Mon 14:02") before that. Locale from the app.
 */
export function copyTimeLabel(savedAt: Date, now: Date, locale: string): string {
  const sameDay =
    savedAt.getFullYear() === now.getFullYear() && savedAt.getMonth() === now.getMonth() && savedAt.getDate() === now.getDate()
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(savedAt)
}

/** The time of the device's copy (`libellus.feed`), when it is this member's: what the offline line says "as of". */
export function copyTakenAt(storage: { getItem(key: string): string | null }, memberId: string): Date | null {
  try {
    const raw = storage.getItem(DEVICE_FEED_KEY)
    const saved = raw ? (JSON.parse(raw) as { data?: { memberId?: string; savedAt?: string } }).data : null
    if (!saved || saved.memberId !== memberId || typeof saved.savedAt !== 'string') return null
    const at = new Date(saved.savedAt)
    return Number.isNaN(at.getTime()) ? null : at
  } catch {
    return null
  }
}
