// Pick my next book (issue #259, prototype): the draw, the candidate list, the rounds and Accept.
// Pure functions (app/data/pick.ts); no stack needed.
import { describe, expect, it } from 'vitest'
import type { Book, BookSnapshot } from '@/data/books'
import type { LibraryEntry } from '@/data/library'
import {
  acceptAction,
  addCandidate,
  canPick,
  candidateOfEntry,
  candidateOfHit,
  declineRound,
  drawWinner,
  firstRound,
  othersOf,
  PICK_MAX,
  randomIndex,
  removeCandidate,
  toggleCandidate,
  variantFromParam,
  winnerOf,
  type PickCandidate,
  type RandomSource,
} from '@/data/pick'

const snapshot = (title: string, appleId: string): BookSnapshot => ({
  title,
  authors: ['Ada Example'],
  isbn13: null,
  isbn10: null,
  pageCount: 300,
  year: 2020,
  language: 'en',
  publisher: null,
  description: null,
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple',
  appleId,
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})
const book = (id: string): Book => ({ ...snapshot(`Book ${id}`, `a${id}`), id, createdAt: '2026-01-01T00:00:00Z' })
const entry = (id: string, status: LibraryEntry['status'] = 'want_to_read'): LibraryEntry => ({
  id: `entry-${id}`,
  status,
  addedAt: '2026-01-01T00:00:00Z',
  book: book(id),
  pageCountOverride: null,
  latestSession: null,
})
const candidates = (n: number): PickCandidate[] => Array.from({ length: n }, (_, i) => candidateOfEntry(entry(String(i))))

/** A seeded xorshift source, so a failing run can be repeated. */
function seeded(seed: number): RandomSource {
  let x = seed >>> 0 || 1
  return (into) => {
    for (let i = 0; i < into.length; i++) {
      x ^= x << 13
      x >>>= 0
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      into[i] = x
    }
    return into
  }
}
/** A source that hands out these values, in turn. */
const scripted = (values: number[]): RandomSource => {
  let at = 0
  return (into) => {
    for (let i = 0; i < into.length; i++) into[i] = values[at++ % values.length]!
    return into
  }
}

/** Pearson's chi-square of counts against a uniform expectation. */
function chiSquare(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0)
  const expected = total / counts.length
  return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0)
}

describe('the draw', () => {
  it('is uniform: 60,000 draws among 5 pass a chi-square test (df 4, p 0.001: 18.47)', () => {
    const random = seeded(259)
    const counts = [0, 0, 0, 0, 0]
    for (let i = 0; i < 60_000; i++) counts[randomIndex(5, random)]!++
    expect(chiSquare(counts)).toBeLessThan(18.47)
  })

  it('is uniform with crypto.getRandomValues too (12 candidates, df 11, p 0.001: 31.26)', () => {
    const counts = Array.from({ length: 12 }, () => 0)
    for (let i = 0; i < 48_000; i++) counts[randomIndex(12)]!++
    expect(chiSquare(counts)).toBeLessThan(31.26)
  })

  it('has no modulo bias: a value past the last whole multiple of n is drawn again', () => {
    // 2^32 % 3 === 1: 4294967295 is the one value that would favour index 0. It is skipped.
    expect(randomIndex(3, scripted([4294967295, 7]))).toBe(7 % 3)
  })

  it('never picks the Book picked last time, unless it is the only one', () => {
    const list = candidates(4)
    const random = seeded(7)
    for (let i = 0; i < 2000; i++) expect(list[drawWinner(list, list[2]!.key, random)]!.key).not.toBe(list[2]!.key)
    const one = candidates(1)
    expect(drawWinner(one, one[0]!.key, random)).toBe(0)
  })

  it('stays uniform among the others when one is left out (4 of 5, df 3, p 0.001: 16.27)', () => {
    const list = candidates(5)
    const random = seeded(11)
    const counts = [0, 0, 0, 0, 0]
    for (let i = 0; i < 40_000; i++) counts[drawWinner(list, list[0]!.key, random)]!++
    expect(counts[0]).toBe(0)
    expect(chiSquare(counts.slice(1))).toBeLessThan(16.27)
  })

  it('refuses an empty list', () => {
    expect(() => drawWinner([], null)).toThrow()
    expect(() => randomIndex(0)).toThrow()
  })
})

