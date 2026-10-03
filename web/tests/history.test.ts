import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createCollections } from '@/data/collections'
import {
  checkSessionEdit,
  createLibrary,
  sessionEditOf,
  sortSessions,
  type Library,
  type LibraryEntry,
  type ReadingSession,
  type SessionEdit,
} from '@/data/library'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Reading history and removing (issue #11) through the repository, against the
 * local stack, as real signed-in members: every read of an entry, an edit with
 * the rules of creating the read, deleting one read (the only one returns the
 * entry to Want to read) and removing the entry with its reads and its places
 * on Collections. The pure checks the Edit sheet runs first have their own
 * block at the end.
 */

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

const today = isoDay()

/** A member with one Book, finished 3 days ago after a week, rated 3.75 with a review. */
async function finishedBook(title = 'Piranesi') {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const added = await library.addToLibrary(book(title), {
    status: 'finished',
    startedOn: addDays(today, -10),
    endedOn: addDays(today, -3),
    rating: 15,
    review: 'A house of statues.',
  })
  const entry = added.data!
  const [read] = (await library.sessions(entry.id)).data!
  return { member, library, entry, read: read! }
}

/** The edit that leaves a read as it is, to change one thing at a time. */
function edit(read: ReadingSession, changes: Partial<SessionEdit> = {}): SessionEdit {
  return { ...sessionEditOf(read), ...changes }
}

async function status(library: Library, entry: LibraryEntry) {
  return (await library.entry(entry.id)).data!.status
}

describe('the history of an entry', () => {
  it('lists every read, newest first, the open one at the top', async () => {
    const { library, entry, read } = await finishedBook()
    await library.readAgain(entry.id, addDays(today, -1))

    const { data: reads, error } = await library.sessions(entry.id)

    expect(error).toBeNull()
    expect(reads).toHaveLength(2)
    expect(reads![0]).toMatchObject({ outcome: null, startedOn: addDays(today, -1), endedOn: null })
    expect(reads![1]).toMatchObject({
      id: read.id,
      outcome: 'finished',
      startedOn: addDays(today, -10),
      endedOn: addDays(today, -3),
      rating: 15,
      review: 'A house of statues.',
      abandonReason: null,
    })
  })

  it('shows a member only her own reads', async () => {
    const { entry } = await finishedBook()
    const stranger = await signUpMember()

    expect(await createLibrary(stranger.client).sessions(entry.id)).toEqual({ data: [], error: null })
  })

  it('has no reads for a Book on Want to read', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const { data: entry } = await library.addToLibrary(book('Emma'))

    expect(await library.sessions(entry!.id)).toEqual({ data: [], error: null })
  })
})

