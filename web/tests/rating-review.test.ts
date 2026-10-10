import { describe, expect, it } from 'vitest'
import { isRatingOnlyReview, looksLikeRatingButIsNot, ratingFromReviewText } from '@/utils/ratingReview'

/** A review that is only a number is a rating (utils/ratingReview.ts): every form, the rounding, and what is not one. */

describe('a review that is only a rating', () => {
  it.each([
    ['4.6', 18],
    ['4,6', 18],
    ['5/5', 20],
    ['4.5/5', 18],
    ['4.6/10', 18], // a typo for /5: he rates out of 5
    ['4.6/5', 18],
    ['3', 12],
    ['4.9', 19],
    ['4.75', 19],
    ['4.74', 18],
    ['4.25', 17],
    ['3.8/5', 15],
    ['0.25', 1],
    ['5', 20],
    ['8/10', 16],
    ['10/10', 20],
    ['7.5/10', 15],
    ['4.5 ★', 18],
    ['4.5★', 18],
    ['4 stars', 16],
    ['4.5/5 stars', 18],
    ['4 star', 16],
    ['  4.6  ', 18],
    ['4 / 5', 16],
    ['4.5 STARS', 18],
  ])('%j is %i quarters', (text, quarters) => {
    expect(isRatingOnlyReview(text)).toBe(true)
    expect(ratingFromReviewText(text)).toBe(quarters)
  })

  it('rounds down to the quarter, never up', () => {
    expect(ratingFromReviewText('4.99')).toBe(19)
    expect(ratingFromReviewText('4.51')).toBe(18)
    expect(ratingFromReviewText('0.24')).toBeNull()
  })

  it('is a rating-only text with no rating for 0', () => {
    expect(isRatingOnlyReview('0')).toBe(true)
    expect(ratingFromReviewText('0')).toBeNull()
    expect(ratingFromReviewText('0/5')).toBeNull()
  })
})

describe('what is not a rating-only review', () => {
  it.each([
    '5 stars, loved it',
    'Book 2 of 3',
    '1984',
    '7',
    '6/5',
    '11/10',
    '4.5/6',
    '4.5/5 loved it',
    'loved it 5/5',
    '',
    '   ',
    '4..5',
    '-4',
    '4.5.1',
    '4 out of 5',
    '4/5/6',
  ])('%j stays a review', (text) => {
    expect(ratingFromReviewText(text)).toBeNull()
    expect(isRatingOnlyReview(text)).toBe(false)
  })

  it('has none for no text', () => {
    expect(ratingFromReviewText(null)).toBeNull()
    expect(ratingFromReviewText(undefined)).toBeNull()
    expect(isRatingOnlyReview(null)).toBe(false)
  })

  it('names a number above 5 without /10 as a rating that is none (the importer reports it)', () => {
    expect(looksLikeRatingButIsNot('1984')).toBe(true)
    expect(looksLikeRatingButIsNot('7')).toBe(true)
    expect(looksLikeRatingButIsNot('6/5')).toBe(true)
    expect(looksLikeRatingButIsNot('4.6')).toBe(false)
    expect(looksLikeRatingButIsNot('8/10')).toBe(false)
    expect(looksLikeRatingButIsNot('Book 2 of 3')).toBe(false)
  })
})
