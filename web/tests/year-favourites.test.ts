import { describe, expect, it } from 'vitest'
import type { Book } from '@/data/books'
import { figuresOf, type StatsRead } from '@/data/stats'

/**
 * The Favourites of a year in review: every five-star Book (exactly 5.00; a 4.75 is a four), newest first,
 * and with none the single top-rated read. Pure (data/stats.ts): no stack involved.
 */

let n = 0
function read(title: string, endedOn: string, rating: number | null, bookId = `b-${title}`): StatsRead {
  n++
  return {
    sessionId: `s${n}`,
    entryId: `e-${bookId}`,
    book: { id: bookId, title, authors: [] } as unknown as Book,
    startedOn: null,
    endedOn,
    outcome: 'finished',
    rating,
    pages: null,
    days: null,
    nth: 1,
  }
}

const titles = (reads: readonly StatsRead[]) => reads.map((r) => r.book.title)

describe('figuresOf favourites', () => {
  it('lists every five-star read of the year, newest first, and leaves 4.75 out', () => {
    const reads = [
      read('Dune', '2025-02-01', 20),
      read('Emma', '2025-06-10', 19),
      read('Hyperion', '2025-09-03', 20),
      read('Piranesi', '2025-04-20', 20),
      read('Ulysses', '2025-11-02', 20),
      read('Elsewhere', '2024-12-30', 20),
    ]
    const year = figuresOf(reads, 2025)
    expect(titles(year.favourites)).toEqual(['Ulysses', 'Hyperion', 'Piranesi', 'Dune'])
    expect(year.favourite?.book.title).toBe('Ulysses')
  })

  it('takes a Book once when two of its reads got five stars, by the newest', () => {
    const reads = [read('Piranesi', '2025-01-10', 20, 'p'), read('Dune', '2025-03-01', 20), read('Piranesi', '2025-08-31', 20, 'p')]
    const year = figuresOf(reads, 2025)
    expect(year.favourites.map((r) => [r.book.title, r.endedOn])).toEqual([['Piranesi', '2025-08-31'], ['Dune', '2025-03-01']])
  })

  it('falls back to the top-rated read alone when nothing is five stars', () => {
    const reads = [read('Dune', '2025-02-01', 19), read('Emma', '2025-06-10', 18), read('Hyperion', '2025-09-03', 19)]
    const year = figuresOf(reads, 2025)
    expect(titles(year.favourites)).toEqual(['Hyperion']) // the tie goes to the newest
    expect(year.favourite?.book.title).toBe('Hyperion')
  })

  it('is empty when nothing is rated, and ignores years and unrated reads', () => {
    expect(figuresOf([read('Dune', '2025-02-01', null)], 2025).favourites).toEqual([])
    expect(figuresOf([read('Dune', '2025-02-01', null)], 2025).favourite).toBeNull()
    expect(figuresOf([read('Dune', '2024-02-01', 20)], 2025).favourites).toEqual([])
  })

  it('counts a single five-star read as one, as the favourite was', () => {
    const year = figuresOf([read('Dune', '2025-02-01', 20), read('Emma', '2025-06-10', 19)], 2025)
    expect(titles(year.favourites)).toEqual(['Dune'])
  })
})
