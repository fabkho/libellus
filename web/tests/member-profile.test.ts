import { describe, expect, it } from 'vitest'
import type { StatsRead } from '../app/data/stats'
import type { MemberProfile, SocialBook, SocialSections } from '../app/data/socialShapes'
import { bookPathOf, figuresWithRatings, libraryLine, memberBlocks, yearIn, type VisibleProfile } from '../app/utils/memberProfile'

// What another member's profile shows (social v1, U4): pure, no stack needed.

const ON: SocialSections = { reading: true, want: true, finished: true, ratings: true, reviews: true, abandoned: true, year: true }

function book(id: string, manual = false): SocialBook {
  return { id, title: id, authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, manual }
}

function profile(over: { sections?: Partial<SocialSections>; counts?: VisibleProfile['counts']; want?: number } = {}): VisibleProfile {
  const base: MemberProfile = {
    member: { id: 'm', name: 'Anna', photo: null },
    private: true,
    state: 'following',
    visible: true,
    followsYou: false,
    sections: { ...ON, ...over.sections },
    since: '2025-03-01',
    counts: over.counts ?? { read: 4, reading: 1, want: 3 },
    reading: [{ book: book('r1'), startedOn: '2026-10-03' }],
    want: Array.from({ length: over.want ?? 3 }, (_, i) => ({ book: book(`w${i}`), addedOn: '2026-10-01' })),
    finished: [{ book: book('f1'), endedOn: '2026-10-09', rating: 18, review: null }],
  }
  return base as VisibleProfile
}

function read(entry: string, endedOn: string | null, outcome: StatsRead['outcome'] = 'finished'): StatsRead {
  return { sessionId: `${entry}-${endedOn}`, entryId: entry, book: book(entry) as never, startedOn: null, endedOn, outcome, rating: null, pages: null, days: null, nth: 1 }
}

describe('the blocks her switches leave', () => {
  const record = { reads: [read('a', '2026-03-02'), read('b', '2025-06-01')] }

  it('shows every block when everything is on and her record is in', () => {
    expect(memberBlocks(profile(), record, false)).toEqual({
      reading: true,
      want: true,
      wantAll: false,
      figures: true,
      ratings: true,
      finished: true,
      yearCards: true,
    })
  })

  it('drops Currently reading and Want to read with their switches, and an empty list', () => {
    expect(memberBlocks(profile({ sections: { reading: false } }), record, false).reading).toBe(false)
    expect(memberBlocks(profile({ sections: { want: false } }), record, false)).toMatchObject({ want: false, wantAll: false })
    const none = { ...profile(), reading: [], want: [], finished: [] } as VisibleProfile
    expect(memberBlocks(none, record, false)).toMatchObject({ reading: false, want: false, finished: false })
  })

  it('offers See all only when she has more Want to read than the profile carries', () => {
    expect(memberBlocks(profile({ counts: { read: 4, reading: 1, want: 12 }, want: 12 }), record, false).wantAll).toBe(false)
    expect(memberBlocks(profile({ counts: { read: 4, reading: 1, want: 17 }, want: 12 }), record, false).wantAll).toBe(true)
  })

  it('closes her figures without the year switch or without Finished, whatever the record holds', () => {
    expect(memberBlocks(profile({ sections: { year: false } }), null, false)).toMatchObject({ figures: false, ratings: false, yearCards: false })
    expect(memberBlocks(profile({ sections: { finished: false } }), record, false)).toMatchObject({ figures: false, yearCards: false, finished: false })
  })

  it('closes Ratings with its own switch and keeps the rest of her figures', () => {
    expect(memberBlocks(profile({ sections: { ratings: false } }), record, false)).toMatchObject({ figures: true, ratings: false, yearCards: true })
  })

  it('stands the figures as placeholders while the record is on its way, for a member who has finished something', () => {
    expect(memberBlocks(profile(), null, true)).toMatchObject({ figures: true, ratings: true, yearCards: false })
    expect(memberBlocks(profile({ counts: { read: 0, reading: 0, want: 0 } }), null, true).figures).toBe(false)
    expect(memberBlocks(profile(), null, false).figures).toBe(false)
  })

  it('closes the figures and the year cards for a record with nothing finished', () => {
    const quiet = { reads: [read('x', '2026-02-02', 'abandoned')] }
    expect(memberBlocks(profile(), quiet, false)).toMatchObject({ figures: false, yearCards: false })
  })
})

describe('the Library line', () => {
  const template = (m: { read: string; reading: string; want: string }) => `${m.read} read · ${m.reading} reading · ${m.want} want`

  it('says all three counts she shows', () => {
    expect(libraryLine({ read: 42, reading: 2, want: 17 }, template)).toBe('42 read · 2 reading · 17 want')
  })

  it('takes a hidden count away with its part, never a zero', () => {
    expect(libraryLine({ read: null, reading: 2, want: 17 }, template)).toBe('2 reading · 17 want')
    expect(libraryLine({ read: 42, reading: null, want: null }, template)).toBe('42 read')
  })

  it('says nothing when every count is hidden', () => {
    expect(libraryLine({ read: null, reading: null, want: null }, template)).toBeNull()
  })

  it('formats the counts', () => {
    expect(libraryLine({ read: 1200, reading: 0, want: 3 }, template, (n) => `<${n}>`)).toBe('<1200> read · <0> reading · <3> want')
  })
})

describe('a Book on her profile', () => {
  it('opens its page, except a Manual book, which opens nothing', () => {
    expect(bookPathOf({ id: 'abc', manual: false })).toBe('/book/abc')
    expect(bookPathOf({ id: 'abc', manual: true })).toBeNull()
  })
})

describe('the year in the pills', () => {
  const reads = [read('a', '2026-03-02'), read('b', '2025-06-01'), read('c', '2024-01-01', 'abandoned')]

  it('keeps All and a year she has finished a read in, else goes back to All', () => {
    expect(yearIn('all', reads)).toBe('all')
    expect(yearIn(2025, reads)).toBe(2025)
    expect(yearIn(2024, reads)).toBe('all')
    expect(yearIn(2020, [])).toBe('all')
  })
})

describe('her figures without her Ratings', () => {
  it('drops the "not rated yet" line, which she did not say, and keeps the rest', () => {
    expect(figuresWithRatings({ unrated: 8, books: 8 }, false)).toEqual({ unrated: 0, books: 8 })
    expect(figuresWithRatings({ unrated: 8, books: 8 }, true)).toEqual({ unrated: 8, books: 8 })
  })
})
