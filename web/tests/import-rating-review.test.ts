import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mapFableLibrary } from '@/data/import/fable'
import { goodreadsAdapter } from '@/data/import/goodreads'
import { hardcoverAdapter } from '@/data/import/hardcover'
import { parseReadingTracker, type Overrides } from '@/data/import/readingTracker'
import { mapRows } from '@/data/import/rows'
import type { Row } from '@/data/import/csv'

/**
 * A review that is only a rating is a rating, not a review (utils/ratingReview.ts; tests/rating-review.test.ts pins
 * the forms), in every importer that reads free-text reviews: Goodreads, Hardcover and the Fable tracker. A rating the
 * row has stays; a number above 5 with no `/10` stays a review and is reported.
 */

const TODAY = '2026-10-21'

describe('Goodreads', () => {
  const goodreads = (review: string, rating = '0', shelf = 'read') =>
    mapRows(goodreadsAdapter, [{ 'Book Id': '1', Title: 'A Book', Author: 'An Author', 'Exclusive Shelf': shelf, 'My Rating': rating, 'My Review': review, 'Date Read': '2026/09/01' } as Row], TODAY).books[0]!

  it('takes a rating-only review as the rating when the read has none, rounded down, and keeps no review', () => {
    for (const [text, quarters] of [['4.6', 18], ['5/5', 20], ['4.5/5', 18], ['4.6/10', 18], ['3', 12], ['4,9', 19], ['4.5 ★', 18]] as const) {
      expect(goodreads(text).session, text).toMatchObject({ outcome: 'finished', rating: quarters, review: null })
    }
    expect(goodreads('4.6').problems).toEqual([])
  })

  it('keeps the rating the row already has, and still drops the number as a review', () => {
    expect(goodreads('4.3', '4').session).toMatchObject({ rating: 16, review: null })
    expect(goodreads('5/5', '5').session).toMatchObject({ rating: 20, review: null })
  })

  it('leaves a real review alone, and a number that is no rating (above 5, no /10) as a review, reported', () => {
    expect(goodreads('5 stars, loved it').session).toMatchObject({ rating: null, review: '5 stars, loved it' })
    expect(goodreads('Book 2 of 3').session).toMatchObject({ review: 'Book 2 of 3' })
    const year = goodreads('1984')
    expect(year.session).toMatchObject({ rating: null, review: '1984' })
    expect(year.problems).toEqual([{ code: 'ratingLikeReview' }])
  })

  it('halves a number above 5 written out of 10', () => {
    expect(goodreads('8/10').session).toMatchObject({ rating: 16, review: null })
  })

  it('does not give a rating to a book that is not finished', () => {
    const want = goodreads('4.5', '0', 'to-read')
    expect(want.session).toBeNull()
    expect(want.problems).toContainEqual({ code: 'notFinishedRating' })
  })
})

describe('Hardcover', () => {
  const hardcover = (review: string, rating = '') =>
    mapRows(hardcoverAdapter, [{ 'Hardcover Book ID': '1', Title: 'A Book', Author: 'An Author', Status: 'Read', Rating: rating, Review: review, 'Date Finished': '2026-09-01' } as Row], TODAY).books[0]!

  it('reads the same rule', () => {
    expect(hardcover('4.6').session).toMatchObject({ rating: 18, review: null })
    expect(hardcover('4.5/5', '3').session).toMatchObject({ rating: 12, review: null })
    expect(hardcover('Lovely').session).toMatchObject({ rating: null, review: 'Lovely' })
    expect(hardcover('1984').problems).toEqual([{ code: 'ratingLikeReview' }])
  })
})

describe('the Fable tracker', () => {
  const { books: records } = parseReadingTracker(readFileSync(new URL('./fixtures/fable/reading-list.json', import.meta.url), 'utf8'))
  const overrides = JSON.parse(readFileSync(new URL('./fixtures/fable/overrides.json', import.meta.url), 'utf8')) as Overrides
  const finished = records.find((record) => record.session?.finishedAt && !record.session?.dnfAt)!
  const mapped = (rating: number | null, review: string | null) =>
    mapFableLibrary(
      [{ ...finished, id: 'solo-0001', session: { ...finished.session!, rating, review } }],
      { ...overrides, merge: [], pinned: [] } as Overrides,
    ).entries[0]!.sessions[0]!

  it('reads the same rule', () => {
    expect(mapped(null, '4.6')).toMatchObject({ rating: 18, review: null })
    expect(mapped(4.5, '5/5')).toMatchObject({ rating: 18, review: null })
    expect(mapped(null, 'Lovely')).toMatchObject({ rating: null, review: 'Lovely' })
  })
})
