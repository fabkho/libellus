import { afterAll, describe, expect, it } from 'vitest'
import type { StatsRead, StatsYear } from '@/data/stats'
import { readsInWeek } from '@/data/stats'
import {
  WEEKS_SHOWN,
  canStep,
  chartBounds,
  clampRange,
  columnsOf,
  defaultRange,
  litColumn,
  newestWeekStartOf,
  scopeBounds,
  stepRange,
  stepYear,
  switchMode,
  windowFigures,
  withMode,
  yearColumnsOf,
  type ChartRange,
  type ChartScope,
} from '@/data/statsChart'
import { addDays, daysBetween, mondayOf, weekNumberOf } from '@/utils/dates'
import { statsSheetReads, statsSheetWithYear } from '@/utils/statsSheet'

/**
 * The Profile's chart by month or by week (WP-08, data/statsChart.ts): ISO weeks (Monday first) bucketed by the day
 * a read ended, the windows and their ends, and the figures of a window. Days are calendar days (`YYYY-MM-DD`),
 * so the buckets must not move with the device's time zone or daylight saving: the same assertions run in several
 * zones, one with a midnight that does not exist (Havana's daylight saving starts at 00:00). Nothing here needs the stack.
 */
function read(id: string, ended: string | null, over: Partial<StatsRead> = {}): StatsRead {
  return {
    sessionId: id,
    entryId: id,
    book: { id, title: id, authors: [], pageCount: 300, coverUrl: null, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as StatsRead['book'],
    startedOn: null,
    endedOn: ended,
    outcome: 'finished',
    rating: null,
    pages: 300,
    days: null,
    nth: 1,
    ...over,
  }
}
const ids = (reads: readonly StatsRead[]) => reads.map((r) => r.sessionId)

const ZONES = [
  { zone: 'Europe/Berlin', july: -120 },
  { zone: 'America/Los_Angeles', july: 420 },
  { zone: 'Pacific/Auckland', july: -720 },
  { zone: 'Asia/Kolkata', july: -330 },
  { zone: 'America/Havana', july: 240 },
]
const zoneBefore = process.env.TZ
afterAll(() => {
  if (zoneBefore === undefined) delete process.env.TZ
  else process.env.TZ = zoneBefore
})
/** Runs `body` in each of the zones (the process's own is put back after the file). */
function inEveryZone(body: (zone: string) => void) {
  for (const { zone, july } of ZONES) {
    process.env.TZ = zone
    expect(new Date(2026, 6, 1).getTimezoneOffset(), `${zone} is in effect`).toBe(july)
    body(zone)
  }
}

describe('ISO weeks', () => {
  it('finds the Monday a week starts on, Sunday last', () => {
    expect(mondayOf('2026-06-15')).toBe('2026-06-15') // a Monday
    expect(mondayOf('2026-06-17')).toBe('2026-06-15') // a Wednesday
    expect(mondayOf('2026-06-21')).toBe('2026-06-15') // a Sunday belongs to the week before it
    expect(mondayOf('2026-06-22')).toBe('2026-06-22')
  })

  it('numbers a week across New Year by its Thursday', () => {
    // 1 Jan 2026 is a Thursday: week 1 starts Monday 29 Dec 2025.
    expect(mondayOf('2026-01-01')).toBe('2025-12-29')
    expect(weekNumberOf('2025-12-28')).toBe(52)
    expect(weekNumberOf('2025-12-29')).toBe(1)
    expect(weekNumberOf('2026-01-01')).toBe(1)
    expect(weekNumberOf('2026-01-04')).toBe(1)
    expect(weekNumberOf('2026-01-05')).toBe(2)
    // 31 Dec 2024 is a Tuesday: already week 1 of 2025.
    expect(weekNumberOf('2024-12-31')).toBe(1)
  })

  it('has a week 53 in the years that have one', () => {
    // 2020 and 2026 have 53 weeks; their last days (and the first days of the next January) belong to it.
    expect(weekNumberOf('2020-12-31')).toBe(53)
    expect(weekNumberOf('2021-01-03')).toBe(53)
    expect(weekNumberOf('2021-01-04')).toBe(1)
    expect(weekNumberOf('2026-12-31')).toBe(53)
    expect(weekNumberOf('2027-01-01')).toBe(53)
    expect(weekNumberOf('2027-01-03')).toBe(53)
    expect(weekNumberOf('2027-01-04')).toBe(1)
    // …and not in the ones that do not.
    expect(weekNumberOf('2025-12-28')).toBe(52)
  })

  it('agrees with the ISO 8601 rule on every day of 2019–2031', () => {
    // The rule, written the other way round: week 1 is the week with 4 January in it.
    for (let day = '2019-01-01'; day < '2031-01-01'; day = addDays(day, 1)) {
      const monday = mondayOf(day)
      const thursdayYear = Number(addDays(monday, 3).slice(0, 4))
      const week1Monday = mondayOf(`${thursdayYear}-01-04`)
      expect(weekNumberOf(day), day).toBe(daysBetween(week1Monday, monday) / 7 + 1)
    }
  })

  it('is the same in every time zone, daylight saving and a missing midnight included', () => {
    inEveryZone(() => {
      // Spring forward and fall back in Europe, the start of Havana's summer time (no 00:00 on 8 Mar 2026).
      expect(mondayOf('2026-03-29')).toBe('2026-03-23')
      expect(mondayOf('2026-03-30')).toBe('2026-03-30')
      expect(mondayOf('2026-10-25')).toBe('2026-10-19')
      expect(mondayOf('2026-03-08')).toBe('2026-03-02')
      expect(mondayOf('2026-03-09')).toBe('2026-03-09')
      expect(weekNumberOf('2026-03-29')).toBe(13)
      expect(weekNumberOf('2026-10-25')).toBe(43)
      expect(weekNumberOf('2026-01-01')).toBe(1)
      expect(weekNumberOf('2026-12-31')).toBe(53)
    })
  })
})

describe('the weeks window', () => {
  const today = '2026-06-17' // a Wednesday
  const range: ChartRange = { ...defaultRange(today), mode: 'weeks' }

  it('ends with the week today sits in, 13 weeks from a Monday', () => {
    expect(newestWeekStartOf(today)).toBe('2026-03-23')
    expect(range.weekStart).toBe('2026-03-23')
    const cols = columnsOf([], range, 2026)
    expect(cols).toHaveLength(WEEKS_SHOWN)
    expect(cols[0]!.start).toBe('2026-03-23')
    expect(cols.at(-1)!.start).toBe('2026-06-15')
    expect(cols.at(-1)!.end).toBe('2026-06-21')
    expect(cols.map((c) => c.number)).toEqual([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])
    expect(litColumn(cols, today)).toBe(13)
  })

  it('has the same newest window from a Monday to the Sunday after, and moves on the next Monday', () => {
    expect(newestWeekStartOf('2026-06-15')).toBe('2026-03-23')
    expect(newestWeekStartOf('2026-06-21')).toBe('2026-03-23')
    expect(newestWeekStartOf('2026-06-22')).toBe('2026-03-30')
  })

  it('runs through New Year: the last week of a year and week 1 sit side by side', () => {
    const cols = columnsOf([], { ...range, weekStart: '2025-11-17' }, 2026)
    expect(cols.map((c) => c.number)).toEqual([47, 48, 49, 50, 51, 52, 1, 2, 3, 4, 5, 6, 7])
    expect(cols[6]!.start).toBe('2025-12-29')
    expect(cols[6]!.end).toBe('2026-01-04')
  })

  it('runs through an ISO week 53', () => {
    const cols = columnsOf([], { ...range, weekStart: '2020-10-05' }, 2026)
    expect(cols.map((c) => c.number)).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53])
    expect(cols.at(-1)!.end).toBe('2021-01-03')
    const next = columnsOf([], { ...range, weekStart: '2021-01-04' }, 2026)
    expect(next[0]!.number).toBe(1)
  })

  it('puts a read in the week its end date falls in, Sunday and Monday on either side', () => {
    const reads = [
      read('sun', '2026-03-29'), // Sunday: the first week
      read('mon', '2026-03-30'), // Monday: the second
      read('first', '2026-03-23'),
      read('last', '2026-06-21'),
      read('before', '2026-03-22'),
      read('after', '2026-06-22'),
    ]
    const cols = columnsOf(reads, range, 2026)
    expect(cols.map((c) => c.count)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(ids(cols[0]!.reads)).toEqual(['sun', 'first'])
    expect(ids(readsInWeek(reads, '2026-03-23'))).toEqual(['sun', 'first'])
  })

  it('counts a week across New Year as one week', () => {
    const reads = [read('before', '2025-12-30'), read('on', '2026-01-01'), read('after', '2026-01-04'), read('next', '2026-01-05')]
    const week = readsInWeek(reads, '2025-12-29')
    expect(ids(week)).toEqual(['before', 'on', 'after'])
    const cols = columnsOf(reads, { ...range, weekStart: '2025-11-17' }, 2026)
    expect(cols[6]!.count).toBe(3)
    expect(cols[7]!.count).toBe(1)
  })

  it('leaves out a read without an end date, an abandoned one and a read still going', () => {
    const reads = [read('no date', null), read('dnf', '2026-04-01', { outcome: 'abandoned' }), read('open', '2026-04-01', { outcome: null }), read('ok', '2026-04-01')]
    expect(ids(readsInWeek(reads, '2026-03-30'))).toEqual(['ok'])
    expect(columnsOf(reads, range, 2026).reduce((sum, c) => sum + c.count, 0)).toBe(1)
    expect(columnsOf(reads, { ...range, mode: 'months' }, 2026).reduce((sum, c) => sum + c.count, 0)).toBe(1)
  })

  it('buckets the same in every time zone, across daylight-saving changes', () => {
    const reads = [read('a', '2026-03-28'), read('b', '2026-03-29'), read('c', '2026-03-30'), read('d', '2026-10-25'), read('e', '2026-10-26')]
    inEveryZone(() => {
      // Berlin springs forward on Sunday 29 Mar 2026, so the 13 weeks from 23 Mar hold a 7-day week of 167 hours.
      const spring = columnsOf(reads, { ...range, weekStart: '2026-03-16' }, 2026)
      expect(spring.map((c) => c.start)).toEqual(Array.from({ length: 13 }, (_, w) => addDays('2026-03-16', 7 * w)))
      expect(spring.every((c) => daysBetween(c.start, c.end) === 6)).toBe(true)
      expect(ids(spring[1]!.reads)).toEqual(['a', 'b'])
      expect(ids(spring[2]!.reads)).toEqual(['c'])
      // …and falls back on Sunday 25 Oct (a 169-hour week).
      const autumn = columnsOf(reads, { ...range, weekStart: '2026-10-05' }, 2026)
      expect(autumn.map((c) => c.number)).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53])
      expect(ids(autumn[2]!.reads)).toEqual(['d'])
      expect(ids(autumn[3]!.reads)).toEqual(['e'])
      // The newest window from a day in each zone's own summer.
      expect(newestWeekStartOf('2026-07-01')).toBe('2026-04-06')
    })
  })
})

