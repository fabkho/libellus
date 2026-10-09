import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import {
  BATCH_FROM,
  createFeed,
  DEVICE_FEED_KEY,
  FEED_KEEP_DAYS,
  FEED_PAGE,
  feedDays,
  readFeed,
  saveFeed,
  type FeedEntry,
  type FeedKind,
} from '@/data/feed'
import { createLibrary } from '@/data/library'
import { isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { newClient, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The feed's repository (social v1, W2): the pure folding of entries into days and batches, the
 * device's copy, and `page()` against the social stack (what Ben sees of Ada).
 * The rules of who sees what are the database's (supabase/tests/social_readers_test.sql).
 */

const ADA = { id: 'ada', name: 'Ada', photo: null }
const BEN = { id: 'ben', name: 'Ben', photo: null }
const BOOK = {
  id: 'b1',
  title: 'A Book',
  authors: [],
  year: null,
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  manual: false,
}

let counter = 0
/** An entry `minutes` after midnight UTC of `day`. */
function entry(day: string, minutes: number, member = ADA, kind: FeedKind = 'finished'): FeedEntry {
  counter += 1
  return {
    id: `e${counter}`,
    at: new Date(Date.parse(`${day}T00:00:00Z`) + minutes * 60_000).toISOString(),
    member,
    kind,
    again: false,
    day,
    book: { ...BOOK, id: `b${counter}` },
    rating: null,
    review: null,
    spoilers: false,
    folded: false,
    sessionId: null,
    likes: 0,
    liked: false,
  }
}
/** Newest first, as `feed` answers. */
const newestFirst = (entries: FeedEntry[]) => [...entries].sort((a, b) => (a.at < b.at ? 1 : -1))
const utcDay = (at: string) => at.slice(0, 10)
const ids = (entries: FeedEntry[]) => entries.map((e) => e.id)

describe('feedDays', () => {
  it('has no days for no entries', () => {
    expect(feedDays([], utcDay)).toEqual([])
  })

  it('splits entries into days, newest day first, entries in their order', () => {
    const a = entry('2026-10-10', 600)
    const b = entry('2026-10-10', 300, BEN, 'started')
    const c = entry('2026-10-09', 900)
    const days = feedDays(newestFirst([c, b, a]), utcDay)
    expect(days.map((d) => d.day)).toEqual(['2026-10-10', '2026-10-09'])
    expect(days[0]!.rows).toEqual([
      { type: 'entry', entry: a },
      { type: 'entry', entry: b },
    ])
    expect(days[1]!.rows).toEqual([{ type: 'entry', entry: c }])
  })

  it("uses the day the caller's function gives, not the UTC one", () => {
    const late = entry('2026-10-10', 23 * 60 + 30)
    const early = entry('2026-10-11', 30)
    const plusTwo = (at: string) => new Date(Date.parse(at) + 2 * 3_600_000).toISOString().slice(0, 10)
    expect(feedDays(newestFirst([late, early]), plusTwo).map((d) => d.day)).toEqual(['2026-10-11'])
    expect(feedDays(newestFirst([late, early]), utcDay).map((d) => d.day)).toEqual(['2026-10-11', '2026-10-10'])
  })

  it('folds three finishes of one member on one day into one batch where the newest was', () => {
    const first = entry('2026-10-10', 100)
    const second = entry('2026-10-10', 200)
    const third = entry('2026-10-10', 300)
    const [day] = feedDays(newestFirst([first, second, third]), utcDay)
    expect(day!.rows).toHaveLength(1)
    expect(day!.rows[0]).toEqual({
      type: 'batch',
      member: ADA,
      kind: 'finished',
      day: '2026-10-10',
      entries: [third, second, first],
    })
    expect(BATCH_FROM).toBe(3)
  })

  it('does not fold two', () => {
    const rows = feedDays(newestFirst([entry('2026-10-10', 100), entry('2026-10-10', 200)]), utcDay)[0]!.rows
    expect(rows.map((r) => r.type)).toEqual(['entry', 'entry'])
  })

  it("does not let another member's or another kind's entry in between break or join a batch", () => {
    const f1 = entry('2026-10-10', 100)
    const bens = entry('2026-10-10', 200, BEN)
    const f2 = entry('2026-10-10', 300)
    const started = entry('2026-10-10', 400, ADA, 'started')
    const f3 = entry('2026-10-10', 500)
    const rows = feedDays(newestFirst([f1, bens, f2, started, f3]), utcDay)[0]!.rows
    expect(rows.map((r) => r.type)).toEqual(['batch', 'entry', 'entry'])
    const [batch, between, bensRow] = rows
    expect(batch).toMatchObject({ type: 'batch', kind: 'finished', member: ADA })
    expect(ids((batch as { entries: FeedEntry[] }).entries)).toEqual(ids([f3, f2, f1]))
    expect(between).toEqual({ type: 'entry', entry: started })
    expect(bensRow).toEqual({ type: 'entry', entry: bens })
  })

  it('keeps the batch where the newest of its entries was, among other rows', () => {
    const newer = entry('2026-10-10', 900, BEN, 'want')
    const a1 = entry('2026-10-10', 100)
    const a2 = entry('2026-10-10', 200)
    const a3 = entry('2026-10-10', 300)
    const older = entry('2026-10-10', 50, BEN, 'want')
    const rows = feedDays(newestFirst([a1, a2, a3, newer, older]), utcDay)[0]!.rows
    expect(rows.map((r) => r.type)).toEqual(['entry', 'batch', 'entry'])
    expect(rows[0]).toEqual({ type: 'entry', entry: newer })
    expect(rows[2]).toEqual({ type: 'entry', entry: older })
  })

  it('does not fold across days, members or kinds', () => {
    const entries = [
      entry('2026-10-10', 100),
      entry('2026-10-10', 200),
      entry('2026-10-09', 300),
      entry('2026-10-09', 400, BEN),
      entry('2026-10-10', 500, ADA, 'reviewed'),
      entry('2026-10-10', 600, BEN, 'reviewed'),
    ]
    const rows = feedDays(newestFirst(entries), utcDay).flatMap((d) => d.rows)
    expect(rows.every((r) => r.type === 'entry')).toBe(true)
    expect(rows).toHaveLength(6)
  })

  it('folds on each day separately', () => {
    const entries = ['2026-10-10', '2026-10-09'].flatMap((day) => [entry(day, 100), entry(day, 200), entry(day, 300)])
    const days = feedDays(newestFirst(entries), utcDay)
    expect(days.map((d) => d.rows.map((r) => r.type))).toEqual([['batch'], ['batch']])
  })
})

describe("the device's copy", () => {
  const now = new Date('2026-10-12T10:00:00Z')
  const entries = [entry('2026-10-12', 100), entry('2026-10-11', 100, BEN, 'want')]

  it('is written and read back, under libellus.feed', () => {
    const store = new Map<string, string>()
    const device = {
      length: 0,
      key: () => null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    expect(DEVICE_FEED_KEY).toBe('libellus.feed')
    expect(saveFeed(device, 'me', entries, now)).toBe(true)
    expect([...store.keys()]).toEqual(['libellus.feed'])
    expect(readFeed(device, 'me', new Date('2026-10-13T10:00:00Z'))).toEqual(entries)
  })

  it('reads as none for another member', () => {
    const device = deviceStorage()
    saveFeed(device, 'me', entries, now)
    expect(readFeed(device, 'someone-else', now)).toBeNull()
  })

  it(`reads as none when older than ${FEED_KEEP_DAYS} days, and as itself up to then`, () => {
    const device = deviceStorage()
    saveFeed(device, 'me', entries, now)
    expect(readFeed(device, 'me', new Date(now.getTime() + FEED_KEEP_DAYS * 86_400_000))).toEqual(entries)
    expect(readFeed(device, 'me', new Date(now.getTime() + 8 * 86_400_000))).toBeNull()
  })

  it('reads as none when torn, foreign or of another shape', () => {
    const device = deviceStorage()
    for (const raw of [
      '{"version":2,"data":{"memberId":"me","savedAt":"2026-10-12T10:0',
      'not json',
      '{"version":1,"data":{"memberId":"me","savedAt":"2026-10-12T10:00:00Z","entries":[]}}',
      '{"version":3,"data":{"memberId":"me","savedAt":"2026-10-12T10:00:00Z","entries":[]}}',
      '{"version":2,"data":{"memberId":"me","savedAt":"2026-10-12T10:00:00Z","entries":"x"}}',
      '{"version":2,"data":{"memberId":"me","savedAt":"2026-10-12T10:00:00Z","entries":[{"id":1}]}}',
      '{"version":2,"data":{"memberId":"me","savedAt":"yesterday","entries":[]}}',
      'null',
    ]) {
      device.setItem(DEVICE_FEED_KEY, raw)
      expect(readFeed(device, 'me', now), raw).toBeNull()
    }
  })

  it('reads as none with nothing saved, and ignores a storage that refuses', () => {
    const device = deviceStorage()
    expect(readFeed(device, 'me', now)).toBeNull()
    const refusing = {
      ...device,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(saveFeed(refusing, 'me', entries, now)).toBe(false)
    expect(readFeed(refusing, 'me', now)).toBeNull()
  })
})

function deviceStorage() {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
}

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 250,
    year: 1969,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: 'https://example.org/cover.jpg',
    coverThumbhash: null,
    coverColors: { dominant: '#112233', secondary: '#445566' },
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

describe('the feed against the social stack', () => {
  beforeAll(async () => {
    await sql(`update private.social_config set settle_window = '0'`)
  })
  afterAll(async () => {
    await sql(`update private.social_config set settle_window = '10 minutes'`)
  })

  it("shows Ben Ada's finishes, a page at a time, and refuses offline", async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    await sql(
      `insert into public.follows (follower_id, followee_id, accepted_at) values ($1, $2, now())`,
      [ben.id, ada.id],
    )
    const library = createLibrary(ada.client)
    const today = isoDay()
    const finish = async (title: string) => {
      const added = (await library.addToLibrary(book(title), { status: 'finished', startedOn: today, endedOn: today })).data!
      return added
    }

    const first = await finish('First Finish')
    const feed = createFeed(ben.client, { online: () => true })
    const page = (await feed.page()).data!
    expect(page).toHaveLength(1)
    expect(page[0]).toMatchObject({
      kind: 'finished',
      again: false,
      member: { id: ada.id },
      book: { id: first.book.id, title: first.book.title, manual: false },
      rating: null,
      review: null,
      spoilers: false,
      folded: false,
      sessionId: first.latestSession!.id,
      likes: 0,
      liked: false,
    })
    expect(page[0]!.member.name).not.toBeUndefined()
    expect(typeof page[0]!.id).toBe('string')
    expect(page[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(FEED_PAGE).toBe(30)

    const second = await finish('Second Finish')
    const both = (await feed.page()).data!
    expect(both.map((e) => e.book.id)).toEqual([second.book.id, first.book.id])

    const last = both[0]!
    const older = (await feed.page({ at: last.at, id: last.id })).data!
    expect(older.map((e) => e.book.id)).toEqual([first.book.id])

    expect((await feed.page(both[1]!)).data).toEqual([])
    const offline = createFeed(newClient(), { online: () => false })
    expect(await offline.page()).toEqual({ data: null, error: 'offline' })

    // A connection that answers nothing (status 0) is offline too, not a failed load.
    const silent = { rpc: async () => ({ data: null, error: { message: 'Failed to fetch' }, status: 0 }) }
    expect(await createFeed(silent as never, { online: () => true }).page()).toEqual({ data: null, error: 'offline' })
  })
})