describe('update a session', () => {
  it('fixes the dates, Rating and review of a finished read, which the entry then shows', async () => {
    const { library, entry, read } = await finishedBook()

    const { data, error } = await library.updateSession(
      entry.id,
      read,
      edit(read, { startedOn: addDays(today, -12), endedOn: addDays(today, -5), rating: 19, review: '  Rereadable.  ' }),
    )

    expect(error).toBeNull()
    expect(data).toMatchObject({
      id: entry.id,
      status: 'finished',
      latestSession: { startedOn: addDays(today, -12), endedOn: addDays(today, -5), rating: 19, review: 'Rereadable.' },
    })
    expect((await library.sessions(entry.id)).data).toHaveLength(1)
  })

  it('clears the Rating, the review and the start day by leaving them out', async () => {
    const { library, entry, read } = await finishedBook()

    const { data } = await library.updateSession(entry.id, read, edit(read, { startedOn: '', rating: null, review: '  ' }))

    expect(data!.latestSession).toMatchObject({ startedOn: null, rating: null, review: null, outcome: 'finished' })
  })

  it('moves the start of the read in progress, and only that', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(book('Dune'))
    await library.startReading(added!.id, addDays(today, -2))
    const [open] = (await library.sessions(added!.id)).data!

    const { data, error } = await library.updateSession(added!.id, open!, edit(open!, { startedOn: addDays(today, -6) }))

    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'reading', latestSession: { startedOn: addDays(today, -6), outcome: null } })
    // What an open read cannot have is not sent, whatever the sheet holds.
    const stuffed = await library.updateSession(added!.id, open!, edit(open!, { endedOn: today, rating: 12, review: 'Early.' }))
    expect(stuffed.data!.latestSession).toMatchObject({ endedOn: null, rating: null, review: null, outcome: null })
    expect(await library.updateSession(added!.id, open!, edit(open!, { startedOn: '' }))).toEqual({
      data: null,
      error: 'date_invalid',
    })
  })

  it('fixes the dates and the reason of an abandoned read, which keeps no Rating or review', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(book('Ubik'))
    await library.startReading(added!.id, addDays(today, -9))
    await library.abandon(added!.id, { endedOn: addDays(today, -4), reason: 'Too strange.' })
    const [read] = (await library.sessions(added!.id)).data!

    const { data, error } = await library.updateSession(
      added!.id,
      read!,
      edit(read!, { endedOn: addDays(today, -5), abandonReason: '  Lost the thread.  ', rating: 20, review: 'Nope.' }),
    )

    expect(error).toBeNull()
    expect(data).toMatchObject({
      status: 'finished',
      latestSession: { outcome: 'abandoned', endedOn: addDays(today, -5), abandonReason: 'Lost the thread.', rating: null, review: null },
    })
  })

  it('refuses taking the end day of a finished read away', async () => {
    const { library, entry, read } = await finishedBook()
    expect(await library.updateSession(entry.id, read, edit(read, { endedOn: '' }))).toEqual({
      data: null,
      error: 'date_invalid',
    })
  })

  it('refuses what the database refuses, as codes, and leaves the read as it was', async () => {
    const { library, entry, read } = await finishedBook()
    const stranger = await signUpMember()

    expect(await library.updateSession(entry.id, read, edit(read, { endedOn: addDays(today, -11) }))).toEqual({
      data: null,
      error: 'ended_before_started',
    })
    expect(await library.updateSession(entry.id, read, edit(read, { endedOn: addDays(today, 2) }))).toEqual({
      data: null,
      error: 'date_in_future',
    })
    expect(await library.updateSession(entry.id, read, edit(read, { rating: 21 }))).toEqual({
      data: null,
      error: 'rating_invalid',
    })
    expect(await library.updateSession(entry.id, read, edit(read, { rating: 0 }))).toEqual({
      data: null,
      error: 'rating_invalid',
    })
    expect(await library.updateSession(entry.id, read, edit(read, { review: 'x'.repeat(10_001) }))).toEqual({
      data: null,
      error: 'review_too_long',
    })
    expect(await createLibrary(stranger.client).updateSession(entry.id, read, edit(read))).toEqual({
      data: null,
      error: 'session_not_found',
    })
    expect((await library.sessions(entry.id)).data![0]).toEqual(read)
  })

  it('files the entry under the end day it now has', async () => {
    const { library, entry, read } = await finishedBook()

    await library.updateSession(entry.id, read, edit(read, { startedOn: '', endedOn: addDays(today, -30) }))

    const finished = (await library.entries('finished')).data!
    expect(finished.find((e) => e.id === entry.id)!.latestSession!.endedOn).toBe(addDays(today, -30))
  })

  it('counts in "Read in <year>" by the end day it now has', async () => {
    const { library, entry, read } = await finishedBook()
    const year = Number(today.slice(0, 4))
    const before = (await library.readInYear(year)).data!

    await library.updateSession(entry.id, read, edit(read, { startedOn: '', endedOn: `${year - 1}-06-01` }))

    expect((await library.readInYear(year)).data).toBe(before - 1)
  })
})

