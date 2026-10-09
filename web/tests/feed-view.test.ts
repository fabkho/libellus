import { describe, expect, it } from 'vitest'
import { DEVICE_FEED_KEY, FEED_PAGE, saveFeed, type FeedEntry } from '@/data/feed'
import {
  appendPage,
  copyTakenAt,
  copyTimeLabel,
  feedBatchKey,
  feedDayLabel,
  feedEmptyState,
  feedVerbKey,
  mergeFirstPage,
  withoutMember,
} from '@/utils/feedView'

/**
 * What the feed page and Home's circle decide before they draw (social v1, U5): the day's words, which
 * empty state, how a refresh joins the pages already loaded, the verbs, the copy's time.
 */

const CARD = { id: 'ada', name: 'Ada', photo: null }
const BOOK = { id: 'b1', title: 'A Book', authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, manual: false }

/** An entry `minutes` after midnight UTC of 2026-10-09, newest = highest. */
function entry(id: string, minutes: number): FeedEntry {
  const at = new Date(Date.UTC(2026, 9, 9, 0, minutes)).toISOString()
  return { id, at, member: CARD, kind: 'finished', again: false, day: null, book: BOOK, rating: null, review: null }
}

/** `count` entries, newest first, ids `<prefix>0…`, the newest `top` minutes in. */
function page(prefix: string, count: number, top: number): FeedEntry[] {
  return Array.from({ length: count }, (_, i) => entry(`${prefix}${i}`, top - i))
}

describe('the day eyebrows', () => {
  const today = '2026-10-09'
  it.each([
    ['2026-10-09', 'today'],
    ['2026-10-08', 'yesterday'],
    ['2026-10-07', 'weekday'],
    ['2026-10-03', 'weekday'],
    ['2026-10-02', 'date'],
    ['2025-10-09', 'date'],
    // A clock that is a day ahead of the member's own: still today, never a negative.
    ['2026-10-10', 'today'],
  ])('%s is %s when today is 9 Oct', (day, expected) => {
    expect(feedDayLabel(day, today)).toBe(expected)
  })

  it('counts calendar days across a change of clocks', () => {
    expect(feedDayLabel('2026-10-24', '2026-10-26')).toBe('weekday')
    expect(feedDayLabel('2026-03-28', '2026-03-29')).toBe('yesterday')
  })
})

describe('the two empty states', () => {
  it('following nobody is the invitation', () => {
    expect(feedEmptyState(0)).toBe('nobody')
  })
  it('following people is the quiet one', () => {
    expect(feedEmptyState(1)).toBe('quiet')
    expect(feedEmptyState(12)).toBe('quiet')
  })
  it('not knowing (offline, or the question failed) is the quiet one, which is true for both', () => {
    expect(feedEmptyState(null)).toBe('quiet')
  })
})

describe('the verbs', () => {
  it('a re-read says "started again", nothing else changes', () => {
    expect(feedVerbKey('started', true)).toBe('startedAgain')
    expect(feedVerbKey('started', false)).toBe('started')
    expect(feedVerbKey('finished', true)).toBe('finished')
    expect(feedVerbKey('abandoned', false)).toBe('abandoned')
    expect(feedVerbKey('want', false)).toBe('want')
    expect(feedVerbKey('reviewed', false)).toBe('reviewed')
  })
  it('every kind has batch wording', () => {
    expect(['started', 'finished', 'abandoned', 'want', 'reviewed'].map((kind) => feedBatchKey(kind as FeedEntry['kind']))).toEqual([
      'batchStarted',
      'batchFinished',
      'batchAbandoned',
      'batchWant',
      'batchReviewed',
    ])
  })
})

