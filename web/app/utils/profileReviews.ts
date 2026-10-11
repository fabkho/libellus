import type { LibraryEntry } from '../data/library'
import { isRatingOnlyReview } from './ratingReview'

/**
 * "Your reviews" on the own Profile (social v2a, owner's request): her reads that have a review, newest first,
 * worked out from her Library on the device (so it works offline). Pure, framework-free.
 *
 * Written reviews only: a text that is only a number is a rating (`isRatingOnlyReview`), not a review, and is left out.
 *
 * What the device holds of her reads is each entry's latest session (`LibraryEntry.latestSession`): so one
 * review per Book, the one of her latest read when that read is a finished one; a re-read in progress hides the
 * review of the read before it until it ends (the database has it, the device's lists do not carry it).
 */

/** The cards the sideways row holds before its last *See all* card (the section's *See all* button and the sheet have every one). */
export const REVIEWS_SHOWN = 6

export type ProfileReview = {
  /** The read's id: the row's key. */
  id: string
  entry: LibraryEntry
  endedOn: string | null
  rating: number | null
  review: string
  /** She flagged it as spoilers (a quiet tag; it is never folded for her). */
  spoilers: boolean
}

/** The day a review is ordered by: the day the read ended, else the day the read was made (when the review was written). */
const dayOf = (review: ProfileReview, createdAt: string) => review.endedOn ?? createdAt.slice(0, 10)

/** Her reads with a review, newest first by the read's end day (else the day it was written), then the newest write. */
export function profileReviews(entries: readonly LibraryEntry[]): ProfileReview[] {
  const made = new Map<string, string>()
  const reviews: ProfileReview[] = []
  for (const entry of entries) {
    const read = entry.latestSession
    const text = read?.review?.trim()
    // A text that is only a number ("4.6", "5/5", a Goodreads import) is her rating, not a review.
    if (!read || read.outcome !== 'finished' || !text || isRatingOnlyReview(text)) continue
    made.set(read.id, read.createdAt)
    reviews.push({ id: read.id, entry, endedOn: read.endedOn, rating: read.rating, review: read.review!, spoilers: Boolean(read.reviewSpoilers) })
  }
  return reviews.sort((a, b) => {
    const byDay = dayOf(b, made.get(b.id)!).localeCompare(dayOf(a, made.get(a.id)!))
    return byDay || made.get(b.id)!.localeCompare(made.get(a.id)!)
  })
}
