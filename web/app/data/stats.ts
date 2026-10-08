import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book } from './books'
import { BOOK_COLUMNS, bookFromRow, mapLibraryError, type BookRow, type Result, type SessionOutcome } from './library'
import { pageCountOf } from './progress'
import { amountOf, dayFromRow, unitOf } from './progressDays'
import { addDays, daysSpanned } from '../utils/dates'

/**
 * The member's reading in figures (issue #78, the Profile and its years in
 * review). Everything is read from the tables that exist: one query for the
 * closed reads with their Books, two counts, and the days of progress
 * (`reading_progress_days`, issue #68) of the last weeks. The figures are
 * worked out here, framework-free, so a native client computes the same ones
 * from the same rows. Nothing is written.
 *
 * The rules every figure follows:
 * - A year is the year a read ended, re-reads included, like *Read in <year>*.
 *   A finished read logged without an end date counts in All, in no year.
 * - The pages of a read are the member's own total for the entry (issue #60),
 *   else the edition's; a Book with neither counts as a read "without a count".
 * - Days from start to finish count both ends (`daysSpanned`); a read without
 *   both dates has none.
 * - Ratings are quarter stars 1–20; a whole-star row takes 4.75 as four.
 */

/** A year, or every year at once. */
export type StatsYear = number | 'all'

/** One closed read (finished or abandoned), as the figures need it. */
export type StatsRead = {
  sessionId: string
  entryId: string
  book: Book
  startedOn: string | null
  endedOn: string | null
  outcome: SessionOutcome
  /** Quarter stars, 1–20, or null when unrated. */
  rating: number | null
  /** The pages that count: the member's own total, else the edition's. */
  pages: number | null
  /** Days from start to finish, both ends counted; null without both dates. */
  days: number | null
  /** Which finished read of the entry this is (2 = read again); 0 for an abandoned one. */
  nth: number
}

/** One day of the last weeks: whether anything was read, and how many pages (percent-only days read no pages). */
export type ReadingDay = { day: string; read: boolean; pages: number }

/** What the Profile is drawn from. */
export type ReadingRecord = {
  /** Every closed read, oldest end first. */
  reads: StatsRead[]
  wantToRead: number
  reading: number
  /** The last `DAYS_SHOWN` days up to today, oldest first. */
  days: ReadingDay[]
  /** The first day progress was kept by day at all (the table is new: older reads have none). */
  daysSince: string | null
}

/** How many days the reading days look back over: five weeks and then some, so a Monday-first calendar fits. */
export const DAYS_SHOWN = 42

/** The whole-star row a Rating counts in: 4.75 is a four, 0.25 a one. */
export function starOf(rating: number): number {
  return Math.max(1, Math.floor(rating / 4))
}

type SessionStatsRow = {
  id: string
  entry_id: string
  started_on: string | null
  ended_on: string | null
  outcome: SessionOutcome
  rating: number | null
  created_at: string
  entry: { page_count_override: number | null; book: BookRow }
}

type DayStatsRow = {
  day: string
  start_page: number | null
  start_percent: number | null
  end_page: number | null
  end_percent: number | null
  session: { entry: { page_count_override: number | null; book: { page_count: number | null } } }
}

/** The closed reads from their rows, oldest end first, each knowing which read of its entry it is. */
export function readsFromRows(rows: readonly SessionStatsRow[]): StatsRead[] {
  const order = (row: SessionStatsRow) => row.ended_on ?? row.started_on ?? ''
  const sorted = [...rows].sort((a, b) => order(a).localeCompare(order(b)) || a.created_at.localeCompare(b.created_at))
  const seen = new Map<string, number>()
  return sorted.map((row) => {
    const book = bookFromRow(row.entry.book)
    let nth = 0
    if (row.outcome === 'finished') {
      nth = (seen.get(row.entry_id) ?? 0) + 1
      seen.set(row.entry_id, nth)
    }
    return {
      sessionId: row.id,
      entryId: row.entry_id,
      book,
      startedOn: row.started_on,
      endedOn: row.ended_on,
      outcome: row.outcome,
      rating: row.rating,
      pages: pageCountOf({ book, pageCountOverride: row.entry.page_count_override }),
      days: row.started_on && row.ended_on ? daysSpanned(row.started_on, row.ended_on) : null,
      nth,
    }
  })
}

