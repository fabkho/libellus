import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { mapFableLibrary, type ImportEntry } from '@/data/import/fable'
import type { Overrides, ReadingTrackerBook } from '@/data/import/readingTracker'
import { createLibrary } from '@/data/library'
import { addDays, isoDay } from '@/utils/dates'
import { withLookup } from '../scripts/fable/covers'
import { findMemberId, writeImport } from '../scripts/fable/write'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, stack, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The Fable import's writes (issue #17) against the local stack, with
 * synthetic records: written as the service role into a real member, then
 * written again, and again with changed overrides. Nothing is doubled; what the
 * member made in the app is left alone; the Status is the database's. What the
 * member sees is read the way the app reads it, through the repository.
 */

/** The service-role key of the stack the suite talks to (owner-only; never in the app). */
function serviceRoleKey(): string {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY
  const env = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const match = env.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m)
  if (!match) throw new Error('`supabase status` did not report SERVICE_ROLE_KEY')
  return match[1]!
}

/** A valid ISBN-13 in 979-0, a range no book uses (it is music's), so no real Book is ever touched. */
function testIsbn(): string {
  const body = `9790${String(randomInt(0, 1e8)).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

const today = isoDay()
const day = (offset: number) => `${addDays(today, offset)}T00:00:00.000Z`

function record(n: number, fields: Partial<ReadingTrackerBook>): ReadingTrackerBook {
  return {
    id: `fixture-${n}-${randomInt(0, 1e9)}`,
    title: runTitle(`Book ${n}`),
    author: 'Ada Example',
    additionalAuthors: null,
    shelf: 'want-to-read',
    isbn: null,
    isbn13: testIsbn(),
    description: null,
    coverUrl: null,
    pageCount: 300,
    yearPublished: '2020',
    publisher: TEST_PUBLISHER,
    createdAt: '2026-03-28 00:54:14',
    session: null,
    ...fields,
  }
}

const finished = (started: number, ended: number, rating: number | null = null) => ({
  startedAt: day(started), finishedAt: day(ended), rating, review: null,
})

let service: SupabaseClient
let member: TestMember
let records: ReadingTrackerBook[]
let appMade: BookSnapshot
const appleId = uniqueAppleId()

/** The plan for the records, with the one Apple edition looked up as the cover step would. */
function planFor(overrides: Overrides = {}): ImportEntry[] {
  return mapFableLibrary(records, overrides).entries.map((entry) =>
    entry.trackerIds.includes(records[5]!.id)
      ? withLookup(entry, {
          apple: { id: appleId, via: 'isbn', isbn13: entry.book.isbn13, description: null },
          openLibrary: null,
          dnb: null,
          cover: { url: 'https://example.com/cover.jpg', source: 'apple', width: 600, height: 900, thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw', colors: { dominant: '#AA3322', secondary: '#112233' } },
        })
      : entry,
  )
}

async function sessionsOf(entryId: string) {
  const { data, error } = await member.client
    .from('reading_sessions')
    .select('started_on, ended_on, outcome, rating, import_key')
    .eq('entry_id', entryId)
    .order('created_at')
  if (error) throw error
  return data
}

async function entryOf(trackerId: string) {
  const { data, error } = await member.client
    .from('library_entries')
    .select('id, status, book_id, import_key')
    .eq('import_key', `fable:${trackerId}`)
  if (error) throw error
  return data[0] ?? null
}

beforeAll(async () => {
  service = createClient(stack.url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  member = await signUpMember()

  // A Book the member added in the app before the import, which Fable also has.
  appMade = {
    title: runTitle('Added in the app'), authors: ['Bo Sample'], isbn13: testIsbn(), isbn10: null, pageCount: null,
    year: 2021, language: 'en', publisher: TEST_PUBLISHER, description: null, coverUrl: null, coverThumbhash: null,
    coverColors: null, source: 'apple', appleId: uniqueAppleId(), openLibraryEditionKey: null, openLibraryWorkKey: null,
  }
  expect((await createLibrary(member.client).addToLibrary(appMade)).error).toBeNull()

  const first = record(1, { shelf: 'read', yearPublished: '2009', session: finished(-400, -380, 4.5) })
  records = [
    first,
    // Another edition of the same book, read again later: the same entry, a second session.
    record(2, { title: first.title, yearPublished: '2019', shelf: 'read', session: finished(-40, -30, 4.75) }),
    record(3, { title: runTitle('Want to read'), author: 'Cy Mock' }),
    record(4, { title: runTitle('Reading now'), author: 'Di Stub', shelf: 'currently-reading', session: { startedAt: day(-3), finishedAt: null, rating: null, review: null } }),
    record(5, { title: runTitle('Not finished'), author: 'Ed Spec', shelf: 'dnf', session: { startedAt: day(-90), finishedAt: null, rating: null, review: null, dnfAt: day(-80), dnfReason: 'Too slow' } }),
    record(6, { title: runTitle('On Apple'), author: 'Flo Dummy', shelf: 'read', session: finished(-20, -10, 5) }),
    // Fable knew it without an ISBN, and no lookup found it: the member's Manual book.
    record(7, { title: runTitle('Nowhere else'), author: 'Gil Fake', isbn13: 'XqT9ab12Cd', shelf: 'read', session: finished(-200, -190) }),
    record(8, { title: appMade.title, author: 'Bo Sample', isbn13: appMade.isbn13, shelf: 'read', session: finished(-60, -50, 3) }),
  ]
})

describe('writeImport', () => {
  it('finds the member by address', async () => {
    expect(await findMemberId(service, member.email.toUpperCase())).toBe(member.id)
    expect(await findMemberId(service, `nobody-${member.email}`)).toBeNull()
  })

  it('writes Books, entries and one session per read, with the Status the database derives', async () => {
    const result = await writeImport(service, member.id, planFor())

    expect(result.problems).toEqual([])
    expect(result.entries).toMatchObject({ created: 6, adopted: 1, unchanged: 0 })
    expect(result.sessions).toMatchObject({ created: 7, updated: 0, deleted: 0 })
    expect(result.books).toMatchObject({ manual: 1, reused: 1 })

    const orchard = (await entryOf(records[1]!.id))!
    expect(orchard.status).toBe('finished')
    expect(await sessionsOf(orchard.id)).toEqual([
      { started_on: addDays(today, -400), ended_on: addDays(today, -380), outcome: 'finished', rating: 18, import_key: `fable:${records[0]!.id}` },
      { started_on: addDays(today, -40), ended_on: addDays(today, -30), outcome: 'finished', rating: 19, import_key: `fable:${records[1]!.id}` },
    ])
    expect((await entryOf(records[2]!.id))!.status).toBe('want_to_read')
    expect((await entryOf(records[3]!.id))!.status).toBe('reading')
    const dnf = (await entryOf(records[4]!.id))!
    expect(dnf.status).toBe('finished')
    expect((await sessionsOf(dnf.id))[0]).toMatchObject({ outcome: 'abandoned', rating: null })

    // What the app shows: the Book the import made, its cover, and the adopted entry, once.
    const library = createLibrary(member.client)
    const finishedEntries = (await library.entries('finished')).data!
    const onApple = finishedEntries.find((entry) => entry.book.appleId === appleId)!
    expect(onApple.book).toMatchObject({ source: 'apple', coverUrl: 'https://example.com/cover.jpg', coverColors: { dominant: '#aa3322', secondary: '#112233' } })
    expect(onApple.latestSession).toMatchObject({ rating: 20 })
    expect(finishedEntries.filter((entry) => entry.book.isbn13 === appMade.isbn13)).toHaveLength(1)
    const manual = finishedEntries.find((entry) => entry.book.title === runTitle('Nowhere else'))!
    expect(manual.book).toMatchObject({ source: 'manual', isbn13: null })
  })

  it('changes nothing when run again', async () => {
    const before = await createLibrary(member.client).entries('finished')
    const result = await writeImport(service, member.id, planFor())

    expect(result.problems).toEqual([])
    expect(result.books).toMatchObject({ created: 0, coverFilled: 0 })
    expect(result.entries).toMatchObject({ created: 0, adopted: 0, moved: 0, unchanged: 7, stale: [] })
    expect(result.sessions).toEqual({ created: 0, updated: 0, unchanged: 7, deleted: 0 })
    expect(await createLibrary(member.client).entries('finished')).toEqual(before)
  })

  it('follows changed overrides without doubling anything, and leaves what the member did in the app alone', async () => {
    // In the app: the member starts the Want to read book.
    const library = createLibrary(member.client)
    const wanted = (await entryOf(records[2]!.id))!
    expect((await library.startReading(wanted.id, today)).error).toBeNull()

    const movedIsbn = testIsbn()
    const result = await writeImport(service, member.id, planFor({
      books: {
        [records[1]!.id]: { dateRead: addDays(today, -29) }, // a corrected finish date
        [records[2]!.id]: { isbn13: movedIsbn }, // the edition actually owned
        [records[4]!.id]: { skip: true }, // not worth keeping after all
      },
    }), { prune: true })

    expect(result.problems).toEqual([])
    expect(result.sessions).toMatchObject({ created: 0, updated: 1 })
    expect(result.entries).toMatchObject({ moved: 1, pruned: 1, stale: [`fable:${records[4]!.id}`] })

    const orchard = (await entryOf(records[1]!.id))!
    expect((await sessionsOf(orchard.id)).map((session) => session.ended_on)).toEqual([addDays(today, -380), addDays(today, -29)])

    const moved = (await entryOf(records[2]!.id))!
    expect(moved.id).toBe(wanted.id)
    expect((await library.book(moved.book_id)).data).toMatchObject({ isbn13: movedIsbn })
    // The session the member started in the app is still there, and still decides the Status.
    expect(moved.status).toBe('reading')
    expect(await sessionsOf(moved.id)).toEqual([{ started_on: today, ended_on: null, outcome: null, rating: null, import_key: null }])

    expect(await entryOf(records[4]!.id)).toBeNull()
  })

  it('puts imported Books into the Catalogue the way search finds them: another member adds the same Book', async () => {
    const imported = (await entryOf(records[5]!.id))!
    const other = await signUpMember()
    const { data, error } = await createLibrary(other.client).addToLibrary({
      title: 'On Apple, as search shows it', authors: ['Flo Dummy'], isbn13: null, isbn10: null, pageCount: null,
      year: null, language: null, publisher: TEST_PUBLISHER, description: null, coverUrl: null, coverThumbhash: null,
      coverColors: null, source: 'apple', appleId, openLibraryEditionKey: null, openLibraryWorkKey: null,
    })
    expect(error).toBeNull()
    expect(data!.book.id).toBe(imported.book_id)
    expect(data!.status).toBe('want_to_read')
  })

  it('reads everything and writes nothing on a dry run', async () => {
    const fresh = await signUpMember()
    const result = await writeImport(service, fresh.id, planFor(), { dryRun: true })
    expect(result.entries.created).toBe(7)
    expect(result.sessions.created).toBe(7)
    expect((await createLibrary(fresh.client).entries('finished')).data).toEqual([])
  })
})
