import { describe, expect, it } from 'vitest'
import {
  amountOf,
  dailyAmounts,
  dayBoundsOf,
  dayEdit,
  effectOf,
  lastTimeOf,
  newestEmptyDay,
  paceOf,
  readingLogOf,
  withDayRemoved,
  withDaySet,
  type DayContext,
  type ProgressDay,
} from '@/data/progressDays'
import { addDays } from '@/utils/dates'

/**
 * The rules of progress on an earlier day (docs/plans/backdated-progress.md, section 4, E1-E15) as the client
 * works them out, without a database: the chain of the plan's mock, today = Tue 3 Nov, 480 pages. The random
 * comparison against the database's own functions is tests/progress-day-edit.test.ts.
 */

const today = '2026-11-03'
const ago = (n: number) => addDays(today, -n)
const page = (n: number) => ({ page: n })
const pct = (n: number) => ({ percent: n })
const row = (n: number, start: number | null, end: number): ProgressDay => ({ day: ago(n), start: start === null ? null : page(start), end: page(end) })

// days ago → start→end: 11: 0→30 · 10: 30→58 · 8: 58→96 · 7: 96→120 · 5: 120→151 · 4: 151→170 · 2: 170→188 · 1: 188→212; P = 212
const chain = [row(11, null, 30), row(10, 30, 58), row(8, 58, 96), row(7, 96, 120), row(5, 120, 151), row(4, 151, 170), row(2, 170, 188), row(1, 188, 212)]
const ctx: DayContext = { current: page(212), pageCount: 480, startedOn: ago(12) }
const at = (days: readonly ProgressDay[], n: number) => days.find((d) => d.day === ago(n))

/** The chain invariant: each row starts where the one before ended. */
function chained(days: readonly ProgressDay[]) {
  for (let i = 1; i < days.length; i++) expect(days[i]!.start).toEqual(days[i - 1]!.end)
}

describe('the range of an earlier day (R3)', () => {
  it('is between the neighbours: where the day before ended and where the day after ended', () => {
    expect(dayBoundsOf(chain, ago(3), page(212), 480, 'page')).toEqual({ lo: 170, hi: 188, start: 170, end: null, leads: true })
    expect(dayBoundsOf(chain, ago(9), page(212), 480, 'page')).toMatchObject({ lo: 58, hi: 96 })
  })

  it('says where an existing day ends, and keeps that inside its range', () => {
    expect(dayBoundsOf(chain, ago(2), page(212), 480, 'page')).toEqual({ lo: 170, hi: 212, start: 170, end: 188, leads: true })
  })

  it('goes up to the page count past the latest day while the days lead the value, and to the value when they do not (E10)', () => {
    expect(dayBoundsOf(chain, ago(0), page(212), 480, 'page').hi).toBe(480)
    expect(dayBoundsOf(chain, ago(0), page(230), 480, 'page')).toMatchObject({ hi: 230, leads: false })
  })

  it('compares in the wheel\'s unit, converting through the page count (E13)', () => {
    const percent = [row(4, 120, 170)]
    // 170 of 480 is 35 %.
    expect(dayBoundsOf(percent, ago(3), page(188), 480, 'percent')).toMatchObject({ lo: 35, hi: 39 })
  })

  it('starts a day before the first one at the first one\'s start, and a read without days at none', () => {
    expect(dayBoundsOf(chain, ago(12), page(212), 480, 'page')).toMatchObject({ lo: 0, hi: 30 })
    expect(dayBoundsOf([], ago(3), null, 480, 'page')).toEqual({ lo: 0, hi: 480, start: 0, end: null, leads: true })
  })
})

