/**
 * A review that is only a number is a rating written as text ("4.6", "5/5", "4.5/5", "4,5 ★", "4 stars"):
 * Goodreads has whole stars only, so some readers type the finer rating into the review box. Such a text is
 * the rating, not a review (the owner's decisions): an import does not keep it as a review, and the number is the
 * read's rating, rounded DOWN to the quarter steps a rating has (4.6 → 4.5 = 18 quarters, 4.3 → 4.25 = 17,
 * 4.9 → 4.75 = 19, 5 → 20), over the whole or half stars the exporting app stored (the number is the real rating).
 * A text that says no rating (0) leaves the row's rating.
 *
 * The text is: optional spaces, a number with `.` or `,`, optionally `/5` or `/10`, optionally `★` or `stars`,
 * optional spaces; nothing else. The rules for the number:
 *  - it counts as stars out of 5; `/10` is the same as `/5` for 5 or less ("4.6/10" is a typo for "4.6/5") and
 *    halves a number above 5 ("8/10" is 4 stars);
 *  - a number above 5 with no `/10` ("1984", "7") is no rating (it may be a title or a year): the text stays a review;
 *  - 0 is a rating-only text with no rating (unrated).
 * supabase/migrations/20261021030000_rating_only_reviews.sql applies the same rule to reads already imported
 * (a SQL regex of the same pattern): keep the two in step; tests/rating-review.test.ts pins the forms.
 * Pure: no framework, so a native port copies it.
 */

const RATING_ONLY = /^\s*(\d+(?:[.,]\d+)?)\s*(?:\/\s*(5|10))?\s*(?:★|stars?)?\s*$/i

/** The stars the text says (0–5), or null when it is not a rating-only text. */
function starsOf(text: string): number | null {
  const match = RATING_ONLY.exec(text)
  if (!match) return null
  const written = Number(match[1]!.replace(',', '.'))
  if (!Number.isFinite(written)) return null
  const stars = match[2] === '10' && written > 5 ? written / 2 : written
  return stars <= 5 ? stars : null
}

/** Whether a review text is only a rating (see above); such a text is not a review. */
export function isRatingOnlyReview(text: string | null | undefined): boolean {
  return text != null && starsOf(text) !== null
}

/** The rating in integer quarters (1–20) a rating-only text says, rounded down; null for anything else or for 0. */
export function ratingFromReviewText(text: string | null | undefined): number | null {
  const stars = text == null ? null : starsOf(text)
  if (stars === null) return null
  // The small addend keeps 4.6 * 4 = 18.4 and 4.75 * 4 = 19 where binary floats could land just under a quarter.
  const quarters = Math.floor(stars * 4 + 1e-9)
  return quarters >= 1 ? Math.min(20, quarters) : null
}

/** A number above 5 with no `/10` that has the shape of a rating-only text: no rating, so it stays a review (reported to the importer). */
export function looksLikeRatingButIsNot(text: string | null | undefined): boolean {
  return text != null && RATING_ONLY.test(text) && starsOf(text) === null
}
