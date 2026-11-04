import { describe, expect, it } from 'vitest'
import { addDayOf, dayFromPicker, dayPillsOf, dayRangeOf, LOG_ROWS, logRowOf, logRowsOf, offersDays } from '@/data/progressDayView'
import { dayBoundsOf, readingLogOf, type ProgressDay } from '@/data/progressDays'
import { addDays } from '@/utils/dates'

/**
 * What the Update progress sheet shows on an earlier day (docs/plans/backdated-progress.md §3, PR 3), as the client
 * works it out without a screen: which day pill is lit, what the date input may hand back, and the range line's two
 * ends, over the chain of the plan's mock (today = Tue 3 Nov, 480 pages). The sheet itself is
 * e2e/progress-earlier-day.spec.ts; the repo has no component tests, so the logic lives in `data/progressDayView.ts`
 * and is tested here.
 */

const today = '2026-11-03'
const ago = (n: number) => addDays(today, -n)
const page = (n: number) => ({ page: n })
const row = (n: number, start: number | null, end: number): ProgressDay => ({ day: ago(n), start: start === null ? null : page(start), end: page(end) })

// days ago → start→end: 6: 0→40 · 4: 40→90 · 1: 90→140; P = 140
const chain = [row(6, null, 40), row(4, 40, 90), row(1, 90, 140)]

describe('the day pills', () => {
  it('light Today for no day, and for a day that is not before today', () => {
    expect(dayPillsOf(null, today)).toEqual({ lit: 'today', yesterday: ago(1), picked: null })
    expect(dayPillsOf(today, today).lit).toBe('today')
  })

  it('light Yesterday for yesterday, even when it was picked on the date input', () => {
    expect(dayPillsOf(ago(1), today)).toEqual({ lit: 'yesterday', yesterday: ago(1), picked: null })
  })

  it('light the third pill with any other earlier day, and it carries that day', () => {
    expect(dayPillsOf(ago(5), today)).toEqual({ lit: 'pick', yesterday: ago(1), picked: ago(5) })
  })

  it('know yesterday across a month and a year', () => {
    expect(dayPillsOf(null, '2027-01-01').yesterday).toBe('2026-12-31')
    expect(dayPillsOf(null, '2026-03-01').yesterday).toBe('2026-02-28')
  })
})

describe('whether the sheet offers a day', () => {
  it('does for a read begun before today', () => {
    expect(offersDays(ago(1), today)).toBe(true)
    expect(offersDays(ago(40), today)).toBe(true)
  })

  it('does not for a read begun today (or later): a new day before it began is refused', () => {
    expect(offersDays(today, today)).toBe(false)
    expect(offersDays(addDays(today, 1), today)).toBe(false)
  })

  it('does for a read with no known start', () => {
    expect(offersDays(null, today)).toBe(true)
    expect(offersDays(undefined, today)).toBe(true)
  })
})

describe('the date input', () => {
  it('hands back a day inside the read as that day', () => {
    expect(dayFromPicker(ago(5), today, ago(20))).toBe(ago(5))
    expect(dayFromPicker(ago(20), today, ago(20))).toBe(ago(20))
  })

  it('hands back today (or later) as Today', () => {
    expect(dayFromPicker(today, today, ago(20))).toBeNull()
    expect(dayFromPicker(addDays(today, 3), today, ago(20))).toBeNull()
  })

  it('hands back nothing for a day before the read began, a cleared input or a half-typed one', () => {
    expect(dayFromPicker(ago(21), today, ago(20))).toBeUndefined()
    expect(dayFromPicker('', today, ago(20))).toBeUndefined()
    expect(dayFromPicker('2026-11', today, ago(20))).toBeUndefined()
  })

  it('has no lower limit without a start', () => {
    expect(dayFromPicker('2020-01-01', today, undefined)).toBe('2020-01-01')
  })
})

