import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createLibrary, type LibraryEntry } from '@/data/library'
import { backoff, createOutbox, createSender, memoryOutboxStorage, type Send } from '@/data/outbox'
import { applyWrite, applyWrites, QUEUED_ACTIONS, type QueuedWrite, type WriteQueue } from '@/data/queuedWrites'
import { addDays } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { bookDays, dayBook, daysOf, stateOf, utcToday } from './support/progressDays'
import { sql } from './support/stack'

/**
 * Progress on an earlier day, written offline (docs/plans/backdated-progress.md, section 5): `set_progress_day` and
 * `delete_progress_day` wait in the outbox like `update_progress`, answer at once with the entry as it will be,
 * leave in the order they were made through `sync_write` at most once per id, and the days they leave are the days
 * the same writes leave online. Refusals the database names are failures the member can read; a deadlock is tried again.
 */

const today = utcToday()
const page = (n: number) => ({ page: n })

/** The phone, as the stores make it (tests/outbox.test.ts): the device's copy, an outbox on memory, the repository wired to both. */
function device(member: TestMember, { send, storage = memoryOutboxStorage(), now }: { send?: Send; storage?: ReturnType<typeof memoryOutboxStorage>; now?: () => number } = {}) {
  const copy = new Map<string, LibraryEntry>()
  const state = { offline: false }
  const outbox = createOutbox({ memberId: member.id, storage, send: send ?? createSender(member.client), now })
  const queue: WriteQueue = {
    open: () => true,
    holds: () => state.offline || outbox.items().length > 0,
    entry: (id) => copy.get(id) ?? null,
    entryForBook: (bookId) => [...copy.values()].find((entry) => entry.book.id === bookId) ?? null,
    collection: () => null,
    add: (write) => outbox.add(write),
  }
  const library = createLibrary(member.client, { online: () => !state.offline, queue })
  const keep = <T extends { data: LibraryEntry | null; error: unknown }>(result: T): T => {
    if (result.data) copy.set(result.data.id, result.data)
    return result
  }
  return { state, outbox, storage, library, keep }
}

/** A member with a read of 300 pages begun 20 days ago and these days booked on it (a day: ago, start, end). */
async function reader(rows: [number, number | null, number][] = [[6, null, 40], [4, 40, 90], [1, 90, 140]], current: number | null = 140) {
  const member = await signUpMember()
  const phone = device(member)
  const added = phone.keep(await phone.library.addToLibrary(dayBook('Piranesi', 300), { status: 'reading', startedOn: addDays(today, -20) }))
  const entry = added.data as LibraryEntry
  await bookDays(entry.latestSession!.id, rows, current)
  const refreshed = phone.keep((await phone.library.entry(entry.id)) as { data: LibraryEntry | null; error: unknown })
  return { member, phone, entry: refreshed.data as LibraryEntry, session: entry.latestSession!.id }
}

