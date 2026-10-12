/**
 * The rows of a long sheet come in pages (components/profile/ReadsSheet.vue): the first `ROWS_PAGE`, then another
 * page whenever the end comes near, so a few hundred reads are never a few hundred rows in the DOM at once. The rows
 * are all on the device already (`stats.record.reads`): this only limits what is drawn. A virtual list is for when a
 * measurement asks for one (docs/perf/final-round.md); a page of 30 rows is 1.5 screens.
 */
export const ROWS_PAGE = 30

/** How many rows show after one more page: never more than there are. */
export function moreRows(shown: number, total: number, page = ROWS_PAGE): number {
  return Math.min(Math.max(total, 0), Math.max(shown, 0) + page)
}

/** How many rows there are still to come, and so how many the next page will add. */
export function nextPage(shown: number, total: number, page = ROWS_PAGE): number {
  return moreRows(shown, total, page) - Math.min(shown, Math.max(total, 0))
}

/**
 * How many rows a sheet opens with: a page, or on the way back from a Book the count it was left with, whole pages
 * (an odd count from a changed list is rounded up to the page, so the next load lands on a page's end) and never
 * fewer than the page.
 */
export function openingRows(kept: number | undefined, page = ROWS_PAGE): number {
  if (!kept || !Number.isFinite(kept) || kept <= page) return page
  return Math.ceil(kept / page) * page
}
