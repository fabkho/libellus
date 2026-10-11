import { describe, expect, it } from 'vitest'
import { clearMatches, IMPORT_MATCHES_DAYS, IMPORT_MATCHES_KEY, readMatches, writeMatches, type StoredMatch } from '@/utils/importMatches'

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  }
}

const match = (n: number): StoredMatch => ({
  via: n % 2 ? 'isbn' : 'title',
  book: { title: `Book ${n}`, authors: ['A'], isbn13: `97800000${n}`, description: 'A very long blurb '.repeat(50), coverUrl: 'https://x/c.jpg' },
})

describe('the kept answers of an import lookup', () => {
  it('give back what was kept for the member, without the long description', () => {
    const storage = memory()
    writeMatches(storage, 'm1', new Map([['goodreads:1', match(1)], ['goodreads:2', match(2)]]), 1000)
    const read = readMatches(storage, 'm1', 2000)
    expect([...read.keys()]).toEqual(['goodreads:1', 'goodreads:2'])
    expect(read.get('goodreads:1')).toMatchObject({ via: 'isbn', book: { title: 'Book 1', description: null, coverUrl: 'https://x/c.jpg' } })
  })

  it('are the member\'s own, and expire after a week', () => {
    const storage = memory()
    writeMatches(storage, 'm1', new Map([['goodreads:1', match(1)]]), 0)
    expect(readMatches(storage, 'm2', 1).size).toBe(0)
    expect(readMatches(storage, 'm1', (IMPORT_MATCHES_DAYS - 1) * 86_400_000).size).toBe(1)
    expect(readMatches(storage, 'm1', (IMPORT_MATCHES_DAYS + 1) * 86_400_000).size).toBe(0)
  })

  it('shrug off anything unreadable and storage that refuses', () => {
    const storage = memory()
    storage.data.set(IMPORT_MATCHES_KEY, '{not json')
    expect(readMatches(storage, 'm1').size).toBe(0)
    storage.data.set(IMPORT_MATCHES_KEY, JSON.stringify({ member: 'm1', at: Date.now(), rows: { 'goodreads:1': { via: 'nonsense', book: {} }, 'goodreads:2': match(2) } }))
    expect([...readMatches(storage, 'm1').keys()]).toEqual(['goodreads:2'])
    const full = { setItem: () => { throw new Error('quota') }, removeItem: () => {} }
    expect(() => writeMatches(full, 'm1', new Map([['goodreads:1', match(1)]]))).not.toThrow()
  })

  it('can be cleared', () => {
    const storage = memory()
    writeMatches(storage, 'm1', new Map([['goodreads:1', match(1)]]))
    clearMatches(storage)
    expect(readMatches(storage, 'm1').size).toBe(0)
  })
})