/** The last `count` days up to today from the days' rows: read or not, and the pages (all Books together). */
export function readingDaysFromRows(rows: readonly DayStatsRow[], today: string, count = DAYS_SHOWN): ReadingDay[] {
  const byDay = new Map<string, ReadingDay>()
  for (const row of rows) {
    const pageCount = pageCountOf({ book: { pageCount: row.session.entry.book.page_count }, pageCountOverride: row.session.entry.page_count_override })
    const amount = amountOf(dayFromRow({ session_id: '', ...row }), pageCount)
    if (amount <= 0) continue
    const day = byDay.get(row.day) ?? { day: row.day, read: false, pages: 0 }
    day.read = true
    if (unitOf(pageCount) === 'page') day.pages += amount
    byDay.set(row.day, day)
  }
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(today, i - count + 1)
    return byDay.get(day) ?? { day, read: false, pages: 0 }
  })
}

// ------------------------------------------------------------------ figures

export type AuthorFigure = {
  name: string
  count: number
  /** Mean Rating in quarters of the rated ones, null when none is. */
  rating: number | null
  /** The author's Books, newest read first, each once. */
  books: Book[]
}

export type YearFigures = {
  year: StatsYear
  /** Finished reads, re-reads included. */
  books: number
  pages: number
  /** Finished reads without any page count, left out of `pages`. */
  pagesMissing: number
  rated: number
  unrated: number
  /** Mean Rating in quarters, null with nothing rated. */
  average: number | null
  /** Finished reads per whole star, 5 down to 1. */
  byStar: { star: number; count: number }[]
  /** Finished reads per month (a year: 12) or per year, oldest first (All). */
  columns: { key: number; count: number }[]
  medianDays: number | null
  quickest: StatsRead | null
  slowest: StatsRead | null
  longest: StatsRead | null
  shortest: StatsRead | null
  rereads: number
  abandoned: number
  /** Authors read more than once, most read first (then the better rated). */
  authors: AuthorFigure[]
  /** The best rated read, the latest on a tie. */
  favourite: StatsRead | null
}

const yearOf = (read: StatsRead) => (read.endedOn ? Number(read.endedOn.slice(0, 4)) : null)
const inYear = (year: StatsYear) => (read: StatsRead) => year === 'all' || yearOf(read) === year

/** The years with a finished read, newest first. */
export function yearsOf(reads: readonly StatsRead[]): number[] {
  const years = new Set(reads.filter((r) => r.outcome === 'finished').map(yearOf).filter((y): y is number => y !== null))
  return [...years].sort((a, b) => b - a)
}

/** The finished reads of a year (or all), newest end first. */
export function finishedIn(reads: readonly StatsRead[], year: StatsYear): StatsRead[] {
  return reads.filter((r) => r.outcome === 'finished' && inYear(year)(r)).reverse()
}

/** A month's finished reads (`month` 1–12), in the order they ended. */
export function readsInMonth(reads: readonly StatsRead[], year: number, month: number): StatsRead[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  return finishedIn(reads, year)
    .filter((r) => r.endedOn!.startsWith(prefix))
    .reverse()
}

/** The finished reads rated in one whole-star row, best rated first, then newest. */
export function readsWithStars(reads: readonly StatsRead[], year: StatsYear, star: number): StatsRead[] {
  return finishedIn(reads, year)
    .filter((r) => r.rating !== null && starOf(r.rating) === star)
    .sort((a, b) => b.rating! - a.rating! || (b.endedOn ?? '').localeCompare(a.endedOn ?? ''))
}

/**
 * The finished reads of a year (or all) whose Book has no page count: exactly the reads
 * `pagesMissing` counts, in the same order (newest end first), so the Pages card's line and the
 * sheet it opens can never disagree.
 */