describe('the range line', () => {
  const range = (day: string) => dayRangeOf(chain, day, dayBoundsOf(chain, day, page(140), 480, 'page'), 480)

  it('runs from the day before to the day after, in the wheel\'s numbers', () => {
    expect(range(ago(2))).toEqual({ from: { day: ago(4), value: 90 }, to: { kind: 'day', day: ago(1), value: 140 } })
    expect(range(ago(5))).toEqual({ from: { day: ago(6), value: 40 }, to: { kind: 'day', day: ago(4), value: 90 } })
  })

  it('does the same for a day that has an entry', () => {
    expect(range(ago(4))).toEqual({ from: { day: ago(6), value: 40 }, to: { kind: 'day', day: ago(1), value: 140 } })
  })

  it('starts at the read\'s start before its first day', () => {
    expect(range(ago(8))).toEqual({ from: { day: null, value: 0 }, to: { kind: 'day', day: ago(6), value: 40 } })
  })

  it('is open upward for the latest day while the days lead her progress', () => {
    expect(range(ago(1))).toEqual({ from: { day: ago(4), value: 90 }, to: { kind: 'open' } })
  })

  it('ends at her progress (now) for a day after the last one when her progress is ahead of the days', () => {
    // The read stands at 150, the days stop at 140: they do not lead it, so the latest day cannot go past 150.
    const bounds = dayBoundsOf(chain, ago(0), page(150), 480, 'page')
    expect(bounds.leads).toBe(false)
    expect(dayRangeOf(chain, ago(0), bounds, 480)).toEqual({ from: { day: ago(1), value: 140 }, to: { kind: 'now', value: 150 } })
  })

  it('never reaches above the wheel\'s own ceiling', () => {
    const bounds = dayBoundsOf(chain, ago(2), page(140), 480, 'page')
    expect(dayRangeOf(chain, ago(2), bounds, 120).to).toEqual({ kind: 'day', day: ago(1), value: 120 })
  })
})

describe('the reading log\'s rows', () => {
  it('draw a day that went back as a negative size, not "+-6": the sign is the row\'s, the size is not', () => {
    expect(logRowOf({ day: ago(2), amount: -6, end: 94 })).toEqual({ day: ago(2), amount: -6, end: 94, back: true, size: 6 })
    expect(logRowOf({ day: ago(1), amount: 18, end: 112 })).toMatchObject({ back: false, size: 18 })
  })

  it('list a day that went back (R12) and keep a day that read nothing out, newest first', () => {
    // 6 days ago 0 → 40, 4 days ago 40 → 34 (went back), 2 days ago 34 → 34 (nothing: no row), yesterday 34 → 60.
    const days = [row(6, null, 40), row(4, 40, 34), row(2, 34, 34), row(1, 34, 60)]
    const log = readingLogOf(days, 480)
    expect(log.map((d) => d.day)).toEqual([ago(1), ago(4), ago(6)])
    expect(logRowsOf(log).rows.map((r) => [r.back, r.size])).toEqual([[false, 26], [true, 6], [false, 40]])
  })

  it('show the newest fourteen and count the rest; all of them once asked for', () => {
    const log = Array.from({ length: 31 }, (_, i) => ({ day: ago(i + 1), amount: 5, end: 100 - i }))
    const view = logRowsOf(log)
    expect(view.rows).toHaveLength(LOG_ROWS)
    expect(view.rows[0]!.day).toBe(ago(1))
    expect(view.more).toBe(31 - LOG_ROWS)
    expect(logRowsOf(log, true)).toMatchObject({ more: 0 })
    expect(logRowsOf(log, true).rows).toHaveLength(31)
    expect(logRowsOf(log.slice(0, 14))).toMatchObject({ more: 0 })
  })
})

describe('Add day', () => {
  it('opens on the newest day before today without an entry, not before the read began', () => {
    // Days 6, 4 and 1 ago have an entry: 2 ago is the newest empty one.
    expect(addDayOf(chain, ago(20), today)).toBe(ago(2))
    const full = [row(3, null, 10), row(2, 10, 20), row(1, 20, 30)]
    expect(addDayOf(full, ago(5), today)).toBe(ago(4))
    expect(addDayOf([...full, row(4, 5, 10), row(5, null, 5)], ago(5), today)).toBe(ago(1))
  })

  it('falls back to yesterday when every day since the start has one (its sheet then edits it)', () => {
    expect(addDayOf([row(2, null, 10), row(1, 10, 20)], ago(2), today)).toBe(ago(1))
  })

  it('is not offered for a read that began today', () => {
    expect(addDayOf([], today, today)).toBeNull()
  })
})
