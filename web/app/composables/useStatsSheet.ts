import type { GenreId } from '~/data/enrich/genres'
import type { ReadingDay, StatsRead } from '~/data/stats'
import type { ProfileSheet } from '~/stores/stats'
import { statsSheetReads, statsSheetWithYear } from '~/utils/statsSheet'

/**
 * What the Profile's sheet shows for the one that is `shown` (composables/useProfileSheet.ts): its title, its reads
 * and whether a row names its year (utils/statsSheet.ts holds the mapping). The Profile, a year in review and a
 * member's two pages bind these to `ProfileReadsSheet` instead of each keeping its own switch; a new figure that opens
 * a list is one case there and one title here.
 *
 * `reads` are the page's closed reads, `days` the Profile's reading days (a member's page has none) and `ofEntry`
 * the genres of an entry (a genre's sheet; a page without one lists no genre's books).
 */
export function useStatsSheet(
  shown: Ref<ProfileSheet | null>,
  reads: () => readonly StatsRead[],
  days: () => readonly ReadingDay[] = () => [],
  ofEntry: (entryId: string) => readonly GenreId[] | undefined = () => undefined,
) {
  const { t } = useI18n()
  const { monthLong, dayLong, dayTitle } = useFigures()

  const title = computed(() => {
    const s = shown.value
    if (!s) return ''
    switch (s.kind) {
      case 'month':
        return t('profile.sheet.month', { month: monthLong(s.month), year: s.year })
      case 'week':
        return t('profile.sheet.week', { date: dayLong(s.start) })
      case 'day':
        return dayTitle(s.day)
      case 'pagesMissing':
        return t('profile.sheet.pagesMissing')
      case 'stars':
        return t('profile.sheet.stars', { count: s.star, year: s.year === 'all' ? t('profile.sheet.allYears') : String(s.year) }, s.star)
      case 'author':
        return t('profile.sheet.author', { name: s.name, year: s.year === 'all' ? t('profile.sheet.allYears') : String(s.year) })
      case 'genre':
        return t('profile.sheet.genre', { genre: t(`genre.${s.genre}`), year: s.year === 'all' ? t('profile.sheet.allYears') : String(s.year) })
      case 'unrated':
        return t('profile.sheet.unrated')
    }
  })
  const sheetReads = computed(() => statsSheetReads(shown.value, reads(), days(), ofEntry))
  const withYear = computed(() => statsSheetWithYear(shown.value))

  return { title, reads: sheetReads, withYear }
}