describe('delete a session', () => {
  it('returns the entry to Want to read when it was the only read', async () => {
    const { library, entry, read } = await finishedBook()

    const { data, error } = await library.deleteSession(entry.id, read.id)

    expect(error).toBeNull()
    expect(data).toMatchObject({ id: entry.id, status: 'want_to_read', latestSession: null })
    expect((await library.sessions(entry.id)).data).toEqual([])
    expect((await library.entries('want_to_read')).data!.map((e) => e.id)).toContain(entry.id)
    expect((await library.entries('finished')).data!.map((e) => e.id)).not.toContain(entry.id)
  })

  it('returns a Book being read to Want to read: the start logged by accident', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(book('Dune'))
    await library.startReading(added!.id, today)
    const [open] = (await library.sessions(added!.id)).data!

    expect((await library.deleteSession(added!.id, open!.id)).data!.status).toBe('want_to_read')
  })

  it('lets the entry follow the reads it has left', async () => {
    const { library, entry, read } = await finishedBook()
    await library.readAgain(entry.id, addDays(today, -1))
    const open = (await library.sessions(entry.id)).data![0]!

    // The open read goes: the earlier, finished one decides again.
    const afterOpen = await library.deleteSession(entry.id, open.id)
    expect(afterOpen.data).toMatchObject({ status: 'finished', latestSession: { id: read.id, rating: 15 } })

    // An earlier read goes while a later one is open: still being read.
    await library.readAgain(entry.id, today)
    const afterEarlier = await library.deleteSession(entry.id, read.id)
    expect(afterEarlier.data).toMatchObject({ status: 'reading', latestSession: { outcome: null } })
    expect((await library.sessions(entry.id)).data).toHaveLength(1)
  })

  it('refuses a read that is not hers or not there, as session_not_found', async () => {
    const { library, entry, read } = await finishedBook()
    const stranger = await signUpMember()

    expect(await createLibrary(stranger.client).deleteSession(entry.id, read.id)).toEqual({
      data: null,
      error: 'session_not_found',
    })
    expect((await library.sessions(entry.id)).data).toHaveLength(1)

    await library.deleteSession(entry.id, read.id)
    expect(await library.deleteSession(entry.id, read.id)).toEqual({ data: null, error: 'session_not_found' })
  })
})

describe('remove from the Library', () => {
  it('deletes the entry with its reads and its places on Collections, and nothing else', async () => {
    const { member, library, entry } = await finishedBook()
    const { data: other } = await library.addToLibrary(book('Hyperion'))
    await library.readAgain(entry.id, addDays(today, -1))
    const collections = createCollections(member.client)
    const houses = (await collections.create('Houses')).data!
    const statues = (await collections.create('Statues')).data!
    await collections.addEntry(houses.id, entry.book)
    await collections.addEntry(houses.id, other!.book)
    await collections.addEntry(statues.id, entry.book)

    expect(await library.removeFromLibrary(entry.id)).toEqual({ data: null, error: null })

    expect((await library.entry(entry.id)).data).toBeNull()
    expect((await library.entryForBook(entry.book.id)).data).toBeNull()
    expect((await library.sessions(entry.id)).data).toEqual([])
    expect((await collections.memberships(entry.id)).data).toEqual([])
    // The Collections stay, with what else is on them.
    const kept = (await collections.list()).data!
    expect(kept.find((c) => c.id === houses.id)!.count).toBe(1)
    expect(kept.find((c) => c.id === statues.id)!.count).toBe(0)
    expect((await collections.get(houses.id)).data!.entries.map((e) => e.id)).toEqual([other!.id])
    // Not in any list, and the Book is still the Catalogue's.
    for (const status of ['want_to_read', 'reading', 'finished'] as const) {
      expect((await library.entries(status)).data!.map((e) => e.id)).not.toContain(entry.id)
    }
    expect((await library.book(entry.book.id)).data).toMatchObject({ id: entry.book.id })
  })

  it('lets the Book be added again, as a fresh entry on Want to read', async () => {
    const { library, entry } = await finishedBook()
    await library.removeFromLibrary(entry.id)

    const again = await library.addToLibrary(entry.book)

    expect(again.error).toBeNull()
    expect(again.data).toMatchObject({ status: 'want_to_read', latestSession: null })
    expect(again.data!.id).not.toBe(entry.id)
  })

  it('does not count its finished reads in "Read in <year>" any more', async () => {
    const { library, entry } = await finishedBook()
    const year = Number(today.slice(0, 4))
    const before = (await library.readInYear(year)).data!

    await library.removeFromLibrary(entry.id)

    expect((await library.readInYear(year)).data).toBe(before - 1)
  })

  it('refuses an entry that is not hers or not there, as entry_not_found', async () => {
    const { library, entry } = await finishedBook()
    const stranger = await signUpMember()

    expect(await createLibrary(stranger.client).removeFromLibrary(entry.id)).toEqual({
      data: null,
      error: 'entry_not_found',
    })
    expect((await library.entry(entry.id)).data).not.toBeNull()
    expect(await status(library, entry)).toBe('finished')

    await library.removeFromLibrary(entry.id)
    expect(await library.removeFromLibrary(entry.id)).toEqual({ data: null, error: 'entry_not_found' })
  })
})