describe('earlier days written offline', () => {
  it('wait in order, answer with the entry as it is, and leave the days the same writes leave online', async () => {
    const offline = await reader()
    const online = await reader()
    const steps = [
      (library: ReturnType<typeof createLibrary>, entry: LibraryEntry) => library.setProgressDay(entry.id, addDays(today, -5), page(60)),
      (library: ReturnType<typeof createLibrary>, entry: LibraryEntry) => library.setProgressDay(entry.id, addDays(today, -8), page(10)),
      (library: ReturnType<typeof createLibrary>, entry: LibraryEntry) => library.deleteProgressDay(entry.id, addDays(today, -4)),
      (library: ReturnType<typeof createLibrary>, entry: LibraryEntry) => library.setProgressDay(entry.id, addDays(today, -5), page(75)),
      (library: ReturnType<typeof createLibrary>, entry: LibraryEntry) => library.deleteProgressDay(entry.id, addDays(today, -1)),
    ]
    for (const step of steps) expect((await step(online.phone.library, online.entry)).error).toBeNull()

    offline.phone.state.offline = true
    for (const step of steps) {
      const result = offline.phone.keep(await step(offline.phone.library, offline.entry))
      expect(result.error).toBeNull()
      // The device's copy is the entry as it was: only the days (the overlay) and the value (R5) can change.
      expect(result.data!.id).toBe(offline.entry.id)
    }
    expect(offline.phone.outbox.items().map((item) => item.action)).toEqual([
      'set_progress_day',
      'set_progress_day',
      'delete_progress_day',
      'set_progress_day',
      'delete_progress_day',
    ])
    expect(offline.phone.outbox.items().map((item) => item.args.p_day)).toEqual([-5, -8, -4, -5, -1].map((ago) => addDays(today, ago)))
    // Nothing reached the database.
    expect(await daysOf(offline.phone.library, offline.session)).toEqual(await bookedRows([[6, null, 40], [4, 40, 90], [1, 90, 140]]))

    offline.phone.state.offline = false
    const report = await offline.phone.outbox.flush()
    expect(report).toMatchObject({ refused: [], waiting: 0, retryAt: null })
    expect(report.taken.map((item) => item.action)).toEqual(steps.map((_, i) => (i === 2 || i === 4 ? 'delete_progress_day' : 'set_progress_day')))

    const strip = (days: Awaited<ReturnType<typeof daysOf>>) => days.map((d) => ({ ago: Math.round((Date.parse(today) - Date.parse(d.day)) / 86_400_000), start: d.start, end: d.end }))
    expect(strip(await daysOf(offline.phone.library, offline.session))).toEqual(strip(await daysOf(online.phone.library, online.session)))
    expect(await stateOf(offline.session)).toEqual(await stateOf(online.session))
  })

  it('goes after the writes already waiting, even once the device is online again', async () => {
    const { member, phone, entry, session } = await reader()
    phone.state.offline = true
    phone.keep(await phone.library.setProgressDay(entry.id, addDays(today, -5), page(60)))
    phone.state.offline = false
    // Online, but the first write has not synced: this one must not overtake it.
    phone.keep(await phone.library.setProgressDay(entry.id, addDays(today, -5), page(70)))
    expect(phone.outbox.items().map((item) => item.args.p_page)).toEqual([60, 70])
    expect((await daysOf(createLibrary(member.client), session)).find((d) => d.day === addDays(today, -5))).toBeUndefined()
    await phone.outbox.flush()
    expect((await daysOf(phone.library, session)).find((d) => d.day === addDays(today, -5))).toEqual({ day: addDays(today, -5), start: page(40), end: page(70) })
  })

  it('follows a read that was begun offline: its start goes first, then the days', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const entry = phone.keep(await phone.library.addToLibrary(dayBook('Jonathan Strange', 300), { status: 'want_to_read' })).data!
    phone.state.offline = true
    const started = phone.keep(await phone.library.startReading(entry.id, addDays(today, -6)))
    expect(started.data!.latestSession!.id).not.toMatch(/^[0-9a-f]{8}-/)
    phone.keep(await phone.library.setProgressDay(entry.id, addDays(today, -4), page(50)))
    phone.keep(await phone.library.setProgressDay(entry.id, addDays(today, -2), page(80)))
    // Before the read began: refused at the database, not in the device's copy (it does not know the days).
    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report.refused).toEqual([])
    const session = (await createLibrary(member.client).entry(entry.id)).data!.latestSession!
    expect(await daysOf(phone.library, session.id)).toEqual([
      { day: addDays(today, -4), start: null, end: page(50) },
      { day: addDays(today, -2), start: page(50), end: page(80) },
    ])
    // Setting the first one made it the latest and the days lead the (empty) value: the value follows the later day.
    expect(session).toMatchObject({ progressPage: 80 })
  })

  it('is not applied twice when its answer was lost: the replay is the first answer, not a second clamp', async () => {
    const { member, entry, session } = await reader()
    const real = createSender(member.client)
    let loseNext = true
    // The call reaches the database; the answer never reaches the phone.
    const send: Send = async (item) => {
      const outcome = await real(item)
      if (loseNext) {
        loseNext = false
        return { kind: 'unreachable' }
      }
      return outcome
    }
    let clock = Date.now()
    const storage = memoryOutboxStorage()
    const phone = device(member, { send, storage })
    phone.keep({ data: entry, error: null })
    phone.state.offline = true
    // 250 is past the day after (4 ago ends at 90): clamped to 90, which takes that day away. Sent twice without the id's
    // protection, the second call would clamp against the next day over (140) and end the day there.
    phone.keep(await phone.library.setProgressDay(entry.id, addDays(today, -5), page(250)))
    phone.state.offline = false

    const outbox = createOutbox({ memberId: member.id, storage, send, now: () => clock })
    await outbox.ready
    expect(await outbox.flush()).toMatchObject({ taken: [], waiting: 1 })
    expect((await daysOf(phone.library, session)).map((d) => d.day)).toEqual([addDays(today, -6), addDays(today, -5), addDays(today, -1)])

    clock += backoff(1)
    expect(await outbox.flush()).toMatchObject({ refused: [], waiting: 0 })
    expect(await daysOf(phone.library, session)).toEqual([
      { day: addDays(today, -6), start: null, end: page(40) },
      { day: addDays(today, -5), start: page(40), end: page(90) },
      { day: addDays(today, -1), start: page(90), end: page(140) },
    ])
  })

  it('answers a second send of the same id with the first result (sync_write)', async () => {
    const { member, entry, session } = await reader()
    const id = crypto.randomUUID()
    const args = { p_entry_id: entry.id, p_day: addDays(today, -3), p_page: 70, p_percent: null }
    const first = await member.client.rpc('sync_write', { p_request_id: id, p_action: 'set_progress_day', p_args: args })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ replayed: false })
    await member.client.rpc('sync_write', { p_request_id: crypto.randomUUID(), p_action: 'delete_progress_day', p_args: { p_entry_id: entry.id, p_day: addDays(today, -3) } })
    const again = await member.client.rpc('sync_write', { p_request_id: id, p_action: 'set_progress_day', p_args: args })
    expect(again.data).toMatchObject({ replayed: true })
    // The replay did not put the day back.
    expect((await daysOf(createLibrary(member.client), session)).find((d) => d.day === addDays(today, -3))).toBeUndefined()
  })

  it('does not move a day older than yesterday up to yesterday, as an update of the progress does', async () => {
    const { phone, entry, session } = await reader([], null)
    phone.state.offline = true
    phone.keep(await phone.library.setProgressDay(entry.id, addDays(today, -9), page(30)))
    phone.state.offline = false
    await phone.outbox.flush()
    expect(await daysOf(phone.library, session)).toEqual([{ day: addDays(today, -9), start: null, end: page(30) }])
  })
})