describe('the months window', () => {
  it('is twelve months of a calendar year, by the day each read ended', () => {
    const reads = [read('jan', '2026-01-01'), read('jan end', '2026-01-31'), read('feb', '2026-02-28'), read('dec', '2026-12-31'), read('prev', '2025-12-31'), read('next', '2027-01-01')]
    const cols = columnsOf(reads, { mode: 'months', weekStart: '2026-03-23' }, 2026)
    expect(cols.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(cols.map((c) => c.count)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(cols[1]!.end).toBe('2026-02-28')
    expect(columnsOf([], { mode: 'months', weekStart: '2026-03-23' }, 2024)[1]!.end).toBe('2024-02-29')
    expect(cols[11]!.end).toBe('2026-12-31')
  })

  it('lights the month today is in', () => {
    const cols = columnsOf([], { mode: 'months', weekStart: '2026-03-23' }, 2026)
    expect(litColumn(cols, '2026-06-17')).toBe(6)
    expect(litColumn(cols, '2027-01-02')).toBeNull()
  })

  it('gives the same months in every time zone', () => {
    const reads = [read('a', '2026-03-29'), read('b', '2026-03-08'), read('c', '2026-10-25')]
    inEveryZone(() => {
      const cols = columnsOf(reads, { mode: 'months', weekStart: '2026-03-23' }, 2026)
      expect(cols.map((c) => c.count)).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 0, 0])
    })
  })
})

