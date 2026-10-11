import type { StatsRead } from '~/data/stats'
import { parseDay } from '~/utils/dates'
import { dateFormat, numberFormat } from '~/utils/intl'

/**
 * The Profile's figures in words and numbers, in the app's locale (issue #78):
 * counts ("6,005"), large counts compact ("30.1K"), an average Rating in
 * stars to one decimal ("4.3"), months long, short and as a letter, a month
 * with its year ("January 2023"), and how long a read took ("in 12 days").
 */
export function useFigures() {
  const { t, locale } = useI18n()

  const count = (value: number) => numberFormat(locale.value).format(value)
  /** A share (0–1) as a whole percent, "40%" in the app's locale. */
  const percent = (share: number) => numberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(share)
  /** Five figures and up compact, so a figure keeps to its cell. */
  const large = (value: number) =>
    value < 10_000 ? count(value) : numberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  /** A mean Rating in quarters, as stars to one decimal; a dash with nothing rated. */
  const stars = (quarters: number | null) =>
    quarters === null ? '–' : numberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(quarters / 4)

  const monthDate = (month: number) => new Date(2000, month - 1, 1)
  /** `month` 1–12. */
  const monthLong = (month: number) => dateFormat(locale.value, { month: 'long' }).format(monthDate(month))
  const monthShort = (month: number) => dateFormat(locale.value, { month: 'short' }).format(monthDate(month))
  const monthLetter = (month: number) => dateFormat(locale.value, { month: 'narrow' }).format(monthDate(month))
  const monthYear = (day: string) => dateFormat(locale.value, { month: 'long', year: 'numeric' }).format(parseDay(day))
  const weekdayLetter = (day: string) => dateFormat(locale.value, { weekday: 'narrow' }).format(parseDay(day))

  const dayParts = (day: string) => ({
    day: dateFormat(locale.value, { day: 'numeric' }).format(parseDay(day)),
    month: dateFormat(locale.value, { month: 'long' }).format(parseDay(day)),
  })
  /** "12 March", the month long (a day in the calendar's names, no year: it is one of the last weeks). */
  const dayLong = (day: string) => t('common.dayMonth', dayParts(day))
  /** "Thursday 12 March", in the member's locale: a day's sheet. */
  const dayTitle = (day: string) => t('profile.sheet.day', { weekday: dateFormat(locale.value, { weekday: 'long' }).format(parseDay(day)), date: dayLong(day) })

  /** "in a day", "in 12 days"; nothing without both dates. */
  const readIn = (read: Pick<StatsRead, 'days'>) => (read.days === null ? '' : t('profile.sheet.readIn', { count: read.days }, read.days))

  return { count, large, percent, stars, monthLong, monthShort, monthLetter, monthYear, weekdayLetter, dayLong, dayTitle, readIn }
}
