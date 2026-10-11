import { describe, expect, it } from 'vitest'
import {
  COLLECTION_ORDER,
  COLLECTION_SORT_KEY,
  collectionDir,
  readCollectionSort,
  saveCollectionSort,
  sortCollectionEntries,
  type CollectionSort,
} from '@/data/collectionSort'
import type { LibraryEntry } from '@/data/library'

/**
 * Sorting the Books inside one Collection (backlog #9) on plain entries: no database, the Collection is
 * loaded already. A view only, so the input (her saved order) is never touched. The rules are the
 * client's; a native port copies them 1:1.
 */

function entry(id: string, title: string, fields: { authors?: string[]; year?: number | null } = {}): LibraryEntry {
  const { authors = ['Ursula K. Le Guin'], year = 1969 } = fields
  return { id, status: 'want_to_read', addedAt: '2026-01-01T00:00:00Z', book: { id: `b-${id}`, title, authors, year } } as unknown as LibraryEntry
}

// Her saved order: c, a, d, b (not the order of any sort).
const C = entry('c', 'The Dispossessed', { authors: ['Ursula K. Le Guin'], year: 1974 })
const A = entry('a', 'Emma', { authors: ['Jane Austen'], year: 1815 })
const D = entry('d', 'Dune', { authors: ['Frank Herbert'], year: 1965 })
const B = entry('b', 'American Gods', { authors: [], year: null })
const SAVED = [C, A, D, B]
const ADDED = { c: '2026-03-01T10:00:00Z', a: '2026-01-01T10:00:00Z', d: '2026-02-01T10:00:00Z', b: '2026-04-01T10:00:00Z' }

const ids = (list: readonly LibraryEntry[]) => list.map((e) => e.id)
const sort = (key: CollectionSort['key'], dir = collectionDir(key)): CollectionSort => ({ key, dir })

describe('sortCollectionEntries', () => {
  it('keeps her saved order for "order", as a new array', () => {
    const shown = sortCollectionEntries(SAVED, COLLECTION_ORDER, ADDED)
    expect(ids(shown)).toEqual(['c', 'a', 'd', 'b'])
    expect(shown).not.toBe(SAVED)
  })

  it('sorts by title, A to Z, ignoring case and counting digits as numbers', () => {
    expect(ids(sortCollectionEntries(SAVED, sort('title'), ADDED))).toEqual(['b', 'd', 'a', 'c'])
    expect(ids(sortCollectionEntries(SAVED, sort('title', 'desc'), ADDED))).toEqual(['c', 'a', 'd', 'b'])
    const volumes = [entry('x', 'Volume 10'), entry('y', 'volume 2')]
    expect(ids(sortCollectionEntries(volumes, sort('title')))).toEqual(['y', 'x'])
  })

  it('sorts by the first author\'s last name, a Book without an author last whichever way it goes', () => {
    // Austen, (Le) Guin, Herbert (the last word of the name, as the Library sorts), then the one without an author.
    expect(ids(sortCollectionEntries(SAVED, sort('author'), ADDED))).toEqual(['a', 'c', 'd', 'b'])
    expect(ids(sortCollectionEntries(SAVED, sort('author', 'desc'), ADDED))).toEqual(['d', 'c', 'a', 'b'])
  })

  it('sorts by publication year, newest first, a Book without one last whichever way it goes', () => {
    expect(ids(sortCollectionEntries(SAVED, sort('year'), ADDED))).toEqual(['c', 'd', 'a', 'b'])
    expect(ids(sortCollectionEntries(SAVED, sort('year', 'asc'), ADDED))).toEqual(['a', 'd', 'c', 'b'])
  })

  it('sorts by when it was put on this Collection, newest first, instants not strings', () => {
    expect(ids(sortCollectionEntries(SAVED, sort('added'), ADDED))).toEqual(['b', 'c', 'd', 'a'])
    expect(ids(sortCollectionEntries(SAVED, sort('added', 'asc'), ADDED))).toEqual(['a', 'd', 'c', 'b'])
    const offsets = { c: '2026-03-01T12:00:00+02:00', a: '2026-03-01T09:00:00.500000+00:00' }
    expect(ids(sortCollectionEntries([A, C], sort('added'), offsets))).toEqual(['c', 'a'])
  })

  it('puts a Book with no time first-added-unknown last, and falls back to her order without any times', () => {
    expect(ids(sortCollectionEntries(SAVED, sort('added'), { a: ADDED.a }))).toEqual(['a', 'c', 'd', 'b'])
    expect(ids(sortCollectionEntries(SAVED, sort('added')))).toEqual(['c', 'a', 'd', 'b'])
  })

  it('is stable: ties keep her order', () => {
    const same = [entry('1', 'Same', { year: 2000 }), entry('2', 'same', { year: 2000 }), entry('3', 'SAME', { year: 2000 })]
    expect(ids(sortCollectionEntries(same, sort('title')))).toEqual(['1', '2', '3'])
    expect(ids(sortCollectionEntries(same, sort('year')))).toEqual(['1', '2', '3'])
  })

  it('never changes the entries it is given', () => {
    const before = ids(SAVED)
    sortCollectionEntries(SAVED, sort('title'), ADDED)
    expect(ids(SAVED)).toEqual(before)
  })
})

describe('what the device remembers', () => {
  const storage = () => {
    const store = new Map<string, string>()
    return { store, getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) }
  }

  it('is her saved order until a sort is chosen', () => {
    expect(readCollectionSort(storage(), 'ida')).toEqual(COLLECTION_ORDER)
  })

  it('keeps the choice per member, one for every Collection, next to other members\'', () => {
    const device = storage()
    saveCollectionSort(device, 'ida', { key: 'title', dir: 'desc' })
    saveCollectionSort(device, 'ben', { key: 'added', dir: 'asc' })
    expect(readCollectionSort(device, 'ida')).toEqual({ key: 'title', dir: 'desc' })
    expect(readCollectionSort(device, 'ben')).toEqual({ key: 'added', dir: 'asc' })
    expect(readCollectionSort(device, 'cy')).toEqual(COLLECTION_ORDER)
    saveCollectionSort(device, 'ida', COLLECTION_ORDER)
    expect(readCollectionSort(device, 'ida')).toEqual(COLLECTION_ORDER)
    expect(readCollectionSort(device, 'ben')).toEqual({ key: 'added', dir: 'asc' })
  })

  it('reads anything unreadable as her saved order, and never throws', () => {
    const device = storage()
    device.store.set(COLLECTION_SORT_KEY, '{nope')
    expect(readCollectionSort(device, 'ida')).toEqual(COLLECTION_ORDER)
    device.store.set(COLLECTION_SORT_KEY, JSON.stringify({ ida: { key: 'bogus', dir: 'asc' }, ben: { key: 'title', dir: 'up' }, cy: 4, di: null }))
    for (const member of ['ida', 'ben', 'cy', 'di']) expect(readCollectionSort(device, member)).toEqual(COLLECTION_ORDER)
    const refusing = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(() => saveCollectionSort(refusing, 'ida', sort('title'))).not.toThrow()
  })
})
