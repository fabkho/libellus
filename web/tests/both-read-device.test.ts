import { describe, expect, it } from 'vitest'
import {
  BOTH_READ_BOOKS,
  BOTH_READ_FRIENDS,
  BOTH_READ_KEEP_DAYS,
  DEVICE_BOTH_READ_KEY,
  bothReadOf,
  forgetBothRead,
  readBothRead,
  sameBothRead,
  saveBothRead,
} from '../app/data/bothReadDevice'
import type { DeviceStorage } from '../app/data/localData'
import type { BothRead } from '../app/data/socialShapes'

/** The device's copy of "You both read": a whitelist, one member's, bounded, never stale, never foreign. */

function memory(): DeviceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const read = (n: number, extra: Record<string, unknown> = {}): BothRead =>
  ({
    book: { id: `b${n}`, title: `T${n}`, authors: ['A'], year: 2020, coverUrl: `https://is1-ssl.mzstatic.com/${n}.jpg`, coverThumbhash: 'th', coverColors: { dominant: '#aaaaaa', secondary: '#bbbbbb' }, manual: false, unverified: false, ...extra },
    mine: { rating: 16, endedOn: '2025-01-02' },
    hers: { rating: null, endedOn: '2025-01-01' },
    ...extra,
  }) as BothRead

const NOW = new Date('2026-10-20T10:00:00Z')

