import { isoDay, parseDay } from '~/utils/dates'
import { dateFormat } from '~/utils/intl'

/**
 * The words the feed gives a day (social v1, §C 14): "Today", "Yesterday", the weekday for the rest
 * of the week ("Monday"), and the date after it ("3 Oct", "3 Oct 2025" outside this year, as the
 * app writes days: useDays). The rule is utils/feedView.ts' `feedDayLabel`.
 */
export function useFeedDay() {
  const { t, locale } = useI18n()
  const { formatDay } = useDays()

  function label(day: string): string {
    switch (feedDayLabel(day, isoDay())) {
      case 'today':
        return t('feed.today')
      case 'yesterday':
        return t('feed.yesterday')
      case 'weekday':
        return dateFormat(locale.value, { weekday: 'long' }).format(parseDay(day))
      default:
        return formatDay(day)
    }
  }

  return { label }
}