describe('where the windows end', () => {
  const today = '2026-06-17'
  const all: ChartScope = { year: 'all', years: [2026, 2025, 2024] }
  const in2026: ChartScope = { year: 2026, years: [2026, 2025, 2024] }
  const in2025: ChartScope = { year: 2025, years: [2026, 2025, 2024] }
  const in2024: ChartScope = { year: 2024, years: [2026, 2025, 2024] }

  it('takes the left end from her first finished read, not from a nominal date', () => {
    const reads = [read('later', '2025-02-10'), read('first', '2024-09-03'), read('dnf', '2023-01-01', { outcome: 'abandoned' }), read('undated', null)]
    const bounds = chartBounds(reads, today)
    expect(bounds.newestWeekStart).toBe('2026-03-23')
    // The earliest window is the one that still holds the Monday of her first finish (2 Sep 2024)…
    expect(bounds.earliestWeekStart <= '2024-09-02').toBe(true)
    expect(addDays(bounds.earliestWeekStart, 7 * WEEKS_SHOWN) > '2024-09-02').toBe(true)
    // …and is a whole number of windows before the newest.
    expect(daysBetween(bounds.earliestWeekStart, bounds.newestWeekStart) % (7 * WEEKS_SHOWN)).toBe(0)
    expect(bounds.earliestWeekStart).toBe('2024-06-24')
  })

  it('keeps a first finish on a window\'s own first Monday in that window', () => {
    const bounds = chartBounds([read('first', '2025-03-24')], today) // Monday, exactly 52 weeks (4 windows) before 23 Mar 2026
    expect(bounds.earliestWeekStart).toBe('2025-03-24')
    const dayBefore = chartBounds([read('first', '2025-03-23')], today) // Sunday: the week before
    expect(dayBefore.earliestWeekStart).toBe('2024-12-23')
  })

  it('has one window when she finished her first read in the newest', () => {
    const bounds = chartBounds([read('first', '2026-05-01')], today)
    expect(bounds.earliestWeekStart).toBe(bounds.newestWeekStart)
    const range = defaultRange(today)
    const scope: ChartScope = { year: 2026, years: [2026] }
    expect(canStep(range, bounds, scope, -1)).toBe(false)
    expect(canStep({ ...range, mode: 'weeks' }, bounds, scope, -1)).toBe(false)
  })

  it('stands on today\'s windows with nothing finished', () => {
    const bounds = chartBounds([read('dnf', '2020-01-01', { outcome: 'abandoned' })], today)
    expect(bounds).toEqual({ earliestWeekStart: '2026-03-23', newestWeekStart: '2026-03-23' })
    expect(chartBounds([], today)).toEqual(bounds)
  })

  it('does not look past today', () => {
    // A read dated after today (a clock that was ahead) is no start for the windows.
    const bounds = chartBounds([read('future', '2027-02-01')], today)
    expect(bounds.earliestWeekStart).toBe(bounds.newestWeekStart)
  })

  it('computes its ends in every time zone alike', () => {
    const reads = [read('first', '2024-09-03')]
    inEveryZone(() => {
      expect(chartBounds(reads, today)).toEqual({ earliestWeekStart: '2024-06-24', newestWeekStart: '2026-03-23' })
    })
  })

  describe('under the year pills', () => {
    const bounds = chartBounds([read('first', '2024-09-03')], today)

    it('lists no window under All: the overview is Months, ‹ goes to the newest year and › has nothing after it', () => {
      const range = defaultRange(today)
      expect(canStep(range, bounds, all, -1)).toBe(true)
      expect(canStep(range, bounds, all, 1)).toBe(false)
      // A Weeks mode kept from before is not a window under All: the overview steps as Months does.
      expect(canStep({ ...range, mode: 'weeks' }, bounds, all, -1)).toBe(true)
      expect(canStep({ ...range, mode: 'weeks' }, bounds, all, 1)).toBe(false)
      expect(stepRange(range, bounds, all, -1)).toEqual({ range, year: 2026 })
      expect(stepRange(range, bounds, all, 1)).toEqual({ range, year: 'all' })
      expect(stepYear(all, -1)).toBe(2026)
      expect(stepYear(all, 1)).toBeNull()
      // A record with no finished read has no year to go to.
      expect(stepYear({ year: 'all', years: [] }, -1)).toBeNull()
      expect(clampRange({ mode: 'weeks', weekStart: '2026-03-23' }, bounds, all).mode).toBe('months')
    })

    it('walks the pills along time, the overview after the newest year, and back the same way', () => {
      let scope: ChartScope = all
      const range = defaultRange(today)
      const seen: StatsYear[] = [scope.year]
      while (canStep(range, bounds, scope, -1)) {
        scope = { ...scope, year: stepRange(range, bounds, scope, -1).year }
        seen.push(scope.year)
      }
      expect(seen).toEqual(['all', 2026, 2025, 2024]) // ‹ from All to the newest year, then older, stopping at the first year with reads
      expect(canStep(range, bounds, scope, -1)).toBe(false)
      const back: StatsYear[] = [scope.year]
      while (canStep(range, bounds, scope, 1)) {
        scope = { ...scope, year: stepRange(range, bounds, scope, 1).year }
        back.push(scope.year)
      }
      expect(back).toEqual([2024, 2025, 2026, 'all']) // › up to All, where it stops
      expect(canStep(range, bounds, scope, 1)).toBe(false)
      expect(canStep(range, bounds, scope, -1)).toBe(true)
    })

    it('opens the weeks of the newest year, and moves the pill there, when Weeks is picked under All', () => {
      const switched = switchMode(defaultRange(today), 'weeks', bounds, all)
      expect(switched.year).toBe(2026)
      expect(switched.range).toEqual({ mode: 'weeks', weekStart: '2026-03-23' }) // the newest window, as under the 2026 pill
      expect(switched.range).toEqual(withMode(defaultRange(today), 'weeks', bounds, in2026))
      // The newest year is the one with a read, not today's: 2025 here, its newest window the one holding 31 Dec.
      const older = switchMode(defaultRange(today), 'weeks', bounds, { year: 'all', years: [2025, 2024] })
      expect(older.year).toBe(2025)
      expect(older.range.weekStart).toBe('2025-12-22')
      // Nothing to open without a year; the pill stays.
      const none = defaultRange(today)
      expect(switchMode(none, 'weeks', bounds, { year: 'all', years: [] })).toEqual({ range: none, year: 'all' })
      // Under a year the pill stays, in both directions.
      expect(switchMode(defaultRange(today), 'weeks', bounds, in2025).year).toBe(2025)
      expect(switchMode(withMode(defaultRange(today), 'weeks', bounds, in2025), 'months', bounds, in2025).year).toBe(2025)
    })

    it('goes on stepping from the weeks of the newest year inside it, and back to Months, ‹ › then walk the pills again', () => {
      const opened = switchMode(defaultRange(today), 'weeks', bounds, all)
      const scope: ChartScope = { year: opened.year, years: all.years }
      expect(canStep(opened.range, bounds, scope, 1)).toBe(false) // the newest window of the newest year: nothing newer, the pills move the year
      expect(stepRange(opened.range, bounds, scope, -1).year).toBe(2026) // the pill stays through the weeks
      const months = switchMode(opened.range, 'months', bounds, scope)
      expect(months.year).toBe(2026)
      expect(stepRange(months.range, bounds, scope, 1).year).toBe('all')
    })

    it('steps the months to the neighbouring year the pills list, stopping at both ends', () => {
      const range = defaultRange(today)
      expect(canStep(range, bounds, in2026, 1)).toBe(true) // the overview sits after the newest year
      expect(stepRange(range, bounds, in2026, 1)).toEqual({ range, year: 'all' })
      expect(stepRange(range, bounds, in2026, -1)).toEqual({ range, year: 2025 })
      expect(stepRange(range, bounds, in2025, -1).year).toBe(2024)
      expect(stepRange(range, bounds, in2025, 1).year).toBe(2026)
      expect(canStep(range, bounds, in2024, -1)).toBe(false)
      expect(stepRange(range, bounds, in2024, -1).year).toBe(2024)
    })

    it('skips a year without a finished read, as the pills do', () => {
      expect(stepYear({ year: 2026, years: [2026, 2023] }, -1)).toBe(2023)
      expect(stepYear({ year: 2023, years: [2026, 2023] }, 1)).toBe(2026)
      // A pill that is not listed (the record changed under it) has nothing to step from.
      expect(stepYear({ year: 2019, years: [2026, 2023] }, 1)).toBeNull()
      expect(stepYear({ year: 2026, years: [2026, 2023] }, 1)).toBe('all')
    })

    it('holds the weeks to the windows touching the selected year', () => {
      // 2026: from the window holding 29 Dec 2025 (the Monday of 1 Jan's week) to the newest.
      expect(scopeBounds(bounds, in2026)).toEqual({ earliestWeekStart: '2025-12-22', newestWeekStart: '2026-03-23' })
      // 2025: from the window holding 1 Jan 2025's week (Monday 30 Dec 2024) to the one holding 31 Dec 2025's (the same one as 2026's first).
      const y2025 = scopeBounds(bounds, in2025)
      expect(y2025.newestWeekStart).toBe('2025-12-22')
      expect(y2025.earliestWeekStart).toBe('2024-12-23')
      // 2024: her first finish's window to the one holding the last week of the year.
      expect(scopeBounds(bounds, in2024)).toEqual({ earliestWeekStart: '2024-06-24', newestWeekStart: '2024-12-23' })
      expect(scopeBounds(bounds, all)).toEqual(bounds)
    })

    it('steps a whole window in Weeks and stops where the year does not reach', () => {
      let range = withMode(defaultRange(today), 'weeks', bounds, in2025)
      expect(range.weekStart).toBe('2025-12-22') // opens on the newest window touching the year: it runs on into March 2026
      expect(canStep(range, bounds, in2025, 1)).toBe(false)
      expect(canStep(range, bounds, in2025, -1)).toBe(true)
      const stepped = stepRange(range, bounds, in2025, -1)
      expect(stepped.year).toBe(2025) // the pill stays
      expect(daysBetween(stepped.range.weekStart, range.weekStart)).toBe(7 * WEEKS_SHOWN)
      range = stepped.range
      expect(range.weekStart).toBe('2025-09-22')
      range = stepRange(range, bounds, in2025, -1).range
      range = stepRange(range, bounds, in2025, -1).range
      expect(range.weekStart).toBe('2025-03-24')
      range = stepRange(range, bounds, in2025, -1).range
      expect(range.weekStart).toBe('2024-12-23') // the one holding 1 Jan 2025's week
      expect(canStep(range, bounds, in2025, -1)).toBe(false)
      expect(stepRange(range, bounds, in2025, -1).range).toBe(range)
    })

    it('shows the window across the year end under both years, and never steps to a year the pill is not on', () => {
      const crossing = { mode: 'weeks', weekStart: '2025-12-22' } as const
      // 22 Dec 2025 – 22 Mar 2026: in 2025's last window and 2026's first.
      expect(clampRange(crossing, bounds, in2026)).toBe(crossing)
      expect(clampRange(crossing, bounds, in2025)).toBe(crossing)
      expect(canStep(crossing, bounds, in2026, -1)).toBe(false)
      expect(canStep(crossing, bounds, in2026, 1)).toBe(true)
    })

    it('holds a kept window to the year when another pill is picked: the nearest window that touches it', () => {
      const kept: ChartRange = { mode: 'weeks', weekStart: '2026-03-23' }
      expect(clampRange(kept, bounds, in2025).weekStart).toBe('2025-12-22')
      expect(clampRange(kept, bounds, in2024).weekStart).toBe('2024-12-23')
      expect(clampRange({ mode: 'weeks', weekStart: '2024-06-24' }, bounds, in2025).weekStart).toBe('2024-12-23')
      expect(clampRange(kept, bounds, in2026)).toBe(kept)
    })

    it('holds a kept range to the ends of the record it is shown with', () => {
      const own = chartBounds([read('first', '2025-03-24')], today)
      const scope: ChartScope = { year: 2026, years: [2026, 2025] }
      expect(clampRange({ mode: 'months', weekStart: '2019-01-07' }, own, scope)).toEqual({ mode: 'months', weekStart: '2025-12-22' })
      expect(clampRange({ mode: 'weeks', weekStart: '2031-01-06' }, own, scope)).toEqual({ mode: 'weeks', weekStart: '2026-03-23' })
      // A week start off a Monday goes to its Monday.
      expect(clampRange({ mode: 'weeks', weekStart: '2025-12-24' }, own, scope).weekStart).toBe('2025-12-22')
    })

    it('switches the mode: the weeks open on the newest window of the year, Months leave the weeks as they were', () => {
      let range = withMode(defaultRange(today), 'weeks', bounds, in2025)
      expect(range).toEqual({ mode: 'weeks', weekStart: '2025-12-22' })
      range = stepRange(range, bounds, in2025, -1).range
      const months = withMode(range, 'months', bounds, in2025)
      expect(months).toEqual({ mode: 'months', weekStart: range.weekStart })
      expect(withMode(months, 'weeks', bounds, in2025).weekStart).toBe('2025-12-22')
      expect(withMode(range, 'weeks', bounds, in2025)).toBe(range)
    })

    it('moves the same through the pills and the capsule: a step and a pill land on the same year', () => {
      // The capsule steps 2026 → 2025 (emitting the pill's year); the pill then is 2025, and stepping from there reads the same list.
      const first = stepRange(defaultRange(today), bounds, in2026, -1)
      expect(first.year).toBe(2025)
      const second = stepRange(first.range, bounds, { year: first.year, years: in2026.years }, 1)
      expect(second.year).toBe(2026)
    })
  })
})

