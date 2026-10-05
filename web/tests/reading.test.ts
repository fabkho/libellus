import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary, sortEntries, type LibraryEntry } from '@/data/library'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Start reading and finish (issue #7) through the repository, against the
 * local stack, as real signed-in members: the Status follows the sessions,
 * the lists sort by the session's days, and the database's refusals come back
 * as codes the screens can word.
 */

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Octavia E. Butler'],
    isbn13: null,
    isbn10: null,
    pageCount: 264,
    year: 1979,
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

async function memberWithBooks(...titles: string[]) {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const entries: LibraryEntry[] = []
  for (const title of titles) entries.push((await library.addToLibrary(book(title))).data!)
  return { member, library, entries }
}

describe('startReading', () => {
  it('moves a Want to read Book to Currently reading with its start date', async () => {
    const { library, entries: [kindred] } = await memberWithBooks('Kindred')
    expect(kindred).toMatchObject({ status: 'want_to_read', latestSession: null })

    const { data: entry, error } = await library.startReading(kindred!.id, addDays(today, -2))

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      id: kindred!.id,
      status: 'reading',
      book: { title: kindred!.book.title },
      latestSession: { startedOn: addDays(today, -2), endedOn: null, outcome: null, rating: null },
    })
    expect((await library.entries('reading')).data!.map((e) => e.id)).toContain(kindred!.id)
    expect((await library.entries('want_to_read')).data!.map((e) => e.id)).not.toContain(kindred!.id)
  })

  it('lists Currently reading by start date, newest first', async () => {
    const { library, entries: [earlier, later] } = await memberWithBooks('Started earlier', 'Started later')
    // Started in the other order than added, so the start date decides.
    await library.startReading(later!.id, addDays(today, -1))
    await library.startReading(earlier!.id, addDays(today, -10))

    const reading = (await library.entries('reading')).data!
    expect(reading.map((e) => e.id)).toEqual([later!.id, earlier!.id])
    expect(sortEntries([...reading].reverse()).map((e) => e.id)).toEqual([later!.id, earlier!.id])
  })

  it('refuses what the database refuses, as codes', async () => {
    const { library, entries: [kindred, dawn] } = await memberWithBooks('Kindred', 'Dawn')
    const stranger = await signUpMember()

    expect(await library.startReading(dawn!.id, addDays(today, 3))).toEqual({ data: null, error: 'date_in_future' })
    await library.startReading(kindred!.id, today)
    expect(await library.startReading(kindred!.id, today)).toEqual({ data: null, error: 'already_reading' })
    expect(await createLibrary(stranger.client).startReading(dawn!.id, today)).toEqual({
      data: null,
      error: 'entry_not_found',
    })
    expect((await library.entry(dawn!.id)).data!.status).toBe('want_to_read')
  })
})

describe('finish', () => {
  it('finishes the read with an end date, 3.75 stars and a review', async () => {
    const { library, entries: [kindred] } = await memberWithBooks('Kindred')
    await library.startReading(kindred!.id, addDays(today, -7))

    const { data: entry, error } = await library.finish(kindred!.id, {
      endedOn: today,
      rating: 15,
      review: '  Dana, pulled back again and again.  ',
    })

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      status: 'finished',
      latestSession: {
        startedOn: addDays(today, -7),
        endedOn: today,
        outcome: 'finished',
        rating: 15,
        review: 'Dana, pulled back again and again.',
      },
    })
    const finished = (await library.entries('finished')).data!
    expect(finished.find((e) => e.id === kindred!.id)?.latestSession?.rating).toBe(15)
    expect((await library.entries('reading')).data!.map((e) => e.id)).not.toContain(kindred!.id)
  })

  it('leaves the Rating and the review out when the member does', async () => {
    const { library, entries: [dawn] } = await memberWithBooks('Dawn')
    await library.startReading(dawn!.id, today)

    const { data: entry } = await library.finish(dawn!.id, { endedOn: today, review: '   ' })

    expect(entry!.latestSession).toMatchObject({ outcome: 'finished', rating: null, review: null })
  })

  it('lists Finished by end date, newest first', async () => {
    const { library, entries: [first, second] } = await memberWithBooks('Finished first', 'Finished second')
    for (const entry of [first!, second!]) await library.startReading(entry.id, addDays(today, -30))
    await library.finish(second!.id, { endedOn: addDays(today, -2), rating: 20 })
    await library.finish(first!.id, { endedOn: addDays(today, -20), rating: 4 })

    const finished = (await library.entries('finished')).data!
    expect(finished.map((e) => e.id)).toEqual([second!.id, first!.id])
    expect(finished.map((e) => e.latestSession?.rating)).toEqual([20, 4])
  })

  it('refuses what the database refuses, as codes', async () => {
    const { library, entries: [kindred, dawn] } = await memberWithBooks('Kindred', 'Dawn')
    await library.startReading(kindred!.id, addDays(today, -3))

    expect(await library.finish(dawn!.id, { endedOn: today })).toEqual({ data: null, error: 'not_reading' })
    expect(await library.finish(kindred!.id, { endedOn: addDays(today, -4) })).toEqual({
      data: null,
      error: 'ended_before_started',
    })
    expect(await library.finish(kindred!.id, { endedOn: addDays(today, 3) })).toEqual({
      data: null,
      error: 'date_in_future',
    })
    expect(await library.finish(kindred!.id, { endedOn: today, rating: 21 })).toEqual({
      data: null,
      error: 'rating_invalid',
    })
    expect(await library.finish(kindred!.id, { endedOn: today, review: 'x'.repeat(10_001) })).toEqual({
      data: null,
      error: 'review_too_long',
    })
    expect((await library.entry(kindred!.id)).data!.status).toBe('reading')

    await library.finish(kindred!.id, { endedOn: today })
    expect(await library.startReading(kindred!.id, today)).toEqual({ data: null, error: 'already_finished' })
  })
})
