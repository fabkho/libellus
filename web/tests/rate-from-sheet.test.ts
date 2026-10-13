import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary, sessionEditOf, type LibraryEntry } from '@/data/library'
import { createOutbox, createSender, memoryOutboxStorage, type Send } from '@/data/outbox'
import { figuresOf, readsUnrated, withRating, type StatsRead } from '@/data/stats'
import type { WriteQueue } from '@/data/queuedWrites'
import { statsSheetReads } from '@/utils/statsSheet'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Rating a Book from the unrated sheet (issue #14, part 2). What the sheet's stars do, in three
 * layers: the selection and its update (pure, `withRating` laid over the record so the list and the
 * figures follow at once), the rating-only write through the Book page's own path (a `SessionEdit`
 * with only the Rating changed, `update_session` keeping the days and the review), and a Rating made
 * offline (the outbox, `update_session` queued like every other write).
 */

const today = isoDay()

// ------------------------------------------------- the selection and its update

function read(id: string, rating: number | null, over: Partial<StatsRead> = {}): StatsRead {
  return {
    sessionId: id,
    entryId: `${id}-entry`,
    book: { id, title: id, authors: ['Susanna Clarke'], pageCount: 272, coverUrl: null, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as StatsRead['book'],
    startedOn: addDays(today, -10),
    endedOn: addDays(today, -3),
    outcome: 'finished',
    rating,
    pages: 272,
    days: 8,
    nth: 1,
    ...over,
  }
}

describe('the unrated list and its figures after a Rating', () => {
  const reads = [read('Old', 16), read('One', null), read('Two', null), read('Three', null)]

  it('takes the rated read out of the list the sheet shows', () => {
    expect(readsUnrated(reads).map((r) => r.sessionId)).toEqual(['Three', 'Two', 'One'])
    const rated = withRating(reads, 'Two', 16)
    expect(readsUnrated(rated).map((r) => r.sessionId)).toEqual(['Three', 'One'])
    expect(statsSheetReads({ kind: 'unrated', year: 'all' }, rated).map((r) => r.sessionId)).toEqual(['Three', 'One'])
  })

  it('moves the figures the sheet stands behind, without a reload', () => {
    const before = figuresOf(reads, 'all')
    expect(before).toMatchObject({ rated: 1, unrated: 3, average: 16 })

    const after = figuresOf(withRating(reads, 'Two', 20), 'all')
    expect(after).toMatchObject({ rated: 2, unrated: 2, average: 18 })
    // The Rating is whole stars from the sheet's stars (quarters are what the store keeps).
    expect(withRating(reads, 'Two', 20).find((r) => r.sessionId === 'Two')).toMatchObject({ rating: 20 })
  })

  it('puts the read back where it was when the Rating is undone', () => {
    expect(withRating(withRating(reads, 'Two', 16), 'Two', null)).toEqual(reads)
    expect(readsUnrated(withRating(withRating(reads, 'Two', 16), 'Two', null)).map((r) => r.sessionId)).toEqual(['Three', 'Two', 'One'])
  })

  it('leaves every other read alone', () => {
    const rated = withRating(reads, 'Two', 8)
    expect(rated.filter((r) => r.sessionId !== 'Two')).toEqual(reads.filter((r) => r.sessionId !== 'Two'))
    expect(withRating(reads, 'Nobody', 8)).toEqual(reads)
  })
})

// ------------------------------------------------------------- the write itself

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** A member with one Book, finished a week ago with a review and no Rating (the unrated sheet's row). */
async function finishedBook(title = 'Piranesi') {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const added = await library.addToLibrary(book(title), {
    status: 'finished',
    startedOn: addDays(today, -10),
    endedOn: addDays(today, -3),
    review: 'A house of statues.',
  })
  const entry = added.data!
  const [read] = (await library.sessions(entry.id)).data!
  return { member, library, entry, read: read! }
}

describe('a Rating written through the Book page\'s path', () => {
  it('changes the Rating and only that: the days and the review stay', async () => {
    const { library, entry, read } = await finishedBook()

    // What `history.rateSession` writes: the read's own state with the Rating as the one change.
    const edit = { ...sessionEditOf(read), rating: 20 }
    const { data, error } = await library.updateSession(entry.id, read, edit)

    expect(error).toBeNull()
    expect(data!.latestSession).toMatchObject({
      rating: 20,
      review: 'A house of statues.',
      startedOn: addDays(today, -10),
      endedOn: addDays(today, -3),
    })
    expect((await library.sessions(entry.id)).data![0]).toMatchObject({ rating: 20, review: 'A house of statues.' })
  })

  it('takes the Rating back off again the same way (Undo)', async () => {
    const { library, entry, read } = await finishedBook()

    const { data } = await library.updateSession(entry.id, read, { ...sessionEditOf(read), rating: 12 })
    const rated = data!.latestSession!
    const undone = await library.updateSession(entry.id, rated, { ...sessionEditOf(rated), rating: null })

    expect(undone.error).toBeNull()
    expect(undone.data!.latestSession).toMatchObject({ rating: null, review: 'A house of statues.' })
  })
})

// --------------------------------------------------------------- offline (issue #93)

/** The phone as the stores make it: the outbox under the repository, the device's copy of the entry. */
function device(member: TestMember, entry: LibraryEntry, send?: Send) {
  const state = { offline: true }
  const outbox = createOutbox({ memberId: member.id, storage: memoryOutboxStorage(), send: send ?? createSender(member.client) })
  const queue: WriteQueue = {
    open: () => true,
    holds: () => state.offline || outbox.items().length > 0,
    entry: (id) => (id === entry.id ? entry : null),
    entryForBook: () => null,
    collection: () => null,
    add: (write) => outbox.add(write),
  }
  const library = createLibrary(member.client, { online: () => !state.offline, queue })
  return { state, outbox, library }
}

describe('a Rating made offline', () => {
  it('waits in the outbox with the whole read, and the database has it once the line is sent', async () => {
    const { member, entry, read } = await finishedBook('Emma')
    const phone = device(member, entry)
    const edit = { ...sessionEditOf(read), rating: 16 }

    const { data, error } = await phone.library.updateSession(entry.id, read, edit)

    // Answered at once, as the entry will be (the queue lays the write over the device's copy).
    expect(error).toBeNull()
    expect(data!.latestSession).toMatchObject({ rating: 16, review: 'A house of statues.' })
    expect(phone.outbox.items()).toMatchObject([{ action: 'update_session', entryId: entry.id }])
    // Nothing in the database yet.
    expect((await createLibrary(member.client).sessions(entry.id)).data![0]).toMatchObject({ rating: null })

    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report).toMatchObject({ refused: [], waiting: 0 })
    expect((await createLibrary(member.client).sessions(entry.id)).data![0]).toMatchObject({ rating: 16, review: 'A house of statues.' })
  })
})
