import { describe, expect, it } from 'vitest'
import { figuresOf, type StatsRead } from '@/data/stats'
import { pagesFigure } from '@/utils/pagesFigure'

/** The Pages figure of a year: never "0 pages" (an Apple Books import has no page count), and honest about the Books without one. */

const read = (id: string, pages: number | null): StatsRead =>
  ({ id, book: { id, title: id, authors: [], coverUrl: null, coverThumbhash: null, coverColors: null }, pages, outcome: 'finished', endedOn: '2026-03-01', startedOn: '2026-02-01', rating: null, rereads: 0 }) as unknown as StatsRead

describe('the Pages figure', () => {
  it('is left out (null) when no Book of the year has a page count, and says how many have none', () => {
    const f = pagesFigure(figuresOf([read('a', null), read('b', null)], 2026))
    expect(f).toEqual({ value: null, missing: 2, perBook: null })
  })

  it('sums the known counts when some are missing, and gives no pages-a-book then', () => {
    const f = pagesFigure(figuresOf([read('a', 300), read('b', null), read('c', 200)], 2026))
    expect(f).toEqual({ value: 500, missing: 1, perBook: null })
  })

  it('gives the pages a book when every Book has a count', () => {
    const f = pagesFigure(figuresOf([read('a', 300), read('b', 200)], 2026))
    expect(f).toEqual({ value: 500, missing: 0, perBook: 250 })
  })

  it('is null for a year with nothing finished, with no pages a book', () => {
    expect(pagesFigure({ books: 0, pages: 0, pagesMissing: 0 })).toEqual({ value: null, missing: 0, perBook: null })
  })
})
