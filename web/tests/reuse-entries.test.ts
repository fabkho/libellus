import { describe, expect, it } from 'vitest'
import { reuseEntries, sameData } from '@/data/reuseEntries'

const entry = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'want_to_read',
  book: { id: `book-${id}`, title, authors: ['A. Writer'], goodreads: null },
  latestSession: null,
  ...extra,
})

describe('sameData', () => {
  it('compares JSON-shaped values field by field', () => {
    expect(sameData(entry('1', 'One'), entry('1', 'One'))).toBe(true)
    expect(sameData(entry('1', 'One'), entry('1', 'Two'))).toBe(false)
    expect(sameData({ authors: ['a', 'b'] }, { authors: ['a'] })).toBe(false)
    expect(sameData({ a: null }, { a: undefined })).toBe(false)
    expect(sameData([], {})).toBe(false)
  })

  it('counts an undefined field as absent, as the device copy (JSON) drops it', () => {
    expect(sameData({ a: 1, readAs: undefined }, { a: 1 })).toBe(true)
    expect(sameData({ a: 1 }, { a: 1, readAs: undefined })).toBe(true)
  })
})

describe('reuseEntries', () => {
  it('keeps the held list when a refresh brings back the same entries', () => {
    const held = [entry('1', 'One'), entry('2', 'Two')]
    const next = [entry('1', 'One'), entry('2', 'Two')]
    expect(reuseEntries(held, next)).toBe(held)
  })

  it('keeps the unchanged entries and takes the changed one', () => {
    const held = [entry('1', 'One'), entry('2', 'Two'), entry('3', 'Three')]
    const changed = entry('2', 'Two, revised')
    const result = reuseEntries(held, [entry('1', 'One'), changed, entry('3', 'Three')])
    expect(result).not.toBe(held)
    expect(result[0]).toBe(held[0])
    expect(result[1]).toBe(changed)
    expect(result[2]).toBe(held[2])
  })

  it('follows the new order, a new entry and one that left', () => {
    const held = [entry('1', 'One'), entry('2', 'Two')]
    const added = entry('3', 'Three')
    const result = reuseEntries(held, [added, entry('2', 'Two')])
    expect(result).toEqual([added, held[1]])
    expect(result[1]).toBe(held[1])

    const reordered = reuseEntries(held, [entry('2', 'Two'), entry('1', 'One')])
    expect(reordered).not.toBe(held)
    expect(reordered).toEqual([held[1], held[0]])
    expect(reordered[0]).toBe(held[1])
  })
})
