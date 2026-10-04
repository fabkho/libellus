import type { LibraryEntry } from '~/data/library'
import { pageCountOf, progressOf } from '~/data/progress'
import {
  dailyAmounts,
  daysLeftOf,
  lastTimeOf,
  paceOf,
  readingLogOf,
  readSummaryOf,
  unitOf,
  valueIn,
  type DayAmount,
} from '~/data/progressDays'
import { useProgressDaysStore } from '~/stores/progressDays'
import { daysBetween, isoDay, parseDay } from '~/utils/dates'

/**
 * A read's progress by day for a screen (issue #68): asks for the days of the
 * entry's read (stores/progressDays.ts) and works out what Home's card and the
 * book page show from them (data/progressDays.ts): the last days' amounts, the
 * pace, the days to go, "Last time", the reading log and the read so far, in
 * the read's unit, with the words for them. `loaded` is false until the days
 * are in (offline, possibly never): the screens then show what they did before.
 */
export function useReadingDays(entry: () => LibraryEntry | null) {
  const { t, n, locale } = useI18n()
  const { formatDay } = useDays()
  const store = useProgressDaysStore()

  const sessionId = computed(() => entry()?.latestSession?.id ?? null)
  watchEffect(() => store.want(sessionId.value))

  const days = computed(() => (sessionId.value ? (store.bySession[sessionId.value] ?? null) : null))
  const loaded = computed(() => days.value !== null)
  const pageCount = computed(() => {
    const now = entry()
    return now ? pageCountOf(now) : null
  })
  const unit = computed(() => unitOf(pageCount.value))
  /** Where the read is and where it ends, in its unit. */
  const position = computed(() => valueIn(progressOf(entry()?.latestSession), unit.value, pageCount.value) ?? 0)
  const end = computed(() => pageCount.value ?? 100)
  const atEnd = computed(() => position.value >= end.value)

  const today = () => isoDay()
  const amounts = (count: number): DayAmount[] => dailyAmounts(days.value ?? [], today(), count, pageCount.value)
  /** Whether the read has any day that read something. */
  const hasHistory = computed(() => (days.value ?? []).length > 0)
  const pace = computed(() => paceOf(days.value ?? [], today(), pageCount.value))
  const daysLeft = computed(() => daysLeftOf(pace.value, position.value, end.value))
  const lastTime = computed(() => lastTimeOf(days.value ?? [], today(), pageCount.value))
  const log = computed(() => readingLogOf(days.value ?? [], pageCount.value))
  /** The read so far (start to today) spread over its days: the card's line at the end. */
  const sofar = computed(() => {
    const startedOn = entry()?.latestSession?.startedOn
    return startedOn ? readSummaryOf(startedOn, today(), pageCount.value) : null
  })

  // ------------------------------------------------------------------ words

  /** "Today", "Yesterday", "Fri" within the week, else "3 Oct". */
  function dayWords(day: string): string {
    const ago = daysBetween(day, today())
    if (ago === 0) return t('book.progress.dayToday')
    if (ago === 1) return t('book.progress.dayYesterday')
    if (ago > 1 && ago < 7) return new Intl.DateTimeFormat(locale.value, { weekday: 'short' }).format(parseDay(day))
    return formatDay(day)
  }
  /** "24 pages", "5 %". */
  const amountWords = (amount: number) =>
    unit.value === 'page' ? t('book.progress.amountPages', { count: n(amount) }, amount) : t('book.progress.amountPercent', { count: amount })
  /** "18 a day", "7 % a day". */
  const perDayWords = (amount: number) =>
    unit.value === 'page' ? t('book.progress.perDay', { count: n(amount) }) : t('book.progress.perDayPercent', { count: amount })
  /** "22 days". */
  const daysWords = (count: number) => t('book.progress.days', { count }, count)

  /** The card's line beside the sparkline: "18 a day · 22 days", or at the end "12 days · 51 a day". */
  const paceLine = computed(() => {
    if (atEnd.value && sofar.value) return t('book.progress.endLine', { days: daysWords(sofar.value.days), perDay: perDayWords(sofar.value.perDay) })
    if (!pace.value) return null
    return daysLeft.value ? t('book.progress.paceLine', { perDay: perDayWords(pace.value), days: daysWords(daysLeft.value) }) : perDayWords(pace.value)
  })

  return {
    days,
    loaded,
    hasHistory,
    pageCount,
    unit,
    position,
    end,
    atEnd,
    amounts,
    pace,
    daysLeft,
    lastTime,
    log,
    sofar,
    dayWords,
    amountWords,
    perDayWords,
    daysWords,
    paceLine,
  }
}
