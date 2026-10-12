import { readsInMonth, readsOnDay, readsWithoutPages, readsWithStars, type ReadingDay, type StatsRead } from '~/data/stats'
import type { ProfileSheet } from '~/stores/stats'

/**
 * What a Profile sheet lists (components/profile/ReadsSheet.vue): one switch over `ProfileSheet` for the Profile,
 * a year in review and a member's two pages, so a new kind of figure is one case here and one in `statsSheetTitle`
 * (composables/useStatsSheet.ts). Framework-free, so Vitest drives it.
 *
 * `reads` are the closed reads of the page's member (a year in review: that year's), `days` the reading days of the
 * Profile (a member's page has none: a day's sheet is only ever opened there).
 */
export function statsSheetReads(sheet: ProfileSheet | null, reads: readonly StatsRead[], days: readonly ReadingDay[] = []): StatsRead[] {
  if (!sheet) return []
  switch (sheet.kind) {
    case 'month':
      return readsInMonth(reads, sheet.year, sheet.month)
    case 'day':
      return readsOnDay(days, sheet.day)
    case 'pagesMissing':
      return readsWithoutPages(reads, sheet.year)
    case 'stars':
      return readsWithStars(reads, sheet.year, sheet.star)
  }
}

/**
 * Whether a row names its year: a sheet over every year (the All pill) carries it, as does nothing else — a day and
 * a month are one year already.
 */
export function statsSheetWithYear(sheet: ProfileSheet | null): boolean {
  return !!sheet && sheet.kind !== 'day' && sheet.kind !== 'month' && sheet.year === 'all'
}