describe('the checks the Edit sheet runs first', () => {
  const finished: ReadingSession = {
    id: 's1',
    startedOn: '2026-03-01',
    endedOn: '2026-03-10',
    outcome: 'finished',
    rating: 12,
    review: null,
    abandonReason: null,
    createdAt: '2026-03-10T10:00:00Z',
  }
  const open: ReadingSession = { ...finished, id: 's2', endedOn: null, outcome: null, rating: null }
  const undated: ReadingSession = { ...finished, id: 's3', startedOn: null, endedOn: null }
  const now = '2026-04-01'

  it('lets an unchanged read through', () => {
    expect(checkSessionEdit(finished, sessionEditOf(finished), now)).toBeNull()
    expect(checkSessionEdit(open, sessionEditOf(open), now)).toBeNull()
    expect(checkSessionEdit(undated, sessionEditOf(undated), now)).toBeNull()
  })

  it('finds the days the database would refuse', () => {
    expect(checkSessionEdit(finished, edit(finished, { endedOn: '2026-02-28' }), now)).toBe('ended_before_started')
    expect(checkSessionEdit(finished, edit(finished, { endedOn: '2026-04-02' }), now)).toBe('date_in_future')
    expect(checkSessionEdit(finished, edit(finished, { startedOn: '2026-04-02', endedOn: '' }), now)).toBe('date_invalid')
    expect(checkSessionEdit(finished, edit(finished, { endedOn: '' }), now)).toBe('date_invalid')
    expect(checkSessionEdit(finished, edit(finished, { endedOn: '10/03/2026' }), now)).toBe('date_invalid')
    expect(checkSessionEdit(open, edit(open, { startedOn: '' }), now)).toBe('date_invalid')
    expect(checkSessionEdit(open, edit(open, { startedOn: '2026-04-02' }), now)).toBe('date_in_future')
  })

  it('allows what a read logged later may leave out', () => {
    expect(checkSessionEdit(finished, edit(finished, { startedOn: '' }), now)).toBeNull()
    expect(checkSessionEdit(undated, edit(undated, { rating: 20 }), now)).toBeNull()
  })
})

describe('sorting reads', () => {
  const read = (id: string, over: Partial<ReadingSession>): ReadingSession => ({
    id,
    startedOn: null,
    endedOn: null,
    outcome: 'finished',
    rating: null,
    review: null,
    abandonReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  })

  it('puts the open read first, then by the day each ended, reads without days last', () => {
    const sorted = sortSessions([
      read('undated', {}),
      read('old', { startedOn: '2024-01-01', endedOn: '2024-02-01' }),
      read('open', { outcome: null, startedOn: '2025-01-01' }),
      read('new', { startedOn: '2025-03-01', endedOn: '2025-03-09' }),
      read('no-start', { endedOn: '2024-06-01' }),
    ])

    expect(sorted.map((r) => r.id)).toEqual(['open', 'new', 'no-start', 'old', 'undated'])
  })
})
