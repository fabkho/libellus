import type { ProgressMode, ProgressValue } from './progress'

/**
 * Progress by day (issue #68, phase 2 of design round #65's direction D): how far
 * each day of a read went, as `update_progress` books it in
 * `reading_progress_days` (where the read was before the day's first update and
 * after its last, on the member's own calendar day). The card's chart and
 * pace, the book page's figures, chart and reading log, and "Last time" are all
 * worked out here from those rows, so a native client copies it 1:1.
 *
 * Amounts are in the read's unit: pages when the entry has a page count that
 * counts (`pageCountOf`), else percent. A value of the other kind is converted
 * through the page count; one that cannot be (a page with no page count) counts
 * as nothing. Days are `YYYY-MM-DD`, and `today` is always the caller's
 * (`isoDay()`), never a clock read in here.
 */

/** One day of a read: where it began (null: no progress yet, i.e. 0) and ended. */
export type ProgressDay = { day: string; start: ProgressValue | null; end: ProgressValue }

/** A row of `reading_progress_days` as the database returns it. */
export type ProgressDayRow = {
  session_id: string
  day: string
  start_page: number | null
  start_percent: number | null
  end_page: number | null
  end_percent: number | null
}

/** One day of the chart: how much was read (0 for a day without reading, never below). */
export type DayAmount = { day: string; amount: number }

export function dayFromRow(row: ProgressDayRow): ProgressDay {
  const start = row.start_page != null ? { page: row.start_page } : row.start_percent != null ? { percent: row.start_percent } : null
  const end = row.end_page != null ? { page: row.end_page } : { percent: row.end_percent ?? 0 }
  return { day: row.day, start, end }
}

/** What the book page shows of a read's progress: nothing but the button, the bar and figures, or those with the chart and log too. */
export type ProgressShown = 'none' | 'value' | 'days'

/** Whether a value says the member got anywhere: a page or percent above 0 (0 is where a read stands before and after an Undo of its first save). */
export function progressStarted(progress: ProgressValue | null): boolean {
  if (!progress) return false
  return ('page' in progress ? progress.page : progress.percent) > 0
}

/**
 * What the book page shows for a read in progress (issue #79). **Never tracked**:
 * no value above 0 on the read *and* no `reading_progress_days` row for it → `'none'`,
 * only the Update progress button. **A value but no day rows** (a first value set
 * long after the start books no day, #68; a read from before #68) → `'value'`:
 * the bar, the four figures (pace and days to go "–") and the button, but no chart
 * and no log, which have nothing to draw. **Any day row** → `'days'`: everything.
 * `days` is null until they were loaded (a cold open, offline possibly never):
 * nothing is known about a chart, so none is held (issue #104; #79 held its room
 * for a read with a value, which collapsed again when the days turned out to be
 * none). A read with a value then counts as `'value'`, one without stays
 * `'none'`; the chart and log open in when the days arrive and there are some.
 */
export function progressShownOf(progress: ProgressValue | null, days: readonly ProgressDay[] | null): ProgressShown {
  if (days?.length) return 'days'
  return progressStarted(progress) ? 'value' : 'none'
}

/** What the read counts in: pages with a page count, else percent. */
export function unitOf(pageCount: number | null): ProgressMode {
  return pageCount ? 'page' : 'percent'
}

/** A value in a unit: none is 0; the other kind through the page count; null when it cannot be. */
export function valueIn(value: ProgressValue | null, unit: ProgressMode, pageCount: number | null): number | null {
  if (!value) return 0
  if (unit === 'page') {
    if ('page' in value) return value.page
    return pageCount ? Math.round((value.percent / 100) * pageCount) : null
  }
  if ('percent' in value) return value.percent
  return pageCount ? Math.round((value.page / pageCount) * 100) : null
}

/** How far one day went, in the read's unit (negative for a day that went back; 0 when it cannot be told). */
export function amountOf(day: ProgressDay, pageCount: number | null): number {
  const unit = unitOf(pageCount)
  const from = valueIn(day.start, unit, pageCount)
  const to = valueIn(day.end, unit, pageCount)
  return from === null || to === null ? 0 : to - from
}

/** Days between two calendar days (`to` later), whatever the clock does in between. */
function daysFrom(from: string, to: string): number {
  const [a, b] = [from, to].map((day) => {
    const [y, m, d] = day.split('-').map(Number)
    return Date.UTC(y!, m! - 1, d!)
  })
  return Math.round((b! - a!) / 86_400_000)
}

/** The day `count` days before `day`. */
function dayBefore(day: string, count: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! - count)).toISOString().slice(0, 10)
}

/** The last `count` days up to today, oldest first, with what was read on each (the card's chart and the reading page's). */
export function dailyAmounts(days: readonly ProgressDay[], today: string, count: number, pageCount: number | null): DayAmount[] {
  const read = new Map(days.map((d) => [d.day, Math.max(0, amountOf(d, pageCount))]))
  return Array.from({ length: count }, (_, i) => {
    const day = dayBefore(today, count - 1 - i)
    return { day, amount: read.get(day) ?? 0 }
  })
}

/** How many days the pace looks back over. */
export const PACE_DAYS = 14

/**
 * How much a day, over the last two weeks: what was read since the first day
 * that read anything in them, spread over every day from it to today, rounded
 * (at least 1). Null with fewer than two days of reading to go on.
 */
export function paceOf(days: readonly ProgressDay[], today: string, pageCount: number | null): number | null {
  const recent = days
    .filter((d) => daysFrom(d.day, today) < PACE_DAYS && daysFrom(d.day, today) >= 0)
    .map((d) => ({ day: d.day, amount: amountOf(d, pageCount) }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => a.day.localeCompare(b.day))
  if (recent.length < 2) return null
  const total = recent.reduce((sum, d) => sum + d.amount, 0)
  const span = daysFrom(recent[0]!.day, today) + 1
  return Math.max(1, Math.round(total / span))
}

/** Days still to go at a pace: 0 at the end, null without a pace. */
export function daysLeftOf(pace: number | null, position: number, end: number): number | null {
  if (position >= end) return 0
  if (!pace) return null
  return Math.max(1, Math.ceil((end - position) / pace))
}

/** "Last time": the latest day before today that read something, and how much. */
export function lastTimeOf(days: readonly ProgressDay[], today: string, pageCount: number | null): DayAmount | null {
  const before = days
    .filter((d) => d.day < today)
    .map((d) => ({ day: d.day, amount: amountOf(d, pageCount) }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => b.day.localeCompare(a.day))
  return before[0] ?? null
}

/** The reading log: every day that read something, newest first, with how much and where it ended. */
export function readingLogOf(
  days: readonly ProgressDay[],
  pageCount: number | null,
): { day: string; amount: number; end: number | null }[] {
  const unit = unitOf(pageCount)
  return days
    .map((d) => ({ day: d.day, amount: amountOf(d, pageCount), end: valueIn(d.end, unit, pageCount) }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => b.day.localeCompare(a.day))
}

/**
 * How a read went, for the Finish sheet ("Read in 12 days · 51 pages a day"): the
 * days from its start to its end, both counted, and the whole book (the page count,
 * else 100 %) spread over them, rounded (at least 1).
 */
export function readSummaryOf(startedOn: string, endedOn: string, pageCount: number | null): { days: number; perDay: number; unit: ProgressMode } {
  const days = Math.max(daysFrom(startedOn, endedOn), 0) + 1
  const whole = pageCount ?? 100
  return { days, perDay: Math.max(1, Math.round(whole / days)), unit: unitOf(pageCount) }
}
