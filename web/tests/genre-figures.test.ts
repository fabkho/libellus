import { describe, expect, it } from 'vitest'
import type { Book } from '@/data/books'
import { readDeviceGenres, saveDeviceGenres } from '@/data/enrich/deviceGenres'
import { genreFiguresOf } from '@/data/enrich/genreFigures'
import { GENRE_IDS, type GenreId } from '@/data/enrich/genres'
import type { StatsRead } from '@/data/stats'
import en from '../i18n/locales/en.json' with { type: 'json' }

/**
 * The Profile's figures by genre (issue #168): which finished reads count, how a Book with
 * several genres counts, what the share is of, and the order that never jumps. Pure
 * (data/enrich/genreFigures.ts): no stack involved.
 */

let n = 0
function read(entryId: string, endedOn: string | null, outcome: StatsRead['outcome'] = 'finished'): StatsRead {
  n++
  return {
    sessionId: `s${n}`,
    entryId,
    book: { id: `b-${entryId}`, title: entryId, authors: [] } as unknown as Book,
    startedOn: null,
    endedOn,
    outcome,
    rating: null,
    pages: null,
    days: null,
    nth: outcome === 'finished' ? 1 : 0,
  }
}

const genresOf = (table: Record<string, GenreId[]>) => (entryId: string) => table[entryId]

describe('genreFiguresOf', () => {
  const reads = [
    read('dune', '2025-02-01'),
    read('emma', '2025-03-01'),
    read('hyperion', '2026-01-10'),
    read('piranesi', '2026-04-02'),
    read('unplaced', '2026-05-05'),
    read('dnf', '2026-06-06', 'abandoned'),
    read('undated', null),
  ]
  const table = {
    dune: ['sci-fi', 'fantasy'] as GenreId[],
    emma: ['classics', 'romance'] as GenreId[],
    hyperion: ['sci-fi'] as GenreId[],
    piranesi: ['fantasy', 'literary'] as GenreId[],
    dnf: ['horror'] as GenreId[],
    undated: ['poetry'] as GenreId[],
    unplaced: [] as GenreId[],
  }

  it('counts the finished reads of the year, a Book once in each of its genres', () => {
    const figures = genreFiguresOf(reads, 2026, genresOf(table))
    expect(figures.genres.map((g) => [g.genre, g.count])).toEqual([
      ['sci-fi', 1],
      ['fantasy', 1],
      ['literary', 1],
    ])
    expect(figures.placed).toBe(2)
    expect(figures.without).toBe(1)
  })

  it('takes the share of the reads that have a genre, so a share can stand beside others summing to more than a whole', () => {
    const figures = genreFiguresOf(reads, 2026, genresOf(table))
    expect(figures.genres.find((g) => g.genre === 'sci-fi')!.share).toBe(0.5)
    expect(figures.genres.reduce((sum, g) => sum + g.share, 0)).toBeGreaterThan(1)
  })

  it('counts every year under All, a read without an end date there and in no single year, an abandoned read nowhere', () => {
    const all = genreFiguresOf(reads, 'all', genresOf(table))
    expect(all.genres.map((g) => [g.genre, g.count])).toEqual([
      ['sci-fi', 2],
      ['fantasy', 2],
      ['romance', 1],
      ['literary', 1],
      ['classics', 1],
      ['poetry', 1],
    ])
    expect(all.placed).toBe(5)
    expect(all.genres.some((g) => g.genre === 'horror')).toBe(false)
    expect(genreFiguresOf(reads, 2025, genresOf(table)).placed).toBe(2)
  })

  it('counts a read again as a read, and a genre once per read', () => {
    const again = [read('dune', '2025-02-01'), read('dune', '2026-02-01')]
    const figures = genreFiguresOf(again, 'all', genresOf({ dune: ['sci-fi', 'sci-fi', 'fantasy'] }))
    expect(figures.genres).toEqual([
      { genre: 'sci-fi', count: 2, share: 1 },
      { genre: 'fantasy', count: 2, share: 1 },
    ])
  })

  it('orders a tie by the canonical list, whatever order the reads came in', () => {
    const a = genreFiguresOf([read('x', '2026-01-01'), read('y', '2026-01-02')], 2026, genresOf({ x: ['essays'], y: ['sci-fi'] }))
    const b = genreFiguresOf([read('y', '2026-01-02'), read('x', '2026-01-01')], 2026, genresOf({ x: ['essays'], y: ['sci-fi'] }))
    expect(a.genres.map((g) => g.genre)).toEqual(['sci-fi', 'essays'])
    expect(b.genres.map((g) => g.genre)).toEqual(['sci-fi', 'essays'])
    expect(GENRE_IDS.indexOf('sci-fi')).toBeLessThan(GENRE_IDS.indexOf('essays'))
  })

  it('knows nothing of a read whose genres are not known, and says so', () => {
    const figures = genreFiguresOf(reads, 2026, () => undefined)
    expect(figures).toEqual({ year: 2026, genres: [], placed: 0, without: 3 })
  })
})

describe('the labels', () => {
  it('say every canonical genre, under genre.<id>, once', () => {
    for (const id of GENRE_IDS) expect(typeof (en.genre as Record<string, unknown>)[id], id).toBe('string')
    const labels = GENRE_IDS.map((id) => (en.genre as Record<string, string>)[id])
    expect(new Set(labels).size).toBe(GENRE_IDS.length)
  })
})

describe('the device copy', () => {
  const memory = () => {
    const items = new Map<string, string>()
    return {
      get length() {
        return items.size
      },
      key: (i: number) => [...items.keys()][i] ?? null,
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    }
  }
  const rows = [{ entryId: 'e1', bookId: 'b1', genres: ['sci-fi', 'fantasy'] as GenreId[], overridden: true }]

  it('is read back for the member it was saved for, and for nobody else', () => {
    const storage = memory()
    saveDeviceGenres(storage, 'her', rows)
    expect(readDeviceGenres(storage, 'her')).toEqual(rows)
    expect(readDeviceGenres(storage, 'him')).toBeNull()
  })

  it('keeps out what is not a canonical genre, and survives rubbish', () => {
    const storage = memory()
    storage.setItem('libellus.genres', JSON.stringify({ version: 1, memberId: 'her', entries: [{ entryId: 'e', bookId: 'b', genres: ['sci-fi', 'space-western'], overridden: false }, 7] }))
    expect(readDeviceGenres(storage, 'her')).toEqual([{ entryId: 'e', bookId: 'b', genres: ['sci-fi'], overridden: false }])
    storage.setItem('libellus.genres', '{nope')
    expect(readDeviceGenres(storage, 'her')).toBeNull()
  })
})
