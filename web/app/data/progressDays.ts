import { PAGE_CEILING, type ProgressMode, type ProgressValue } from './progress.ts'

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
 * that read anything in them, spread over the days she read in them, not the
 * calendar span from it to today (a day without reading is not a day she read),
 * rounded (at least 1). Null with fewer than two days of reading to go on.
 */
export function paceOf(days: readonly ProgressDay[], today: string, pageCount: number | null): number | null {
  const recent = days
    .filter((d) => daysFrom(d.day, today) < PACE_DAYS && daysFrom(d.day, today) >= 0)
    .map((d) => ({ day: d.day, amount: amountOf(d, pageCount) }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => a.day.localeCompare(b.day))
  if (recent.length < 2) return null
  const total = recent.reduce((sum, d) => sum + d.amount, 0)
  const span = recent.length
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

/**
 * The reading log: every day with a row, newest first, with how much and where it ended. A day that went back
 * (the member re-read, or a later day was set lower: a negative amount) is listed too, as "-6": a row that is not
 * shown cannot be tapped to edit or remove it (R12). A day that reads nothing (0) has no row in the database; one
 * that cannot be told (a page on a read with no page count) is 0 here and stays out. The chart still clamps at 0
 * (`dailyAmounts`), the pace and "Last time" still count only days that read something (above 0).
 */
export function readingLogOf(
  days: readonly ProgressDay[],
  pageCount: number | null,
): { day: string; amount: number; end: number | null }[] {
  const unit = unitOf(pageCount)
  return days
    .map((d) => ({ day: d.day, amount: amountOf(d, pageCount), end: valueIn(d.end, unit, pageCount) }))
    .filter((d) => d.amount !== 0)
    .sort((a, b) => b.day.localeCompare(a.day))
}

// ------------------------------------------------------- an earlier day (R1-R12)

/**
 * Progress on an earlier day (docs/plans/backdated-progress.md): the rules of `public.set_progress_day` and
 * `public.delete_progress_day` (supabase/migrations/20261114010000_progress_day_edit.sql), worked out here from the
 * read's days for what the client draws before the database answers: the wheel's range (`dayBoundsOf`), the
 * effect line (`effectOf`) and the days a write that waits will leave (`withDaySet`, `withDayRemoved`, the
 * offline overlay). The database is the authority; `tests/progress-day-edit.test.ts` runs random edits through
 * both and compares the rows. A native client copies this 1:1.
 *
 * What she enters is where she ended the day (R1); the day's amount follows. One row per day, ends only (R2); the
 * value is clamped between its neighbours (R3); the next day starts where this one ends, and a next day that then
 * reads nothing goes (R4); the read's own value moves only when the days lead it and the day is the latest (R5);
 * removing a day is setting it to its own start (R6). Every comparison is in one unit, the kind of the value given
 * (a remove: the kind of the day's end), the other kind through the page count, rounded half up.
 */

/** What the rules need beyond the days: the read's own value, the page count that counts, and (optionally) the day it began. */
export type DayContext = {
  current: ProgressValue | null
  pageCount: number | null
  /** A new day before it is refused (`date_invalid`): the day is not written. Left out: not checked. */
  startedOn?: string | null
}

/** Where an earlier day's wheel may be, in a unit (R3), and where the day stands now. */
export type DayBounds = {
  /** The least the day may end at: where the day before it ended (the day's own start). */
  lo: number
  /** The most: where the day after it ended; for the latest day the page count (100 %), or the read's value when the days do not lead it. */
  hi: number
  /** Where the day began (what "+8" is measured against); `lo` widened to a row's own end that sits below it. */
  start: number
  /** Where the day ends now, null for a day without a row. */
  end: number | null
  /** The days lead the read's value (R5): its latest day ends where the read is. */
  leads: boolean
}

type Pair = { page: number | null; percent: number | null }
const pairOf = (value: ProgressValue | null): Pair => ({
  page: value && 'page' in value ? value.page : null,
  percent: value && 'percent' in value ? value.percent : null,
})
const valueOfPair = (pair: Pair): ProgressValue | null =>
  pair.page !== null ? { page: pair.page } : pair.percent !== null ? { percent: pair.percent } : null
const samePair = (a: ProgressValue | null, b: ProgressValue | null) => {
  const [x, y] = [pairOf(a), pairOf(b)]
  return x.page === y.page && x.percent === y.percent
}
/** SQL's `least` / `greatest`: a missing value is ignored. */
const least = (...values: (number | null)[]) => Math.min(...values.filter((v): v is number => v !== null))
const greatest = (...values: (number | null)[]) => Math.max(...values.filter((v): v is number => v !== null))

type Placed = {
  rows: ProgressDay[]
  cur: ProgressDay | undefined
  prev: ProgressDay | undefined
  next: ProgressDay | undefined
  last: ProgressDay | undefined
}

function placeOf(days: readonly ProgressDay[], day: string): Placed {
  const rows = [...days].sort((a, b) => a.day.localeCompare(b.day))
  return {
    rows,
    cur: rows.find((d) => d.day === day),
    prev: [...rows].reverse().find((d) => d.day < day),
    next: rows.find((d) => d.day > day),
    last: rows.at(-1),
  }
}

/** The day's start as stored (R2): its own, else where the day before ended, else the next day's start (the base). */
function startOf({ cur, prev, next }: Placed): ProgressValue | null {
  if (cur) return cur.start
  if (prev) return prev.end
  return next ? next.start : null
}

/** Whether the days lead the read's value (R5): it equals the latest day's end; no value and no days counts. */
function leadsOf({ last }: Placed, current: ProgressValue | null, unit: ProgressMode, pageCount: number | null) {
  const p = valueIn(current, unit, pageCount)
  return p !== null && p === (last ? valueIn(last.end, unit, pageCount) : 0)
}

function limitOf(unit: ProgressMode, pageCount: number | null): number | null {
  return unit === 'page' ? pageCount : 100
}

/** The range of a set (R3): [lo, hi] as the database computes it, with the row's own end inside it. */
function rangeOf(place: Placed, ctx: DayContext, unit: ProgressMode) {
  const { cur, next } = place
  const { current, pageCount } = ctx
  const start = valueIn(startOf(place), unit, pageCount) ?? 0
  const p = valueIn(current, unit, pageCount)
  const leads = leadsOf(place, current, unit, pageCount)
  const limit = limitOf(unit, pageCount)
  let hi: number | null = next ? valueIn(next.end, unit, pageCount) : leads ? limit : p
  hi = least(hi, limit)
  let lo = start
  const curEnd = cur ? valueIn(cur.end, unit, pageCount) : null
  if (cur) {
    lo = least(lo, curEnd)
    hi = greatest(hi, curEnd)
  }
  return { lo, hi, start, leads, curEnd, p, limit }
}

/**
 * Where an earlier day's wheel may stand, in `unit` (the wheel's mode): the range of R3 for a day that has a row or
 * not, where it begins and (with a row) where it ends. `current` is the read's value; `pageCount` the one that counts.
 */
export function dayBoundsOf(
  days: readonly ProgressDay[],
  day: string,
  current: ProgressValue | null,
  pageCount: number | null,
  unit: ProgressMode,
): DayBounds {
  const place = placeOf(days, day)
  const { lo, hi, start, leads, curEnd } = rangeOf(place, { current, pageCount }, unit)
  // No page count and no value to bound a page by (the database refuses a page then): the ceiling a page can be.
  return { lo, hi: Number.isFinite(hi) ? hi : PAGE_CEILING, start, end: place.cur ? curEnd : null, leads }
}

/** The days and the read's value after one edit (what the database leaves), and whether the value moved. */
export type DayEdit = { days: ProgressDay[]; current: ProgressValue | null; currentChanged: boolean }

/**
 * One edit of a day through the database's rules: `value` is where she ended it, `null` removes the day (R6). A
 * write the database refuses (a page on a read with no page count, a page past it, a percent over 100, a new day
 * before the read began) and one that changes nothing leave the days as they are.
 */
export function dayEdit(days: readonly ProgressDay[], day: string, value: ProgressValue | null, ctx: DayContext): DayEdit {
  const { pageCount, current } = ctx
  const unchanged: DayEdit = { days: [...days].sort((a, b) => a.day.localeCompare(b.day)), current, currentChanged: false }
  const place = placeOf(days, day)
  const { cur, next } = place
  const remove = value === null
  if (remove && !cur) return unchanged
  if (value) {
    if ('page' in value && (pageCount === null || value.page < 0 || value.page > pageCount)) return unchanged
    if ('percent' in value && (value.percent < 0 || value.percent > 100)) return unchanged
    if (!cur && ctx.startedOn && day < ctx.startedOn) return unchanged
  }
  const unit: ProgressMode = remove ? (cur!.end && 'page' in cur!.end ? 'page' : 'percent') : 'page' in value ? 'page' : 'percent'
  const startValue = startOf(place)
  const start = valueIn(startValue, unit, pageCount) ?? 0
  const range = rangeOf(place, ctx, unit)
  const { leads, p } = range
  let x: number
  if (remove) x = start
  else {
    x = 'page' in value ? value.page : value.percent
    x = greatest(least(x, range.hi), range.lo)
    if (cur && range.curEnd === x) return unchanged
  }

  const rows = new Map(place.rows.map((d) => [d.day, d]))
  let end: ProgressValue | null
  if (x === start) {
    // R6: the day ends where it starts, so it has no row.
    if (!cur) return unchanged
    rows.delete(day)
    end = startValue
  } else {
    end = unit === 'page' ? { page: x } : { percent: x }
    // On a bound it equals: that bound's stored value (the next day's end, or the read's value).
    if (next && x === valueIn(next.end, unit, pageCount)) end = next.end
    else if (!next && !leads && p !== null && x === p && current) end = current
    rows.set(day, { day, start: cur ? cur.start : startValue, end })
  }

  // R4: the next day starts where this one ends now; a next day that then reads nothing goes.
  if (next) {
    if (valueIn(end, unit, pageCount) === valueIn(next.end, unit, pageCount)) rows.delete(next.day)
    else if (!samePair(next.start, end)) rows.set(next.day, { ...next, start: end })
  }
  const result = [...rows.values()].sort((a, b) => a.day.localeCompare(b.day))

  // R5: the read's value follows a latest day the days lead.
  const latest = !result.some((d) => d.day > day)
  if (!leads || !latest) return { days: result, current, currentChanged: false }
  const written = pairOf(end)
  if (written.page === null && written.percent === null) {
    return { days: result, current: null, currentChanged: current !== null }
  }
  const page = written.page !== null && pageCount !== null ? Math.min(written.page, Math.max(pageCount, 0)) : written.page
  const after: ProgressValue = page !== null ? { page } : { percent: written.percent! }
  if (current && valueIn(current, unit, pageCount) === valueIn(after, unit, pageCount)) {
    return { days: result, current, currentChanged: false }
  }
  return { days: result, current: after, currentChanged: true }
}

/** The days after she set `day` to where she ended it (R3, R4): the offline overlay's, and the effect line's. */
export function withDaySet(days: readonly ProgressDay[], day: string, value: ProgressValue, ctx: DayContext): ProgressDay[] {
  return dayEdit(days, day, value, ctx).days
}

/**
 * The days after `day` is removed: the next day absorbs it (R6). Needs no page count, as the database's remove: the
 * value moves only with `dayEdit`, which has the read's value.
 */
export function withDayRemoved(days: readonly ProgressDay[], day: string, ctx: Partial<DayContext> = {}): ProgressDay[] {
  return dayEdit(days, day, null, { current: null, pageCount: null, ...ctx }).days
}

/** What saving an earlier day does beyond the day itself, for the sheet's effect line. */
export type DayEffect = {
  /**
   * `add`: a new day, and the day after it reads differently (`next`); `edit`: an existing day moves (or is removed),
   * the day after it reads differently (`next`); `now`: the read's own value changes (`value`, in the unit of the
   * value given); `none`: only this day changes.
   */
  kind: 'add' | 'edit' | 'now' | 'none'
  day: string
  /** The day after: what it read (`was`) and reads now (`now`, 0 when it goes), in the read's unit (`amountOf`). */
  next?: { day: string; was: number; now: number }
  /** The read's value after, in the unit of the value given (0: none). */
  value?: number
}

/**
 * What saving `value` on `day` (null: removing it) does: the read's value moves (`now`) when the days lead it and
 * the day is, or becomes, the latest; else the day after it re-chains (`add` / `edit` with its amounts before and
 * after); else nothing but the day itself (`none`).
 */
export function effectOf(days: readonly ProgressDay[], day: string, value: ProgressValue | null, ctx: DayContext): DayEffect {
  const edit = dayEdit(days, day, value, ctx)
  const existed = days.some((d) => d.day === day)
  if (edit.currentChanged) {
    const unit: ProgressMode = value ? ('page' in value ? 'page' : 'percent') : unitOf(ctx.pageCount)
    return { kind: 'now', day, value: valueIn(edit.current, unit, ctx.pageCount) ?? 0 }
  }
  const next = [...days].sort((a, b) => a.day.localeCompare(b.day)).find((d) => d.day > day)
  if (next) {
    const was = amountOf(next, ctx.pageCount)
    const after = edit.days.find((d) => d.day === next.day)
    const now = after ? amountOf(after, ctx.pageCount) : 0
    if (was !== now) return { kind: existed ? 'edit' : 'add', day, next: { day: next.day, was, now } }
  }
  return { kind: 'none', day }
}

/** The day "Add day" opens on: the newest day before today, not before the read began, that has no row; null with none left. */
export function newestEmptyDay(days: readonly ProgressDay[], startedOn: string, today: string): string | null {
  const taken = new Set(days.map((d) => d.day))
  for (let ago = 1, day = dayBefore(today, 1); day >= startedOn; ago += 1, day = dayBefore(today, ago)) {
    if (!taken.has(day)) return day
  }
  return null
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
