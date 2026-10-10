import { describe, expect, it } from 'vitest'
import type { FeedEntry, FeedKind } from '@/data/feed'
import { CARD_DAYS, circleView, type CirclePhrase } from '@/utils/circleView'

/**
 * What Home's "Your circle" decides before it draws (social v1, U8): which finish gets the card (the
 * 7-day rule), that it leaves the list, how a member's row is built (two phrases at most, batches,
 * the day, the fan), and how many members there are.
 */

const NOW = new Date(Date.UTC(2026, 9, 9, 12, 0)) // Fri 9 Oct 2026, noon UTC
const HOUR = 3_600_000
const DAY = 24 * HOUR
const dayOf = (at: string) => at.slice(0, 10)
const options = { now: NOW, dayOf }

const ANNA = { id: 'anna', name: 'Anna', photo: null }
const BEN = { id: 'ben', name: 'Ben', photo: null }
const CLARA = { id: 'clara', name: 'Clara', photo: null }
const TOM = { id: 'tom', name: 'Tom', photo: null }

function book(id: string) {
  return { id, title: `Book ${id}`, authors: [], year: null, coverUrl: null, coverThumbhash: null, coverColors: null, manual: false }
}

let serial = 0
/** An entry `hours` before NOW, newest = fewest hours. */
function entry(member: typeof ANNA, kind: FeedKind, bookId: string, hoursAgo: number, extra: Partial<FeedEntry> = {}): FeedEntry {
  serial += 1
  return {
    id: `e${String(serial).padStart(3, '0')}`,
    at: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
    member,
    kind,
    again: false,
    day: null,
    book: book(bookId),
    rating: null,
    review: null,
    spoilers: false,
    folded: false,
    sessionId: null,
    likes: 0,
    liked: false,
    ...extra,
  }
}

