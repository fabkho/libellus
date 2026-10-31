import { readsBetween, yearsOf, type StatsRead, type StatsYear } from './stats'
import { addDays, daysBetween, mondayOf, weekNumberOf } from '../utils/dates'

/**
 * The Profile's chart (WP-08, backlog #11b/#11c): which window of her reading the columns show and how it steps,
 * worked out here, framework-free, so a native client draws the same columns.
 *
 * The chart follows the year pills (the `scope`):
 * - **All**: the overview, one column per year she finished a read in (the Months half of the capsule, "All years"). It sits after
 *   the newest year on the capsule's line of time: ‹ goes from it to the newest year, › is nothing. Weeks picked under All open
 *   on the newest year's newest window and move the pill to that year (`switchMode`).
 * - **A year, Months**: the twelve months of that year; ‹ › step to the neighbouring pill (older: the next year with a
 *   finished read, as the pills list them; newer: the next year, or All after the newest), which moves the pill with it.
 * - **A year, Weeks**: the columns are `WEEKS_SHOWN` ISO weeks (Monday first), the windows laid out from the one
 *   today sits in, back; ‹ › step one whole window but stay on the windows that touch the selected year (the first
 *   and the last may reach into its neighbours), so the chart never contradicts the pill. Another year's pill puts
 *   the window on the nearest one that touches it.
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
 * Where the chart stands under a year: the mode, and the weeks' window (a switch back finds it as it was left; the
 * weeks open on the newest). `weekStart` is the window's first Monday. The months' year is the pill's, not kept here.
 */
export type ChartRange = { mode: ChartMode; weekStart: string }

/** The year in the pills and the years it lists (the ones with a finished read, newest first). */
export type ChartScope = { year: StatsYear; years: readonly number[] }

/** The ends of the weeks' windows: the earliest and the newest. */
export type ChartBounds = { earliestWeekStart: string; newestWeekStart: string }

/** One column: a month of a year (`key` 1–12), a week of a window (`key` 1–13) or a year (`key` the year), with the reads that ended in it. */
export type ChartColumn = {
  key: number
  count: number
  /** First and last day it covers, both counted. */
  start: string
  end: string
  /** The month 1–12 (months), the ISO week number 1–53 (weeks) or the year (years). */
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
  let first: string | null = null
  for (const read of reads) {
    if (read.outcome === 'finished' && read.endedOn !== null && (first === null || read.endedOn < first)) first = read.endedOn
  }
  if (first === null || first > today) return { earliestWeekStart: newestWeekStart, newestWeekStart }
  const back = Math.max(Math.ceil(daysBetween(mondayOf(first), newestWeekStart) / (7 * WEEKS_SHOWN)), 0)
  return { earliestWeekStart: addDays(newestWeekStart, -7 * WEEKS_SHOWN * back), newestWeekStart }
}

/** The first Monday of the window the week of `day` sits in (held to the ends). */
function windowOf(day: string, bounds: ChartBounds): string {
  const back = Math.max(Math.ceil(daysBetween(mondayOf(day), bounds.newestWeekStart) / (7 * WEEKS_SHOWN)), 0)
  const start = addDays(bounds.newestWeekStart, -7 * WEEKS_SHOWN * back)
  return start < bounds.earliestWeekStart ? bounds.earliestWeekStart : start
}

/** The windows a scope allows: the whole record under All, under a year the ones touching it (its first week to its last). */
export function scopeBounds(bounds: ChartBounds, scope: ChartScope): ChartBounds {
  if (scope.year === 'all') return bounds
  const earliest = windowOf(`${scope.year}-01-01`, bounds)
  const newest = windowOf(`${scope.year}-12-31`, bounds)
  return earliest <= newest ? { earliestWeekStart: earliest, newestWeekStart: newest } : { earliestWeekStart: newest, newestWeekStart: newest }
}

/** The chart as it opens: months, the newest weeks. */
export function defaultRange(today: string): ChartRange {
  return { mode: 'months', weekStart: newestWeekStartOf(today) }
}

/**
 * A range held from before, held to the windows of the scope (a record that changed, a day that passed, another pill); a week start off a Monday goes to its Monday.
 * Under All there are no weeks to show: the overview is the Months half's (`mode` months).
 */
