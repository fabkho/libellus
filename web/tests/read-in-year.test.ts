import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary, yearBounds } from '@/data/library'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * "Read in <year>" on Home (issue #8) through the repository, against the local
 * stack: the finished sessions with an end date in the calendar year, re-reads
 * included, and nothing else. One count call; the member sees only their own.
 */

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 300,
    year: 1969,
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

type Row = { started?: string | null; ended?: string | null; outcome?: 'finished' | 'abandoned' | null }

/** Sessions written as the owner's import would: dates the member could not pick through the actions. */
async function sessions(entryId: string, rows: Row[]) {
  for (const { started = null, ended = null, outcome = 'finished' } of rows) {
    await sql(
      'insert into public.reading_sessions (entry_id, started_on, ended_on, outcome) values ($1, $2, $3, $4)',
      [entryId, started, ended, outcome],
    )
  }
}

async function memberWithEntry(title = 'The Dispossessed') {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const entry = (await library.addToLibrary(book(title))).data!
  return { member, library, entry }
}

describe('yearBounds', () => {
  it('is the first and the last day of the calendar year', () => {
    expect(yearBounds(2024)).toEqual({ from: '2024-01-01', to: '2024-12-31' })
    expect(yearBounds(987)).toEqual({ from: '0987-01-01', to: '0987-12-31' })
  })
})

describe('readInYear', () => {
  it('is 0 for a member who has finished nothing', async () => {
    const { library } = await memberWithEntry()
    expect(await library.readInYear(Number(isoDay().slice(0, 4)))).toEqual({ data: 0, error: null })
  })

  it('counts finished reads by the year of the end date, the first and last day of the year included', async () => {
    const { library, entry } = await memberWithEntry()
    await sessions(entry.id, [
      { started: '2023-12-20', ended: '2023-12-31' },
      { started: '2023-12-30', ended: '2024-01-01' },
      { started: '2024-06-01', ended: '2024-12-31' },
      { started: '2024-12-30', ended: '2025-01-01' },
    ])

    expect(await library.readInYear(2023)).toEqual({ data: 1, error: null })
    expect(await library.readInYear(2024)).toEqual({ data: 2, error: null })
    expect(await library.readInYear(2025)).toEqual({ data: 1, error: null })
    expect(await library.readInYear(2022)).toEqual({ data: 0, error: null })
  })

  it('counts a re-read of the same Book each time it was finished', async () => {
    const { library, entry } = await memberWithEntry()
    await sessions(entry.id, [
      { started: '2024-01-02', ended: '2024-02-01' },
      { started: '2024-05-02', ended: '2024-06-01' },
      { started: '2024-09-02', ended: '2024-10-01' },
    ])
    expect(await library.readInYear(2024)).toEqual({ data: 3, error: null })
  })

  it('counts every Book finished in the year, not only the entry whose latest read it is', async () => {
    const { member, library, entry } = await memberWithEntry('First')
    const other = (await createLibrary(member.client).addToLibrary(book('Second'))).data!
    await sessions(entry.id, [{ started: '2024-01-02', ended: '2024-02-01' }])
    await sessions(other.id, [{ started: '2023-03-02', ended: '2023-04-01' }, { started: '2024-03-02', ended: '2024-04-01' }])
    expect(await library.readInYear(2024)).toEqual({ data: 2, error: null })
  })

  it('does not count abandoned reads, open reads or finished reads without an end date', async () => {
    const { library, entry } = await memberWithEntry()
    await sessions(entry.id, [
      { started: '2024-01-02', ended: '2024-02-01', outcome: 'abandoned' },
      { started: '2024-03-02', ended: null, outcome: 'finished' },
      { started: null, ended: null, outcome: 'finished' },
      { started: '2024-05-02', ended: '2024-05-20', outcome: 'finished' },
      { started: '2024-07-02', ended: null, outcome: null },
    ])
    expect(await library.readInYear(2024)).toEqual({ data: 1, error: null })
  })

  it('counts a read finished through the Library actions today', async () => {
    const { library, entry } = await memberWithEntry()
    const today = isoDay()
    const year = Number(today.slice(0, 4))
    await library.startReading(entry.id, addDays(today, -1))
    expect((await library.readInYear(year)).data).toBe(0)

    await library.finish(entry.id, { endedOn: today, rating: 16 })

    expect(await library.readInYear(year)).toEqual({ data: 1, error: null })
  })

  it("never counts another member's reads", async () => {
    const mine = await memberWithEntry('Mine')
    const theirs = await memberWithEntry('Theirs')
    await sessions(theirs.entry.id, [{ started: '2024-01-02', ended: '2024-02-01' }])
    await sessions(mine.entry.id, [{ started: '2024-01-02', ended: '2024-02-01' }, { started: '2024-03-02', ended: '2024-04-01' }])

    expect((await mine.library.readInYear(2024)).data).toBe(2)
    expect((await theirs.library.readInYear(2024)).data).toBe(1)
  })
})