/** Entries as the feed answers them: newest first. */
const feed = (...entries: FeedEntry[]) => [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

const verbs = (phrases: CirclePhrase[]) => phrases.map((p) => (p.type === 'entry' ? p.verb : `${p.key}:${p.count}`))

describe('the card', () => {
  it('is the newest finished entry of the week, with her stars and review', () => {
    const view = circleView(
      feed(
        entry(BEN, 'started', 'b1', 2),
        entry(ANNA, 'finished', 'b2', 5, { rating: 18, review: 'Warm.' }),
        entry(CLARA, 'finished', 'b3', 30),
      ),
      options,
    )
    expect(view.card).toMatchObject({ member: ANNA, book: { id: 'b2' }, verb: 'finished', rating: 18, review: 'Warm.' })
  })

  it('takes a review when it is the newest, and says "finished" when the finish is there too', () => {
    const finished = entry(ANNA, 'finished', 'b2', 6, { rating: 16 })
    const reviewed = entry(ANNA, 'reviewed', 'b2', 5, { rating: 16, review: 'Slow, then warm.' })
    const view = circleView(feed(finished, reviewed), options)
    expect(view.card).toMatchObject({ verb: 'finished', rating: 16, review: 'Slow, then warm.' })
    expect(view.friends).toEqual([])
  })

  it('carries the heart of the read and the fold of the review the card shows (social v2a)', () => {
    const finished = entry(ANNA, 'finished', 'b2', 6, { rating: 16, sessionId: 's1', likes: 3, liked: true })
    const reviewed = entry(ANNA, 'reviewed', 'b2', 5, { rating: 16, review: 'The end!', spoilers: true, folded: true })
    expect(circleView(feed(finished, reviewed), options).card).toMatchObject({ sessionId: 's1', likes: 3, liked: true, review: 'The end!', folded: true })
    expect(circleView(feed(entry(ANNA, 'finished', 'b2', 5)), options).card).toMatchObject({ sessionId: null, likes: 0, liked: false, folded: false })
  })

  it('says "reviewed" when only the review is within the week', () => {
    const reviewed = entry(ANNA, 'reviewed', 'b2', 5, { rating: 16, review: 'Late thoughts.' })
    expect(circleView(feed(reviewed), options).card).toMatchObject({ verb: 'reviewed', review: 'Late thoughts.' })
  })

  it('is none when the newest finish is older than 7 days', () => {
    const old = entry(ANNA, 'finished', 'b2', CARD_DAYS * 24 + 1)
    const view = circleView(feed(old, entry(BEN, 'started', 'b1', 3)), options)
    expect(view.card).toBeNull()
    // It is not told in the list as a card either: it is simply an older row of hers.
    expect(view.friends.map((f) => f.member.id)).toEqual(['ben', 'anna'])
  })

  it('still counts a finish exactly 7 days old', () => {
    const edge = entry(ANNA, 'finished', 'b2', CARD_DAYS * 24)
    expect(circleView(feed(edge), options).card?.member.id).toBe('anna')
  })

  it('is none without a finish, and an abandoned one is no finish', () => {
    expect(circleView(feed(entry(BEN, 'started', 'b1', 2), entry(ANNA, 'abandoned', 'b2', 3), entry(TOM, 'want', 'b3', 4)), options).card).toBeNull()
    expect(circleView([], options)).toEqual({ card: null, friends: [] })
  })

  it('is never a finish folded into a batch of three', () => {
    const three = [entry(ANNA, 'finished', 'b1', 3), entry(ANNA, 'finished', 'b2', 4), entry(ANNA, 'finished', 'b3', 5)]
    const view = circleView(feed(...three, entry(CLARA, 'finished', 'b4', 20)), options)
    // Anna's three are one batch row; the newest finish that stands alone is Clara's.
    expect(view.card?.member.id).toBe('clara')
    expect(verbs(view.friends[0]!.phrases)).toEqual(['batchFinished:3'])
  })

  it('is one at most: the older finish stays in the list', () => {
    const view = circleView(feed(entry(ANNA, 'finished', 'b1', 3), entry(CLARA, 'finished', 'b2', 9)), options)
    expect(view.card?.member.id).toBe('anna')
    expect(view.friends).toHaveLength(1)
    expect(view.friends[0]).toMatchObject({ member: CLARA, phrases: [{ type: 'entry', verb: 'finished' }] })
  })
})

describe('the card leaves the list', () => {
  it('and her other activity still makes her row', () => {
    const view = circleView(
      feed(entry(ANNA, 'finished', 'b1', 2), entry(ANNA, 'want', 'b2', 26), entry(BEN, 'started', 'b3', 3)),
      options,
    )
    expect(view.card?.book.id).toBe('b1')
    expect(view.friends.map((f) => [f.member.id, verbs(f.phrases)])).toEqual([
      ['ben', ['started']],
      ['anna', ['want']],
    ])
  })

  it('no row of hers when the finish was all she did', () => {
    const view = circleView(feed(entry(ANNA, 'finished', 'b1', 2), entry(BEN, 'started', 'b3', 3)), options)
    expect(view.friends.map((f) => f.member.id)).toEqual(['ben'])
  })

  it('a batch that lost one of its three is two entries again', () => {
    const view = circleView(
      feed(
        entry(ANNA, 'want', 'b1', 3),
        entry(ANNA, 'want', 'b2', 4),
        entry(ANNA, 'want', 'b3', 5),
        entry(ANNA, 'finished', 'b4', 1),
        entry(ANNA, 'reviewed', 'b4', 0.5, { review: 'x' }),
      ),
      options,
    )
    // The finish and its review are the card; Anna's three "want" stay a batch.
    expect(view.card?.book.id).toBe('b4')
    expect(verbs(view.friends[0]!.phrases)).toEqual(['batchWant:3'])
  })
})

describe('a member\u2019s row', () => {
  it('holds her two newest events at most, joined later as one sentence', () => {
    const view = circleView(
      feed(
        entry(BEN, 'started', 'b1', 1),
        entry(BEN, 'want', 'b2', 2),
        entry(BEN, 'abandoned', 'b3', 3),
      ),
      options,
    )
    expect(view.friends).toHaveLength(1)
    expect(verbs(view.friends[0]!.phrases)).toEqual(['started', 'want'])
    expect(view.friends[0]!.books.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('a batch is one phrase, and names its Books in the fan', () => {
    const view = circleView(
      feed(entry(ANNA, 'want', 'b1', 3), entry(ANNA, 'want', 'b2', 4), entry(ANNA, 'want', 'b3', 5), entry(ANNA, 'want', 'b4', 6)),
      options,
    )
    const [anna] = view.friends
    expect(anna!.phrases).toEqual([{ type: 'batch', key: 'batchWant', count: 4 }])
    expect(anna!.books.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('two single entries of one kind are one phrase with both Books, newest first', () => {
    const view = circleView(feed(entry(TOM, 'want', 'b1', 2), entry(TOM, 'want', 'b2', 3), entry(TOM, 'started', 'b3', 4)), options)
    expect(view.friends[0]!.phrases).toEqual([{ type: 'entry', verb: 'want', books: [expect.objectContaining({ id: 'b1' }), expect.objectContaining({ id: 'b2' })] }])
    expect(view.friends[0]!.books.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('two events of different kinds stay two phrases', () => {
    const view = circleView(feed(entry(BEN, 'started', 'b1', 2), entry(BEN, 'want', 'b2', 3)), options)
    expect(verbs(view.friends[0]!.phrases)).toEqual(['started', 'want'])
    expect(view.friends[0]!.phrases.map((p) => (p.type === 'entry' ? p.books.length : 0))).toEqual([1, 1])
  })

  it('a started and a started-again entry are two kinds of verb, so two phrases', () => {
    const view = circleView(feed(entry(BEN, 'started', 'b1', 2, { again: true }), entry(BEN, 'started', 'b2', 3)), options)
    expect(verbs(view.friends[0]!.phrases)).toEqual(['startedAgain', 'started'])
  })

  it('a batch next to a single entry of the same kind stays two phrases', () => {
    const view = circleView(
      feed(entry(ANNA, 'want', 'b1', 2 + 24), entry(ANNA, 'want', 'b2', 3), entry(ANNA, 'want', 'b3', 4), entry(ANNA, 'want', 'b4', 5)),
      options,
    )
    expect(verbs(view.friends[0]!.phrases)).toEqual(['batchWant:3', 'want'])
  })

  it('a started-again entry keeps its own verb', () => {
    const view = circleView(feed(entry(BEN, 'started', 'b1', 2, { again: true })), options)
    expect(verbs(view.friends[0]!.phrases)).toEqual(['startedAgain'])
  })

  it('the fan has three covers at most, each Book once', () => {
    const view = circleView(
      feed(
        entry(ANNA, 'want', 'b1', 3),
        entry(ANNA, 'want', 'b2', 4),
        entry(ANNA, 'want', 'b3', 5),
        entry(ANNA, 'finished', 'b1', 30),
        entry(ANNA, 'started', 'b9', 31),
      ),
      { now: NOW, dayOf },
    )
    // The finish is Anna's card; her row is the batch of three, then the start: four Books, three covers.
    expect(view.friends[0]!.books.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
    const twice = circleView(feed(entry(BEN, 'started', 'b1', 1), entry(BEN, 'abandoned', 'b1', 2)), options)
    expect(twice.friends[0]!.books.map((b) => b.id)).toEqual(['b1'])
  })

  it('the day is her newest event\u2019s', () => {
    const view = circleView(feed(entry(BEN, 'started', 'b1', 2), entry(BEN, 'want', 'b2', 30)), options)
    expect(view.friends[0]!.day).toBe('2026-10-09')
    const older = circleView(feed(entry(BEN, 'started', 'b1', 30), entry(BEN, 'want', 'b2', 31)), options)
    expect(older.friends[0]!.day).toBe('2026-10-08')
  })
})

describe('the list', () => {
  it('orders members by their newest activity, newest first', () => {
    const view = circleView(
      feed(
        entry(CLARA, 'started', 'b1', 60),
        entry(BEN, 'started', 'b2', 2),
        entry(ANNA, 'want', 'b3', 10),
        entry(BEN, 'want', 'b4', 40),
      ),
      options,
    )
    expect(view.friends.map((f) => f.member.id)).toEqual(['ben', 'anna', 'clara'])
  })

  it('shows three members at most', () => {
    const view = circleView(
      feed(
        entry(ANNA, 'started', 'b1', 1),
        entry(BEN, 'started', 'b2', 2),
        entry(CLARA, 'started', 'b3', 3),
        entry(TOM, 'started', 'b4', 4),
      ),
      options,
    )
    expect(view.friends.map((f) => f.member.id)).toEqual(['anna', 'ben', 'clara'])
  })

  it('a week without a finish is the list alone', () => {
    const view = circleView(
      feed(entry(BEN, 'started', 'b1', 2), entry(ANNA, 'want', 'b2', 3), entry(TOM, 'started', 'b3', 2 * 24), entry(ANNA, 'finished', 'b4', 9 * DAY / HOUR)),
      options,
    )
    expect(view.card).toBeNull()
    expect(view.friends.map((f) => f.member.id)).toEqual(['ben', 'anna', 'tom'])
    // Anna's old finish is no card, so it is her second phrase.
    expect(verbs(view.friends[1]!.phrases)).toEqual(['want', 'finished'])
  })
})