describe('a refresh and the pages already loaded', () => {
  it('a short first page is the whole feed: nothing below it is kept', () => {
    const current = [...page('a', 5, 100)]
    const fresh = page('a', 3, 100)
    expect(mergeFirstPage(current, fresh).map((e) => e.id)).toEqual(['a0', 'a1', 'a2'])
  })

  it('a full first page keeps what was loaded below it', () => {
    const first = page('a', FEED_PAGE, 200)
    const second = page('b', 10, 200 - FEED_PAGE)
    const current = [...first, ...second]
    const merged = mergeFirstPage(current, first)
    expect(merged).toHaveLength(FEED_PAGE + 10)
    expect(merged.slice(FEED_PAGE).map((e) => e.id)).toEqual(second.map((e) => e.id))
  })

  it('new entries on top push the old ones down without doubling them', () => {
    const old = page('a', FEED_PAGE, 200)
    const fresh = [entry('n1', 300), entry('n0', 301), ...old.slice(0, FEED_PAGE - 2)].sort((x, y) => y.at.localeCompare(x.at))
    const merged = mergeFirstPage(old, fresh)
    const ids = merged.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    // The two entries the fresh page no longer reaches are older than its last one: they stay below it.
    expect(ids.slice(-2)).toEqual(['a28', 'a29'])
  })

  it('an entry that went (hidden, switched off) within the fresh page goes', () => {
    const first = page('a', FEED_PAGE, 200)
    const gone = first[3]!
    const fresh = [...first.filter((e) => e !== gone), entry('z', 200 - FEED_PAGE)]
    const merged = mergeFirstPage(first, fresh)
    expect(merged.some((e) => e.id === gone.id)).toBe(false)
  })

  it('an empty answer empties the list', () => {
    expect(mergeFirstPage(page('a', 4, 10), [])).toEqual([])
  })

  it('an older page is added after the ones she has, without any she already has', () => {
    const have = page('a', 3, 100)
    const next = [have[2]!, entry('b0', 50)]
    expect(appendPage(have, next).map((e) => e.id)).toEqual(['a0', 'a1', 'a2', 'b0'])
  })
})

describe("when the device's copy was taken", () => {
  const memory = () => {
    const values = new Map<string, string>()
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    }
  }

  it('is the time the copy was saved, for the member it is of', () => {
    const storage = memory()
    const savedAt = new Date('2026-10-09T12:02:00Z')
    saveFeed(storage as never, 'ada', [entry('a', 1)], savedAt)
    expect(copyTakenAt(storage, 'ada')?.toISOString()).toBe(savedAt.toISOString())
    expect(copyTakenAt(storage, 'ben')).toBeNull()
  })

  it('is nothing for no copy, or a torn one', () => {
    const storage = memory()
    expect(copyTakenAt(storage, 'ada')).toBeNull()
    storage.setItem(DEVICE_FEED_KEY, '{"data":')
    expect(copyTakenAt(storage, 'ada')).toBeNull()
    storage.setItem(DEVICE_FEED_KEY, JSON.stringify({ data: { memberId: 'ada', savedAt: 'yesterday-ish' } }))
    expect(copyTakenAt(storage, 'ada')).toBeNull()
  })

  it('reads as the time today, with the weekday before that', () => {
    const now = new Date(2026, 9, 9, 18, 30)
    expect(copyTimeLabel(new Date(2026, 9, 9, 14, 2), now, 'en-GB')).toBe('14:02')
    expect(copyTimeLabel(new Date(2026, 9, 7, 14, 2), now, 'en-GB')).toMatch(/^Wed,? 14:02$/)
  })
})

describe('a member who left her circle', () => {
  it('takes her entries out and keeps everyone else\'s, in order', () => {
    const ida = { id: 'ida', name: 'Ida', photo: null }
    const all = [entry('a', 5), { ...entry('i1', 4), member: ida }, entry('b', 3), { ...entry('i2', 2), member: ida }]
    expect(withoutMember(all, 'ida').map((e) => e.id)).toEqual(['a', 'b'])
    expect(withoutMember(all, 'nobody')).toEqual(all)
  })

  it('does not bring her back when a full first page is joined to the older pages she had', () => {
    const ida = { id: 'ida', name: 'Ida', photo: null }
    const had = [...page('n', FEED_PAGE, 100), { ...entry('old-ida', 10), member: ida }]
    const shown = withoutMember(had, 'ida')
    expect(mergeFirstPage(shown, page('n', FEED_PAGE, 100)).some((e) => e.member.id === 'ida')).toBe(false)
  })
})
