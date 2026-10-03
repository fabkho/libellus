import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import {
  addWithFromDraft,
  checkAddDraft,
  chooseAddStatus,
  createLibrary,
  newAddDraft,
  type AddWith,
} from '@/data/library'
import { createManualBooks } from '@/data/manualBooks'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Adding a Book with any Status (issue #9) through the repositories, against
 * the local stack, as real signed-in members: the entry and its first read
 * come from one call, for the Catalogue and for Manual books, and the
 * database's refusals come back as codes the sheets can word.
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

describe('addToLibrary with a Status', () => {
  it('adds a Book as Currently reading with its start date', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)

    const { data: entry, error } = await library.addToLibrary(book('Kindred'), {
      status: 'reading',
      startedOn: addDays(today, -4),
    })

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      status: 'reading',
      latestSession: { startedOn: addDays(today, -4), endedOn: null, outcome: null, rating: null, review: null },
    })
    expect((await library.entries('reading')).data!.map((e) => e.id)).toEqual([entry!.id])
    expect((await library.entries('want_to_read')).data).toEqual([])
  })

  it('adds a past read as Finished with both dates, 4.25 stars and a review', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)

    const { data: entry, error } = await library.addToLibrary(book('Dawn'), {
      status: 'finished',
      startedOn: '2021-03-02',
      endedOn: '2021-03-19',
      rating: 17,
      review: '  Slow, then all at once.  ',
    })

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      status: 'finished',
      latestSession: {
        startedOn: '2021-03-02',
        endedOn: '2021-03-19',
        outcome: 'finished',
        rating: 17,
        review: 'Slow, then all at once.',
      },
    })
    expect((await library.entries('finished')).data!.map((e) => e.id)).toEqual([entry!.id])
  })

  it('needs only the end day for a Finished read', async () => {
    const member = await signUpMember()

    const { data: entry, error } = await createLibrary(member.client).addToLibrary(book('Old'), {
      status: 'finished',
      endedOn: '2015-06-01',
    })

    expect(error).toBeNull()
    expect(entry!.latestSession).toMatchObject({ startedOn: null, endedOn: '2015-06-01', rating: null, review: null })
  })

  it('still adds to Want to read by default, with no session', async () => {
    const member = await signUpMember()

    const { data: entry } = await createLibrary(member.client).addToLibrary(book('Later'))

    expect(entry).toMatchObject({ status: 'want_to_read', latestSession: null })
  })

  it('refuses what start and finish refuse, as codes, and keeps nothing', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const refusals: [AddWith, string][] = [
      [{ status: 'reading' }, 'date_invalid'],
      [{ status: 'reading', startedOn: addDays(today, 3) }, 'date_in_future'],
      [{ status: 'reading', startedOn: today, endedOn: today }, 'session_invalid'],
      [{ status: 'reading', startedOn: today, rating: 8 }, 'session_invalid'],
      [{ status: 'want_to_read', startedOn: today }, 'session_invalid'],
      [{ status: 'finished' }, 'date_invalid'],
      [{ status: 'finished', startedOn: addDays(today, -1), endedOn: addDays(today, -2) }, 'ended_before_started'],
      [{ status: 'finished', endedOn: addDays(today, 2) }, 'date_in_future'],
      [{ status: 'finished', endedOn: today, rating: 0 }, 'rating_invalid'],
      [{ status: 'finished', endedOn: today, rating: 21 }, 'rating_invalid'],
      [{ status: 'finished', endedOn: today, review: 'x'.repeat(10_001) }, 'review_too_long'],
    ]

    for (const [options, code] of refusals) {
      const snapshot = book('Refused')
      expect(await library.addToLibrary(snapshot, options), JSON.stringify(options)).toEqual({ data: null, error: code })
      expect((await library.catalogueBook({ appleId: snapshot.appleId! })).data).toBeNull()
    }
    for (const status of ['want_to_read', 'reading', 'finished'] as const) {
      expect((await library.entries(status)).data).toEqual([])
    }
  })

  it('refuses a Book the member already has, whatever the Status', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const snapshot = book('Twice')
    await library.addToLibrary(snapshot, { status: 'finished', endedOn: today })

    expect(await library.addToLibrary(snapshot, { status: 'reading', startedOn: today })).toEqual({
      data: null,
      error: 'already_in_library',
    })
    expect((await library.entries('finished')).data).toHaveLength(1)
  })
})

