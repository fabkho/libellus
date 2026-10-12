import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import type { GenreId } from '@/data/enrich/genres'
import { readsByAuthor, readsOfGenre, readsUnrated, type ReadingDay, type StatsRead } from '@/data/stats'
import { moreRows, nextPage, openingRows, ROWS_PAGE } from '@/utils/pageRows'
import { statsSheetReads, statsSheetWithYear } from '@/utils/statsSheet'

/**
 * The Profile's sheets (components/profile/ReadsSheet.vue): the one switch that says what each lists
 * (utils/statsSheet.ts, used by the Profile, a year in review and a member's two pages) and the pages the long ones
 * come in (utils/pageRows.ts). Nothing here needs the stack.
 */
function read(id: string, ended: string | null, over: Partial<StatsRead> & { pages?: number | null; author?: string } = {}): StatsRead {
  const { pages = 300, author, ...rest } = over
  return {
    sessionId: id,
    entryId: id,
    book: { id, title: id, authors: author ? [author] : [], pageCount: pages, coverUrl: null, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as StatsRead['book'] & BookSnapshot,
    startedOn: null,
    endedOn: ended,
    outcome: 'finished',
    rating: null,
    pages,
    days: null,
    nth: 1,
    ...rest,
  }
}
const ids = (reads: readonly StatsRead[]) => reads.map((r) => r.sessionId)

describe('statsSheetReads', () => {
  // Oldest end first, as the record hands them over.
  const reads = [
    read('Old', '2024-12-05', { rating: 16, pages: null }),
    read('March', '2025-03-02', { rating: 20 }),
    read('March again', '2025-03-20', { rating: 16 }),
    read('June', '2025-06-01', { pages: null }),
  ]
  const days: ReadingDay[] = [{ day: '2025-03-02', read: true, pages: 10, reads: [reads[1]!] }]

  it('is empty for no sheet', () => {
    expect(statsSheetReads(null, reads, days)).toEqual([])
  })

  it('lists a month\'s books in the order they ended', () => {
    expect(ids(statsSheetReads({ kind: 'month', year: 2025, month: 3 }, reads))).toEqual(['March', 'March again'])
  })

  it('lists a star row\'s books, a year or all', () => {
    expect(ids(statsSheetReads({ kind: 'stars', year: 'all', star: 4 }, reads))).toEqual(['March again', 'Old'])
    expect(ids(statsSheetReads({ kind: 'stars', year: 2025, star: 5 }, reads))).toEqual(['March'])
  })

  it('lists the reads without a page count', () => {
    expect(ids(statsSheetReads({ kind: 'pagesMissing', year: 2025 }, reads))).toEqual(['June'])
    expect(ids(statsSheetReads({ kind: 'pagesMissing', year: 'all' }, reads))).toEqual(['June', 'Old'])
  })

  it('lists a day\'s reads from the reading days, none on a member\'s page that has no days', () => {
    expect(ids(statsSheetReads({ kind: 'day', day: '2025-03-02' }, reads, days))).toEqual(['March'])
    expect(statsSheetReads({ kind: 'day', day: '2025-03-02' }, reads)).toEqual([])
  })

  it('routes an author\'s, a genre\'s and the unrated sheet to their selector', () => {
    const books = [read('Ada', '2025-03-02', { author: 'Ada Fenn', rating: 16 }), read('Ben', '2025-03-30', { author: 'Ben Yu' })]
    const ofEntry = (entryId: string): readonly GenreId[] | undefined => (entryId === 'Ada' ? ['sci-fi'] : undefined)
    expect(ids(statsSheetReads({ kind: 'author', year: 2025, name: 'Ada Fenn' }, books))).toEqual(['Ada'])
    expect(ids(statsSheetReads({ kind: 'genre', year: 2025, genre: 'sci-fi' }, books, [], ofEntry))).toEqual(['Ada'])
    expect(ids(statsSheetReads({ kind: 'unrated', year: 2025 }, books))).toEqual(['Ben'])
  })
})

/**
 * The books behind one figure (data/stats.ts), each selector the very reads its figure counts: an author's
 * reads of the period, a genre's and the ones not rated yet. The record's order (oldest end first).
 */
describe('readsByAuthor, readsOfGenre and readsUnrated', () => {
  const reads = [
    read('Ada old', '2024-03-02', { author: 'Ada Fenn' }),
    read('Ada', '2025-03-02', { author: 'Ada Fenn', rating: 16 }),
    read('Ada again', '2025-03-20', { author: 'Ada Fenn', rating: 20, nth: 2 }),
    read('Ada abandoned', '2025-04-01', { author: 'Ada Fenn', outcome: 'abandoned', nth: 0 }),
    read('Ben', '2025-04-04', { author: 'Ben Yu' }),
  ]
  // The genres of an entry (the member's, else the computed ones). `Ben`'s are not known (not asked for
  // yet), so it is in no genre's list.
  const genres: Record<string, readonly GenreId[]> = {
    'Ada old': ['sci-fi'],
    Ada: ['sci-fi', 'classics'],
    'Ada again': ['sci-fi'],
    'Ada abandoned': ['sci-fi'],
  }
  const ofEntry = (entryId: string) => genres[entryId]

  it('an author\'s reads of the period: a re-read one read each, an abandoned one never', () => {
    expect(ids(readsByAuthor(reads, 2025, 'Ada Fenn'))).toEqual(['Ada again', 'Ada'])
    expect(ids(readsByAuthor(reads, 'all', 'Ada Fenn'))).toEqual(['Ada again', 'Ada', 'Ada old'])
    expect(ids(readsByAuthor(reads, 2025, 'Nobody'))).toEqual([])
  })

  it('a genre\'s reads of the period: a read whose genres are not known in none, a genre read by nobody empty', () => {
    expect(ids(readsOfGenre(reads, 2025, 'sci-fi', ofEntry))).toEqual(['Ada again', 'Ada'])
    expect(ids(readsOfGenre(reads, 2025, 'classics', ofEntry))).toEqual(['Ada'])
    expect(ids(readsOfGenre(reads, 'all', 'sci-fi', ofEntry))).toEqual(['Ada again', 'Ada', 'Ada old'])
    expect(ids(readsOfGenre(reads, 2025, 'crime', ofEntry))).toEqual([])
  })

  it('the reads not rated yet: what the figure counts, an abandoned one never', () => {
    expect(ids(readsUnrated(reads, 2025))).toEqual(['Ben'])
    expect(ids(readsUnrated(reads, 'all'))).toEqual(['Ben', 'Ada old'])
  })
})

describe('statsSheetWithYear', () => {
  it('names the year on a row only under All', () => {
    expect(statsSheetWithYear({ kind: 'stars', year: 'all', star: 3 })).toBe(true)
    expect(statsSheetWithYear({ kind: 'pagesMissing', year: 'all' })).toBe(true)
    expect(statsSheetWithYear({ kind: 'stars', year: 2025, star: 3 })).toBe(false)
    expect(statsSheetWithYear({ kind: 'month', year: 2025, month: 3 })).toBe(false)
    expect(statsSheetWithYear({ kind: 'day', day: '2025-03-02' })).toBe(false)
    expect(statsSheetWithYear(null)).toBe(false)
    expect(statsSheetWithYear({ kind: 'author', year: 'all', name: 'Ada Fenn' })).toBe(true)
    expect(statsSheetWithYear({ kind: 'genre', year: 'all', genre: 'sci-fi' })).toBe(true)
    expect(statsSheetWithYear({ kind: 'unrated', year: 'all' })).toBe(true)
    expect(statsSheetWithYear({ kind: 'author', year: 2025, name: 'Ada Fenn' })).toBe(false)
  })
})

describe('pages of rows', () => {
  it('opens with a page, 30 rows', () => {
    expect(ROWS_PAGE).toBe(30)
    expect(openingRows(undefined)).toBe(30)
  })

  it('adds a page at a time and stops at the end of the list', () => {
    expect(moreRows(30, 120)).toBe(60)
    expect(moreRows(90, 120)).toBe(120)
    expect(moreRows(120, 120)).toBe(120)
    expect(moreRows(30, 45)).toBe(45)
    expect(moreRows(30, 0)).toBe(0)
  })

  it('says how many the next page adds, none at the end, fewer for a short last page', () => {
    expect(nextPage(30, 120)).toBe(30)
    expect(nextPage(90, 100)).toBe(10)
    expect(nextPage(30, 30)).toBe(0)
    expect(nextPage(30, 12)).toBe(0)
  })

  it('opens again with the count it was left with, in whole pages and never fewer than one', () => {
    expect(openingRows(90)).toBe(90)
    expect(openingRows(100)).toBe(120)
    expect(openingRows(12)).toBe(30)
    expect(openingRows(0)).toBe(30)
    expect(openingRows(Number.NaN)).toBe(30)
  })
})
