import { addDays } from '../utils/dates.ts'
import { type DayBounds, type ProgressDay } from './progressDays.ts'

/**
 * What the Update progress sheet shows when it is on an earlier day (plan docs/plans/backdated-progress.md §3):
 * which of the day pills is lit, what the picker may choose, and the range line's two ends. Framework-free
 * (a native client copies it); the words are the component's. `today` is always the caller's (`isoDay()`).
 */

export type DayPill = 'today' | 'yesterday' | 'pick'

/** The pills: which one is lit, the day "Yesterday" means, and the day the third pill carries (a picked one, else none). */
export type DayPills = { lit: DayPill; yesterday: string; picked: string | null }

/** `day` null is Today; yesterday is its own pill, any other earlier day sits on the third one. */
export function dayPillsOf(day: string | null, today: string): DayPills {
  const yesterday = addDays(today, -1)
  if (day === null || day >= today) return { lit: 'today', yesterday, picked: null }
  if (day === yesterday) return { lit: 'yesterday', yesterday, picked: null }
  return { lit: 'pick', yesterday, picked: day }
}

/**
 * Whether the sheet offers a day at all: a read that began today (or later) has no earlier day to record
 * (`date_invalid` for a new day before it began), so the pills stay out of its way. A read with no known start is
 * not limited.
 */
export function offersDays(startedOn: string | null | undefined, today: string): boolean {
  return !startedOn || startedOn < today
}

/**
 * What the date input handed back, as the day to switch to: a day from today on is Today (null), a day before the
 * read began (the picker's `min` is a hint some platforms ignore) or an empty value (the picker was cleared) is
 * nothing (`undefined`: the sheet stays where it is).
 */
export function dayFromPicker(value: string, today: string, min: string | null | undefined): string | null | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  if (value >= today) return null
  if (min && value < min) return undefined
  return value
}

/** One end of the range line: a day with the value the wheel may reach there (`day` null: the read's start). */
export type RangeFrom = { day: string | null; value: number }

/** The upper end: the next day's end, "now" (the read's value, which the days do not lead), or open (the page count). */
export type RangeTo = { kind: 'day'; day: string; value: number } | { kind: 'now'; value: number } | { kind: 'open' }

export type DayRange = { from: RangeFrom; to: RangeTo }

/**
 * Where the earlier day may stand in words' terms ("Between Fri · p. 170 and Sun · p. 188"): from where the day
 * before ended (its day, or the read's start when there is none) to where the day after ends; with no day after,
 * the read's own value, or nothing but the page count when the days lead it. `bounds` is `dayBoundsOf`'s and `limit` the wheel's
 * ceiling (`progressLimit`), so the line and the wheel never disagree.
 */
export function dayRangeOf(days: readonly ProgressDay[], day: string, bounds: DayBounds, limit: number): DayRange {
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day))
  const before = [...sorted].reverse().find((d) => d.day < day)
  const after = sorted.find((d) => d.day > day)
  const from: RangeFrom = { day: before?.day ?? null, value: bounds.start }
  if (after) return { from, to: { kind: 'day', day: after.day, value: Math.min(bounds.hi, limit) } }
  if (bounds.leads) return { from, to: { kind: 'open' } }
  return { from, to: { kind: 'now', value: Math.min(bounds.hi, limit) } }
}