describe('setting an earlier day (R3, R4, R5; E1-E14)', () => {
  it('E1: adds a day and the day after it starts where it ends', () => {
    const days = withDaySet(chain, ago(3), page(178), ctx)
    expect(at(days, 3)).toEqual(row(3, 170, 178))
    expect(at(days, 2)).toEqual(row(2, 178, 188))
    expect(dayEdit(chain, ago(3), page(178), ctx).currentChanged).toBe(false)
    chained(days)
  })

  it('E2: moves a day\'s end, and the next day begins there', () => {
    const days = withDaySet(chain, ago(2), page(175), ctx)
    expect(at(days, 2)).toEqual(row(2, 170, 175))
    expect(at(days, 1)).toEqual(row(1, 175, 212))
    chained(days)
  })

  it('E3: a day that ends where the next one ended takes it over: the next row goes', () => {
    const days = withDaySet(chain, ago(2), page(212), ctx)
    expect(at(days, 1)).toBeUndefined()
    expect(at(days, 2)).toEqual(row(2, 170, 212))
    expect(days).toHaveLength(chain.length - 1)
  })

  it('E6: the latest day moves the read\'s value while the days lead it', () => {
    const edit = dayEdit(chain, ago(1), page(220), ctx)
    expect(at(edit.days, 1)).toEqual(row(1, 188, 220))
    expect(edit.current).toEqual(page(220))
    expect(edit.currentChanged).toBe(true)
  })

  it('E7: adds a day between two, whose second one then starts at it', () => {
    const days = withDaySet(chain, ago(9), page(70), ctx)
    expect(at(days, 9)).toEqual(row(9, 58, 70))
    expect(at(days, 8)).toEqual(row(8, 70, 96))
    chained(days)
  })

  it('E8: a value below the range clamps to its start, which is no day at all', () => {
    expect(withDaySet(chain, ago(3), page(100), ctx)).toEqual(chain)
  })

  it('clamps a value above the range to the next day\'s end: the next day goes, the day ends where it did', () => {
    const days = withDaySet(chain, ago(3), page(400), ctx)
    expect(at(days, 3)).toEqual(row(3, 170, 188))
    expect(at(days, 2)).toBeUndefined()
    chained(days)
  })

  it('E10: days that do not lead the value leave it alone, and bound the latest day by it', () => {
    const lagging = { ...ctx, current: page(230) }
    const edit = dayEdit(chain, ago(0), page(300), lagging)
    expect(at(edit.days, 0)).toEqual({ day: ago(0), start: page(212), end: page(230) })
    expect(edit.currentChanged).toBe(false)
    expect(edit.current).toEqual(page(230))
  })

  it('E11: a read with no value and no days takes a first day from none, and the value follows', () => {
    const edit = dayEdit([], ago(5), page(40), { current: null, pageCount: 480 })
    expect(edit.days).toEqual([{ day: ago(5), start: null, end: page(40) }])
    expect(edit.current).toEqual(page(40))
  })

  it('E12: an import (a value, no days) takes a first day bounded by the value, which stays', () => {
    const edit = dayEdit([], ago(2), page(300), { current: page(212), pageCount: 480 })
    expect(edit.days).toEqual([{ day: ago(2), start: null, end: page(212) }])
    expect(edit.current).toEqual(page(212))
    expect(edit.currentChanged).toBe(false)
    expect(dayEdit([], ago(2), page(200), { current: page(212), pageCount: 480 }).days).toEqual([{ day: ago(2), start: null, end: page(200) }])
  })

  it('E14: the same write twice is the same, and the end it has changes nothing', () => {
    const once = withDaySet(chain, ago(3), page(178), ctx)
    expect(withDaySet(once, ago(3), page(178), ctx)).toEqual(once)
    expect(withDaySet(chain, ago(2), page(188), ctx)).toEqual(chain)
  })

  it('E9 and R8: refused writes leave the days as they are', () => {
    expect(withDaySet(chain, ago(13), page(5), ctx)).toEqual(chain)
    expect(withDaySet(chain, ago(3), page(481), ctx)).toEqual(chain)
    expect(withDaySet(chain, ago(3), pct(101), ctx)).toEqual(chain)
    expect(withDaySet(chain, ago(3), page(180), { ...ctx, pageCount: null })).toEqual(chain)
    // An old row stays editable before the start date.
    expect(withDaySet(chain, ago(11), page(25), { ...ctx, startedOn: ago(5) }).find((d) => d.day === ago(11))!.end).toEqual(page(25))
  })

  it('works in percent for a read without a page count', () => {
    const days = [{ day: ago(3), start: null, end: pct(20) }, { day: ago(1), start: pct(20), end: pct(50) }]
    const edit = dayEdit(days, ago(2), pct(30), { current: pct(50), pageCount: null })
    expect(edit.days.map((d) => d.end)).toEqual([pct(20), pct(30), pct(50)])
    expect(edit.days[2]!.start).toEqual(pct(30))
  })

  it('stores a percent that lands on the next day\'s page as that page, so the days keep leading in both units', () => {
    // 188 of 480 is 39 % (rounded): setting 39 % on the day before lands exactly on the next day's end.
    const edit = dayEdit(chain, ago(3), pct(39), ctx)
    expect(at(edit.days, 3)).toEqual({ day: ago(3), start: page(170), end: page(188) })
    expect(at(edit.days, 2)).toBeUndefined()
  })
})