describe('what the outbox does with a refusal', () => {
  it('makes a failure of a day the database refuses (not_reading, entry_not_found, date_invalid), and still sends the ones behind it', async () => {
    const { member, phone, entry, session } = await reader()
    const other = phone.keep(await phone.library.addToLibrary(dayBook('Gone', 300), { status: 'reading', startedOn: addDays(today, -10) })).data!
    const finishing = phone.keep(await phone.library.addToLibrary(dayBook('Done', 300), { status: 'reading', startedOn: addDays(today, -10) })).data!

    phone.state.offline = true
    // Before the read began: only the database knows the day of a new row is too early.
    phone.keep(await phone.library.setProgressDay(entry.id, addDays(today, -25), page(10)))
    phone.keep(await phone.library.setProgressDay(other.id, addDays(today, -3), page(10)))
    phone.keep(await phone.library.setProgressDay(finishing.id, addDays(today, -3), page(10)))
    phone.keep(await phone.library.deleteProgressDay(finishing.id, addDays(today, -3)))
    phone.keep(await phone.library.setProgressDay(entry.id, addDays(today, -5), page(60)))
    // Meanwhile, on another device: the entry is removed and the read finished.
    const elsewhere = createLibrary(member.client)
    await elsewhere.removeFromLibrary(other.id)
    await elsewhere.finish(finishing.id, { endedOn: today })

    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report.refused.map((failure) => [failure.action, failure.code])).toEqual([
      ['set_progress_day', 'date_invalid'],
      ['set_progress_day', 'entry_not_found'],
      ['set_progress_day', 'not_reading'],
      ['delete_progress_day', 'not_reading'],
    ])
    expect(report.refused.every((failure) => failure.domain === 'library')).toBe(true)
    expect(report.taken.map((item) => item.action)).toEqual(['set_progress_day'])
    expect(phone.outbox.items()).toEqual([])
    expect((await daysOf(phone.library, session)).find((d) => d.day === addDays(today, -5))).toEqual({ day: addDays(today, -5), start: page(40), end: page(60) })
  })

  it('tries a deadlock (40P01) again and lands the day then, once', async () => {
    const { member, phone, entry, session } = await reader()
    let calls = 0
    const flaky = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls++
        if (calls === 1) return { data: null, error: { code: '40P01', message: 'deadlock detected' }, status: 500 }
        return member.client.rpc(name, args)
      },
    } as unknown as SupabaseClient
    let clock = Date.now()
    const storage = memoryOutboxStorage()
    const box = device(member, { send: createSender(flaky), storage, now: () => clock })
    box.keep({ data: entry, error: null })
    box.state.offline = true
    box.keep(await box.library.setProgressDay(entry.id, addDays(today, -5), page(60)))
    box.state.offline = false
    const tried = await box.outbox.flush()
    expect(tried).toMatchObject({ taken: [], refused: [], waiting: 1 })
    expect(tried.retryAt).toBe(clock + backoff(1))
    expect((await daysOf(phone.library, session)).find((d) => d.day === addDays(today, -5))).toBeUndefined()
    clock += backoff(1)
    expect(await box.outbox.flush()).toMatchObject({ refused: [], waiting: 0 })
    expect(calls).toBe(2)
    expect((await daysOf(phone.library, session)).find((d) => d.day === addDays(today, -5))).toEqual({ day: addDays(today, -5), start: page(40), end: page(60) })
  })
})

