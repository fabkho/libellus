import { describe, expect, it } from 'vitest'
import { bookPageKey, bookPageOf, followEdition } from '../app/utils/bookPageKey'

/**
 * Which book page an address shows (utils/bookPageKey.ts): a page that
 * followed its entry to another edition stays the same page under the new
 * address, so the change animates instead of drawing a new page (#61).
 */

describe('bookPageKey', () => {
  it('is the address of a page that never changed edition', () => {
    expect(bookPageKey({ params: { key: 'untouched' } })).toBe('/book/untouched')
    expect(bookPageOf('apple-123')).toBe('apple-123')
  })

  it('keeps the first page through every change of edition, and back', () => {
    followEdition('first', 'second')
    expect(bookPageKey({ params: { key: 'second' } })).toBe('/book/first')
    followEdition('second', 'third')
    expect(bookPageOf('third')).toBe('first')
    followEdition('third', 'first')
    expect(bookPageOf('first')).toBe('first')
  })

  it('ignores a change to the same Book', () => {
    followEdition('same', 'same')
    expect(bookPageOf('same')).toBe('same')
  })
})