describe('removing a day (R6; E4, E5)', () => {
  it('E4: a day in the middle goes and the next one takes its pages', () => {
    const days = withDayRemoved(chain, ago(2))
    expect(at(days, 2)).toBeUndefined()
    expect(at(days, 1)).toEqual(row(1, 170, 212))
    chained(days)
  })

  it('E5: the latest day goes and the read\'s value goes back to where it began', () => {
    const edit = dayEdit(chain, ago(1), null, ctx)
    expect(edit.days).toHaveLength(chain.length - 1)
    expect(edit.current).toEqual(page(188))
    expect(edit.currentChanged).toBe(true)
  })

  it('takes a read with a first day from none back to none', () => {
    const edit = dayEdit([{ day: ago(2), start: null, end: page(40) }], ago(2), null, { current: page(40), pageCount: 480 })
    expect(edit).toEqual({ days: [], current: null, currentChanged: true })
  })

  it('a day without a row is a no-op', () => {
    expect(withDayRemoved(chain, ago(3))).toEqual(chain)
  })
})

describe('what saving does, for the effect line', () => {
  it('says the day after reads differently when a day is added (E1)', () => {
    expect(effectOf(chain, ago(3), page(178), ctx)).toEqual({ kind: 'add', day: ago(3), next: { day: ago(2), was: 18, now: 10 } })
  })

  it('says the day after reads differently when a day moves (E2)', () => {
    expect(effectOf(chain, ago(2), page(175), ctx)).toEqual({ kind: 'edit', day: ago(2), next: { day: ago(1), was: 24, now: 37 } })
  })

  it('says her progress becomes the value when the latest day changes (E6)', () => {
    expect(effectOf(chain, ago(1), page(220), ctx)).toEqual({ kind: 'now', day: ago(1), value: 220 })
    expect(effectOf(chain, ago(1), null, ctx)).toEqual({ kind: 'now', day: ago(1), value: 188 })
  })

  it('says nothing when only the day changes', () => {
    expect(effectOf(chain, ago(3), page(170), ctx)).toEqual({ kind: 'none', day: ago(3) })
    expect(effectOf(chain, ago(9), page(58), ctx)).toEqual({ kind: 'none', day: ago(9) })
  })

  it('says a next day that goes reads nothing now (E3)', () => {
    expect(effectOf(chain, ago(2), page(212), ctx)).toEqual({ kind: 'edit', day: ago(2), next: { day: ago(1), was: 24, now: 0 } })
  })
})

describe('"Add day": the newest day without a row', () => {
  it('is the latest day before today that has none, and not before the read began', () => {
    expect(newestEmptyDay(chain, ago(12), today)).toBe(ago(3))
    expect(newestEmptyDay([row(1, null, 5), row(2, null, 3)], ago(3), today)).toBe(ago(3))
    expect(newestEmptyDay([row(1, null, 5), row(2, null, 3), row(3, null, 1)], ago(3), today)).toBeNull()
    expect(newestEmptyDay([], today, today)).toBeNull()
    expect(newestEmptyDay([], ago(2), today)).toBe(ago(1))
  })
})

describe('the log and the chart show what exists (R12)', () => {
  const back = [...chain, { day: ago(0), start: page(212), end: page(206) }]

  it('lists a day that went back as a negative amount, and not a day that read nothing', () => {
    const log = readingLogOf([...back, { day: ago(6), start: page(120), end: page(120) }], 480)
    expect(log[0]).toEqual({ day: ago(0), amount: -6, end: 206 })
    expect(log).toHaveLength(9)
  })

  it('still draws that day as nothing, and leaves it out of the pace and "Last time"', () => {
    expect(dailyAmounts(back, today, 3, 480).at(-1)).toEqual({ day: today, amount: 0 })
    expect(lastTimeOf(back, today, 480)).toEqual({ day: ago(1), amount: 24 })
    expect(paceOf(back, today, 480)).toBe(paceOf(chain, today, 480))
    expect(amountOf(back.at(-1)!, 480)).toBe(-6)
  })
})

describe('what the overlay shows', () => {
  it('lays writes on one another in order, each on what the one before left', () => {
    let current = ctx.current
    let days: readonly ProgressDay[] = chain
    for (const [day, value] of [[ago(3), page(178)], [ago(2), page(180)], [ago(3), null]] as const) {
      const edit = dayEdit(days, day, value, { ...ctx, current })
      days = edit.days
      current = edit.current
    }
    expect(at(days, 3)).toBeUndefined()
    expect(at(days, 2)).toEqual(row(2, 170, 180))
    expect(at(days, 1)).toEqual(row(1, 180, 212))
  })
})