async function bookedRows(rows: [number, number | null, number][]) {
  return rows.map(([ago, start, end]) => ({ day: addDays(today, -ago), start: start === null ? null : page(start), end: page(end) }))
}

describe('applyWrite for the two actions', () => {
  const entry = (patch: Partial<LibraryEntry> = {}): LibraryEntry => ({
    id: 'e1',
    status: 'reading',
    addedAt: '2026-10-01T00:00:00Z',
    book: { id: 'b1', createdAt: '2026-10-01T00:00:00Z', title: 'Piranesi', authors: [], isbn13: null, isbn10: null, pageCount: 300, year: 2020, language: 'en', publisher: null, description: null, coverUrl: null, coverThumbhash: null, coverColors: null, source: 'apple', appleId: null, openLibraryEditionKey: null, openLibraryWorkKey: null },
    pageCountOverride: null,
    formatOverride: null,
    readAs: null,
    hidden: false,
    latestSession: {
      id: 's1', startedOn: '2026-10-20', endedOn: null, outcome: null, rating: null, review: null, reviewSpoilers: false, abandonReason: null,
      progressPage: 140, progressPercent: null, progressUpdatedAt: '2026-11-01T10:00:00Z', createdAt: '2026-10-20T10:00:00Z', readAs: null,
    } as LibraryEntry['latestSession'],
    ...patch,
  })
  const write = (action: 'set_progress_day' | 'delete_progress_day', args: Record<string, unknown>): QueuedWrite => ({
    action,
    args: { p_entry_id: 'e1', p_day: '2026-11-01', ...args },
    about: 'Piranesi',
    queuedAt: '2026-11-04T09:00:00Z',
    entryId: 'e1',
  } as QueuedWrite)

  it('is a queued action', () => {
    expect(QUEUED_ACTIONS).toContain('set_progress_day')
    expect(QUEUED_ACTIONS).toContain('delete_progress_day')
  })

  it('leaves the entry as it is: the days and the value the days lead are not on it', () => {
    expect(applyWrite(entry(), write('set_progress_day', { p_page: 50, p_percent: null }))).toEqual(entry())
    expect(applyWrite(entry(), write('delete_progress_day', {}))).toEqual(entry())
  })

  it('refuses what the database would refuse at once, with its code', () => {
    expect(applyWrite(null, write('set_progress_day', { p_page: 50 }))).toBe('entry_not_found')
    expect(applyWrite(entry({ latestSession: { ...entry().latestSession!, outcome: 'finished', endedOn: '2026-11-02' } }), write('set_progress_day', { p_page: 50 }))).toBe('not_reading')
    expect(applyWrite(entry({ latestSession: { ...entry().latestSession!, outcome: 'abandoned', endedOn: '2026-11-02' } }), write('delete_progress_day', {}))).toBe('not_reading')
    expect(applyWrite(entry(), write('set_progress_day', { p_page: 50, p_percent: 20 }))).toBe('progress_invalid')
    expect(applyWrite(entry(), write('set_progress_day', { p_page: null, p_percent: null }))).toBe('progress_invalid')
    expect(applyWrite(entry(), write('set_progress_day', { p_page: 301 }))).toBe('progress_invalid')
    expect(applyWrite(entry({ pageCountOverride: 100 }), write('set_progress_day', { p_page: 120 }))).toBe('progress_invalid')
    expect(applyWrite(entry(), write('set_progress_day', { p_percent: 101 }))).toBe('progress_invalid')
    expect(applyWrite(entry({ book: { ...entry().book, pageCount: null } }), write('set_progress_day', { p_page: 5 }))).toBe('progress_invalid')
    expect(applyWrite(entry(), write('set_progress_day', { p_day: 'yesterday', p_page: 50 }))).toBe('date_invalid')
    expect(applyWrite(entry(), write('delete_progress_day', { p_day: null }))).toBe('date_invalid')
  })

  it('lays waiting day writes over a Library without changing it, and skips one that no longer fits', () => {
    const lists = { want_to_read: [], reading: [entry()], finished: [] }
    expect(applyWrites(lists, [write('set_progress_day', { p_page: 50 }), write('delete_progress_day', {})]).reading).toEqual([entry()])
    expect(applyWrites(lists, [write('set_progress_day', { p_page: 500 })])).toBe(lists)
  })
})

// A direct SQL guard: the helper that seeds days must not have changed the entry's own value.
describe('the fixture', () => {
  it('books days under the member\'s read and nothing else', async () => {
    const { session } = await reader([[2, null, 20]], 20)
    const rows = await sql<{ n: number }>('select count(*)::int as n from public.reading_progress_days where session_id = $1', [session])
    expect(rows[0]!.n).toBe(1)
  })
})