describe('addManualBook with a Status', () => {
  const typed = (title: string) => ({ title: runTitle(title), author: 'Ida Beispiel' })

  it('adds a Manual book as Currently reading', async () => {
    const member = await signUpMember()

    const { data: entry, error } = await createManualBooks(member.client).addManualBook(typed('Lesend'), {
      status: 'reading',
      startedOn: addDays(today, -1),
    })

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      status: 'reading',
      book: { source: 'manual' },
      latestSession: { startedOn: addDays(today, -1), endedOn: null, outcome: null },
    })
  })

  it('adds a Manual book as Finished with dates, Rating and review', async () => {
    const member = await signUpMember()

    const { data: entry, error } = await createManualBooks(member.client).addManualBook(typed('Gelesen'), {
      status: 'finished',
      startedOn: '2019-07-01',
      endedOn: '2019-07-20',
      rating: 17,
      review: 'Unvergesslich.',
    })

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      status: 'finished',
      latestSession: { startedOn: '2019-07-01', endedOn: '2019-07-20', outcome: 'finished', rating: 17, review: 'Unvergesslich.' },
    })
    expect((await createLibrary(member.client).entries('finished')).data!.map((e) => e.id)).toEqual([entry!.id])
  })

  it('adds a Manual book to Want to read when no Status is given', async () => {
    const member = await signUpMember()

    const { data: entry } = await createManualBooks(member.client).addManualBook(typed('Später'))

    expect(entry).toMatchObject({ status: 'want_to_read', latestSession: null })
  })

  it('refuses what the database refuses, as codes, and keeps no Book', async () => {
    const member = await signUpMember()
    const manual = createManualBooks(member.client)

    expect(await manual.addManualBook(typed('Ohne Start'), { status: 'reading' })).toEqual({ data: null, error: 'date_invalid' })
    expect(await manual.addManualBook(typed('Zukunft'), { status: 'finished', endedOn: addDays(today, 1) })).toEqual({
      data: null,
      error: 'date_in_future',
    })
    expect(
      await manual.addManualBook(typed('Rückwärts'), { status: 'finished', startedOn: today, endedOn: addDays(today, -1) }),
    ).toEqual({ data: null, error: 'ended_before_started' })
    expect(await manual.addManualBook(typed('Zu viel'), { status: 'finished', endedOn: today, rating: 21 })).toEqual({
      data: null,
      error: 'rating_invalid',
    })
    expect(await manual.addManualBook(typed('Datiert'), { status: 'want_to_read', endedOn: today })).toEqual({
      data: null,
      error: 'session_invalid',
    })
    for (const status of ['want_to_read', 'reading', 'finished'] as const) {
      expect((await createLibrary(member.client).entries(status)).data).toEqual([])
    }
  })
})

describe('the Add sheets\' draft', () => {
  it('starts on Want to read with nothing chosen', () => {
    expect(newAddDraft()).toEqual({ status: 'want_to_read', startedOn: '', endedOn: '', rating: null, review: '' })
    expect(addWithFromDraft(newAddDraft())).toEqual({ status: 'want_to_read' })
  })

  it('gives each Status the days it starts with and keeps the Rating and review', () => {
    const draft = newAddDraft()

    chooseAddStatus(draft, 'reading', '2026-10-03')
    expect(draft).toMatchObject({ status: 'reading', startedOn: '2026-10-03', endedOn: '' })

    chooseAddStatus(draft, 'finished', '2026-10-03')
    expect(draft).toMatchObject({ status: 'finished', startedOn: '', endedOn: '2026-10-03' })
    draft.rating = 17
    draft.review = 'Loved it'

    chooseAddStatus(draft, 'want_to_read', '2026-10-03')
    expect(draft).toMatchObject({ status: 'want_to_read', startedOn: '', endedOn: '', rating: 17, review: 'Loved it' })
    expect(addWithFromDraft(draft)).toEqual({ status: 'want_to_read' })
  })

  it('sends only what belongs to the Status', () => {
    const draft = { status: 'finished' as const, startedOn: '2026-09-01', endedOn: '2026-09-20', rating: 17, review: 'Good' }
    expect(addWithFromDraft(draft)).toEqual({
      status: 'finished',
      startedOn: '2026-09-01',
      endedOn: '2026-09-20',
      rating: 17,
      review: 'Good',
    })
    expect(addWithFromDraft({ ...draft, status: 'reading' })).toEqual({ status: 'reading', startedOn: '2026-09-01' })
  })

  it('finds what the database would refuse, in the member\'s own today', () => {
    const on = (patch: object) => checkAddDraft({ ...newAddDraft(), ...patch }, '2026-10-03')

    expect(on({})).toBeNull()
    expect(on({ status: 'reading', startedOn: '2026-10-03' })).toBeNull()
    expect(on({ status: 'reading', startedOn: '' })).toBe('date_invalid')
    expect(on({ status: 'reading', startedOn: '2026-10-04' })).toBe('date_in_future')
    expect(on({ status: 'finished', endedOn: '2026-10-03' })).toBeNull()
    expect(on({ status: 'finished', endedOn: '' })).toBe('date_invalid')
    expect(on({ status: 'finished', endedOn: '2026-10-04' })).toBe('date_in_future')
    expect(on({ status: 'finished', startedOn: '2026-10-04', endedOn: '2026-10-03' })).toBe('date_in_future')
    expect(on({ status: 'finished', startedOn: '2026-09-02', endedOn: '2026-09-01' })).toBe('ended_before_started')
    expect(on({ status: 'finished', startedOn: '2026-09-01', endedOn: '2026-09-01' })).toBeNull()
  })
})
