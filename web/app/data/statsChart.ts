import { readsBetween, type StatsRead } from './stats'
import { addDays, daysBetween, mondayOf, weekNumberOf } from '../utils/dates'

/**
 * The Profile's chart by month or by week (WP-08, backlog #11b/#11c): which window of her reading the columns
 * show and how it steps, worked out here, framework-free, so a native client draws the same columns.
 *
 * - **Months**: the columns are the twelve months of a calendar year; ‹ › step whole years.
 * - **Weeks**: the columns are `WEEKS_SHOWN` ISO weeks (Monday first); the newest window ends with the week today
 *   sits in; ‹ › step one whole window.
 * - Both ends stop: no window before the one holding her first finish (taken from her reads, not from a nominal
 *   date) and none after today's.
 * - A read counts in the window its end date (`endedOn`) falls in; one without an end date counts in none.
 *   Days are the member's own calendar days (`YYYY-MM-DD`, no time zone), so the buckets never shift with the
 *   device's zone or daylight saving.
 */

/** How many weeks one window holds: a quarter. */
export const WEEKS_SHOWN = 13

export type ChartMode = 'months' | 'weeks'

/**
 * Where the chart stands: the mode, and each mode's window (a switch back finds the months' year as it was left;
 * the weeks always open on the newest window). `weekStart` is the window's first Monday.
 */
export type ChartRange = { mode: ChartMode; year: number; weekStart: string }

/** The ends of the windows: the earliest and the newest of each mode. */
export type ChartBounds = { firstYear: number; lastYear: number; earliestWeekStart: string; newestWeekStart: string }

/** One column: a month of a year (`key` 1–12) or one week of a window (`key` 1–13), with the reads that ended in it. */
export type ChartColumn = {
  key: number
  count: number
  /** First and last day it covers, both counted. */
  start: string
  end: string
  /** The month 1–12 (months), or the ISO week number 1–53 (weeks). */
  number: number
  reads: StatsRead[]
}

/** The first Monday of the newest window: the last `WEEKS_SHOWN` weeks, the one today sits in the last. */
export function newestWeekStartOf(today: string): string {
  return addDays(mondayOf(today), -7 * (WEEKS_SHOWN - 1))
}

/** The ends of the windows for a record: the left end is the window holding her first finished read (today's when she has none). */
export function chartBounds(reads: readonly StatsRead[], today: string): ChartBounds {
  const newestWeekStart = newestWeekStartOf(today)
  const thisYear = Number(today.slice(0, 4))
  let first: string | null = null
  for (const read of reads) {
    if (read.outcome === 'finished' && read.endedOn !== null && (first === null || read.endedOn < first)) first = read.endedOn
  }
  if (first === null || first > today) return { firstYear: thisYear, lastYear: thisYear, earliestWeekStart: newestWeekStart, newestWeekStart }
  const back = Math.max(Math.ceil(daysBetween(mondayOf(first), newestWeekStart) / (7 * WEEKS_SHOWN)), 0)
  return {
    firstYear: Number(first.slice(0, 4)),
    lastYear: thisYear,
    earliestWeekStart: addDays(newestWeekStart, -7 * WEEKS_SHOWN * back),
    newestWeekStart,
  }
}

/** The chart as it opens: months, this year. */
export function defaultRange(today: string): ChartRange {
  return { mode: 'months', year: Number(today.slice(0, 4)), weekStart: newestWeekStartOf(today) }
}

/** A range held from before, held to the ends (a record that changed, a day that passed); a week start off a Monday goes to its Monday. */
export function clampRange(range: ChartRange, bounds: ChartBounds): ChartRange {
  const year = Math.min(Math.max(range.year, bounds.firstYear), bounds.lastYear)
  let weekStart = mondayOf(range.weekStart)
  if (weekStart < bounds.earliestWeekStart) weekStart = bounds.earliestWeekStart
  if (weekStart > bounds.newestWeekStart) weekStart = bounds.newestWeekStart
  return { mode: range.mode, year, weekStart }
}

/** Switches the mode: months keep the year they were left on, weeks open on the newest window. */
export function withMode(range: ChartRange, mode: ChartMode, bounds: ChartBounds): ChartRange {
  if (mode === range.mode) return range
  return mode === 'months' ? clampRange({ ...range, mode }, bounds) : { ...range, mode, weekStart: bounds.newestWeekStart }
}

/** Whether ‹ (`-1`) or › (`1`) has a window to step to. */
export function canStep(range: ChartRange, bounds: ChartBounds, direction: -1 | 1): boolean {
  if (range.mode === 'months') return direction < 0 ? range.year > bounds.firstYear : range.year < bounds.lastYear
  return direction < 0 ? range.weekStart > bounds.earliestWeekStart : range.weekStart < bounds.newestWeekStart
}

/** One window back or forward: a year, or `WEEKS_SHOWN` weeks. At an end, the range as it is. */
export function stepRange(range: ChartRange, bounds: ChartBounds, direction: -1 | 1): ChartRange {
  if (!canStep(range, bounds, direction)) return range
  return range.mode === 'months'
    ? { ...range, year: range.year + direction }
    : { ...range, weekStart: addDays(range.weekStart, 7 * WEEKS_SHOWN * direction) }
}

/** The columns of a window, each with the reads that ended in it. */
export function columnsOf(reads: readonly StatsRead[], range: ChartRange): ChartColumn[] {
  if (range.mode === 'months') {
    return Array.from({ length: 12 }, (_, m) => {
      const start = `${range.year}-${String(m + 1).padStart(2, '0')}-01`
      const end = addDays(m === 11 ? `${range.year + 1}-01-01` : `${range.year}-${String(m + 2).padStart(2, '0')}-01`, -1)
      const inColumn = readsBetween(reads, start, end)
      return { key: m + 1, count: inColumn.length, start, end, number: m + 1, reads: inColumn }
    })
  }
  return Array.from({ length: WEEKS_SHOWN }, (_, w) => {
    const start = addDays(range.weekStart, 7 * w)
    const inColumn = readsBetween(reads, start, addDays(start, 6))
    return { key: w + 1, count: inColumn.length, start, end: addDays(start, 6), number: weekNumberOf(start), reads: inColumn }
  })
}

/** The column holding `today` (the one drawn lit), if the window has it. */
export function litColumn(columns: readonly ChartColumn[], today: string): number | null {
  return columns.find((c) => c.start <= today && today <= c.end)?.key ?? null
}

/** What sits under the chart: the books of the window, their pages (reads without a count leave out) and the mean Rating in quarters. */
export function windowFigures(columns: readonly ChartColumn[]): { books: number; pages: number; average: number | null } {
  const reads = columns.flatMap((c) => c.reads)
  const rated = reads.filter((r) => r.rating !== null)
  return {
    books: reads.length,
    pages: reads.reduce((sum, r) => sum + (r.pages ?? 0), 0),
    average: rated.length ? rated.reduce((sum, r) => sum + r.rating!, 0) / rated.length : null,
  }
}
