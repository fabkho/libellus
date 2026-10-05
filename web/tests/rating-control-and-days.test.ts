import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, daysSpanned, isoDay, parseDay } from '@/utils/dates'
import { quartersAt, ratingX, starFills, stepQuarters, wholeStarsAt } from '@/utils/rating'

/**
 * The pure rules behind the Finish sheet: where the rating control puts a
 * finger's quarter, and the calendar days sessions are stored as. A native
 * port copies these and checks them against the same cases.
 */

// The control's geometry: 44 px stars, 12 px apart (RatingInput.vue).
const SIZE = 44
const GAP = 12

describe('the rating control', () => {
  it('puts each quarter where the stars fill to', () => {
    // 3.75 stars: three whole stars, three quarters of the fourth star's shape.
    const fills = starFills(15)
    expect(ratingX(15, SIZE, GAP)).toBeCloseTo(3 * (SIZE + GAP) + fills[3]! * SIZE)
    expect(ratingX(20, SIZE, GAP)).toBeCloseTo(4 * (SIZE + GAP) + (20.6 / 24) * SIZE)
    for (let q = 1; q <= 20; q++) expect(ratingX(q, SIZE, GAP)).toBeGreaterThan(ratingX(q - 1, SIZE, GAP))
  })

  it('snaps a drag to the nearest quarter', () => {
    for (let q = 0; q <= 20; q++) expect(quartersAt(ratingX(q, SIZE, GAP) + 1, SIZE, GAP)).toBe(q)
    expect(quartersAt(-30, SIZE, GAP)).toBe(0)
    expect(quartersAt(10_000, SIZE, GAP)).toBe(20)
  })

  it('gives a tap the whole star under the finger', () => {
    expect(wholeStarsAt(SIZE / 2, SIZE, GAP)).toBe(4)
    expect(wholeStarsAt(3 * (SIZE + GAP) + 2, SIZE, GAP)).toBe(16)
    // The gap belongs half to each neighbour.
    expect(wholeStarsAt(SIZE + GAP / 2 - 1, SIZE, GAP)).toBe(4)
    expect(wholeStarsAt(SIZE + GAP / 2 + 1, SIZE, GAP)).toBe(8)
    expect(wholeStarsAt(10_000, SIZE, GAP)).toBe(20)
  })

  it('steps a quarter at a time from the keyboard, within five stars', () => {
    expect(stepQuarters(null, 1)).toBe(1)
    expect(stepQuarters(15, 1)).toBe(16)
    expect(stepQuarters(20, 1)).toBe(20)
    expect(stepQuarters(1, -1)).toBe(0)
  })
})

describe('calendar days', () => {
  it('are the device’s day, never shifted by the time zone', () => {
    expect(isoDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(isoDay(parseDay('2026-10-03'))).toBe('2026-10-03')
    expect(parseDay('2026-10-03').getDate()).toBe(3)
  })

  it('count and move across months and years', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0)
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31)
  })

  it('of a read are counted at both ends: one rule for the status line, the cards and the history', () => {
    // Begun and ended on one day: 1 day (day 1 while it is open).
    expect(daysSpanned('2026-10-01', '2026-10-01')).toBe(1)
    expect(daysSpanned('2026-10-03', '2026-10-05')).toBe(3)
    expect(daysSpanned('2026-02-27', '2026-03-02')).toBe(4)
    // Across daylight saving and years.
    expect(daysSpanned('2026-03-28', '2026-03-30')).toBe(3)
    expect(daysSpanned('2025-12-31', '2026-01-01')).toBe(2)
    // An end before its start (clock changes, a logged-later read) is still 1 day.
    expect(daysSpanned('2026-10-05', '2026-10-03')).toBe(1)
  })
})
