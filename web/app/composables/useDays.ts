import { daysBetween, daysSpanned, isoDay, parseDay } from '~/utils/dates'

/**
 * Calendar days (`YYYY-MM-DD`, as reading sessions store them) in words, in
 * the app's locale: "3 Oct", "3 Oct 2025" outside this year, and "Today ·
 * 3 Oct" / "Yesterday · 2 Oct" where a sheet shows the day it will save.
 */
export function useDays() {
  const { t, locale } = useI18n()

  function parts(day: string) {
    const date = parseDay(day)
    return {
      day: new Intl.DateTimeFormat(locale.value, { day: 'numeric' }).format(date),
      month: new Intl.DateTimeFormat(locale.value, { month: 'short' }).format(date),
      year: String(date.getFullYear()),
    }
  }

  /** "3 Oct", or "3 Oct 2025" in another year (unless the year shows elsewhere: `year: false`). */
  function formatDay(day: string, { year = true }: { year?: boolean } = {}): string {
    const p = parts(day)
    return !year || day.slice(0, 4) === isoDay().slice(0, 4) ? t('common.dayMonth', p) : t('common.dayMonthYear', p)
  }

  /** "Today · 3 Oct", "Yesterday · 2 Oct", otherwise as `formatDay`. */
  function relativeDay(day: string): string {
    const ago = daysBetween(day, isoDay())
    if (ago === 0) return t('common.today', { date: formatDay(day) })
    if (ago === 1) return t('common.yesterday', { date: formatDay(day) })
    return formatDay(day)
  }

  /** Which day of a read today is: the start day is day 1. */
  function dayOfRead(startedOn: string): number {
    return daysSpanned(startedOn, isoDay())
  }

  return { formatDay, relativeDay, dayOfRead }
}