describe('the device copy of You both read', () => {
  it('keeps an answer for the member who saved it and gives it back equal', () => {
    const storage = memory()
    const items = [read(1), read(2)]
    expect(saveBothRead(storage, 'ada', 'ida', items, NOW)).toBe(true)
    expect(readBothRead(storage, 'ada', 'ida', NOW)).toEqual(items)
    expect(readBothRead(storage, 'ada', 'someone-else', NOW)).toBeNull()
  })

  it('is never another member\'s (signing in as someone else reads none, and her save replaces the old)', () => {
    const storage = memory()
    saveBothRead(storage, 'ada', 'ida', [read(1)], NOW)
    expect(readBothRead(storage, 'bea', 'ida', NOW)).toBeNull()
    saveBothRead(storage, 'bea', 'ida', [read(2)], NOW)
    expect(readBothRead(storage, 'ada', 'ida', NOW)).toBeNull()
    expect(readBothRead(storage, 'bea', 'ida', NOW)?.[0]?.book.id).toBe('b2')
  })

  it('writes the whitelisted keys only: nothing else of an answer reaches the device', () => {
    const storage = memory()
    saveBothRead(storage, 'ada', 'ida', [read(1, { review: 'a secret review', email: 'ida@example.com', pages: 300 })], NOW)
    const raw = storage.getItem(DEVICE_BOTH_READ_KEY)!
    expect(raw).not.toMatch(/secret|example\.com|pages|review|email/)
    const [item] = readBothRead(storage, 'ada', 'ida', NOW)!
    expect(Object.keys(item!).sort()).toEqual(['book', 'hers', 'mine'])
    expect(Object.keys(item!.book).sort()).toEqual(['authors', 'coverColors', 'coverThumbhash', 'coverUrl', 'id', 'manual', 'title', 'unverified', 'year'])
    expect(Object.keys(item!.mine).sort()).toEqual(['endedOn', 'rating'])
  })

  it('is ignored when old, of another version, torn or foreign', () => {
    const storage = memory()
    saveBothRead(storage, 'ada', 'ida', [read(1)], NOW)
    const later = new Date(NOW.getTime() + (BOTH_READ_KEEP_DAYS + 1) * 86_400_000)
    expect(readBothRead(storage, 'ada', 'ida', later)).toBeNull()
    storage.setItem(DEVICE_BOTH_READ_KEY, '{"version":0,"data":{}}')
    expect(readBothRead(storage, 'ada', 'ida', NOW)).toBeNull()
    storage.setItem(DEVICE_BOTH_READ_KEY, '{torn')
    expect(readBothRead(storage, 'ada', 'ida', NOW)).toBeNull()
    storage.setItem(DEVICE_BOTH_READ_KEY, JSON.stringify({ version: 1, data: { memberId: 'ada', friends: { ida: { savedAt: NOW.toISOString(), items: [{ nothing: true }] } } } }))
    expect(readBothRead(storage, 'ada', 'ida', NOW)).toBeNull()
  })

  it('is bounded: the least recently saved friends go, a longer answer keeps its newest Books', () => {
    const storage = memory()
    for (let i = 0; i < BOTH_READ_FRIENDS + 2; i++) saveBothRead(storage, 'ada', `f${i}`, [read(i)], new Date(NOW.getTime() + i * 1000))
    expect(readBothRead(storage, 'ada', 'f0', NOW)).toBeNull()
    expect(readBothRead(storage, 'ada', 'f1', NOW)).toBeNull()
    expect(readBothRead(storage, 'ada', `f${BOTH_READ_FRIENDS + 1}`, NOW)).not.toBeNull()
    saveBothRead(storage, 'ada', 'big', Array.from({ length: BOTH_READ_BOOKS + 50 }, (_, i) => read(i)), new Date(NOW.getTime() + 60_000))
    const big = readBothRead(storage, 'ada', 'big', NOW)!
    expect(big).toHaveLength(BOTH_READ_BOOKS)
    expect(big[0]!.book.id).toBe('b0')
  })

  it('goes when asked (her section went off), and an empty answer keeps nothing', () => {
    const storage = memory()
    saveBothRead(storage, 'ada', 'ida', [read(1)], NOW)
    forgetBothRead(storage, 'ada', 'ida')
    expect(readBothRead(storage, 'ada', 'ida', NOW)).toBeNull()
    expect(storage.getItem(DEVICE_BOTH_READ_KEY)).toBeNull()
    saveBothRead(storage, 'ada', 'ida', [], NOW)
    expect(storage.getItem(DEVICE_BOTH_READ_KEY)).toBeNull()
  })

  it('removes the copy when the storage is full (an older one would be wrong) and survives a storage that throws', () => {
    const storage = memory()
    saveBothRead(storage, 'ada', 'ida', [read(1)], NOW)
    storage.setItem = () => {
      throw new Error('quota')
    }
    expect(saveBothRead(storage, 'ada', 'ida', [read(2)], NOW)).toBe(false)
    expect(readBothRead(storage, 'ada', 'ida', NOW)).toBeNull()
    expect(() => readBothRead({ ...storage, getItem: () => { throw new Error('off') } }, 'ada', 'ida', NOW)).not.toThrow()
  })

  it('writes nothing for an answer equal to the copy, renews its age after a day, and writes a change at once', () => {
    const storage = memory()
    let writes = 0
    const set = storage.setItem
    storage.setItem = (key, value) => {
      writes++
      set(key, value)
    }
    saveBothRead(storage, 'ada', 'ida', [read(1)], NOW)
    expect(writes).toBe(1)
    saveBothRead(storage, 'ada', 'ida', [read(1)], new Date(NOW.getTime() + 3_600_000))
    expect(writes, 'equal and fresh: untouched').toBe(1)
    saveBothRead(storage, 'ada', 'ida', [read(1)], new Date(NOW.getTime() + 25 * 3_600_000))
    expect(writes, 'equal, a day old: the age is renewed').toBe(2)
    saveBothRead(storage, 'ada', 'ida', [read(2)], new Date(NOW.getTime() + 25 * 3_600_000 + 1000))
    expect(writes, 'changed: written').toBe(3)
    expect(readBothRead(storage, 'ada', 'ida', NOW)?.[0]?.book.id).toBe('b2')
  })

  it('knows two answers are the same (a fresh answer equal to the copy changes nothing)', () => {
    expect(sameBothRead([read(1), read(2)], [read(1), read(2)])).toBe(true)
    expect(sameBothRead([read(1)], [read(2)])).toBe(false)
    expect(sameBothRead([read(1)], [{ ...read(1), mine: { rating: 12, endedOn: '2025-01-02' } }])).toBe(false)
    expect(bothReadOf({ book: { id: 1 } })).toBeNull()
  })
})