describe('the candidate list', () => {
  it('a tap selects a Book and another tap removes it', () => {
    const [a, b] = candidates(2)
    let list = toggleCandidate([], a!).candidates
    list = toggleCandidate(list, b!).candidates
    expect(list.map((c) => c.key)).toEqual([a!.key, b!.key])
    expect(toggleCandidate(list, a!).candidates.map((c) => c.key)).toEqual([b!.key])
  })

  it('takes each Book once', () => {
    const [a] = candidates(1)
    expect(addCandidate([a!], a!).candidates).toHaveLength(1)
  })

  it('stops at the most it deals, and says so', () => {
    const list = candidates(PICK_MAX)
    const extra = candidateOfEntry(entry('extra'))
    const change = addCandidate(list, extra)
    expect(change.refused).toBe('full')
    expect(change.candidates).toHaveLength(PICK_MAX)
  })

  it('can pick from two up to the most', () => {
    expect(canPick(candidates(1))).toBe(false)
    expect(canPick(candidates(2))).toBe(true)
    expect(canPick(candidates(PICK_MAX))).toBe(true)
  })

  it('a candidate is removed by its key', () => {
    const list = candidates(3)
    expect(removeCandidate(list, list[1]!.key).map((c) => c.key)).toEqual([list[0]!.key, list[2]!.key])
  })

  it('a search result joins as a snapshot, an entry on Want to read as that entry, a Book read or being read not at all', () => {
    const fresh = snapshot('Piranesi', '123')
    expect(candidateOfHit({ key: 'apple-123', book: fresh, entry: null })).toEqual({ kind: 'search', key: 'apple-123', book: fresh })
    const want = entry('w')
    expect(candidateOfHit({ key: want.book.id, book: want.book, entry: want })).toEqual(candidateOfEntry(want))
    const reading = entry('r', 'reading')
    expect(candidateOfHit({ key: reading.book.id, book: reading.book, entry: reading })).toBeNull()
    const finished = entry('f', 'finished')
    expect(candidateOfHit({ key: finished.book.id, book: finished.book, entry: finished })).toBeNull()
  })

  it('a search result and Want to read entries mix in one list', () => {
    const fromSearch = candidateOfHit({ key: 'apple-9', book: snapshot('Elsewhere', '9'), entry: null })!
    const list = addCandidate(candidates(2), fromSearch).candidates
    expect(list.map((c) => c.kind)).toEqual(['entry', 'entry', 'search'])
  })
})

describe('the rounds', () => {
  it('the first round draws among all of them', () => {
    const round = firstRound(candidates(5), null, scripted([3]))
    expect(round).toMatchObject({ number: 1, winner: 3, alone: false })
    expect(othersOf(round)).toHaveLength(4)
    expect(othersOf(round).map((c) => c.key)).not.toContain(winnerOf(round).key)
  })

  it('Decline drops the shown Book and draws again among the rest', () => {
    const random = seeded(3)
    const first = firstRound(candidates(5), null, random)
    const declined = winnerOf(first).key
    const second = declineRound(first, random)!
    expect(second.number).toBe(2)
    expect(second.candidates).toHaveLength(4)
    expect(second.candidates.map((c) => c.key)).not.toContain(declined)
  })

  it('the last one left is picked without a draw, and none left is the end', () => {
    const random = seeded(5)
    let round = firstRound(candidates(3), null, random)
    round = declineRound(round, random)!
    expect(round.alone).toBe(false)
    round = declineRound(round, random)!
    expect(round).toMatchObject({ number: 3, alone: true, winner: 0 })
    expect(declineRound(round, random)).toBeNull()
  })

  it('a new pick over the same Books does not open with the Book picked last time', () => {
    const list = candidates(3)
    for (let seed = 1; seed < 300; seed++) expect(winnerOf(firstRound(list, list[1]!.key, seeded(seed))).key).not.toBe(list[1]!.key)
  })
})

describe('Accept', () => {
  it('starts an entry on Want to read', () => {
    expect(acceptAction(candidateOfEntry(entry('7')))).toEqual({ kind: 'start', entryId: 'entry-7' })
  })

  it('adds a search result as Currently reading', () => {
    const fresh = snapshot('Piranesi', '123')
    expect(acceptAction({ kind: 'search', key: 'apple-123', book: fresh })).toEqual({ kind: 'add', book: fresh, status: 'reading' })
  })
})

describe('the variant switch', () => {
  it('reads a, b, c and the names', () => {
    expect(variantFromParam('a')).toBe('deck')
    expect(variantFromParam('B')).toBe('stack')
    expect(variantFromParam(['c'])).toBe('wheel')
    expect(variantFromParam('wheel')).toBe('wheel')
    expect(variantFromParam('x')).toBeNull()
    expect(variantFromParam(undefined)).toBeNull()
  })
})
