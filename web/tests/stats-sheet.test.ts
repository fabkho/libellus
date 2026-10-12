import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import type { ReadingDay, StatsRead } from '@/data/stats'
import { moreRows, nextPage, openingRows, ROWS_PAGE } from '@/utils/pageRows'
import { statsSheetReads, statsSheetWithYear } from '@/utils/statsSheet'

/**
 * The Profile's sheets (components/profile/ReadsSheet.vue): the one switch that says what each lists
 * (utils/statsSheet.ts, used by the Profile, a year in review and a member's two pages) and the pages the long ones
 * come in (utils/pageRows.ts). Nothing here needs the stack.
 */
function read(id: string, ended: string | null, over: Partial<StatsRead> & { pages?: number | null } = {}): StatsRead {
  const { pages = 300, ...rest } = over
  return {
    sessionId: id,
    entryId: id,
    book: { id, title: id, authors: [], pageCount: pages, coverUrl: null, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as StatsRead['book'] & BookSnapshot,
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
})

describe('statsSheetWithYear', () => {
  it('names the year on a row only under All', () => {
    expect(statsSheetWithYear({ kind: 'stars', year: 'all', star: 3 })).toBe(true)
    expect(statsSheetWithYear({ kind: 'pagesMissing', year: 'all' })).toBe(true)
    expect(statsSheetWithYear({ kind: 'stars', year: 2025, star: 3 })).toBe(false)
    expect(statsSheetWithYear({ kind: 'month', year: 2025, month: 3 })).toBe(false)
    expect(statsSheetWithYear({ kind: 'day', day: '2025-03-02' })).toBe(false)
    expect(statsSheetWithYear(null)).toBe(false)
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
