import type { YearFigures } from '~/data/stats'

/**
 * The Pages figure of a year (Profile, a year in review, a member's page, a reading page). A Book without a page
 * count (an Apple Books import has none) adds nothing to the sum, so the figure is the pages of the Books that
 * have them, and the line under it says how many have not (`pagesMissing`). A year where no Book has pages has
 * nothing to sum: the figure is left out (null, drawn as the dash the Days a book figure uses), never "0 pages".
 * The pages a book is only said when every Book has a count: with some missing, the average of the known ones would
 * be a number the year does not have.
 */
export function pagesFigure(figures: Pick<YearFigures, 'books' | 'pages' | 'pagesMissing'>): {
  /** The sum of the known page counts; null when none is known. */
  value: number | null
  /** How many finished reads have no count, left out of the sum. */
  missing: number
  /** The pages a book, when every Book has a count; null otherwise. */
  perBook: number | null
} {
  const value = figures.pages > 0 ? figures.pages : null
  const missing = figures.pagesMissing
  return { value, missing, perBook: value !== null && missing === 0 && figures.books > 0 ? Math.round(value / figures.books) : null }
}