describe('the years under All', () => {
  it('is a column per year with a finished read, the oldest first, over the whole year', () => {
    const reads = [read('a', '2026-01-02'), read('b', '2024-12-31'), read('c', '2024-06-01'), read('dnf', '2025-03-03', { outcome: 'abandoned' }), read('undated', null)]
    const cols = yearColumnsOf(reads)
    expect(cols.map((c) => [c.key, c.count])).toEqual([
      [2024, 2],
      [2026, 1],
    ])
    expect(cols[0]).toMatchObject({ start: '2024-01-01', end: '2024-12-31', number: 2024 })
    expect(litColumn(cols, '2026-06-17')).toBe(2026)
    expect(litColumn(cols, '2025-06-17')).toBeNull()
    expect(yearColumnsOf([])).toEqual([])
  })
})

describe('the figures of a window', () => {
  it('counts books, pages (a read without a count adds none) and the mean rating', () => {
    const reads = [
      read('a', '2026-04-01', { pages: 100, rating: 16 }),
      read('b', '2026-04-02', { pages: null, rating: 20 }),
      read('c', '2026-05-02', { pages: 250, rating: null }),
      read('outside', '2025-04-01', { pages: 999, rating: 4 }),
    ]
    const cols = columnsOf(reads, { mode: 'months', weekStart: '2026-03-23' }, 2026)
    expect(windowFigures(cols)).toEqual({ books: 3, pages: 350, average: 18 })
    expect(windowFigures(columnsOf([], { mode: 'months', weekStart: '2026-03-23' }, 2026))).toEqual({ books: 0, pages: 0, average: null })
  })

  it('follows the window: the weeks hold only their own books', () => {
    const reads = [read('in', '2026-04-01', { pages: 100 }), read('out', '2026-01-10', { pages: 400 })]
    const weeks = columnsOf(reads, { mode: 'weeks', weekStart: '2026-03-23' }, 2026)
    expect(windowFigures(weeks)).toMatchObject({ books: 1, pages: 100 })
  })
})

describe('a week\'s sheet', () => {
  const reads = [read('Sun', '2026-03-29'), read('Mon', '2026-03-30'), read('Wed', '2026-04-01'), read('Next', '2026-04-06')]

  it('lists the week\'s reads, its Monday naming it', () => {
    expect(ids(statsSheetReads({ kind: 'week', start: '2026-03-30' }, reads))).toEqual(['Mon', 'Wed'])
    expect(ids(statsSheetReads({ kind: 'week', start: '2026-03-23' }, reads))).toEqual(['Sun'])
    expect(statsSheetReads({ kind: 'week', start: '2025-01-06' }, reads)).toEqual([])
  })

  it('names the year on its rows (a window may cross a year end), a month\'s sheet does not', () => {
    expect(statsSheetWithYear({ kind: 'week', start: '2026-03-30' })).toBe(true)
    expect(statsSheetWithYear({ kind: 'month', year: 2026, month: 3 })).toBe(false)
  })
})