export function readsWithoutPages(reads: readonly StatsRead[], year: StatsYear = 'all'): StatsRead[] {
  return finishedIn(reads, year).filter((r) => r.pages === null)
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

export function figuresOf(reads: readonly StatsRead[], year: StatsYear): YearFigures {
  const finished = finishedIn(reads, year)
  const rated = finished.filter((r) => r.rating !== null)
  const timed = finished.filter((r) => r.days !== null).sort((a, b) => a.days! - b.days!)
  const paged = finished.filter((r) => r.pages !== null).sort((a, b) => a.pages! - b.pages!)

  const byAuthor = new Map<string, StatsRead[]>()
  for (const read of finished) {
    const name = read.book.authors[0]
    if (name) byAuthor.set(name, [...(byAuthor.get(name) ?? []), read])
  }
  const authors = [...byAuthor.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => {
      const withRating = list.filter((r) => r.rating !== null)
      return {
        name,
        count: list.length,
        rating: withRating.length ? withRating.reduce((sum, r) => sum + r.rating!, 0) / withRating.length : null,
        books: [...new Map(list.map((r) => [r.book.id, r.book])).values()],
      }
    })
    .sort((a, b) => b.count - a.count || (b.rating ?? 0) - (a.rating ?? 0))

  const columns =
    year === 'all'
      ? [...yearsOf(reads)].reverse().map((y) => ({ key: y, count: finishedIn(reads, y).length }))
      : Array.from({ length: 12 }, (_, m) => ({ key: m + 1, count: readsInMonth(reads, year, m + 1).length }))

  return {
    year,
    books: finished.length,
    pages: paged.reduce((sum, r) => sum + r.pages!, 0),
    pagesMissing: readsWithoutPages(reads, year).length,
    rated: rated.length,
    unrated: finished.length - rated.length,
    average: rated.length ? rated.reduce((sum, r) => sum + r.rating!, 0) / rated.length : null,
    byStar: [5, 4, 3, 2, 1].map((star) => ({ star, count: rated.filter((r) => starOf(r.rating!) === star).length })),
    columns,
    medianDays: median(timed.map((r) => r.days!)),
    quickest: timed[0] ?? null,
    slowest: timed.at(-1) ?? null,
    longest: paged.at(-1) ?? null,
    shortest: paged[0] ?? null,
    rereads: finished.filter((r) => r.nth > 1).length,
    abandoned: reads.filter((r) => r.outcome === 'abandoned' && inYear(year)(r)).length,
    authors,
    favourite: [...rated].sort((a, b) => b.rating! - a.rating! || (b.endedOn ?? '').localeCompare(a.endedOn ?? ''))[0] ?? null,
  }
}

/** The first day of the member's reading: the earliest start or end of a closed read. */
export function readingSinceOf(reads: readonly StatsRead[]): string | null {
  return reads.map((r) => r.startedOn ?? r.endedOn).filter((d): d is string => Boolean(d)).sort()[0] ?? null
}

/** The days read among the last `count`, and the pages on a day read (days read without pages left out). */
export function readingDaysSummary(days: readonly ReadingDay[], count = 30) {
  const last = days.slice(-count)
  const paged = last.filter((d) => d.pages > 0)
  return {
    read: last.filter((d) => d.read).length,
    count: last.length,
    perDay: paged.length ? Math.round(paged.reduce((sum, d) => sum + d.pages, 0) / paged.length) : null,
  }
}

// --------------------------------------------------------------- repository

export type Stats = {
  /** The member's reading record as of `today` (`YYYY-MM-DD`, the member's day). */
  record: (today: string) => Promise<Result<ReadingRecord>>
}

/** The most rows the API returns for one request (`max_rows`, supabase/config.toml). */
const PAGE = 1000

/**
 * Every row of a query, page by page: the API answers at most `PAGE` rows a
 * request, and a member's whole history (an imported Library) can be more.
 * The query must have a stable order for the pages to meet.
 */
async function allPages<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message?: string; code?: string } | null }>,
): Promise<{ data: Row[]; error: null } | { data: null; error: { message?: string; code?: string } }> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return { data: rows, error: null }
  }
}

export function createStats(client: SupabaseClient): Stats {
  return {
    async record(today) {
      const from = addDays(today, -(DAYS_SHOWN - 1))
      const [sessions, want, reading, days, first] = await Promise.all([
        allPages<SessionStatsRow>((from, to) =>
          client
            .from('reading_sessions')
            .select(`id, entry_id, started_on, ended_on, outcome, rating, created_at, entry:library_entries!inner(page_count_override, book:books!inner(${BOOK_COLUMNS}))`)
            .not('outcome', 'is', null)
            .order('id')
            .range(from, to)
            .returns<SessionStatsRow[]>(),
        ),
        client.from('library_entries').select('id', { count: 'exact', head: true }).eq('status', 'want_to_read'),
        client.from('library_entries').select('id', { count: 'exact', head: true }).eq('status', 'reading'),
        allPages<DayStatsRow>((start, end) =>
          client
            .from('reading_progress_days')
            .select('day, start_page, start_percent, end_page, end_percent, session:reading_sessions!inner(entry:library_entries!inner(page_count_override, book:books!inner(page_count)))')
            .gte('day', from)
            .lte('day', today)
            .order('session_id')
            .order('day')
            .range(start, end)
            .returns<DayStatsRow[]>(),
        ),
        client.from('reading_progress_days').select('day').order('day').limit(1).returns<{ day: string }[]>(),
      ])
      const failed = sessions.error ?? want.error ?? reading.error ?? days.error ?? first.error
      if (failed || !sessions.data || !days.data) return { data: null, error: mapLibraryError(failed ?? {}) }
      return {
        data: {
          reads: readsFromRows(sessions.data),
          wantToRead: want.count ?? 0,
          reading: reading.count ?? 0,
          days: readingDaysFromRows(days.data, today),
          daysSince: first.data[0]?.day ?? null,
        },
        error: null,
      }
    },
  }
}
