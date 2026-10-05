import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary, isNotFinished, sortEntries, type LibraryEntry } from '@/data/library'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Abandon and read again (issue #10) through the repository, against the
 * local stack, as real signed-in members: an abandoned read moves the entry to
 * Finished, *Not finished* is the entries whose latest session was abandoned,
 * and a new session starts only when the latest one is closed.
 */

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Frank Herbert'],
    isbn13: null,
    isbn10: null,
    pageCount: 412,
    year: 1965,
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

/** The ids under *Not finished*: the Finished list, narrowed the way the Library narrows it. */
async function notFinished(library: ReturnType<typeof createLibrary>) {
  return (await library.entries('finished')).data!.filter(isNotFinished).map((e) => e.id)
}

describe('abandon', () => {
  it('ends the read as abandoned with a day and a reason, and the entry is Finished', async () => {
    const { library, entries: [dune] } = await memberWithBooks('Dune')
    await library.startReading(dune!.id, addDays(today, -9))

    const { data: entry, error } = await library.abandon(dune!.id, {
      endedOn: addDays(today, -2),
      reason: '  Too much sand.  ',
    })

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      id: dune!.id,
      status: 'finished',
      latestSession: {
        startedOn: addDays(today, -9),
        endedOn: addDays(today, -2),
        outcome: 'abandoned',
        rating: null,
        review: null,
        abandonReason: 'Too much sand.',
      },
    })
    expect(isNotFinished(entry!)).toBe(true)
    expect((await library.entries('finished')).data!.map((e) => e.id)).toContain(dune!.id)
    expect((await library.entries('reading')).data!.map((e) => e.id)).not.toContain(dune!.id)
  })

  it('takes the reason as optional: left out or blank is no reason', async () => {
    const { library, entries: [dune, emma] } = await memberWithBooks('Dune', 'Emma')
    for (const entry of [dune!, emma!]) await library.startReading(entry.id, today)

    const left = await library.abandon(dune!.id, { endedOn: today })
    const blank = await library.abandon(emma!.id, { endedOn: today, reason: '   ' })

    expect(left.data!.latestSession).toMatchObject({ outcome: 'abandoned', abandonReason: null })
    expect(blank.data!.latestSession).toMatchObject({ outcome: 'abandoned', abandonReason: null })
  })

  it('refuses what the database refuses, as codes', async () => {
    const { library, entries: [dune, emma] } = await memberWithBooks('Dune', 'Emma')
    const stranger = await signUpMember()
    await library.startReading(dune!.id, addDays(today, -3))

    expect(await library.abandon(emma!.id, { endedOn: today })).toEqual({ data: null, error: 'not_reading' })
    expect(await library.abandon(dune!.id, { endedOn: addDays(today, -4) })).toEqual({
      data: null,
      error: 'ended_before_started',
    })
    expect(await library.abandon(dune!.id, { endedOn: addDays(today, 3) })).toEqual({
      data: null,
      error: 'date_in_future',
    })
    expect(await library.abandon(dune!.id, { endedOn: today, reason: 'x'.repeat(1001) })).toEqual({
      data: null,
      error: 'reason_too_long',
    })
    expect(await createLibrary(stranger.client).abandon(dune!.id, { endedOn: today })).toEqual({
      data: null,
      error: 'entry_not_found',
    })
    expect((await library.entry(dune!.id)).data!.status).toBe('reading')

    await library.abandon(dune!.id, { endedOn: today })
    expect(await library.abandon(dune!.id, { endedOn: today })).toEqual({ data: null, error: 'not_reading' })
    expect(await library.finish(dune!.id, { endedOn: today })).toEqual({ data: null, error: 'not_reading' })
  })
})

