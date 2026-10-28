import { describe, expect, it } from 'vitest'
import type { BothRead, SocialBook } from '@/data/socialShapes'
import { sharedFiguresOf } from '@/utils/sharedFigures'

/** The Shared figures line (plan E 1–3): counts and figures from the both_read answer only. Pure. */

function book(id: string, title = `Book ${id}`): SocialBook {
  return {
    id,
    title,
    authors: ['A'],
    year: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    manual: false,
    unverified: false,
  } as unknown as SocialBook
}

function both(id: string, mine: [number | null, string | null], hers: [number | null, string | null], title?: string): BothRead {
  return {
    book: book(id, title),
    mine: { rating: mine[0], endedOn: mine[1] },
    hers: { rating: hers[0], endedOn: hers[1] },
  }
}

describe('sharedFiguresOf', () => {
  it('empty answer: no count weight, no figures', () => {
    expect(sharedFiguresOf([])).toEqual({ count: 0, agreement: null, disagreement: null, firstCount: null })
  })

  it('count is the number of shared Books', () => {
    const items = [both('1', [null, null], [null, null]), both('2', [null, null], [null, null])]
    expect(sharedFiguresOf(items).count).toBe(2)
  })

  it('agreement: within half a star, inclusive (2 quarters), of the Books both rated', () => {
    const items = [
      both('1', [16, null], [14, null]), // 0.5 apart: agree
      both('2', [12, null], [16, null]), // 1 apart: no
      both('3', [8, null], [10, null]), // 0.5 apart: agree
      both('4', [null, null], [4, null]), // hers only: not counted
      both('5', [4, null], [null, null]), // mine only: not counted
    ]
    expect(sharedFiguresOf(items).agreement).toEqual({ agree: 2, of: 3 })
  })

  it('agreement is null when her Ratings are off', () => {
    const items = [both('1', [16, null], [null, null]), both('2', [12, null], [null, null])]
    expect(sharedFiguresOf(items).agreement).toBeNull()
  })

  it('disagreement: the widest gap, only above half a star', () => {
    const items = [
      both('1', [18, null], [8, null], 'Copper Island'), // 2.5 stars apart
      both('2', [12, null], [4, null], 'Other'), // 2 stars apart
    ]
    const out = sharedFiguresOf(items).disagreement
    expect(out?.book.id).toBe('1')
    expect(out?.book.title).toBe('Copper Island')
    expect(out?.hers).toBe(8)
    expect(out?.mine).toBe(18)
  })

  it('no disagreement when every gap is within half a star', () => {
    const items = [both('1', [16, null], [14, null]), both('2', [10, null], [10, null])]
    expect(sharedFiguresOf(items).disagreement).toBeNull()
  })

  it('disagreement ties go to the first Book in the answer', () => {
    const items = [both('1', [20, null], [12, null]), both('2', [4, null], [12, null])]
    expect(sharedFiguresOf(items).disagreement?.book.id).toBe('1')
  })

  it('firstCount: Books she ended strictly before you', () => {
    const items = [
      both('1', [null, '2024-03-01'], [null, '2024-02-01']), // she first
      both('2', [null, '2024-02-01'], [null, '2024-03-01']), // you first
      both('3', [null, '2024-02-01'], [null, '2024-02-01']), // same day: not first
      both('4', [null, null], [null, '2024-01-01']), // your day unknown: not counted
    ]
    expect(sharedFiguresOf(items).firstCount).toBe(1)
  })

  it('firstCount is null when no pair has both days, 0 when none was first', () => {
    expect(sharedFiguresOf([both('1', [null, null], [null, '2024-01-01'])]).firstCount).toBeNull()
    expect(sharedFiguresOf([both('1', [null, '2024-01-01'], [null, '2024-02-01'])]).firstCount).toBe(0)
  })
})
