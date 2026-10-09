import { describe, expect, it } from 'vitest'
import { DEVICE_FEED_KEY, FEED_PAGE, feedDays, saveFeed, type FeedEntry } from '@/data/feed'
import {
  appendPage,
  copyTakenAt,
  copyTimeLabel,
  feedBatchKey,
  feedDayLabel,
  feedEmptyState,
  feedVerbKey,
  mergeFirstPage,
  withoutDoubledReviews,
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

  it('keeps older entries only of the people she follows now, when that is known', () => {
    const ida = { id: 'ida', name: 'Ida', photo: null }
    const had = [...page('n', FEED_PAGE, 100), entry('old-ada', 10), { ...entry('old-ida', 9), member: ida }]
    const fresh = page('n', FEED_PAGE, 100)
    expect(mergeFirstPage(had, fresh, new Set(['ada'])).map((e) => e.id).slice(FEED_PAGE)).toEqual(['old-ada'])
    expect(mergeFirstPage(had, fresh, new Set()).length).toBe(FEED_PAGE)
    // Unknown (People not read): nothing is dropped.
    expect(mergeFirstPage(had, fresh, null).map((e) => e.id).slice(FEED_PAGE)).toEqual(['old-ada', 'old-ida'])
    expect(mergeFirstPage(had, fresh).length).toBe(FEED_PAGE + 2)
  })
})

describe('a review that follows its finish', () => {
  const book = (id: string) => ({ ...BOOK, id, title: id })
  const of = (id: string, minutes: number, kind: FeedEntry['kind'], bookId: string, member = CARD): FeedEntry => ({
    ...entry(id, minutes),
    member,
    kind,
    book: book(bookId),
    review: kind === 'finished' || kind === 'reviewed' ? 'Quiet and strange.' : null,
  })
  const day = (entries: FeedEntry[]) => feedDays(withoutDoubledReviews(entries), (at) => at.slice(0, 10))[0]!.rows

  it('shows one row when both the finish and the review are loaded', () => {
    const rows = day([of('r', 20, 'reviewed', 'home'), of('f', 10, 'finished', 'home')])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'entry', entry: { id: 'f', kind: 'finished' } })
  })

  it('keeps a review whose finish is not loaded', () => {
    const rows = day([of('r', 20, 'reviewed', 'home')])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ entry: { id: 'r', kind: 'reviewed' } })
  })

  it("keeps a review of a Book she did not finish here, and another member's review of the same Book", () => {
    const ben = { id: 'ben', name: 'Ben', photo: null }
    const rows = day([of('r1', 40, 'reviewed', 'home', ben), of('r2', 30, 'reviewed', 'other'), of('f', 10, 'finished', 'home')])
    expect(rows.map((row) => row.type === 'entry' && row.entry.id)).toEqual(['r1', 'r2', 'f'])
  })

  it('counts a batch of reviews without the ones whose finish is loaded', () => {
    const reviews = ['a', 'b', 'c', 'd'].map((b, i) => of(`r${b}`, 50 - i, 'reviewed', b))
    // Three of the four reviewed Books are finished too: one review is left, so no batch.
    let rows = day([...reviews, of('fa', 5, 'finished', 'a'), of('fb', 4, 'finished', 'b'), of('fc', 3, 'finished', 'c')])
    expect(rows.filter((row) => row.type === 'batch' && row.kind === 'reviewed')).toHaveLength(0)
    expect(rows.filter((row) => row.type === 'entry' && row.entry.kind === 'reviewed').map((row) => row.type === 'entry' && row.entry.id)).toEqual(['rd'])
    // Only one of the four is: three reviews are left, and they are a batch.
    rows = day([...reviews, of('fa', 5, 'finished', 'a')])
    const batch = rows.find((row) => row.type === 'batch' && row.kind === 'reviewed')
    expect(batch?.type === 'batch' && batch.entries.map((e) => e.id)).toEqual(['rb', 'rc', 'rd'])
  })
})