describe('the Not finished filter', () => {
  it('lists the entries whose latest session was abandoned, newest end first, and nothing else', async () => {
    const { library, entries: [earlier, later, finished, reading, wanted] } = await memberWithBooks(
      'Abandoned earlier',
      'Abandoned later',
      'Finished',
      'Reading',
      'Wanted',
    )
    for (const entry of [earlier!, later!, finished!, reading!]) await library.startReading(entry.id, addDays(today, -30))
    await library.abandon(later!.id, { endedOn: addDays(today, -2) })
    await library.abandon(earlier!.id, { endedOn: addDays(today, -20), reason: 'Slow' })
    await library.finish(finished!.id, { endedOn: addDays(today, -1), rating: 12 })

    const ids = await notFinished(library)

    expect(ids).toEqual([later!.id, earlier!.id])
    expect(ids).not.toContain(finished!.id)
    expect(ids).not.toContain(reading!.id)
    expect(ids).not.toContain(wanted!.id)
    // The Finished list still holds them all, the abandoned reads among the finished ones.
    expect((await library.entries('finished')).data!.map((e) => e.id)).toEqual([finished!.id, later!.id, earlier!.id])
  })

  it('follows the latest session: a read started again leaves it, a finished read after an abandoned one stays out', async () => {
    const { library, entries: [dune, emma] } = await memberWithBooks('Dune', 'Emma')
    await library.startReading(dune!.id, addDays(today, -20))
    await library.abandon(dune!.id, { endedOn: addDays(today, -10) })
    await library.startReading(emma!.id, addDays(today, -20))
    await library.finish(emma!.id, { endedOn: addDays(today, -10), rating: 20 })
    expect(await notFinished(library)).toEqual([dune!.id])

    // Dune is started again: it is being read, so it is no longer under Not finished.
    await library.readAgain(dune!.id, addDays(today, -5))
    expect(await notFinished(library)).toEqual([])
    // Finished this time, it stays out; Emma re-read and given up goes in.
    await library.finish(dune!.id, { endedOn: today })
    await library.readAgain(emma!.id, addDays(today, -3))
    await library.abandon(emma!.id, { endedOn: today })
    expect(await notFinished(library)).toEqual([emma!.id])
  })

  it('sorts an abandoned read with the Finished entries, in the order the database does', async () => {
    const { library, entries: [first, second] } = await memberWithBooks('First', 'Second')
    for (const entry of [first!, second!]) await library.startReading(entry.id, addDays(today, -30))
    await library.finish(first!.id, { endedOn: addDays(today, -2) })
    await library.abandon(second!.id, { endedOn: addDays(today, -5) })

    const finished = (await library.entries('finished')).data!
    expect(sortEntries([...finished].reverse()).map((e) => e.id)).toEqual(finished.map((e) => e.id))
  })
})

describe('readAgain', () => {
  it('starts a new session on a finished Book and keeps the first read', async () => {
    const { library, entries: [dune] } = await memberWithBooks('Dune')
    await library.startReading(dune!.id, addDays(today, -20))
    const done = await library.finish(dune!.id, { endedOn: addDays(today, -10), rating: 16, review: 'Spice.' })

    const { data: entry, error } = await library.readAgain(dune!.id, addDays(today, -1))

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      status: 'reading',
      latestSession: { startedOn: addDays(today, -1), endedOn: null, outcome: null, rating: null },
    })
    expect(entry!.latestSession!.id).not.toBe(done.data!.latestSession!.id)
    expect((await library.entries('reading')).data!.map((e) => e.id)).toContain(dune!.id)
    expect((await library.entries('finished')).data!.map((e) => e.id)).not.toContain(dune!.id)
    // The first read is still there, finished, rating and review intact: ending the
    // new one touches only the new session.
    const second = await library.finish(dune!.id, { endedOn: today })
    expect(second.data!.latestSession).toMatchObject({ outcome: 'finished', rating: null, review: null })
  })

  it('starts again on an abandoned Book', async () => {
    const { library, entries: [dune] } = await memberWithBooks('Dune')
    await library.startReading(dune!.id, addDays(today, -20))
    await library.abandon(dune!.id, { endedOn: addDays(today, -10), reason: 'Too much sand.' })

    const { data: entry, error } = await library.readAgain(dune!.id, today)

    expect(error).toBeNull()
    expect(entry).toMatchObject({ status: 'reading', latestSession: { startedOn: today, outcome: null, abandonReason: null } })
  })

  it('is only possible when the latest session is closed', async () => {
    const { library, entries: [wanted, reading] } = await memberWithBooks('Wanted', 'Reading')
    const stranger = await signUpMember()
    await library.startReading(reading!.id, addDays(today, -2))

    expect(await library.readAgain(reading!.id, today)).toEqual({ data: null, error: 'already_reading' })
    expect(await library.readAgain(wanted!.id, today)).toEqual({ data: null, error: 'never_read' })
    expect((await library.entry(wanted!.id)).data!.status).toBe('want_to_read')
    expect(await createLibrary(stranger.client).readAgain(reading!.id, today)).toEqual({
      data: null,
      error: 'entry_not_found',
    })

    await library.abandon(reading!.id, { endedOn: today })
    expect(await library.readAgain(reading!.id, addDays(today, 3))).toEqual({ data: null, error: 'date_in_future' })
    expect((await library.readAgain(reading!.id, today)).error).toBeNull()
    // Open again: a second tap, or a second device, is refused.
    expect(await library.readAgain(reading!.id, today)).toEqual({ data: null, error: 'already_reading' })
  })

  it('is refused for a Book read before as a first read: that is startReading', async () => {
    const { library, entries: [dune] } = await memberWithBooks('Dune')
    await library.startReading(dune!.id, addDays(today, -2))
    await library.abandon(dune!.id, { endedOn: today })

    expect(await library.startReading(dune!.id, today)).toEqual({ data: null, error: 'already_finished' })
  })
})