export function clampRange(range: ChartRange, bounds: ChartBounds, scope: ChartScope): ChartRange {
  const ends = scopeBounds(bounds, scope)
  let weekStart = mondayOf(range.weekStart)
  if (weekStart < ends.earliestWeekStart) weekStart = ends.earliestWeekStart
  if (weekStart > ends.newestWeekStart) weekStart = ends.newestWeekStart
  const mode = scope.year === 'all' ? 'months' : range.mode
  return weekStart === range.weekStart && mode === range.mode ? range : { mode, weekStart }
}

/** Switches the mode: the weeks open on the newest window of the scope. */
export function withMode(range: ChartRange, mode: ChartMode, bounds: ChartBounds, scope: ChartScope): ChartRange {
  if (mode === range.mode) return range
  return mode === 'months' ? { ...range, mode } : { mode, weekStart: scopeBounds(bounds, scope).newestWeekStart }
}

/**
 * The capsule's mode switch with the pill it moves: Weeks picked under All opens on the newest year's newest window and moves the
 * pill to that year (there are no weeks of "all time"; without a year with a finished read there is nothing to open, so nothing
 * changes); anywhere else the mode changes and the pill stays.
 */
export function switchMode(range: ChartRange, mode: ChartMode, bounds: ChartBounds, scope: ChartScope): { range: ChartRange; year: StatsYear } {
  if (mode === 'weeks' && scope.year === 'all') {
    const newest = scope.years[0]
    if (newest === undefined) return { range, year: scope.year }
    return { range: withMode(range, mode, bounds, { year: newest, years: scope.years }), year: newest }
  }
  return { range: withMode(range, mode, bounds, scope), year: scope.year }
}

/**
 * The pill a step in Months goes to. The steps run along time, the overview after the newest year: ‹ (`-1`) is older (All → the newest year →
 * 2025 → …), › (`1`) newer (… → the newest year → All); none at either end (the oldest year with a finished read, All) or from a pill the record no longer lists.
 */
export function stepYear(scope: ChartScope, direction: -1 | 1): StatsYear | null {
  if (scope.year === 'all') return direction < 0 ? (scope.years[0] ?? null) : null
  const at = scope.years.indexOf(scope.year)
  if (at < 0) return null
  if (direction > 0 && at === 0) return 'all'
  return scope.years[at - direction] ?? null
}

/** Whether ‹ (`-1`) or › (`1`) has a window to step to. */
export function canStep(range: ChartRange, bounds: ChartBounds, scope: ChartScope, direction: -1 | 1): boolean {
  if (scope.year === 'all' || range.mode === 'months') return stepYear(scope, direction) !== null
  const ends = scopeBounds(bounds, scope)
  return direction < 0 ? range.weekStart > ends.earliestWeekStart : range.weekStart < ends.newestWeekStart
}

/**
 * One window back or forward: to the neighbouring pill (All, or a year; it comes back as `year`), or `WEEKS_SHOWN`
 * weeks (the year stays). At an end, the range and the year as they are.
 */
export function stepRange(range: ChartRange, bounds: ChartBounds, scope: ChartScope, direction: -1 | 1): { range: ChartRange; year: StatsYear } {
  if (!canStep(range, bounds, scope, direction)) return { range, year: scope.year }
  if (scope.year === 'all' || range.mode === 'months') return { range, year: stepYear(scope, direction)! }
  return { range: { ...range, weekStart: addDays(range.weekStart, 7 * WEEKS_SHOWN * direction) }, year: scope.year }
}

/** The columns of a window, each with the reads that ended in it: the months of `year`, or the weeks from `range.weekStart`. */
export function columnsOf(reads: readonly StatsRead[], range: ChartRange, year: number): ChartColumn[] {
  if (range.mode === 'months') {
    return Array.from({ length: 12 }, (_, m) => {
      const start = `${year}-${String(m + 1).padStart(2, '0')}-01`
      const end = addDays(m === 11 ? `${year + 1}-01-01` : `${year}-${String(m + 2).padStart(2, '0')}-01`, -1)
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

/** Under All, a column per year she finished a read in, the oldest first (as the Profile always drew them). */
export function yearColumnsOf(reads: readonly StatsRead[]): ChartColumn[] {
  return [...yearsOf(reads)].reverse().map((y) => {
    const inColumn = readsBetween(reads, `${y}-01-01`, `${y}-12-31`)
    return { key: y, count: inColumn.length, start: `${y}-01-01`, end: `${y}-12-31`, number: y, reads: inColumn }
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
