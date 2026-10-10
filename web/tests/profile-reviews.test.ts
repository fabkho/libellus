import { describe, expect, it } from 'vitest'
import type { LibraryEntry, ReadingSession } from '../app/data/library'
import { profileReviews, REVIEWS_SHOWN } from '../app/utils/profileReviews'

/** "Your reviews" on the own Profile (utils/profileReviews.ts): her reads with a review, newest first. */

let serial = 0
const entry = (read: Partial<ReadingSession> | null, status: LibraryEntry['status'] = 'finished'): LibraryEntry => {
  serial += 1
  return {
    id: `e${serial}`,
    status,
    book: { id: `b${serial}`, title: `Book ${serial}` },
    latestSession: read && {
      id: `s${serial}`,
      startedOn: null,
      endedOn: null,
      outcome: 'finished',
      rating: null,
      review: null,
      reviewSpoilers: false,
      abandonReason: null,
      progressPage: null,
      progressPercent: null,
      progressUpdatedAt: null,
      createdAt: '2026-10-01T10:00:00Z',
      ...read,
    },
  } as LibraryEntry
}
const titles = (entries: LibraryEntry[]) => profileReviews(entries).map((r) => r.entry.book.title)

describe('profileReviews', () => {
  it('is the finished reads that have a review, and nothing else', () => {
    const list = [
      entry({ review: 'Warm.', endedOn: '2026-10-05' }),
      entry({ review: null, endedOn: '2026-10-06' }),
      entry({ review: '   \n ', endedOn: '2026-10-07' }),
      entry({ review: 'Gave up.', outcome: 'abandoned', endedOn: '2026-10-08' }),
      entry({ review: 'In progress.', outcome: null }, 'reading'),
      entry(null, 'want_to_read'),
    ]
    expect(titles(list)).toEqual(['Book 1'])
  })

  it('is newest first by the day the read ended', () => {
    const list = [
      entry({ review: 'a', endedOn: '2026-03-01' }),
      entry({ review: 'b', endedOn: '2026-10-09' }),
      entry({ review: 'c', endedOn: '2026-07-15' }),
    ]
    expect(profileReviews(list).map((r) => r.review)).toEqual(['b', 'c', 'a'])
  })

  it('orders a read without an end day by when it was written, among the others', () => {
    const list = [
      entry({ review: 'dated', endedOn: '2026-09-01', createdAt: '2026-09-02T10:00:00Z' }),
      entry({ review: 'undated, newer', endedOn: null, createdAt: '2026-10-03T10:00:00Z' }),
      entry({ review: 'undated, older', endedOn: null, createdAt: '2026-08-03T10:00:00Z' }),
    ]
    expect(profileReviews(list).map((r) => r.review)).toEqual(['undated, newer', 'dated', 'undated, older'])
  })

  it('breaks a tie of days by the newest write', () => {
    const list = [
      entry({ review: 'first', endedOn: '2026-10-01', createdAt: '2026-10-01T08:00:00Z' }),
      entry({ review: 'second', endedOn: '2026-10-01', createdAt: '2026-10-01T20:00:00Z' }),
    ]
    expect(profileReviews(list).map((r) => r.review)).toEqual(['second', 'first'])
  })

  it('carries her stars and the spoilers flag, and the review as she wrote it', () => {
    const [one] = profileReviews([entry({ review: '  The end.  ', rating: 18, reviewSpoilers: true, endedOn: '2026-10-01' })])
    expect(one).toMatchObject({ rating: 18, spoilers: true, review: '  The end.  ', endedOn: '2026-10-01' })
  })

  it('shows three before See all', () => {
    expect(REVIEWS_SHOWN).toBe(3)
  })
})
